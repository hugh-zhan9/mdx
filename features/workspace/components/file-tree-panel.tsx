"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
} from "react";
import { nanoid } from "nanoid";
import type {
    Dispatch,
    DragEvent,
    HTMLAttributes,
    MouseEvent as ReactMouseEvent,
    SetStateAction,
} from "react";
import {
    getFileTreeParentPath,
    isPathWithinFolder,
} from "../lib/file-tree";
import {
    isMarkdownFilePath,
    isPreviewableFilePath,
    normalizeWorkspacePath,
    shouldOpenWithDefaultApplication,
} from "../lib/path";
import { filterTreeByName } from "../lib/tree-filter";
import type {
    AppPreferences,
    FileTreeNode,
    FilteredFileTreeNode,
    PathChangeResult,
    WorkspaceFileTreeActions,
    WorkspaceAction,
    WorkspaceFullTextSearchState,
    WorkspaceSearchResultItem,
} from "../lib/types";
import { FileTreeContextMenu } from "./file-tree-context-menu";
import { FileTreeNodeView } from "./file-tree-node";
import { FileTreeToolbar } from "./file-tree-toolbar";
import { WorkspaceSearchPanel } from "./workspace-search-panel";
import { useAppDialogs } from "./app-dialogs";
import { EmptyState } from "../../../common/components/ui-controls";
import { createFileTreeEmptyState } from "../lib/empty-state-copy";

