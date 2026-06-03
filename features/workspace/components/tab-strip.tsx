"use client";

import { IconButton } from "../../../common/components/ui-controls";
import type { WorkspaceAction, WorkspaceTab } from "../lib/types";

interface TabStripProps {
    tabs: WorkspaceTab[];
    activeTabId: string | null;
    dispatch: (action: WorkspaceAction) => void;
    onCloseTab: (tabId: string) => Promise<void>;
}

export function TabStrip({
    tabs,
    activeTabId,
    dispatch,
    onCloseTab,
}: TabStripProps) {
    return (
        <div className="flex h-10 min-w-0 items-stretch overflow-hidden border-b border-base-300 bg-base-100">
            {tabs.length === 0 ? (
                <div className="flex items-center px-4 text-sm text-base-content/65">
                    未打开文件
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
                            <IconButton
                                label={`关闭 ${tab.title}`}
                                icon="×"
                                className="h-full min-w-8"
                                onClick={() => void onCloseTab(tab.tabId)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
