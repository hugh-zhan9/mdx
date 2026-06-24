"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeWorkspacePath } from "../../workspace/lib/path";
import {
  cancelLlmWikiOperation,
  createDigest,
  detectLlmWikiWorkspace,
  getLlmConfig,
  getLlmWikiOperationState,
  ingestRawFile,
  initializeLlmWikiWorkspace,
  queryWiki,
  refreshKnowledgeGraph,
  rescanRaw,
  runLint,
} from "../lib/llm-wiki-client";
import {
  canRunLlmWikiQuery,
  isCurrentLlmWikiQueryRequest,
} from "../lib/query-eligibility";
import {
  createExclusiveOperationRunner,
  getLlmWikiOperationLabel,
  getLlmWikiStageLabel,
  isLlmWikiActiveOperationOwner,
  type LlmWikiOperation,
} from "../lib/operation-state";
import {
  createAutoProcessingTracker,
  shouldStartAutoProcessing,
} from "../lib/auto-processing";
import { createLlmWikiStatusViewModel } from "../lib/status-view-model";
import type {
  LlmWikiPanelState,
  LlmWikiQueryResponse,
  LlmWikiStatusViewModel,
  LlmWikiWorkspaceStatus,
  PublicLlmProviderConfig,
  RawScanResult,
} from "../lib/types";

export interface LlmWikiWorkspaceHook {
  status: LlmWikiWorkspaceStatus | null;
  viewModel: LlmWikiStatusViewModel;
  message: string | null;
  queryAnswer: LlmWikiQueryResponse | null;
  isReady: boolean;
  isLoading: boolean;
  isQuerying: boolean;
  isProcessing: boolean;
  activeOperation: LlmWikiOperation | null;
  activeOperationId: string | null;
  activeOperationLabel: string | null;
  activeStageLabel: string | null;
  cancelActiveOperation: () => Promise<void>;
  initialize: () => Promise<void>;
  rescan: () => Promise<void>;
  lint: () => Promise<void>;
  graph: () => Promise<void>;
  digest: (title: string, prompt: string) => Promise<void>;
  query: (question: string) => Promise<void>;
  refresh: () => Promise<void>;
  handleRawFileSaved: (path: string) => void;
}

interface UseLlmWikiWorkspaceOptions {
  canAutoProcess?: boolean;
}

const EMPTY_SCAN: RawScanResult = {
  total: 0,
  pendingTotal: 0,
  pending: [],
  completed: [],
  failed: [],
  skipped: [],
};

const MAX_PENDING_PATH_PREVIEW = 10;
const MAX_FAILED_INGEST_SUMMARY = 20;
const MAX_INLINE_ERROR_CHARS = 1000;

interface RootSnapshot {
  rootPath: string;
  status: LlmWikiWorkspaceStatus | null;
  config: PublicLlmProviderConfig | null;
  scan: RawScanResult;
  message: string | null;
  queryAnswer: LlmWikiQueryResponse | null;
  isLoading: boolean;
  isQuerying: boolean;
  activeOperation: LlmWikiOperation | null;
  activeOperationId: string | null;
  activeStage: string | null;
}

export function formatPendingRawStartMessage(
  processedCount: number,
  pending: string[],
) {
  const pendingPreview = pending.slice(0, MAX_PENDING_PATH_PREVIEW);
  const hiddenCount = pending.length - pendingPreview.length;
  return [
    `开始后台处理 raw：${processedCount}/${processedCount + pending.length}`,
    `待处理：${pending.length}`,
    ...pendingPreview.map((path) => `- ${path}`),
    ...(hiddenCount > 0 ? [`... 还有 ${hiddenCount} 个待处理未显示`] : []),
  ].join("\n");
}

function formatFailedIngestSummary(
  processedCount: number,
  failed: Array<{ path: string; error: string }>,
) {
  if (failed.length === 0) {
    return `后台处理完成：${processedCount} 个 raw。`;
  }

  const failedPreview = failed.slice(0, MAX_FAILED_INGEST_SUMMARY);
  const hiddenCount = failed.length - failedPreview.length;
  return [
    `后台处理完成：${processedCount} 个成功，${failed.length} 个失败。`,
    "",
    ...failedPreview.map(
      (item, index) =>
        `${index + 1}. ${item.path}\n   ${formatInlineText(item.error, MAX_INLINE_ERROR_CHARS)}`,
    ),
    ...(hiddenCount > 0 ? [`... 还有 ${hiddenCount} 个失败未显示`] : []),
  ].join("\n");
}