interface FileTreePanelProps {
    rootPath: string;
    fileTree: FileTreeNode[];
    treeFilterQuery: string;
    mode: "tree" | "search";
    searchState: WorkspaceFullTextSearchState;
    collapsed: boolean;
    dispatch: (action: WorkspaceAction) => void;
    preferences: AppPreferences;
    activeTabPath: string | null;
    onActionsChange: (actions: WorkspaceFileTreeActions | null) => void;
    onModeChange: (mode: "tree" | "search") => void;
    onSearchQueryChange: (query: string) => void;
    onSearchCaseSensitiveToggle: () => void;
    onSearchResultClick: (result: WorkspaceSearchResultItem) => void;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

interface ScanWorkspaceResult {
    rootPath: string;
    nodes: FileTreeNode[];
}

interface CreateNodeResult {
    path: string;
    name: string;
    needsRenameOnFirstSave?: boolean;
}

interface ContextMenuState {
    node: FilteredFileTreeNode;
    x: number;
    y: number;
}

interface ActionNode {
    kind: FileTreeNode["kind"];
    name: string;
    path: string;
}

export function FileTreePanel({
    rootPath,
    fileTree,
    treeFilterQuery,
    mode,
    searchState,
    collapsed,
    dispatch,
    preferences,
    activeTabPath,
    onActionsChange,
    onModeChange,
    onSearchQueryChange,
    onSearchCaseSensitiveToggle,
    onSearchResultClick,
    resizeHandleProps,
}: FileTreePanelProps) {
    const dialogs = useAppDialogs();
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
        () => new Set(),
    );
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
        null,
    );
    const [message, setMessage] = useState<string | null>(null);
    const refreshSequenceRef = useRef(0);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const refreshPendingRef = useRef(false);
    const [refreshing, setRefreshing] = useState(false);
    const [, startRefreshTransition] = useTransition();
    const searchActive = treeFilterQuery.trim().length > 0;
    const visibleNodes = useMemo(() => {
        return filterTreeByName(fileTree, treeFilterQuery);
    }, [fileTree, treeFilterQuery]);
    const actionTargetNode = useMemo(() => {
        if (selectedPath) {
            const selectedNode = findNodeByPath(fileTree, selectedPath);

            if (selectedNode) {
                return selectedNode;
            }
        }

        return activeTabPath
            ? findNodeByPath(fileTree, activeTabPath)
            : null;
    }, [activeTabPath, fileTree, selectedPath]);

    useEffect(() => {
        setContextMenu(null);
        setSelectedPath(null);
        setExpandedPaths(new Set());
    }, [rootPath]);

    useEffect(() => {
        if (!contextMenu) {
            return;
        }

        const close = () => setContextMenu(null);
        document.addEventListener("click", close);
        window.addEventListener("blur", close);

        return () => {
            document.removeEventListener("click", close);
            window.removeEventListener("blur", close);
        };
    }, [contextMenu]);

    const showError = useCallback((error: unknown, fallback: string) => {
        const formatted = formatError(error, fallback);
        setMessage(formatted);
        void dialogs.alert({
            title: "操作失败",
            message: formatted,
        });
    }, [dialogs]);

    const refreshTree = useCallback(async () => {
        if (refreshPromiseRef.current) {
            refreshPendingRef.current = true;
            return refreshPromiseRef.current;
        }

        const refreshSequence = refreshSequenceRef.current + 1;
        refreshSequenceRef.current = refreshSequence;
        setRefreshing(true);

        const refreshPromise = (async () => {
            try {
                do {
                    refreshPendingRef.current = false;
                    const scanned = await invokeTauri<ScanWorkspaceResult>(
                        "scan_workspace",
                        {
                            rootPath,
                            options: {
                                excludeDirs: preferences.fileTreeExcludeDirs,
                            },
                        },
                    );

                    if (refreshSequenceRef.current !== refreshSequence) {
                        return;
                    }

                    startRefreshTransition(() => {
                        dispatch({
                            type: "tree/loaded",
                            fileTree: scanned.nodes,
                        });
                    });
                    setMessage(null);
                } while (refreshPendingRef.current);
            } catch (error) {
                if (refreshSequenceRef.current === refreshSequence) {
                    showError(error, "刷新工作区失败。");
                }
            } finally {
                refreshPromiseRef.current = null;
                if (refreshSequenceRef.current === refreshSequence) {
                    setRefreshing(false);
                }
            }
        })();

        refreshPromiseRef.current = refreshPromise;

        return refreshPromise;
    }, [
        dispatch,
        preferences.fileTreeExcludeDirs,
        rootPath,
        showError,
        startRefreshTransition,
    ]);

    const createFolder = useCallback(
        async (parentDir: string) => {
            const name = await dialogs.prompt({
                title: "新建文件夹",
                label: "文件夹名称",
                confirmLabel: "创建",
            });

            if (!name?.trim()) {
                return;
            }

            try {
                const created = await invokeTauri<CreateNodeResult>(
                    "create_folder",
                    {
                        rootPath,
                        parentDir,
                        name: name.trim(),
                    },
                );

                setSelectedPath(normalizeWorkspacePath(created.path));
                expandPath(parentDir, setExpandedPaths);
                await refreshTree();
            } catch (error) {
                showError(error, "创建文件夹失败。");
            }
        },
        [dialogs, refreshTree, rootPath, showError],
    );

    const createMarkdownFile = useCallback(
        async (parentDir: string) => {
            try {
                const created = await invokeTauri<CreateNodeResult>(
                    "create_markdown_file",
                    {
                        rootPath,
                        parentDir,
                        name: null,
                        temporaryUntitled: true,
                    },
                );

                setSelectedPath(normalizeWorkspacePath(created.path));
                expandPath(parentDir, setExpandedPaths);
                dispatch({
                    type: "tab/opened",
                    tab: {
                        tabId: nanoid(8),
                        path: created.path,
                        title: created.name,
                        dirty: false,
                        needsRenameOnFirstSave:
                            created.needsRenameOnFirstSave ?? false,
                    },
                });
                await refreshTree();
            } catch (error) {
                showError(error, "创建 Markdown 文档失败。");
            }
        },
        [dispatch, refreshTree, rootPath, showError],
    );

    const createFolderAtSelection = useCallback(async () => {
        await createFolder(getActionTargetDir(actionTargetNode, rootPath));
    }, [actionTargetNode, createFolder, rootPath]);

    const createMarkdownFileAtSelection = useCallback(async () => {
        await createMarkdownFile(getActionTargetDir(actionTargetNode, rootPath));
    }, [actionTargetNode, createMarkdownFile, rootPath]);

    const renameNode = useCallback(
        async (node: ActionNode) => {
            const name = await dialogs.prompt({
                title: "重命名",
                label: node.kind === "file" ? "文件名称" : "文件夹名称",
                initialValue: node.name,
                confirmLabel: "重命名",
            });

            if (!name?.trim() || name.trim() === node.name) {
                return;
            }

            try {
                const renamed = await invokeTauri<PathChangeResult>(
                    "rename_path",
                    {
                        rootPath,
                        fromPath: node.path,
                        newName:
                            node.kind === "file"
                                ? withMarkdownExtension(name.trim(), node.name)
                                : name.trim(),
                    },
                );

                dispatch(
                    node.kind === "file"
                        ? {
                              type: "tab/pathRemapped",
                              fromPath: renamed.oldPath,
                              toPath: renamed.newPath,
                          }
                        : {
                              type: "tab/prefixRemapped",
                              affectedPrefix:
                                  renamed.affectedPrefix ?? {
                                      oldPrefix: renamed.oldPath,
                                      newPrefix: renamed.newPath,
                                  },
                          },
                );
                setSelectedPath(normalizeWorkspacePath(renamed.newPath));
                await refreshTree();
            } catch (error) {
                showError(error, "重命名失败。");
            }
        },
        [dialogs, dispatch, refreshTree, rootPath, showError],
    );

    const deleteNode = useCallback(
        async (node: ActionNode) => {
            const confirmed = await dialogs.confirm({
                title: "移到废纸篓",
                message: `将“${node.name}”移到废纸篓？`,
                confirmLabel: "移到废纸篓",
                destructive: true,
            });

            if (!confirmed) {
                return;
            }

            try {
                await invokeTauri("trash_path", {
                    rootPath,
                    path: node.path,
                });
                dispatch(
                    node.kind === "file"
                        ? {
                              type: "tab/closedByPath",
                              path: node.path,
                          }
                        : {
                              type: "tab/closedByPrefix",
                              prefix: node.path,
                          },
                );
                setSelectedPath((current) =>
                    current === node.path ? null : current,
                );
                await refreshTree();
            } catch (error) {
                showError(error, "移动到废纸篓失败。");
            }
        },
        [dialogs, dispatch, refreshTree, rootPath, showError],
    );

    const renameSelection = useCallback(async () => {
        if (!actionTargetNode) {
            setMessage("请先选择文件或文件夹。");
            void dialogs.alert({
                title: "需要选择",
                message: "请先选择文件或文件夹。",
            });
            return;
        }

        await renameNode(actionTargetNode);
    }, [actionTargetNode, dialogs, renameNode]);

    const deleteSelection = useCallback(async () => {
        if (!actionTargetNode) {
            setMessage("请先选择文件或文件夹。");
            void dialogs.alert({
                title: "需要选择",
                message: "请先选择文件或文件夹。",
            });
            return;
        }

        await deleteNode(actionTargetNode);
    }, [actionTargetNode, deleteNode, dialogs]);

    const actions = useMemo<WorkspaceFileTreeActions>(
        () => ({
            createFolder: createFolderAtSelection,
            createMarkdownFile: createMarkdownFileAtSelection,
            renameSelection,
            deleteSelection,
            refreshTree,
        }),
        [
            createFolderAtSelection,
            createMarkdownFileAtSelection,
            deleteSelection,
            refreshTree,
            renameSelection,
        ],
    );

    useEffect(() => {
        onActionsChange(actions);

        return () => onActionsChange(null);
    }, [actions, onActionsChange]);

    const moveNode = useCallback(
        async (fromPath: string, targetDir: string) => {
            const normalizedFromPath = normalizeWorkspacePath(fromPath);
            const normalizedTargetDir = normalizeWorkspacePath(targetDir);

            if (
                normalizedFromPath === normalizedTargetDir ||
                getFileTreeParentPath(normalizedFromPath) ===
                    normalizedTargetDir ||
                isPathWithinFolder(normalizedTargetDir, normalizedFromPath)
            ) {
                return;
            }

            try {
                const moved = await invokeTauri<PathChangeResult>("move_path", {
                    rootPath,
                    fromPath: normalizedFromPath,
                    targetDir: normalizedTargetDir,
                });

                const movedNode = findNodeByPath(
                    fileTree,
                    normalizedFromPath,
                );
                const movedFile =
                    movedNode?.kind === "file" ||
                    (!movedNode && !moved.affectedPrefix);

                dispatch(
                    movedFile
                        ? {
                              type: "tab/pathRemapped",
                              fromPath: moved.oldPath,
                              toPath: moved.newPath,
                          }
                        : {
                              type: "tab/prefixRemapped",
                              affectedPrefix:
                                  moved.affectedPrefix ?? {
                                      oldPrefix: moved.oldPath,
                                      newPrefix: moved.newPath,
                                  },
                          },
                );
                setSelectedPath(normalizeWorkspacePath(moved.newPath));
                expandPath(normalizedTargetDir, setExpandedPaths);
                await refreshTree();
            } catch (error) {
                showError(error, "移动失败。");
            }
        },
        [dispatch, fileTree, refreshTree, rootPath, showError],
    );

    const toggleFolder = useCallback((path: string) => {
        setExpandedPaths((current) => {
            const next = new Set(current);

            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }

            return next;
        });
    }, []);

    const openContextMenu = useCallback(
        (
            node: FilteredFileTreeNode,
            event: ReactMouseEvent<HTMLButtonElement>,
        ) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedPath(node.path);
            setContextMenu({
                node,
                x: clamp(event.clientX, 0, window.innerWidth - 180),
                y: clamp(event.clientY, 0, window.innerHeight - 220),
            });
        },
        [],
    );

    const handleDragStart = useCallback(
        (node: FilteredFileTreeNode, event: DragEvent<HTMLButtonElement>) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.path);
        },
        [],
    );

    const openWithDefaultApplication = useCallback(
        async (node: FilteredFileTreeNode) => {
            if (
                node.kind !== "file" ||
                !shouldOpenWithDefaultApplication(node.path)
            ) {
                return;
            }

            try {
                await invokeTauri("open_path_with_default_application", {
                    rootPath,
                    path: node.path,
                });
                setMessage(null);
            } catch (error) {
                showError(error, "打开文件失败。");
            }
        },
        [rootPath, showError],
    );

    if (collapsed) {
        return null;
    }
    const emptyState = createFileTreeEmptyState({ searchActive });

    return (
        <aside className="relative h-full min-h-0 overflow-hidden border-r border-base-300 bg-base-100">
            <div className="flex h-full min-h-0 flex-col">
                <div className="grid grid-cols-2 gap-1 border-b border-base-300 bg-base-200 p-1">
                    <button
                        type="button"
                        className={[
                            "h-7 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                            mode === "tree"
                                ? "bg-base-100 text-base-content shadow-sm"
                                : "text-base-content/70 hover:text-base-content",
                        ].join(" ")}
                        onClick={() => onModeChange("tree")}
                    >
                        文件
                    </button>
                    <button
                        type="button"
                        className={[
                            "h-7 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                            mode === "search"
                                ? "bg-base-100 text-base-content shadow-sm"
                                : "text-base-content/70 hover:text-base-content",
                        ].join(" ")}
                        onClick={() => onModeChange("search")}
                    >
                        全文
                    </button>
                </div>

                {mode === "tree" ? (
                    <>
                        <FileTreeToolbar
                            query={treeFilterQuery}
                            canMutateSelection={Boolean(actionTargetNode)}
                            onNewFolder={() => void createFolderAtSelection()}
                            onNewMarkdownFile={() =>
                                void createMarkdownFileAtSelection()
                            }
                            onRename={() => void renameSelection()}
                            onDelete={() => void deleteSelection()}
                            onRefresh={() => void refreshTree()}
                            refreshing={refreshing}
                            onQueryChange={(query) =>
                                dispatch({
                                    type: "treeFilter/queryChanged",
                                    query,
                                })
                            }
                        />

                        <div className="min-h-0 flex-1 overflow-auto py-1">
                            {message ? (
                                <div className="border-b border-base-300 px-3 py-2 text-xs text-warning">
                                    {message}
                                </div>
                            ) : null}
                            {visibleNodes.length === 0 ? (
                                <div className="py-8">
                                    <EmptyState
                                        title={emptyState.title}
                                        description={emptyState.description}
                                        actionLabel={
                                            searchActive ? null : "新建文档"
                                        }
                                        onAction={
                                            searchActive
                                                ? undefined
                                                : () =>
                                                      void createMarkdownFileAtSelection()
                                        }
                                    />
                                </div>
                            ) : (
                                visibleNodes.map((node) => (
                                    <FileTreeNodeView
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        selectedPath={selectedPath}
                                        expandedPaths={expandedPaths}
                                        searchActive={searchActive}
                                        onSelect={(selected) => {
                                            setSelectedPath(selected.path);

                                            if (
                                                selected.kind === "file" &&
                                                isPreviewableFilePath(
                                                    selected.path,
                                                )
                                            ) {
                                                dispatch({
                                                    type: "tab/opened",
                                                    tab: {
                                                        tabId: nanoid(8),
                                                        path: selected.path,
                                                        title: selected.name,
                                                        dirty: false,
                                                        needsRenameOnFirstSave:
                                                            false,
                                                    },
                                                });
                                            }
                                        }}
                                        onToggleFolder={toggleFolder}
                                        onContextMenu={openContextMenu}
                                        onDoubleClick={(node) =>
                                            void openWithDefaultApplication(
                                                node,
                                            )
                                        }
                                        onDragStart={handleDragStart}
                                        onDropOnFolder={(fromPath, targetDir) =>
                                            void moveNode(fromPath, targetDir)
                                        }
                                    />
                                ))
                            )}
                        </div>
                    </>
                ) : (
                    <div className="min-h-0 flex-1">
                        <WorkspaceSearchPanel
                            rootPath={rootPath}
                            state={searchState}
                            preferences={preferences}
                            onQueryChange={onSearchQueryChange}
                            onCaseSensitiveToggle={onSearchCaseSensitiveToggle}
                            onResultClick={onSearchResultClick}
                        />
                    </div>
                )}
            </div>

            <FileTreeContextMenu
                node={contextMenu?.node ?? null}
                x={contextMenu?.x ?? 0}
                y={contextMenu?.y ?? 0}
                onClose={() => setContextMenu(null)}
                onCreateFolder={() => {
                    if (contextMenu?.node.kind === "folder") {
                        void createFolder(contextMenu.node.path);
                    }
                }}
                onCreateMarkdownFile={() => {
                    if (contextMenu?.node.kind === "folder") {
                        void createMarkdownFile(contextMenu.node.path);
                    }
                }}
                onRename={() => {
                    if (contextMenu?.node) {
                        void renameNode(contextMenu.node);
                    }
                }}
                onDelete={() => {
                    if (contextMenu?.node) {
                        void deleteNode(contextMenu.node);
                    }
                }}
            />

            <div
                {...resizeHandleProps}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40"
            />
        </aside>
    );
}

