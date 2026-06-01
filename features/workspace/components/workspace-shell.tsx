"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { usePanelResize } from "../hooks/use-panel-resize";
import { buildFileTree } from "../lib/file-tree";
import { parseMarkdownOutline } from "../lib/outline";
import { scrollRenderedHeadingIntoView } from "../lib/outline-scroll";
import { createTabSaveQueue } from "../lib/workspace-save";
import { workspaceReducer } from "../lib/workspace-reducer";
import type {
    FileTreeNode,
    WorkspaceAction,
    WorkspaceState,
    WorkspaceTab,
} from "../lib/types";
import type { SaveQueue } from "../lib/workspace-save";
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

interface ScanWorkspaceResult {
    rootPath: string;
    nodes: FileTreeNode[];
}

export function WorkspaceShell({
    workspace,
    dispatch,
    onChooseWorkspace,
    canChooseWorkspace,
    message,
}: WorkspaceShellProps) {
    const workspaceRef = useRef(workspace);
    const saveQueueRef = useRef<SaveQueue | null>(null);
    const workspaceRootRef = useRef(workspace.rootPath);
    const editorViewportRef = useRef<HTMLDivElement | null>(null);
    const tabs = workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const activeTab = workspace.activeTabId
        ? workspace.tabs[workspace.activeTabId] ?? null
        : null;
    const activeHeadings = useMemo(
        () =>
            activeTab?.markdown === undefined
                ? []
                : parseMarkdownOutline(activeTab.markdown),
        [activeTab?.markdown],
    );

    useEffect(() => {
        workspaceRef.current = workspace;
        if (workspaceRootRef.current !== workspace.rootPath) {
            workspaceRootRef.current = workspace.rootPath;
            saveQueueRef.current = null;
        }
    }, [workspace]);

    const dispatchAndMirror = useCallback(
        (action: WorkspaceAction) => {
            workspaceRef.current = workspaceReducer(
                workspaceRef.current,
                action,
            );
            dispatch(action);
        },
        [dispatch],
    );

    const leftPanel = usePanelResize({
        side: "left",
        panel: workspace.panel,
        dispatch: dispatchAndMirror,
    });
    const rightPanel = usePanelResize({
        side: "right",
        panel: workspace.panel,
        dispatch: dispatchAndMirror,
    });
    const saveTab = useCallback(
        (tabId: string) => {
            saveQueueRef.current ??= createTabSaveQueue({
                getWorkspace: () => workspaceRef.current,
                dispatch: dispatchAndMirror,
                invoke: async (command, args) => {
                    const { invoke } = await tauriCore();
                    return invoke(command, args);
                },
                promptName: (title) => window.prompt("File name", title),
                alert: (text) => window.alert(text),
                warn: (text, error) => console.warn(text, error),
                refreshTree: (rootPath) =>
                    refreshTree(
                        rootPath,
                        () => workspaceRef.current.rootPath,
                        dispatchAndMirror,
                    ),
            });

            return saveQueueRef.current.saveTab(tabId);
        },
        [dispatchAndMirror],
    );
    const scrollToHeading = useCallback((_: unknown, index: number) => {
        scrollRenderedHeadingIntoView(editorViewportRef.current, index);
    }, []);
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
                        dispatch={dispatchAndMirror}
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
                        dispatch={dispatchAndMirror}
                        onSaveTab={saveTab}
                    />
                    <EditorStage
                        rootPath={workspace.rootPath}
                        activeTab={activeTab}
                        dispatch={dispatchAndMirror}
                        onSaveTab={saveTab}
                        editorViewportRef={editorViewportRef}
                    />
                </main>

                <div
                    className="min-h-0 overflow-hidden"
                    style={{ gridColumn: 3 }}
                >
                    <OutlinePanel
                        headings={activeHeadings}
                        collapsed={rightPanel.isCollapsed}
                        onToggleCollapsed={rightPanel.toggleCollapsed}
                        onHeadingClick={scrollToHeading}
                        resizeHandleProps={rightPanel.resizeHandleProps}
                    />
                </div>
            </div>
        </div>
    );
}

async function refreshTree(
    rootPath: string,
    getCurrentRootPath: () => string,
    dispatch: (action: WorkspaceAction) => void,
) {
    const { invoke } = await tauriCore();
    const scanned = await invoke<ScanWorkspaceResult>("scan_workspace", {
        rootPath,
    });
    const built = buildFileTree(scanned.nodes);

    if (!built.ok) {
        throw new Error(built.error.message);
    }

    if (getCurrentRootPath() !== rootPath) {
        return;
    }

    dispatch({
        type: "tree/loaded",
        fileTree: built.nodes,
    });
}
