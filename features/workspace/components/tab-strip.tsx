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
            className="flex h-11 min-w-0 items-center overflow-hidden border-b border-[var(--mdx-separator)] bg-[var(--mdx-content-bg)] px-2"
        >
            {tabs.length === 0 ? (
                <div className="flex items-center px-2 text-sm text-base-content/55">
                    未打开文件
                </div>
            ) : (
                <div className="flex min-w-0 gap-0.5 overflow-x-auto">
                    {tabs.map((tab) => (
                        <div
                            key={tab.tabId}
                            data-mdx-workspace-tab=""
                            data-active={
                                activeTabId === tab.tabId ? "true" : undefined
                            }
                            className={[
                                // No border: the active tab is told apart by
                                // its ground, the way a macOS tab is. A box
                                // around every tab draws more lines than there
                                // are distinctions to make.
                                "group flex h-8 min-w-32 max-w-52 items-center rounded-[7px] text-[13px] transition-colors",
                                activeTabId === tab.tabId
                                    ? "bg-base-content/8 text-base-content"
                                    : "text-base-content/60 hover:bg-base-content/4 hover:text-base-content/85",
                            ].join(" ")}
                        >
                            <button
                                type="button"
                                className="min-w-0 flex-1 truncate py-1 pl-2.5 text-left"
                                title={tab.path}
                                onClick={() =>
                                    dispatch({
                                        type: "tab/activated",
                                        tabId: tab.tabId,
                                    })
                                }
                            >
                                {tab.title}
                                {/*
                                 * The unsaved marker is a dot, which a screen
                                 * reader cannot announce. This says the same
                                 * thing in the accessible name, so the state is
                                 * not sighted-only.
                                 */}
                                {tab.dirty ? (
                                    <span className="sr-only">（未保存）</span>
                                ) : null}
                            </button>
                            {/*
                             * One slot holds both the unsaved marker and the
                             * close button, and the pointer swaps them. The
                             * marker is where the button will be, so the tab
                             * does not change width when either appears, and
                             * an unsaved tab reads as a state rather than as an
                             * asterisk stuck to its name.
                             */}
                            <span className="relative mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center">
                                {tab.dirty ? (
                                    <span
                                        aria-hidden="true"
                                        title="未保存"
                                        className="absolute h-[7px] w-[7px] rounded-full bg-base-content/45 transition-opacity group-hover:opacity-0"
                                    />
                                ) : null}
                                <IconButton
                                    label={`关闭 ${tab.title}`}
                                    icon={<X />}
                                    className="h-5 min-w-5 rounded-[5px] px-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                                    onClick={() => void onCloseTab(tab.tabId)}
                                />
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
