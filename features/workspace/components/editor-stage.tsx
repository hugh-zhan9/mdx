"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { EditorPane } from "@/features/editor/components/editor-pane";
import type {
    PendingCliEditorCommand,
    WorkspaceAction,
    WorkspaceTab,
} from "../lib/types";

interface EditorStageProps {
    rootPath: string;
    activeTab: WorkspaceTab | null;
    dispatch: (action: WorkspaceAction) => void;
    onSaveTab: (tabId: string) => Promise<boolean>;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand: PendingCliEditorCommand | null;
    onPendingCliCommandHandled: (commandId: string) => void;
    onSelectionChange: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}

export function EditorStage({
    rootPath,
    activeTab,
    dispatch,
    onSaveTab,
    editorViewportRef,
    pendingCliCommand,
    onPendingCliCommandHandled,
    onSelectionChange,
}: EditorStageProps) {
    const [message, setMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!activeTab || activeTab.markdown !== undefined) {
            setMessage(null);
            return;
        }

        let cancelled = false;
        const loadingTab = activeTab;

        async function loadMarkdown() {
            try {
                const { invoke } = await tauriCore();
                const markdown = await invoke<string>("read_markdown_file", {
                    rootPath,
                    path: loadingTab.path,
                });

                if (cancelled) {
                    return;
                }

                dispatch({
                    type: "tab/saved",
                    tabId: loadingTab.tabId,
                    markdown,
                });
                setMessage(null);
            } catch (error) {
                if (!cancelled) {
                    setMessage(formatError(error, "加载文件失败。"));
                }
            }
        }

        void loadMarkdown();

        return () => {
            cancelled = true;
        };
    }, [activeTab, dispatch, rootPath]);

    const handleMarkdownChange = useCallback(
        (tabId: string, markdown: string) => {
            dispatch({
                type: "tab/contentChanged",
                tabId,
                markdown,
            });
        },
        [dispatch],
    );

    const handleSave = useCallback(async () => {
        if (!activeTab) {
            return;
        }

        setSaving(true);

        try {
            const saved = await onSaveTab(activeTab.tabId);

            if (saved) {
                setMessage(null);
            }
        } finally {
            setSaving(false);
        }
    }, [activeTab, onSaveTab]);

    if (!activeTab) {
        return (
            <section className="flex min-h-0 flex-1 items-center justify-center bg-base-100 px-6 text-sm text-base-content/50">
                选择一个 Markdown 文件开始编辑。
            </section>
        );
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col bg-base-100">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300 px-4">
                <div className="min-w-0 truncate text-sm font-medium">
                    {activeTab.title}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {message ? (
                        <div className="max-w-72 truncate text-xs text-warning">
                            {message}
                        </div>
                    ) : null}
                    <div className="text-xs text-base-content/45">
                        {activeTab.dirty ? "未保存" : "已保存"}
                    </div>
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                        onClick={() => void handleSave()}
                        disabled={saving || activeTab.markdown === undefined}
                    >
                        {saving
                            ? "保存中"
                            : activeTab.needsRenameOnFirstSave
                              ? "命名并保存"
                              : "保存"}
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab.markdown === undefined ? (
                    <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/50">
                        {message ?? "正在加载文件..."}
                    </div>
                ) : (
                    <EditorPane
                        rootPath={rootPath}
                        tab={activeTab}
                        onMarkdownChange={handleMarkdownChange}
                        editorViewportRef={editorViewportRef}
                        pendingCliCommand={pendingCliCommand}
                        onPendingCliCommandHandled={onPendingCliCommandHandled}
                        onSelectionChange={onSelectionChange}
                    />
                )}
            </div>
        </section>
    );
}

function formatError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return `${fallback} ${error.message}`;
    }

    if (typeof error === "string" && error.length > 0) {
        return `${fallback} ${error}`;
    }

    if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.length > 0
    ) {
        return `${fallback} ${error.message}`;
    }

    return fallback;
}
