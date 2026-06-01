"use client";

import { usePanelResize } from "../hooks/use-panel-resize";
import type {
    WorkspaceAction,
    WorkspaceState,
    WorkspaceTab,
} from "../lib/types";
import { EditorStage } from "./editor-stage";
import { FileTreePanel } from "./file-tree-panel";
import { OutlinePanel } from "./outline-panel";
import { TabStrip } from "./tab-strip";

interface WorkspaceShellProps {
    workspace: WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    onChooseWorkspace: () => void;
    canChooseWorkspace: boolean;
    message?: string | null;
}

export function WorkspaceShell({
    workspace,
    dispatch,
    onChooseWorkspace,
    canChooseWorkspace,
    message,
}: WorkspaceShellProps) {
    const leftPanel = usePanelResize({
        side: "left",
        panel: workspace.panel,
        dispatch,
    });
    const rightPanel = usePanelResize({
        side: "right",
        panel: workspace.panel,
        dispatch,
    });
    const tabs = workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const activeTab = workspace.activeTabId
        ? workspace.tabs[workspace.activeTabId] ?? null
        : null;
    const gridTemplateColumns = [
        leftPanel.isCollapsed ? "0px" : `${leftPanel.width}px`,
        "minmax(0, 1fr)",
        rightPanel.isCollapsed ? "0px" : `${rightPanel.width}px`,
    ].join(" ");

    return (
        <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)]">
            <header className="flex min-w-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300 disabled:text-base-content/30"
                        onClick={leftPanel.toggleCollapsed}
                        aria-label={
                            leftPanel.isCollapsed
                                ? "Show file panel"
                                : "Hide file panel"
                        }
                        title={
                            leftPanel.isCollapsed
                                ? "Show file panel"
                                : "Hide file panel"
                        }
                    >
                        Files
                    </button>
                    <div className="min-w-0 truncate text-sm font-semibold">
                        MDX
                    </div>
                    <div className="min-w-0 truncate text-xs text-base-content/50">
                        {workspace.rootPath}
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {message ? (
                        <div className="max-w-80 truncate text-xs text-warning">
                            {message}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300 disabled:text-base-content/30"
                        onClick={onChooseWorkspace}
                        disabled={!canChooseWorkspace}
                    >
                        Open Folder
                    </button>
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300"
                        onClick={rightPanel.toggleCollapsed}
                        aria-label={
                            rightPanel.isCollapsed
                                ? "Show outline panel"
                                : "Hide outline panel"
                        }
                        title={
                            rightPanel.isCollapsed
                                ? "Show outline panel"
                                : "Hide outline panel"
                        }
                    >
                        Outline
                    </button>
                </div>
            </header>

            <div
                className="grid min-h-0"
                style={{ gridTemplateColumns }}
            >
                <div
                    className="min-h-0 overflow-hidden"
                    style={{ gridColumn: 1 }}
                >
                    <FileTreePanel
                        rootPath={workspace.rootPath}
                        fileTree={workspace.fileTree}
                        searchQuery={workspace.search.query}
                        collapsed={leftPanel.isCollapsed}
                        canChooseWorkspace={canChooseWorkspace}
                        dispatch={dispatch}
                        onChooseWorkspace={onChooseWorkspace}
                        onToggleCollapsed={leftPanel.toggleCollapsed}
                        resizeHandleProps={leftPanel.resizeHandleProps}
                    />
                </div>

                <main
                    className="flex min-h-0 min-w-0 flex-col bg-base-100"
                    style={{ gridColumn: 2 }}
                >
                    <TabStrip
                        tabs={tabs}
                        activeTabId={workspace.activeTabId}
                        dispatch={dispatch}
                    />
                    <EditorStage activeTab={activeTab} />
                </main>

                <div
                    className="min-h-0 overflow-hidden"
                    style={{ gridColumn: 3 }}
                >
                    <OutlinePanel
                        collapsed={rightPanel.isCollapsed}
                        onToggleCollapsed={rightPanel.toggleCollapsed}
                        resizeHandleProps={rightPanel.resizeHandleProps}
                    />
                </div>
            </div>
        </div>
    );
}
