"use client";

import { useCallback } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { planFirstSave } from "@/features/editor/lib/tab-save";
import { usePanelResize } from "../hooks/use-panel-resize";
import { buildFileTree } from "../lib/file-tree";
import { normalizeWorkspacePath } from "../lib/path";
import type {
    FileTreeNode,
    PathChangeResult,
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
    const saveTab = useCallback(
        async (tabId: string) => {
            const tab = workspace.tabs[tabId];

            if (!tab) {
                return false;
            }

            try {
                const { invoke } = await tauriCore();
                let path = tab.path;
                const markdown =
                    tab.markdown ??
                    (await invoke<string>("read_markdown_file", {
                        rootPath: workspace.rootPath,
                        path,
                    }));
                let renamed = false;

                if (tab.needsRenameOnFirstSave) {
                    const requestedName = window.prompt(
                        "File name",
                        suggestedFormalName(tab.title),
                    );

                    if (!requestedName) {
                        return false;
                    }

                    const plan = planFirstSave({
                        currentPath: tab.path,
                        requestedName,
                        existingNames: collectSiblingNames(
                            workspace.fileTree,
                            dirname(tab.path),
                        ),
                        needsRenameOnFirstSave: true,
                    });

                    if (plan.kind === "invalid_name") {
                        window.alert(plan.reason);
                        return false;
                    }

                    if (plan.kind === "name_conflict") {
                        window.alert(`"${plan.name}" already exists.`);
                        return false;
                    }

                    if (plan.kind === "rename_then_save") {
                        const renameResult = await invoke<PathChangeResult>(
                            "rename_path",
                            {
                                rootPath: workspace.rootPath,
                                fromPath: tab.path,
                                newName: basename(plan.newPath),
                            },
                        );
                        path = renameResult.newPath;
                        renamed = true;
                        dispatch({
                            type: "tab/renamed",
                            tabId,
                            path,
                            title: basename(path),
                            needsRenameOnFirstSave: false,
                        });
                    } else {
                        path = plan.path;
                    }
                }

                await invoke("write_markdown_file", {
                    rootPath: workspace.rootPath,
                    path,
                    content: markdown,
                });
                dispatch({
                    type: "tab/saved",
                    tabId,
                    markdown,
                });

                if (renamed) {
                    try {
                        await refreshTree(workspace.rootPath, dispatch);
                    } catch (refreshError) {
                        console.warn(
                            "File saved, but failed to refresh workspace tree.",
                            refreshError,
                        );
                        window.alert(
                            formatError(
                                refreshError,
                                "File saved, but failed to refresh workspace tree.",
                            ),
                        );
                    }
                }

                return true;
            } catch (error) {
                window.alert(formatError(error, "Failed to save file."));
                return false;
            }
        },
        [dispatch, workspace],
    );
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
                        onSaveTab={saveTab}
                    />
                    <EditorStage
                        rootPath={workspace.rootPath}
                        activeTab={activeTab}
                        dispatch={dispatch}
                        onSaveTab={saveTab}
                    />
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

async function refreshTree(
    rootPath: string,
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

    dispatch({
        type: "tree/loaded",
        fileTree: built.nodes,
    });
}

function collectSiblingNames(nodes: FileTreeNode[], parentPath: string) {
    const normalizedParentPath = normalizeWorkspacePath(parentPath);

    if (!normalizedParentPath) {
        return nodes.map((node) => node.name);
    }

    const found = findFolderChildren(nodes, normalizedParentPath);

    return (found ?? nodes).map((node) => node.name);
}

function findFolderChildren(
    nodes: FileTreeNode[],
    folderPath: string,
): FileTreeNode[] | null {
    for (const node of nodes) {
        if (node.kind === "folder") {
            if (normalizeWorkspacePath(node.path) === folderPath) {
                return node.children;
            }

            const childNames = findFolderChildren(node.children, folderPath);

            if (childNames) {
                return childNames;
            }
        }
    }

    return null;
}

function suggestedFormalName(title: string) {
    return /^Untitled\d*\.md$/i.test(title) ? "" : title;
}

function basename(path: string) {
    const normalized = normalizeWorkspacePath(path);
    return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function dirname(path: string) {
    const normalized = normalizeWorkspacePath(path);
    const parts = normalized.split("/").filter(Boolean);

    if (parts.length <= 1) {
        return normalized.startsWith("/") ? "/" : "";
    }

    const parent = parts.slice(0, -1).join("/");
    return normalized.startsWith("/") ? `/${parent}` : parent;
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
