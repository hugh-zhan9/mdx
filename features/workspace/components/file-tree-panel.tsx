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
    searchState: WorkspaceFullTextSearchState;
    collapsed: boolean;
    dispatch: (action: WorkspaceAction) => void;
    preferences: AppPreferences;
    activeTabPath: string | null;
    onActionsChange: (actions: WorkspaceFileTreeActions | null) => void;
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
    searchState,
    collapsed,
    dispatch,
    preferences,
    activeTabPath,
    onActionsChange,
    onSearchQueryChange,
    onSearchCaseSensitiveToggle,
    onSearchResultClick,
    resizeHandleProps,
}: FileTreePanelProps) {
    const dialogs = useAppDialogs();
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
        () => new Set(),
    );
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
    const selectedActionNodes = useMemo(() => {
        const nodes = Array.from(selectedPaths)
            .map((path) => findNodeByPath(fileTree, path))
            .filter((node): node is FileTreeNode => Boolean(node));

        return withoutDescendantsOfSelectedFolders(nodes);
    }, [fileTree, selectedPaths]);
    const visibleNodeOrder = useMemo(
        () =>
            flattenVisibleFileTreeNodes(
                visibleNodes,
                expandedPaths,
                searchActive,
            ),
        [expandedPaths, searchActive, visibleNodes],
    );

    useEffect(() => {
        setContextMenu(null);
        setSelectedPath(null);
        setSelectedPaths(new Set());
        setExpandedPaths(new Set());
    }, [rootPath]);

    useEffect(() => {
        if (!contextMenu) {
            return;
        }

        const close = () => setContextMenu(null);
        const listenerHandle = window.setTimeout(() => {
            document.addEventListener("click", close);
        }, 0);
        window.addEventListener("blur", close);

        return () => {
            window.clearTimeout(listenerHandle);
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

                selectSinglePath(created.path, setSelectedPath, setSelectedPaths);
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

                selectSinglePath(created.path, setSelectedPath, setSelectedPaths);
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
                        baseFingerprint: null,
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
                selectSinglePath(
                    renamed.newPath,
                    setSelectedPath,
                    setSelectedPaths,
                );
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
                clearDeletedSelection(
                    [node.path],
                    setSelectedPath,
                    setSelectedPaths,
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
        const deleteTargets =
            selectedActionNodes.length > 0
                ? selectedActionNodes
                : actionTargetNode
                  ? [actionTargetNode]
                  : [];

        if (deleteTargets.length === 0) {
            setMessage("请先选择文件或文件夹。");
            void dialogs.alert({
                title: "需要选择",
                message: "请先选择文件或文件夹。",
            });
            return;
        }

        if (deleteTargets.length === 1) {
            await deleteNode(deleteTargets[0]);
            return;
        }

        const confirmed = await dialogs.confirm({
            title: "移到废纸篓",
            message: `将选中的 ${deleteTargets.length} 个项目移到废纸篓？`,
            confirmLabel: "移到废纸篓",
            destructive: true,
        });

        if (!confirmed) {
            return;
        }

        try {
            for (const node of deleteTargets) {
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
            }

            clearDeletedSelection(
                deleteTargets.map((node) => node.path),
                setSelectedPath,
                setSelectedPaths,
            );
            await refreshTree();
        } catch (error) {
            showError(error, "移动到废纸篓失败。");
        }
    }, [
        actionTargetNode,
        deleteNode,
        dialogs,
        dispatch,
        refreshTree,
        rootPath,
        selectedActionNodes,
        showError,
    ]);

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
                selectSinglePath(moved.newPath, setSelectedPath, setSelectedPaths);
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
            setSelectedPaths((current) =>
                current.has(node.path) ? current : new Set([node.path]),
            );
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

    const selectNode = useCallback(
        (
            node: FilteredFileTreeNode,
            event: ReactMouseEvent<HTMLButtonElement>,
        ) => {
            setSelectedPath(node.path);
            setSelectedPaths((current) => {
                if (event.shiftKey && selectedPath) {
                    const range = selectedRangePaths(
                        visibleNodeOrder,
                        selectedPath,
                        node.path,
                    );

                    if (range.length > 0) {
                        return new Set(range);
                    }
                }

                if (event.metaKey || event.ctrlKey) {
                    const next = new Set(current);

                    if (next.has(node.path)) {
                        next.delete(node.path);
                    } else {
                        next.add(node.path);
                    }

                    return next.size > 0 ? next : new Set([node.path]);
                }

                return new Set([node.path]);
            });
        },
        [selectedPath, visibleNodeOrder],
    );

    if (collapsed) {
        return null;
    }
    const emptyState = createFileTreeEmptyState({ searchActive });

    return (
        <aside
            // The sidebar sits on its own ground rather than the content's, so
            // the boundary between them is a change of surface with a hairline
            // on it — not a heavy rule doing the separating by itself.
            className="relative h-full min-h-0 overflow-hidden border-r border-[var(--mdx-separator)] bg-[var(--mdx-sidebar-bg)]"
        >
            <div className="flex h-full min-h-0 flex-col">
                {/*
                 * One search box, two kinds of answer.
                 *
                 * There used to be a "文件 / 全文" pair of tabs here, which made
                 * the user choose which kind of search they wanted before they
                 * had typed anything — and the answer to "which one is my file
                 * in" is usually "I don't know yet". Now the same query filters
                 * the tree and searches the content, and both sets of results
                 * are shown under headings.
                 */}
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
                            onQueryChange={(query) => {
                                // Both searches, one keystroke. The content
                                // search debounces and cancels its own
                                // in-flight request, so driving it from every
                                // keystroke costs nothing the tree filter does
                                // not already cost.
                                dispatch({
                                    type: "treeFilter/queryChanged",
                                    query,
                                });
                                onSearchQueryChange(query);
                            }}
                        />

                        <div className="min-h-0 flex-1 overflow-auto py-1">
                            {message ? (
                                <div className="border-b border-[var(--mdx-separator)] px-3 py-2 text-xs text-warning">
                                    {message}
                                </div>
                            ) : null}
                            {/*
                             * The heading appears only while searching. With no
                             * query this panel is the file tree, and a "文件"
                             * heading over the whole tree labels nothing.
                             */}
                            {searchActive ? (
                                <p className="px-3 pb-1 pt-1.5 text-[11px] text-base-content/45">
                                    文件
                                </p>
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
                                        selectedPaths={selectedPaths}
                                        expandedPaths={expandedPaths}
                                        searchActive={searchActive}
                                        onSelect={(selected, event) => {
                                            selectNode(selected, event);
                                            if (
                                                !event.shiftKey &&
                                                !event.metaKey &&
                                                !event.ctrlKey &&
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
                                                        baseFingerprint: null,
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
                            {/*
                             * Content matches follow the file matches in the
                             * same scroller, rather than in a pane of their
                             * own: they answer the same question the user
                             * asked, so they belong in the same list of
                             * answers.
                             */}
                            {searchActive ? (
                                <>
                                    <p className="border-t border-[var(--mdx-separator)]/60 px-3 pb-1 pt-2.5 text-[11px] text-base-content/45">
                                        内容
                                    </p>
                                    <WorkspaceSearchPanel
                                        state={searchState}
                                        preferences={preferences}
                                        onCaseSensitiveToggle={
                                            onSearchCaseSensitiveToggle
                                        }
                                        onResultClick={onSearchResultClick}
                                    />
                                </>
                            ) : null}
                        </div>
                    </>
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
                        void (selectedPaths.size > 1 &&
                        selectedPaths.has(contextMenu.node.path)
                            ? deleteSelection()
                            : deleteNode(contextMenu.node));
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

function selectSinglePath(
    path: string,
    setSelectedPath: Dispatch<SetStateAction<string | null>>,
    setSelectedPaths: Dispatch<SetStateAction<Set<string>>>,
) {
    const normalizedPath = normalizeWorkspacePath(path);
    setSelectedPath(normalizedPath);
    setSelectedPaths(new Set([normalizedPath]));
}

function clearDeletedSelection(
    deletedPaths: string[],
    setSelectedPath: Dispatch<SetStateAction<string | null>>,
    setSelectedPaths: Dispatch<SetStateAction<Set<string>>>,
) {
    const deleted = new Set(deletedPaths.map(normalizeWorkspacePath));

    setSelectedPath((current) =>
        current && deleted.has(current) ? null : current,
    );
    setSelectedPaths((current) => {
        const next = new Set(current);

        for (const path of deleted) {
            next.delete(path);
        }

        return next;
    });
}

export function flattenVisibleFileTreeNodes(
    nodes: FilteredFileTreeNode[],
    expandedPaths: Set<string>,
    searchActive: boolean,
): FilteredFileTreeNode[] {
    const flattened: FilteredFileTreeNode[] = [];

    for (const node of nodes) {
        flattened.push(node);

        if (
            node.kind === "folder" &&
            (searchActive || expandedPaths.has(node.path))
        ) {
            flattened.push(
                ...flattenVisibleFileTreeNodes(
                    node.children,
                    expandedPaths,
                    searchActive,
                ),
            );
        }
    }

    return flattened;
}

export function selectedRangePaths(
    nodes: FilteredFileTreeNode[],
    anchorPath: string,
    targetPath: string,
) {
    const anchorIndex = nodes.findIndex((node) => node.path === anchorPath);
    const targetIndex = nodes.findIndex((node) => node.path === targetPath);

    if (anchorIndex === -1 || targetIndex === -1) {
        return [];
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);

    return nodes.slice(start, end + 1).map((node) => node.path);
}

export function withoutDescendantsOfSelectedFolders(nodes: FileTreeNode[]) {
    const selectedFolderPaths = nodes
        .filter((node) => node.kind === "folder")
        .map((node) => node.path);

    return nodes.filter(
        (node) =>
            !selectedFolderPaths.some(
                (folderPath) =>
                    node.path !== folderPath &&
                    isPathWithinFolder(node.path, folderPath),
            ),
    );
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
