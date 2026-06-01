"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
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
    WorkspaceAction,
} from "../lib/types";
import { FileTreeContextMenu } from "./file-tree-context-menu";
import { FileTreeNodeView } from "./file-tree-node";
import { FileTreeToolbar } from "./file-tree-toolbar";

interface FileTreePanelProps {
    rootPath: string;
    fileTree: FileTreeNode[];
    searchQuery: string;
    collapsed: boolean;
    canChooseWorkspace: boolean;
    dispatch: (action: WorkspaceAction) => void;
    onChooseWorkspace: () => void;
    onToggleCollapsed: () => void;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

interface ScanWorkspaceResult {
    rootPath: string;
    nodes: FileTreeNode[];
}

interface CreateNodeResult {
    path: string;
    name: string;
}

interface ContextMenuState {
    node: FilteredFileTreeNode;
    x: number;
    y: number;
}

export function FileTreePanel({
    rootPath,
    fileTree,
    searchQuery,
    collapsed,
    canChooseWorkspace,
    dispatch,
    onChooseWorkspace,
    onToggleCollapsed,
    resizeHandleProps,
}: FileTreePanelProps) {
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
        window.alert(formatted);
    }, []);

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
            showError(error, "Failed to refresh workspace.");
        }
    }, [dispatch, rootPath, showError]);

    const createFolder = useCallback(
        async (parentDir: string) => {
            const name = window.prompt("Folder name");

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
                showError(error, "Failed to create folder.");
            }
        },
        [refreshTree, rootPath, showError],
    );

    const createMarkdownFile = useCallback(
        async (parentDir: string) => {
            const name = window.prompt("Markdown file name", "Untitled.md");

            if (!name?.trim()) {
                return;
            }

            try {
                const created = await invokeTauri<CreateNodeResult>(
                    "create_markdown_file",
                    {
                        rootPath,
                        parentDir,
                        name: withMarkdownExtension(name.trim()),
                    },
                );

                setSelectedPath(normalizeWorkspacePath(created.path));
                expandPath(parentDir, setExpandedPaths);
                await refreshTree();
            } catch (error) {
                showError(error, "Failed to create markdown file.");
            }
        },
        [refreshTree, rootPath, showError],
    );

    const renameNode = useCallback(
        async (node: FilteredFileTreeNode) => {
            const name = window.prompt("New name", node.name);

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
                showError(error, "Failed to rename path.");
            }
        },
        [dispatch, refreshTree, rootPath, showError],
    );

    const deleteNode = useCallback(
        async (node: FilteredFileTreeNode) => {
            const confirmed = window.confirm(
                `Move "${node.name}" to the trash?`,
            );

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
                showError(error, "Failed to move path to trash.");
            }
        },
        [dispatch, refreshTree, rootPath, showError],
    );

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
                showError(error, "Failed to move path.");
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
                        aria-label="Collapse file panel"
                        title="Collapse file panel"
                    >
                        &lt;
                    </button>
                </div>
                <FileTreeToolbar
                    rootPath={rootPath}
                    query={searchQuery}
                    canChooseWorkspace={canChooseWorkspace}
                    onChooseWorkspace={onChooseWorkspace}
                    onNewFolder={() => void createFolder(rootPath)}
                    onNewMarkdownFile={() => void createMarkdownFile(rootPath)}
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
                                ? "No matching markdown files."
                                : "No markdown files found."}
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
                                onSelect={(selected) =>
                                    setSelectedPath(selected.path)
                                }
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
