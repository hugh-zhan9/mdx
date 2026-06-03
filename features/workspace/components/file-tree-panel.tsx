"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
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
    buildFileTree,
    getFileTreeParentPath,
    isPathWithinFolder,
} from "../lib/file-tree";
import {
    isMarkdownFilePath,
    normalizeWorkspacePath,
} from "../lib/path";
import { filterTreeByName } from "../lib/tree-filter";
import type {
    FileTreeNode,
    FilteredFileTreeNode,
    PathChangeResult,
    WorkspaceFileTreeActions,
    WorkspaceAction,
} from "../lib/types";
import { FileTreeContextMenu } from "./file-tree-context-menu";
import { FileTreeNodeView } from "./file-tree-node";
import { FileTreeToolbar } from "./file-tree-toolbar";
import { useAppDialogs } from "./app-dialogs";

interface FileTreePanelProps {
    rootPath: string;
    fileTree: FileTreeNode[];
    searchQuery: string;
    collapsed: boolean;
    dispatch: (action: WorkspaceAction) => void;
    onToggleCollapsed: () => void;
    activeTabPath: string | null;
    onActionsChange: (actions: WorkspaceFileTreeActions | null) => void;
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
    searchQuery,
    collapsed,
    dispatch,
    onToggleCollapsed,
    activeTabPath,
    onActionsChange,
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
    const builtTree = useMemo(() => buildFileTree(fileTree), [fileTree]);
    const searchActive = searchQuery.trim().length > 0;
    const visibleNodes = useMemo(() => {
        if (!builtTree.ok) {
            return [];
        }

        return filterTreeByName(builtTree.nodes, searchQuery);
    }, [builtTree, searchQuery]);
    const actionTargetNode = useMemo(() => {
        if (!builtTree.ok) {
            return null;
        }

        if (selectedPath) {
            const selectedNode = findNodeByPath(builtTree.nodes, selectedPath);

            if (selectedNode) {
                return selectedNode;
            }
        }

        return activeTabPath
            ? findNodeByPath(builtTree.nodes, activeTabPath)
            : null;
    }, [activeTabPath, builtTree, selectedPath]);

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
        try {
            const scanned = await invokeTauri<ScanWorkspaceResult>(
                "scan_workspace",
                { rootPath },
            );
            const result = buildFileTree(scanned.nodes);

            if (!result.ok) {
                throw new Error(result.error.message);
            }

            dispatch({
                type: "tree/loaded",
                fileTree: result.nodes,
            });
            setMessage(null);
        } catch (error) {
            showError(error, "刷新工作区失败。");
        }
    }, [dispatch, rootPath, showError]);

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
                    builtTree.ok ? builtTree.nodes : [],
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
        [builtTree, dispatch, refreshTree, rootPath, showError],
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

    if (collapsed) {
        return null;
    }

    return (
        <aside className="relative h-full min-h-0 overflow-hidden border-r border-base-300 bg-base-100">
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-8 shrink-0 items-center justify-end border-b border-base-300 px-2">
                    <button
                        type="button"
                        className="h-7 shrink-0 px-2 text-xs text-base-content/65 hover:bg-base-200"
                        onClick={onToggleCollapsed}
                        aria-label="收起文件树"
                        title="收起文件树"
                    >
                        &lt;
                    </button>
                </div>
                <FileTreeToolbar
                    query={searchQuery}
                    canMutateSelection={Boolean(actionTargetNode)}
                    onNewFolder={() => void createFolderAtSelection()}
                    onNewMarkdownFile={() =>
                        void createMarkdownFileAtSelection()
                    }
                    onRename={() => void renameSelection()}
                    onDelete={() => void deleteSelection()}
                    onRefresh={() => void refreshTree()}
                    onQueryChange={(query) =>
                        dispatch({
                            type: "search/queryChanged",
                            query,
                        })
                    }
                />

                <div className="min-h-0 flex-1 overflow-auto py-1">
                    {builtTree.ok ? null : (
                        <div className="px-3 py-2 text-xs text-error">
                            {builtTree.error.message}
                        </div>
                    )}
                    {message ? (
                        <div className="border-b border-base-300 px-3 py-2 text-xs text-warning">
                            {message}
                        </div>
                    ) : null}
                    {visibleNodes.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-base-content/50">
                            {searchActive
                                ? "未找到匹配的 Markdown 文件。"
                                : "未找到 Markdown 文件。"}
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

                                    if (selected.kind === "file") {
                                        dispatch({
                                            type: "tab/opened",
                                            tab: {
                                                tabId: nanoid(8),
                                                path: selected.path,
                                                title: selected.name,
                                                dirty: false,
                                                needsRenameOnFirstSave: false,
                                            },
                                        });
                                    }
                                }}
                                onToggleFolder={toggleFolder}
                                onContextMenu={openContextMenu}
                                onDragStart={handleDragStart}
                                onDropOnFolder={(fromPath, targetDir) =>
                                    void moveNode(fromPath, targetDir)
                                }
                            />
                        ))
                    )}
                </div>
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
