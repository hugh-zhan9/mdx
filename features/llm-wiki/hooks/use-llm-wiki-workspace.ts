"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface LlmWikiWorkspaceHook {
    status: LlmWikiWorkspaceStatus | null;
    viewModel: LlmWikiStatusViewModel;
    message: string | null;
    initialize: () => Promise<void>;
    rescan: () => Promise<void>;
    lint: () => Promise<void>;
    graph: () => Promise<void>;
    refresh: () => Promise<void>;
}

const EMPTY_SCAN: RawScanResult = {
    total: 0,
    pending: [],
    skipped: [],
};

export function useLlmWikiWorkspace(rootPath: string): LlmWikiWorkspaceHook {
    const activeRootPathRef = useRef(rootPath);
    const [status, setStatus] = useState<LlmWikiWorkspaceStatus | null>(null);
    const [config, setConfig] = useState<PublicLlmProviderConfig | null>(null);
    const [scan, setScan] = useState<RawScanResult>(EMPTY_SCAN);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        activeRootPathRef.current = rootPath;
    }, [rootPath]);

    const setMessageForError = useCallback((prefix: string, error: unknown) => {
        setMessage(`${prefix}：${formatError(error)}`);
    }, []);

    const refresh = useCallback(async () => {
        if (!rootPath) {
            setStatus(null);
            setConfig(null);
            setScan(EMPTY_SCAN);
            setMessage("请先打开工作区。");
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

            setStatus(nextStatus);
            setConfig(nextConfig);
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("加载 LLM Wiki 状态失败", error);
            }
        }
    }, [rootPath, setMessageForError]);

    useEffect(() => {
        let disposed = false;

        const load = async () => {
            try {
                const [nextStatus, nextConfig] = await Promise.all([
                    detectLlmWikiWorkspace(rootPath),
                    getLlmConfig(),
                ]);

                if (disposed || activeRootPathRef.current !== rootPath) {
                    return;
                }

                setStatus(nextStatus);
                setConfig(nextConfig);
                setMessage(null);
            } catch (error) {
                if (!disposed && activeRootPathRef.current === rootPath) {
                    setMessageForError("加载 LLM Wiki 状态失败", error);
                }
            }
        };

        const reset = async () => {
            setStatus(null);
            setConfig(null);
            setScan(EMPTY_SCAN);
            setMessage("请先打开工作区。");
        };

        if (rootPath) {
            void load();
        } else {
            void reset();
        }

        return () => {
            disposed = true;
        };
    }, [rootPath, setMessageForError]);

    const initialize = useCallback(async () => {
        try {
            const result = await initializeLlmWikiWorkspace(rootPath);

            if (activeRootPathRef.current !== rootPath) {
                return;
            }

            setStatus(result.status);
            await refresh();

            if (activeRootPathRef.current === rootPath) {
                setMessage(formatInitializeMessage(result.createdPaths.length));
            }
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("初始化 LLM Wiki 失败", error);
            }
        }
    }, [refresh, rootPath, setMessageForError]);

    const rescan = useCallback(async () => {
        try {
            const result = await rescanRaw(rootPath);

            if (activeRootPathRef.current !== rootPath) {
                return;
            }

            setScan(result);
            setMessage(
                `raw 扫描完成：${result.total} 个文件，${result.pending.length} 个待处理。`,
            );
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("扫描 raw 失败", error);
            }
        }
    }, [rootPath, setMessageForError]);

    const lint = useCallback(async () => {
        try {
            const result = await runLint(rootPath);

            if (activeRootPathRef.current === rootPath) {
                setMessage(result.report || "Lint 完成，未返回报告。");
            }
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("运行 LLM Wiki lint 失败", error);
            }
        }
    }, [rootPath, setMessageForError]);

    const graph = useCallback(async () => {
        try {
            await refreshKnowledgeGraph(rootPath);

            if (activeRootPathRef.current === rootPath) {
                setMessage("知识图谱已刷新。");
            }
        } catch (error) {
            if (activeRootPathRef.current === rootPath) {
                setMessageForError("刷新知识图谱失败", error);
            }
        }
    }, [rootPath, setMessageForError]);

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
        initialize,
        rescan,
        lint,
        graph,
        refresh,
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
