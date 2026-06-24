"use client";

import { X } from "lucide-react";
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
        <div
            data-mdx-workspace-main-tabs=""
            className="flex h-11 min-w-0 items-center overflow-hidden border-b border-base-content/10 bg-[var(--mdx-content-bg)] px-2"
        >
            {tabs.length === 0 ? (
                <div className="flex items-center px-2 text-sm text-base-content/55">
                    未打开文件
                </div>
            ) : (
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                    {tabs.map((tab) => (
                        <div
                            key={tab.tabId}
                            className={[
                                "flex h-8 min-w-36 max-w-56 items-center rounded-md border text-sm transition-colors",
                                activeTabId === tab.tabId
                                    ? "border-base-content/12 bg-base-content/8 text-base-content shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-base-content)_8%,transparent)]"
                                    : "border-transparent text-base-content/65 hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content",
                            ].join(" ")}
                        >
                            <button
                                type="button"
                                className="min-w-0 flex-1 truncate px-2.5 text-left"
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
                                icon={<X />}
                                className="mr-0.5 h-7 min-w-7"
                                onClick={() => void onCloseTab(tab.tabId)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