function formatInlineText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}...`;
}

export function useLlmWikiWorkspace(
  rootPath: string,
  options: UseLlmWikiWorkspaceOptions = {},
): LlmWikiWorkspaceHook {
  const canAutoProcess = options.canAutoProcess ?? true;
  const activeRootPathRef = useRef(rootPath);
  const requestIdRef = useRef(0);
  const queryGenerationRef = useRef(0);
  const concurrentQueryRef = useRef(false);
  const autoRescanRef = useRef({
    running: false,
    pending: false,
    rootPath: "",
  });
  const autoProcessingTrackerRef = useRef(createAutoProcessingTracker());
  const operationRunnerRef = useRef(createExclusiveOperationRunner());
  const [snapshot, setSnapshot] = useState<RootSnapshot>(() =>
    createInitialSnapshot(rootPath),
  );
  const currentSnapshot =
    snapshot.rootPath === rootPath ? snapshot : createInitialSnapshot(rootPath);
  const { status, config, scan, message, queryAnswer, isQuerying } =
    currentSnapshot;
  const activeOperation = currentSnapshot.activeOperation;
  const activeOperationId = currentSnapshot.activeOperationId;
  const activeStage = currentSnapshot.activeStage;
  const isLoading = currentSnapshot.isLoading || snapshot.rootPath !== rootPath;
  const isProcessing = activeOperation !== null;
  const isReady =
    Boolean(rootPath) && !isLoading && snapshot.rootPath === rootPath;

  useLayoutEffect(() => {
    if (activeRootPathRef.current !== rootPath) {
      queryGenerationRef.current += 1;
    }

    activeRootPathRef.current = rootPath;
  }, [rootPath]);

  const setMessageForError = useCallback((prefix: string, error: unknown) => {
    setSnapshot((current) => ({
      ...current,
      message: `${prefix}：${formatError(error)}`,
      isLoading: false,
    }));
  }, []);

  const runExclusiveOperation = useCallback(
    async (
      operation: LlmWikiOperation,
      task: (context: { operationId: string | null }) => Promise<void>,
    ) => {
      const operationId = createLlmWikiOperationId(operation);
      const result = await operationRunnerRef.current.run(operation, async () => {
        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                activeOperation: operation,
                activeOperationId: operationId,
                activeStage: null,
                message:
                  current.message ??
                  getLlmWikiOperationLabel(operation),
              }
            : current,
        );

        try {
          await task({ operationId });
        } finally {
          setSnapshot((current) =>
            current.rootPath === rootPath &&
            isLlmWikiActiveOperationOwner(current, operation, operationId)
              ? {
                  ...current,
                  activeOperation: null,
                  activeOperationId: null,
                  activeStage: null,
                }
              : current,
          );
        }
      });

      if (
        result.status === "skipped" &&
        activeRootPathRef.current === rootPath
      ) {
        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                activeOperation:
                  operationRunnerRef.current.getActiveOperation(),
              }
            : current,
        );
      }
    },
    [rootPath],
  );

  const runBackgroundIngest = useCallback(
    async (ingestRootPath: string, pending: string[]) => {
      if (pending.length === 0) {
        return;
      }

      function toProgressFailures(
        failed: Array<{ path: string; error: string }>,
      ) {
        return failed.map((item) => ({
          path: item.path,
          reason: item.error,
        }));
      }

      const failed: Array<{ path: string; error: string }> = [];
      const failedPaths = new Set<string>();
      let batch = pending;
      let processedCount = 0;

      while (batch.length > 0) {
        setSnapshot((current) =>
          current.rootPath === ingestRootPath
            ? {
                ...current,
                message: formatPendingRawStartMessage(processedCount, batch),
              }
            : current,
        );

        for (const rawRelativePath of batch) {
          if (activeRootPathRef.current !== ingestRootPath) {
            return;
          }

          const totalInBatch = processedCount + batch.length;
          const startedAt = Date.now();
          const updateProcessingMessage = () => {
            const elapsedSeconds = Math.max(
              0,
              Math.floor((Date.now() - startedAt) / 1000),
            );
            setSnapshot((current) =>
              current.rootPath === ingestRootPath
                ? {
                    ...current,
                    message: [
                      `正在处理 raw：${processedCount + 1}/${totalInBatch}`,
                      `当前：${rawRelativePath}`,
                      `状态：等待 LLM 返回，已等待 ${elapsedSeconds} 秒`,
                      "阶段：后端会依次执行分析和生成，完成或失败后会写入日志",
                      `已完成：${processedCount}`,
                      `已失败：${failed.length}`,
                    ].join("\n"),
                  }
                : current,
            );
          };
          let heartbeat: ReturnType<typeof setInterval> | null = null;
          const operationId = createLlmWikiOperationId("ingest");

          try {
            setSnapshot((current) =>
              current.rootPath === ingestRootPath
                ? {
                    ...current,
                    activeOperation: "ingest",
                    activeOperationId: operationId,
                    activeStage: null,
                  }
                : current,
            );
            updateProcessingMessage();
            heartbeat = setInterval(updateProcessingMessage, 1000);
            await ingestRawFile(
              ingestRootPath,
              rawRelativePath,
              operationId ?? undefined,
            );
            processedCount += 1;
            setSnapshot((current) =>
              current.rootPath === ingestRootPath
                ? {
                    ...current,
                    message: `后台处理 raw：${processedCount} 个已完成`,
                  }
                : current,
            );
          } catch (error) {
            failedPaths.add(rawRelativePath);
            failed.push({
              path: rawRelativePath,
              error: formatError(error),
            });
            setSnapshot((current) =>
              current.rootPath === ingestRootPath
                ? {
                    ...current,
                    message: [
                      `后台处理 raw 失败：${processedCount}/${totalInBatch} 个已完成`,
                      `当前：${rawRelativePath}`,
                      `错误：${formatInlineText(formatError(error), MAX_INLINE_ERROR_CHARS)}`,
                    ].join("\n"),
                  }
                : current,
            );
          try {
              const failureScan = await rescanRaw(
                ingestRootPath,
                Array.from(failedPaths),
                toProgressFailures(failed),
              );
              if (activeRootPathRef.current === ingestRootPath) {
                setSnapshot((current) =>
                  current.rootPath === ingestRootPath
                    ? {
                        ...current,
                        scan: failureScan,
                      }
                    : current,
                );
              }
            } catch (progressError) {
              console.warn(
                "Failed to persist LLM Wiki ingest failure progress.",
                progressError,
              );
            }
          } finally {
            if (heartbeat) {
              clearInterval(heartbeat);
            }
            setSnapshot((current) =>
              current.rootPath === ingestRootPath &&
              current.activeOperationId === operationId
                ? {
                    ...current,
                    activeOperation: null,
                    activeOperationId: null,
                    activeStage: null,
                  }
                : current,
            );
          }
        }

        if (activeRootPathRef.current !== ingestRootPath) {
          break;
        }

        const next = await rescanRaw(
          ingestRootPath,
          Array.from(failedPaths),
          toProgressFailures(failed),
        );

        if (activeRootPathRef.current !== ingestRootPath) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === ingestRootPath
            ? {
                ...current,
                scan: next,
              }
            : current,
        );
        batch = next.pending.filter((path) => !failedPaths.has(path));
      }

      const latest = await rescanRaw(
        ingestRootPath,
        Array.from(failedPaths),
        toProgressFailures(failed),
      );

      if (activeRootPathRef.current !== ingestRootPath) {
        return;
      }

      setSnapshot((current) =>
        current.rootPath === ingestRootPath
          ? {
              ...current,
              scan: latest,
              message: formatFailedIngestSummary(processedCount, failed),
            }
          : current,
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setSnapshot((current) =>
      createLoadingSnapshot(
        rootPath,
        current.rootPath === rootPath ? current.activeOperation : null,
      ),
    );

    if (!rootPath) {
      setSnapshot(createMissingRootSnapshot(rootPath));
      return;
    }

    try {
      const [nextStatus, nextConfig] = await Promise.all([
        detectLlmWikiWorkspace(rootPath),
        getLlmConfig(),
      ]);

      if (activeRootPathRef.current !== rootPath) {
        return;
      }

      if (requestIdRef.current === requestId) {
        setSnapshot({
          rootPath,
          status: nextStatus,
          config: nextConfig,
          scan: EMPTY_SCAN,
          message: null,
          queryAnswer: null,
          isLoading: false,
          isQuerying: false,
          activeOperation: operationRunnerRef.current.getActiveOperation(),
          activeOperationId: null,
          activeStage: null,
        });
      }
    } catch (error) {
      if (
        activeRootPathRef.current === rootPath &&
        requestIdRef.current === requestId
      ) {
        setMessageForError("加载 LLM Wiki 状态失败", error);
      }
    }
  }, [rootPath, setMessageForError]);

  useEffect(() => {
    if (!rootPath || typeof window === "undefined") {
      return;
    }

    const refreshWhenVisible = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      void refresh();
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh, rootPath]);

  useEffect(() => {
    let disposed = false;
    const requestId = ++requestIdRef.current;

    const load = async () => {
      setSnapshot(createLoadingSnapshot(rootPath));

      if (!rootPath) {
        setSnapshot(createMissingRootSnapshot(rootPath));
        return;
      }

      try {
        const [nextStatus, nextConfig] = await Promise.all([
          detectLlmWikiWorkspace(rootPath),
          getLlmConfig(),
        ]);

        if (
          disposed ||
          activeRootPathRef.current !== rootPath ||
          requestIdRef.current !== requestId
        ) {
          return;
        }

        setSnapshot({
          rootPath,
          status: nextStatus,
          config: nextConfig,
          scan: EMPTY_SCAN,
          message: null,
          queryAnswer: null,
          isLoading: false,
          isQuerying: false,
          activeOperation: null,
          activeOperationId: null,
          activeStage: null,
        });
      } catch (error) {
        if (
          !disposed &&
          activeRootPathRef.current === rootPath &&
          requestIdRef.current === requestId
        ) {
          setMessageForError("加载 LLM Wiki 状态失败", error);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [rootPath, setMessageForError]);

  const initialize = useCallback(async () => {
    if (!isReady) {
      return;
    }

    await runExclusiveOperation("initialize", async () => {
      try {
        const result = await initializeLlmWikiWorkspace(rootPath);

        if (activeRootPathRef.current !== rootPath) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                status: result.status,
              }
            : current,
        );
        await refresh();

        if (activeRootPathRef.current === rootPath) {
          setSnapshot((current) =>
            current.rootPath === rootPath
              ? {
                  ...current,
                  message: formatInitializeMessage(result.createdPaths.length),
                }
              : current,
          );
        }
      } catch (error) {
        if (activeRootPathRef.current === rootPath) {
          setMessageForError("初始化 LLM Wiki 失败", error);
        }
      }
    });
  }, [
    isReady,
    refresh,
    rootPath,
    runExclusiveOperation,
    setMessageForError,
  ]);

  const runRawRescan = useCallback(async (retryFailed: boolean) => {
    if (!isReady) {
      return;
    }

    await runExclusiveOperation("rescan", async () => {
      try {
        const result = retryFailed
          ? await rescanRaw(rootPath, [], undefined, true)
          : await rescanRaw(rootPath);

        if (activeRootPathRef.current !== rootPath) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                scan: result,
                message: `raw 扫描完成：${result.total} 个文件，${result.pendingTotal} 个待处理。`,
              }
            : current,
        );
        if (config?.hasApiKey) {
          void runBackgroundIngest(rootPath, result.pending);
        }
      } catch (error) {
        if (activeRootPathRef.current === rootPath) {
          setMessageForError("扫描 raw 失败", error);
        }
      }
    });
  }, [
    config?.hasApiKey,
    isReady,
    rootPath,
    runExclusiveOperation,
    runBackgroundIngest,
    setMessageForError,
  ]);

  const rescan = useCallback(async () => {
    await runRawRescan(true);
  }, [runRawRescan]);

  useEffect(() => {
    if (
      !shouldStartAutoProcessing({
        isReady,
        mode: status?.mode ?? "ordinary",
        hasApiKey: Boolean(config?.hasApiKey),
        activeOperation,
        canAutoProcess,
        rootPath,
      })
    ) {
      return;
    }

    if (!autoProcessingTrackerRef.current.claim(rootPath)) {
      return;
    }

    void runRawRescan(false);
  }, [
    activeOperation,
    canAutoProcess,
    config?.hasApiKey,
    isReady,
    runRawRescan,
    rootPath,
    status?.mode,
  ]);

  const runQueuedRawSaveRescans = useCallback(async () => {
    const queue = autoRescanRef.current;

    queue.rootPath = rootPath;
    if (queue.running) {
      queue.pending = true;
      return;
    }

    queue.running = true;
    queue.pending = true;

    while (queue.pending) {
      queue.pending = false;
      const scanRootPath = queue.rootPath;

      try {
        const result = await rescanRaw(scanRootPath);

        if (activeRootPathRef.current !== scanRootPath) {
          continue;
        }

        setSnapshot((current) =>
          current.rootPath === scanRootPath
            ? {
                ...current,
                scan: result,
                message: `raw 扫描完成：${result.total} 个文件，${result.pendingTotal} 个待处理。`,
              }
            : current,
        );
        if (config?.hasApiKey) {
          await runBackgroundIngest(scanRootPath, result.pending);
        }
      } catch (error) {
        if (activeRootPathRef.current === scanRootPath) {
          setMessageForError("扫描 raw 失败", error);
        }
      }
    }

    queue.running = false;
  }, [config?.hasApiKey, rootPath, runBackgroundIngest, setMessageForError]);

  const handleRawFileSaved = useCallback(
    (path: string) => {
      if (!isReady || status?.mode !== "llmWiki") {
        return;
      }

      if (!isPathInsideRawDirectory(rootPath, path)) {
        return;
      }

      void runQueuedRawSaveRescans();
    },
    [isReady, rootPath, runQueuedRawSaveRescans, status?.mode],
  );

  const lint = useCallback(async () => {
    if (!isReady) {
      return;
    }

    await runExclusiveOperation("lint", async ({ operationId }) => {
      try {
        const result = await runLint(rootPath, operationId ?? undefined);

        if (activeRootPathRef.current === rootPath) {
          setSnapshot((current) =>
            current.rootPath === rootPath
              ? {
                  ...current,
                  message: result.report || "检查完成，未返回报告。",
                }
              : current,
          );
        }
      } catch (error) {
        if (activeRootPathRef.current === rootPath) {
          setMessageForError("运行知识库检查失败", error);
        }
      }
    });
  }, [isReady, rootPath, runExclusiveOperation, setMessageForError]);

  const graph = useCallback(async () => {
    if (!isReady) {
      return;
    }

    await runExclusiveOperation("graph", async () => {
      try {
        await refreshKnowledgeGraph(rootPath);

        if (activeRootPathRef.current === rootPath) {
          setSnapshot((current) =>
            current.rootPath === rootPath
              ? {
                  ...current,
                  message: "知识图谱已刷新。",
                }
              : current,
          );
        }
      } catch (error) {
        if (activeRootPathRef.current === rootPath) {
          setMessageForError("刷新知识图谱失败", error);
        }
      }
    });
  }, [isReady, rootPath, runExclusiveOperation, setMessageForError]);

  const digest = useCallback(
    async (title: string, prompt: string) => {
      const trimmedTitle = title.trim();
      const trimmedPrompt = prompt.trim();
      if (
        !isReady ||
        status?.mode !== "llmWiki" ||
        !trimmedTitle ||
        !trimmedPrompt
      ) {
        return;
      }

      await runExclusiveOperation("digest", async ({ operationId }) => {
        try {
          const path = await createDigest(
            rootPath,
            trimmedTitle,
            trimmedPrompt,
            operationId ?? undefined,
          );

          if (activeRootPathRef.current === rootPath) {
            setSnapshot((current) =>
              current.rootPath === rootPath
                ? {
                    ...current,
                    message: `综述已生成：${path}`,
                  }
                : current,
            );
          }
        } catch (error) {
          if (activeRootPathRef.current === rootPath) {
            setMessageForError("生成综述失败", error);
          }
        }
      });
    },
    [
      isReady,
      rootPath,
      runExclusiveOperation,
      setMessageForError,
      status?.mode,
    ],
  );

  const query = useCallback(
    async (question: string) => {
      const queryRootPath = rootPath;
      const trimmedQuestion = question.trim();

      if (
        !canRunLlmWikiQuery({
          isReady,
          mode: status?.mode ?? "ordinary",
          question: trimmedQuestion,
        })
      ) {
        return;
      }

      const executeQuery = async (operationId: string | null) => {
        const queryGeneration = ++queryGenerationRef.current;

        setSnapshot((current) =>
          current.rootPath === queryRootPath
            ? {
                ...current,
                message: null,
                queryAnswer: null,
                isQuerying: true,
              }
            : current,
        );

        try {
          const result = await queryWiki(
            queryRootPath,
            trimmedQuestion,
            operationId ?? undefined,
          );

          if (
            !isCurrentLlmWikiQueryRequest({
              activeRootPath: activeRootPathRef.current,
              requestRootPath: queryRootPath,
              activeGeneration: queryGenerationRef.current,
              requestGeneration: queryGeneration,
            })
          ) {
            return;
          }

          setSnapshot((current) => {
            if (
              current.rootPath !== queryRootPath ||
              !isCurrentLlmWikiQueryRequest({
                activeRootPath: activeRootPathRef.current,
                requestRootPath: queryRootPath,
                activeGeneration: queryGenerationRef.current,
                requestGeneration: queryGeneration,
              })
            ) {
              return current;
            }

            return {
              ...current,
              queryAnswer: result,
              isQuerying: false,
            };
          });
        } catch (error) {
          setSnapshot((current) => {
            return current.rootPath === queryRootPath &&
              isCurrentLlmWikiQueryRequest({
                activeRootPath: activeRootPathRef.current,
                requestRootPath: queryRootPath,
                activeGeneration: queryGenerationRef.current,
                requestGeneration: queryGeneration,
              })
              ? {
                  ...current,
                  message: `查询 LLM Wiki 失败：${formatError(error)}`,
                  isQuerying: false,
                }
              : current;
          });
        }
      };

      if (activeOperation === "ingest") {
        if (concurrentQueryRef.current) {
          return;
        }

        concurrentQueryRef.current = true;
        try {
          await executeQuery(createLlmWikiOperationId("query"));
        } finally {
          concurrentQueryRef.current = false;
        }
        return;
      }

      await runExclusiveOperation("query", async ({ operationId }) => {
        await executeQuery(operationId);
      });
    },
    [activeOperation, isReady, rootPath, runExclusiveOperation, status?.mode],
  );

  useEffect(() => {
    if (!activeOperationId) {
      return;
    }

    let disposed = false;

    const updateOperationState = async () => {
      try {
        const operationState =
          await getLlmWikiOperationState(activeOperationId);

        if (disposed) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === rootPath &&
          current.activeOperationId === activeOperationId
            ? {
                ...current,
                activeStage: operationState.stage,
              }
            : current,
        );
      } catch (error) {
        if (disposed) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === rootPath &&
          current.activeOperationId === activeOperationId
            ? isOperationNotFoundError(error)
              ? {
                  ...current,
                  activeOperation: null,
                  activeOperationId: null,
                  activeStage: null,
                }
              : {
                  ...current,
                  activeStage: null,
                }
            : current,
        );
      }
    };

    void updateOperationState();
    const interval = setInterval(updateOperationState, 1000);

    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [activeOperationId, rootPath]);

  const cancelActiveOperation = useCallback(async () => {
    if (!activeOperationId) {
      return;
    }

    await cancelLlmWikiOperation(activeOperationId);
  }, [activeOperationId]);

  const panelState = useMemo<LlmWikiPanelState>(
    () => ({
      mode: status?.mode ?? "ordinary",
      llmConfigured: Boolean(
        config?.baseUrl && config.model && config.hasApiKey,
      ),
      paused: false,
      totalRawFiles: scan.total,
      pendingCount: scan.pendingTotal,
      completedCount: scan.completed.length,
      failedCount: scan.failed.length,
      failed: scan.failed,
      skippedCount: scan.skipped.length,
    }),
    [config, scan, status],
  );
  const viewModel = useMemo(
    () => createLlmWikiStatusViewModel(panelState),
    [panelState],
  );

  return {
    status,
    viewModel,
    message,
    queryAnswer,
    isReady,
    isLoading,
    isQuerying,
    isProcessing,
    activeOperation,
    activeOperationId,
    activeOperationLabel: getLlmWikiOperationLabel(activeOperation),
    activeStageLabel: getLlmWikiStageLabel(activeStage),
    cancelActiveOperation,
    initialize,
    rescan,
    lint,
    graph,
    digest,
    query,
    refresh,
    handleRawFileSaved,
  };
}

function isPathInsideRawDirectory(rootPath: string, path: string) {
  const root = stripTrailingSlash(normalizeWorkspacePath(rootPath));
  const saved = normalizeWorkspacePath(path);

  if (!root || !saved) {
    return false;
  }

  const relative = getPathRelativeToRoot(root, saved);

  if (relative === null) {
    return false;
  }

  const parts = relative.split("/").filter(Boolean);

  return parts[0] === "raw" && parts.length > 1;
}

function getPathRelativeToRoot(rootPath: string, path: string) {
  const candidateRootRelative = normalizeWorkspacePath(path);

  if (!isAbsolutePath(candidateRootRelative)) {
    return candidateRootRelative;
  }

  const [root, candidate] = normalizeCaseForPlatform(
    rootPath,
    candidateRootRelative,
  );
  const rootWithSeparator = root.endsWith("/") ? root : `${root}/`;

  if (candidate === root) {
    return "";
  }

  if (!candidate.startsWith(rootWithSeparator)) {
    return null;
  }

  return candidateRootRelative.slice(rootWithSeparator.length);
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function stripTrailingSlash(path: string) {
  if (path === "/" || /^[A-Za-z]:\/?$/.test(path)) {
    return path;
  }

  return path.replace(/\/+$/, "");
}

function normalizeCaseForPlatform(
  rootPath: string,
  candidatePath: string,
): [string, string] {
  if (/^[A-Za-z]:/.test(rootPath) || /^[A-Za-z]:/.test(candidatePath)) {
    return [rootPath.toLowerCase(), candidatePath.toLowerCase()];
  }

  return [rootPath, candidatePath];
}

function createInitialSnapshot(rootPath: string): RootSnapshot {
  return rootPath
    ? createLoadingSnapshot(rootPath)
    : createMissingRootSnapshot(rootPath);
}

function createLoadingSnapshot(
  rootPath: string,
  activeOperation: LlmWikiOperation | null = null,
): RootSnapshot {
  return {
    rootPath,
    status: null,
    config: null,
    scan: EMPTY_SCAN,
    message: null,
    queryAnswer: null,
    isLoading: Boolean(rootPath),
    isQuerying: false,
    activeOperation,
    activeOperationId: null,
    activeStage: null,
  };
}

function createMissingRootSnapshot(rootPath: string): RootSnapshot {
  return {
    rootPath,
    status: null,
    config: null,
    scan: EMPTY_SCAN,
    message: "请先打开工作区。",
    queryAnswer: null,
    isLoading: false,
    isQuerying: false,
    activeOperation: null,
    activeOperationId: null,
    activeStage: null,
  };
}

function createLlmWikiOperationId(operation: LlmWikiOperation) {
  if (
    operation !== "ingest" &&
    operation !== "query" &&
    operation !== "lint" &&
    operation !== "digest"
  ) {
    return null;
  }

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `llm-wiki-${operation}-${crypto.randomUUID()}`;
  }

  return `llm-wiki-${operation}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function formatInitializeMessage(createdCount: number) {
  if (createdCount === 0) {
    return "LLM Wiki 已初始化，现有文件保持不变。";
  }

  return `LLM Wiki 已初始化，新建 ${createdCount} 个文件。`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    if (
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
    ) {
      return error.message;
    }

    if (
      "error" in error &&
      typeof error.error === "string" &&
      error.error.length > 0
    ) {
      return error.error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return "未知错误";
}

function isOperationNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    errorCode?: unknown;
    error_code?: unknown;
    message?: unknown;
  };
  return (
    maybeError.errorCode === "operation_not_found" ||
    maybeError.error_code === "operation_not_found" ||
    (typeof maybeError.message === "string" &&
      maybeError.message.includes("operation_not_found"))
  );
}
