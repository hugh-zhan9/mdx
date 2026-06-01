"use client";

import type { WorkspaceTab } from "../lib/types";

interface EditorStageProps {
    activeTab: WorkspaceTab | null;
}

export function EditorStage({ activeTab }: EditorStageProps) {
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
                <div className="text-xs text-base-content/45">
                    {activeTab.dirty ? "Unsaved" : "Saved"}
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-6">
                {activeTab.markdown === undefined ? (
                    <div className="text-sm text-base-content/50">
                        File content is not loaded.
                    </div>
                ) : (
                    <pre className="whitespace-pre-wrap text-sm leading-6 text-base-content">
                        {activeTab.markdown}
                    </pre>
                )}
            </div>
        </section>
    );
}
