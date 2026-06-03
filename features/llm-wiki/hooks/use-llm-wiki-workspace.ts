"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeWorkspacePath } from "@/features/workspace/lib/path";
import {
  createDigest,
  detectLlmWikiWorkspace,
  getLlmConfig,
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
  activeOperationLabel: string | null;
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
  pending: [],
  completed: [],
  skipped: [],
};

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
}

export function useLlmWikiWorkspace(
  rootPath: string,
  options: UseLlmWikiWorkspaceOptions = {},
): LlmWikiWorkspaceHook {
  const canAutoProcess = options.canAutoProcess ?? true;
  const activeRootPathRef = useRef(rootPath);
  const requestIdRef = useRef(0);
  const queryGenerationRef = useRef(0);
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
      task: () => Promise<void>,
    ) => {
      const result = await operationRunnerRef.current.run(operation, async () => {
        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                activeOperation: operation,
                message:
                  current.message ??
                  getLlmWikiOperationLabel(operation),
              }
            : current,
        );

        try {
          await task();
        } finally {
          setSnapshot((current) =>
            current.rootPath === rootPath
              ? {
                  ...current,
                  activeOperation: null,
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

      const failed: Array<{ path: string; error: string }> = [];
      let batch = pending;
      let processedCount = 0;

      while (batch.length > 0) {
        setSnapshot((current) =>
          current.rootPath === ingestRootPath
            ? {
                ...current,
                message: `开始后台处理 raw：${processedCount}/${processedCount + batch.length}`,
              }
            : current,
        );

        for (const rawRelativePath of batch) {
          if (activeRootPathRef.current !== ingestRootPath) {
            return;
          }

          try {
            await ingestRawFile(ingestRootPath, rawRelativePath);
            processedCount += 1;
            setSnapshot((current) =>
              current.rootPath === ingestRootPath
                ? {
                    ...current,
                    message: `后台处理 raw：${processedCount}`,
                  }
                : current,
            );
          } catch (error) {
            failed.push({
              path: rawRelativePath,
              error: formatError(error),
            });
          }
        }

        if (activeRootPathRef.current !== ingestRootPath || failed.length > 0) {
          break;
        }

        const next = await rescanRaw(ingestRootPath);

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
        batch = next.pending;
      }

      const latest = await rescanRaw(ingestRootPath);

      if (activeRootPathRef.current !== ingestRootPath) {
        return;
      }

      setSnapshot((current) =>
        current.rootPath === ingestRootPath
          ? {
              ...current,
              scan: latest,
              message:
                failed.length === 0
                  ? `后台处理完成：${processedCount} 个 raw。`
                  : `后台处理完成，${failed.length} 个失败：${failed
                      .map((item) => item.path)
                      .join(", ")}`,
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

  const rescan = useCallback(async () => {
    if (!isReady) {
      return;
    }

    await runExclusiveOperation("rescan", async () => {
      try {
        const result = await rescanRaw(rootPath);

        if (activeRootPathRef.current !== rootPath) {
          return;
        }

        setSnapshot((current) =>
          current.rootPath === rootPath
            ? {
                ...current,
                scan: result,
                message: `raw 扫描完成：${result.total} 个文件，${result.pending.length} 个待处理。`,
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

    void rescan();
  }, [
    activeOperation,
    canAutoProcess,
    config?.hasApiKey,
    isReady,
    rescan,
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
                message: `raw 扫描完成：${result.total} 个文件，${result.pending.length} 个待处理。`,
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

    await runExclusiveOperation("lint", async () => {
      try {
        const result = await runLint(rootPath);

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

      await runExclusiveOperation("digest", async () => {
        try {
          const path = await createDigest(rootPath, trimmedTitle, trimmedPrompt);

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
        const result = await queryWiki(queryRootPath, trimmedQuestion);

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
    },
    [isReady, rootPath, status?.mode],
  );

  const panelState = useMemo<LlmWikiPanelState>(
    () => ({
      mode: status?.mode ?? "ordinary",
      llmConfigured: Boolean(
        config?.baseUrl && config.model && config.hasApiKey,
      ),
      paused: false,
      totalRawFiles: scan.total,
      pendingCount: scan.pending.length,
      completedCount: scan.completed.length,
      failedCount: 0,
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
    activeOperationLabel: getLlmWikiOperationLabel(activeOperation),
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
  };
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

  return "未知错误";
}
