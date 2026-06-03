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
    detectLlmWikiWorkspace,
    getLlmConfig,
    initializeLlmWikiWorkspace,
    refreshKnowledgeGraph,
    rescanRaw,
    runLint,
} from "../lib/llm-wiki-client";
import { createLlmWikiStatusViewModel } from "../lib/status-view-model";
import type {
    LlmWikiPanelState,
    LlmWikiStatusViewModel,
    LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig,
    RawScanResult,
} from "../lib/types";

export interface LlmWikiWorkspaceHook {
    status: LlmWikiWorkspaceStatus | null;
    viewModel: LlmWikiStatusViewModel;
    message: string | null;
    isReady: boolean;
    isLoading: boolean;
    initialize: () => Promise<void>;
    rescan: () => Promise<void>;
    lint: () => Promise<void>;
    graph: () => Promise<void>;
    refresh: () => Promise<void>;
    handleRawFileSaved: (path: string) => void;
}

const EMPTY_SCAN: RawScanResult = {
    total: 0,
    pending: [],
    skipped: [],
};

interface RootSnapshot {
    rootPath: string;
    status: LlmWikiWorkspaceStatus | null;
    config: PublicLlmProviderConfig | null;
    scan: RawScanResult;
    message: string | null;
    isLoading: boolean;
}

export function useLlmWikiWorkspace(rootPath: string): LlmWikiWorkspaceHook {
    const activeRootPathRef = useRef(rootPath);
    const requestIdRef = useRef(0);
    const autoRescanRef = useRef({
        running: false,
        pending: false,
        rootPath: "",
    });
    const [snapshot, setSnapshot] = useState<RootSnapshot>(() =>
        createInitialSnapshot(rootPath),
    );
    const currentSnapshot =
        snapshot.rootPath === rootPath
            ? snapshot
            : createInitialSnapshot(rootPath);
    const { status, config, scan, message } = currentSnapshot;
    const isLoading = currentSnapshot.isLoading || snapshot.rootPath !== rootPath;
    const isReady = Boolean(rootPath) && !isLoading && snapshot.rootPath === rootPath;

    useLayoutEffect(() => {
        activeRootPathRef.current = rootPath;
    }, [rootPath]);

    const setMessageForError = useCallback((prefix: string, error: unknown) => {
        setSnapshot((current) => ({
            ...current,
            message: `${prefix}：${formatError(error)}`,
            isLoading: false,
        }));
    }, []);

    const refresh = useCallback(async () => {
        const requestId = ++requestIdRef.current;
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
                    isLoading: false,
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
                    isLoading: false,
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
                              message: formatInitializeMessage(
                                  result.createdPaths.length,
                              ),
                          }
                        : current,
                );
            }
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("初始化 LLM Wiki 失败", error);
            }
        }
    }, [isReady, refresh, rootPath, setMessageForError]);

    const rescan = useCallback(async () => {
        if (!isReady) {
            return;
        }

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
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("扫描 raw 失败", error);
            }
        }
    }, [isReady, rootPath, setMessageForError]);

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
            } catch (error) {
                if (activeRootPathRef.current === scanRootPath) {
                    setMessageForError("扫描 raw 失败", error);
                }
            }
        }

        queue.running = false;
    }, [rootPath, setMessageForError]);

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

        try {
            const result = await runLint(rootPath);

            if (activeRootPathRef.current === rootPath) {
                setSnapshot((current) =>
                    current.rootPath === rootPath
                        ? {
                              ...current,
                              message: result.report || "Lint 完成，未返回报告。",
                          }
                        : current,
                );
            }
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("运行 LLM Wiki lint 失败", error);
            }
        }
    }, [isReady, rootPath, setMessageForError]);

    const graph = useCallback(async () => {
        if (!isReady) {
            return;
        }

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
    }, [isReady, rootPath, setMessageForError]);

    const panelState = useMemo<LlmWikiPanelState>(
        () => ({
            mode: status?.mode ?? "ordinary",
            llmConfigured: Boolean(config?.baseUrl && config.model && config.hasApiKey),
            paused: false,
            totalRawFiles: scan.total,
            pendingCount: scan.pending.length,
            completedCount: Math.max(
                0,
                scan.total - scan.pending.length - scan.skipped.length,
            ),
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
        isReady,
        isLoading,
        initialize,
        rescan,
        lint,
        graph,
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

    const [root, candidate] = normalizeCaseForPlatform(rootPath, candidateRootRelative);
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
    return rootPath ? createLoadingSnapshot(rootPath) : createMissingRootSnapshot(rootPath);
}

function createLoadingSnapshot(rootPath: string): RootSnapshot {
    return {
        rootPath,
        status: null,
        config: null,
        scan: EMPTY_SCAN,
        message: null,
        isLoading: Boolean(rootPath),
    };
}

function createMissingRootSnapshot(rootPath: string): RootSnapshot {
    return {
        rootPath,
        status: null,
        config: null,
        scan: EMPTY_SCAN,
        message: "请先打开工作区。",
        isLoading: false,
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