async function invokeTauri<T = unknown>(
    command: string,
    args: Record<string, unknown>,
) {
    const { invoke } = await import("@tauri-apps/api/core");

    return invoke<T>(command, args);
}

function expandPath(
    path: string,
    setExpandedPaths: Dispatch<SetStateAction<Set<string>>>,
) {
    const normalizedPath = normalizeWorkspacePath(path);

    setExpandedPaths((current) => {
        const next = new Set(current);
        next.add(normalizedPath);
        return next;
    });
}

function withMarkdownExtension(name: string, fallbackName = "Untitled.md") {
    if (isMarkdownFilePath(name)) {
        return name;
    }

    const fallbackExtensionMatch = fallbackName.match(/(\.markdown|\.md)$/i);

    return `${name}${fallbackExtensionMatch?.[1] ?? ".md"}`;
}

function getActionTargetDir(
    node: FileTreeNode | null,
    rootPath: string,
) {
    if (!node) {
        return rootPath;
    }

    if (node.kind === "folder") {
        return node.path;
    }

    return getFileTreeParentPath(node.path) || rootPath;
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

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

function findNodeByPath(nodes: FileTreeNode[], path: string): FileTreeNode | null {
    for (const node of nodes) {
        if (node.path === path) {
            return node;
        }

        if (node.kind === "folder") {
            const child = findNodeByPath(node.children, path);

            if (child) {
                return child;
            }
        }
    }

    return null;
}
