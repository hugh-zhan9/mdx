"use client";

import type { WorkspaceAction, WorkspaceTab } from "../lib/types";

interface TabStripProps {
    tabs: WorkspaceTab[];
    activeTabId: string | null;
    dispatch: (action: WorkspaceAction) => void;
    onSaveTab: (tabId: string) => Promise<boolean>;
}

export function TabStrip({
    tabs,
    activeTabId,
    dispatch,
    onSaveTab,
}: TabStripProps) {
    const closeTab = async (tab: WorkspaceTab) => {
        if (!tab.dirty) {
            dispatch({
                type: "tab/closed",
                tabId: tab.tabId,
            });
            return;
        }

        const choice = window.prompt(
            `"${tab.title}" has unsaved changes. Type save, discard, or cancel.`,
            "save",
        );
        const normalizedChoice = choice?.trim().toLowerCase();

        if (normalizedChoice === "discard") {
            dispatch({
                type: "tab/closed",
                tabId: tab.tabId,
            });
            return;
        }

        if (normalizedChoice !== "save") {
            return;
        }

        const saved = await onSaveTab(tab.tabId);

        if (saved) {
            dispatch({
                type: "tab/closed",
                tabId: tab.tabId,
            });
        }
    };

    return (
        <div className="flex h-10 min-w-0 items-stretch overflow-hidden border-b border-base-300 bg-base-100">
            {tabs.length === 0 ? (
                <div className="flex items-center px-4 text-sm text-base-content/50">
                    No file selected
                </div>
            ) : (
                <div className="flex min-w-0 overflow-x-auto">
                    {tabs.map((tab) => (
                        <div
                            key={tab.tabId}
                            className={[
                                "flex min-w-36 max-w-56 items-center border-r border-base-300 text-sm",
                                activeTabId === tab.tabId
                                    ? "bg-base-100 text-base-content"
                                    : "bg-base-200 text-base-content/65",
                            ].join(" ")}
                        >
                            <button
                                type="button"
                                className="min-w-0 flex-1 truncate px-3 text-left"
                                title={tab.path}
                                onClick={() =>
                                    dispatch({
                                        type: "tab/activated",
                                        tabId: tab.tabId,
                                    })
                                }
                            >
                                {tab.title}
                                {tab.dirty ? " *" : ""}
                            </button>
                            <button
                                type="button"
                                className="h-full px-2 text-base-content/45 hover:bg-base-300 hover:text-base-content"
                                aria-label={`Close ${tab.title}`}
                                title="Close tab"
                                onClick={() => void closeTab(tab)}
                            >
                                x
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
