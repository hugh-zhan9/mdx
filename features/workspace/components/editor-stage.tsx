"use client";

import { useCallback, useEffect, useState } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { EditorPane } from "@/features/editor/components/editor-pane";
import type { WorkspaceAction, WorkspaceTab } from "../lib/types";

interface EditorStageProps {
    rootPath: string;
    activeTab: WorkspaceTab | null;
    dispatch: (action: WorkspaceAction) => void;
    onSaveTab: (tabId: string) => Promise<boolean>;
}

export function EditorStage({
    rootPath,
    activeTab,
    dispatch,
    onSaveTab,
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
                    setMessage(formatError(error, "Failed to load file."));
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
                Select a markdown file to start.
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
                        {activeTab.dirty ? "Unsaved" : "Saved"}
                    </div>
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                        onClick={() => void handleSave()}
                        disabled={saving || activeTab.markdown === undefined}
                    >
                        {saving
                            ? "Saving"
                            : activeTab.needsRenameOnFirstSave
                              ? "Name and Save"
                              : "Save"}
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab.markdown === undefined ? (
                    <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/50">
                        {message ?? "Loading file..."}
                    </div>
                ) : (
                    <EditorPane
                        rootPath={rootPath}
                        tab={activeTab}
                        onMarkdownChange={handleMarkdownChange}
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
