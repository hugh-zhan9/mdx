import { planFirstSave } from "../../editor/lib/tab-save";
import { documentFingerprint } from "../../file-watch/lib/external-change";
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

export type MaybePromise<T> = T | Promise<T>;

export interface SaveCompletedEvent {
    rootPath: string;
    path: string;
    previousPath?: string;
}

export interface SaveTabEnvironment {
    getWorkspace: () => WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    invoke: SaveInvoke;
    promptName: (title: string) => MaybePromise<string | null>;
    alert: (message: string) => MaybePromise<void>;
    warn: (message: string, error: unknown) => void;
    refreshTree: (rootPath: string) => Promise<void>;
    afterSave?: (event: SaveCompletedEvent) => MaybePromise<void>;
}

export interface SaveQueue {
    saveTab(tabId: string): Promise<boolean>;
}

interface SavePlanSnapshot {
    rootPath: string;
    tabId: string;
    path: string;
    markdown: string;
    baseFingerprint?: string | null;
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
        const originalSnapshot = {
            rootPath: initialWorkspace.rootPath,
            tabId,
            path: initialTab.path,
            markdown,
            baseFingerprint:
                initialTab.baseFingerprint ?? documentFingerprint(markdown),
        };
        let renamed = false;

        if (initialTab.needsRenameOnFirstSave) {
            const requestedName = await environment.promptName(
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
                environment.alert(`“${plan.name}” 已存在。`);
                return false;
            }

            if (plan.kind === "rename_then_save") {
                if (!isCurrentTabSnapshot(environment.getWorkspace(), originalSnapshot)) {
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

                if (!isCurrentTabSnapshot(environment.getWorkspace(), originalSnapshot)) {
                    return false;
                }

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
            baseFingerprint: originalSnapshot.baseFingerprint,
        };

        if (!isCurrentTabSnapshot(environment.getWorkspace(), writePlan)) {
            return false;
        }

        await environment.invoke("write_markdown_file", {
            rootPath: writePlan.rootPath,
            path: writePlan.path,
            content: writePlan.markdown,
            expectedFingerprint: writePlan.baseFingerprint,
        });
        const savedFingerprint = documentFingerprint(writePlan.markdown);

        const savedStillCurrent = isCurrentTabSnapshot(
            environment.getWorkspace(),
            writePlan,
        );
        if (savedStillCurrent) {
            environment.dispatch({
                type: "tab/savedIfUnchanged",
                tabId,
                markdown,
                fingerprint: savedFingerprint,
            });
            try {
                const previousPath =
                    normalizeWorkspacePath(writePlan.path) ===
                    normalizeWorkspacePath(originalSnapshot.path)
                        ? undefined
                        : originalSnapshot.path;
                const completedEvent: SaveCompletedEvent = {
                    rootPath: writePlan.rootPath,
                    path: writePlan.path,
                };

                if (previousPath) {
                    completedEvent.previousPath = previousPath;
                }

                await environment.afterSave?.(completedEvent);
            } catch (afterSaveError) {
                environment.warn(
                    "文件已保存，但保存后处理失败。",
                    afterSaveError,
                );
            }
        }

        if (
            renamed &&
            environment.getWorkspace().rootPath === writePlan.rootPath
        ) {
            try {
                await environment.refreshTree(writePlan.rootPath);
            } catch (refreshError) {
                environment.warn(
                    "文件已保存，但刷新工作区树失败。",
                    refreshError,
                );
                environment.alert(
                    formatError(
                        refreshError,
                        "文件已保存，但刷新工作区树失败。",
                    ),
                );
            }
        }

        return savedStillCurrent;
    } catch (error) {
        environment.alert(formatError(error, "保存文件失败。"));
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
