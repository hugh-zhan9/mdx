import { planFirstSave } from "../../editor/lib/tab-save";
import { normalizeWorkspacePath } from "./path";
import type {
    FileTreeNode,
    PathChangeResult,
    WorkspaceAction,
    WorkspaceState,
} from "./types";

export type SaveInvoke = <T = unknown>(
    command: string,
    args: Record<string, unknown>,
) => Promise<T>;

export interface SaveTabEnvironment {
    getWorkspace: () => WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    invoke: SaveInvoke;
    promptName: (title: string) => string | null;
    alert: (message: string) => void;
    warn: (message: string, error: unknown) => void;
    refreshTree: (rootPath: string) => Promise<void>;
}

export interface SaveQueue {
    saveTab(tabId: string): Promise<boolean>;
}

interface SavePlanSnapshot {
    rootPath: string;
    tabId: string;
    path: string;
    markdown: string;
}

export function createTabSaveQueue(
    environment: SaveTabEnvironment,
): SaveQueue {
    const pendingByTab = new Map<string, Promise<boolean>>();

    return {
        saveTab(tabId: string) {
            const previous = pendingByTab.get(tabId) ?? Promise.resolve(true);
            const next = previous
                .catch(() => false)
                .then(() => performSaveTab(tabId, environment));

            pendingByTab.set(tabId, next);

            return next.finally(() => {
                if (pendingByTab.get(tabId) === next) {
                    pendingByTab.delete(tabId);
                }
            });
        },
    };
}

export async function performSaveTab(
    tabId: string,
    environment: SaveTabEnvironment,
): Promise<boolean> {
    try {
        const initialWorkspace = environment.getWorkspace();
        const initialTab = initialWorkspace.tabs[tabId];

        if (!initialTab) {
            return false;
        }

        let path = initialTab.path;
        const markdown =
            initialTab.markdown ??
            (await environment.invoke<string>("read_markdown_file", {
                rootPath: initialWorkspace.rootPath,
                path,
            }));
        let renamed = false;

        if (initialTab.needsRenameOnFirstSave) {
            const requestedName = environment.promptName(
                suggestedFormalName(initialTab.title),
            );

            if (!requestedName) {
                return false;
            }

            const plan = planFirstSave({
                currentPath: initialTab.path,
                requestedName,
                existingNames: collectSiblingNames(
                    initialWorkspace.fileTree,
                    dirname(initialTab.path),
                ),
                needsRenameOnFirstSave: true,
            });

            if (plan.kind === "invalid_name") {
                environment.alert(plan.reason);
                return false;
            }

            if (plan.kind === "name_conflict") {
                environment.alert(`"${plan.name}" already exists.`);
                return false;
            }

            if (plan.kind === "rename_then_save") {
                if (
                    !isCurrentTabSnapshot(environment.getWorkspace(), {
                        rootPath: initialWorkspace.rootPath,
                        tabId,
                        path: initialTab.path,
                        markdown,
                    })
                ) {
                    return false;
                }

                const renameResult = await environment.invoke<PathChangeResult>(
                    "rename_path",
                    {
                        rootPath: initialWorkspace.rootPath,
                        fromPath: initialTab.path,
                        newName: basename(plan.newPath),
                    },
                );
                path = renameResult.newPath;
                renamed = true;
                environment.dispatch({
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

        const writePlan = {
            rootPath: initialWorkspace.rootPath,
            tabId,
            path,
            markdown,
        };

        if (!isCurrentTabSnapshot(environment.getWorkspace(), writePlan)) {
            return false;
        }

        await environment.invoke("write_markdown_file", {
            rootPath: writePlan.rootPath,
            path: writePlan.path,
            content: writePlan.markdown,
        });

        const savedStillCurrent = isCurrentTabSnapshot(
            environment.getWorkspace(),
            writePlan,
        );
        if (savedStillCurrent) {
            environment.dispatch({
                type: "tab/savedIfUnchanged",
                tabId,
                markdown,
            });
        }

        if (
            renamed &&
            environment.getWorkspace().rootPath === writePlan.rootPath
        ) {
            try {
                await environment.refreshTree(writePlan.rootPath);
            } catch (refreshError) {
                environment.warn(
                    "File saved, but failed to refresh workspace tree.",
                    refreshError,
                );
                environment.alert(
                    formatError(
                        refreshError,
                        "File saved, but failed to refresh workspace tree.",
                    ),
                );
            }
        }

        return savedStillCurrent;
    } catch (error) {
        environment.alert(formatError(error, "Failed to save file."));
        return false;
    }
}

export function isCurrentTabSnapshot(
    workspace: WorkspaceState,
    snapshot: SavePlanSnapshot,
) {
    const tab = workspace.tabs[snapshot.tabId];

    return (
        workspace.rootPath === snapshot.rootPath &&
        tab !== undefined &&
        normalizeWorkspacePath(tab.path) ===
            normalizeWorkspacePath(snapshot.path) &&
        tab.markdown === snapshot.markdown
    );
}

export function collectSiblingNames(
    nodes: FileTreeNode[],
    parentPath: string,
) {
    const normalizedParentPath = normalizeWorkspacePath(parentPath);

    if (!normalizedParentPath) {
        return nodes.map((node) => node.name);
    }

    const found = findFolderChildren(nodes, normalizedParentPath);

    return (found ?? nodes).map((node) => node.name);
}

export function suggestedFormalName(title: string) {
    return /^Untitled\d*\.md$/i.test(title) ? "" : title;
}

export function basename(path: string) {
    const normalized = normalizeWorkspacePath(path);
    return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

export function dirname(path: string) {
    const normalized = normalizeWorkspacePath(path);
    const parts = normalized.split("/").filter(Boolean);

    if (parts.length <= 1) {
        return normalized.startsWith("/") ? "/" : "";
    }

    const parent = parts.slice(0, -1).join("/");
    return normalized.startsWith("/") ? `/${parent}` : parent;
}

export function formatError(error: unknown, fallback: string) {
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
