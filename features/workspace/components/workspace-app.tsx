"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useWorkspaceBootstrap } from "../hooks/use-workspace-bootstrap";
import { syncCliWorkspaceSnapshot } from "../lib/cli-sync";
import type {
    WorkspaceMenuActions,
    WorkspaceState,
    WorkspaceTab,
} from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

export function WorkspaceApp() {
    const workspaceActionsRef = useRef<WorkspaceMenuActions | null>(null);
    const workspaceRef = useRef<WorkspaceState | null>(null);
    const {
        status,
        workspace,
        dispatch,
        chooseWorkspace,
        canChooseWorkspace,
        message,
    } = useWorkspaceBootstrap();
    useEffect(() => {
        workspaceRef.current = workspace;
    }, [workspace]);

    const chooseWorkspaceWithGuard = useCallback(async () => {
        const currentWorkspace = workspaceRef.current;

        if (
            currentWorkspace &&
            hasDirtyTabs(currentWorkspace) &&
            !window.confirm(
                "This workspace has unsaved changes. Open another folder and discard them?",
            )
        ) {
            return;
        }

        await chooseWorkspace();
    }, [chooseWorkspace]);

    const handleActionsChange = useCallback(
        (actions: WorkspaceMenuActions | null) => {
            workspaceActionsRef.current = actions;
        },
        [],
    );

    useCliWorkspaceSync(workspace);
    useWorkspaceMenuEvents(
        workspaceActionsRef,
        chooseWorkspaceWithGuard,
    );
    useWorkspaceCloseGuard(workspaceRef);

    return (
        <main
            data-mdx-root
            className="h-screen min-h-0 bg-base-100 text-base-content"
        >
            {workspace ? (
                <WorkspaceShell
                    workspace={workspace}
                    dispatch={dispatch}
                    onChooseWorkspace={chooseWorkspaceWithGuard}
                    canChooseWorkspace={canChooseWorkspace}
                    message={message}
                    onActionsChange={handleActionsChange}
                />
            ) : (
                <WorkspaceEmptyState
                    status={status}
                    message={message}
                    onChooseWorkspace={chooseWorkspaceWithGuard}
                    canChooseWorkspace={canChooseWorkspace}
                />
            )}
        </main>
    );
}

function useWorkspaceMenuEvents(
    workspaceActionsRef: RefObject<WorkspaceMenuActions | null>,
    chooseWorkspace: () => Promise<void>,
) {
    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let disposed = false;
        const unlisteners: Array<() => void> = [];

        const runAction = (handler: () => Promise<void> | void) => {
            void Promise.resolve(handler()).catch((error) => {
                console.warn("Failed to run workspace menu action.", error);
            });
        };

        const subscribe = async () => {
            const { listen } = await import("@tauri-apps/api/event");

            const nextUnlisteners = await Promise.all([
                listen("mdx-menu-open-folder", () => {
                    runAction(chooseWorkspace);
                }),
                listen("mdx-menu-new-folder", () => {
                    runAction(
                        workspaceActionsRef.current?.createFolder ??
                            noopAsync,
                    );
                }),
                listen("mdx-menu-new-markdown-file", () => {
                    runAction(
                        workspaceActionsRef.current?.createMarkdownFile ??
                            noopAsync,
                    );
                }),
                listen("mdx-menu-rename", () => {
                    runAction(
                        workspaceActionsRef.current?.renameSelection ??
                            noopAsync,
                    );
                }),
                listen("mdx-menu-trash", () => {
                    runAction(
                        workspaceActionsRef.current?.deleteSelection ??
                            noopAsync,
                    );
                }),
                listen("mdx-menu-refresh", () => {
                    runAction(
                        workspaceActionsRef.current?.refreshTree ?? noopAsync,
                    );
                }),
                listen("mdx-menu-save", () => {
                    runAction(
                        workspaceActionsRef.current?.saveActiveTab ??
                            noopAsync,
                    );
                }),
                listen("mdx-menu-close-tab", () => {
                    runAction(
                        workspaceActionsRef.current?.closeActiveTab ??
                            noopAsync,
                    );
                }),
            ]);
            unlisteners.push(...nextUnlisteners);

            if (disposed) {
                unlisteners.forEach((unlisten) => unlisten());
            }
        };

        void subscribe().catch((error) => {
            console.warn("Failed to subscribe to workspace menu events.", error);
        });

        return () => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [chooseWorkspace, workspaceActionsRef]);
}

function useWorkspaceCloseGuard(
    workspaceRef: RefObject<WorkspaceState | null>,
) {
    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let disposed = false;
        let unlisten: (() => void) | null = null;

        const subscribe = async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const nextUnlisten = await getCurrentWindow().onCloseRequested(
                (event) => {
                    const workspace = workspaceRef.current;

                    if (
                        workspace &&
                        hasDirtyTabs(workspace) &&
                        !window.confirm(
                            "This workspace has unsaved changes. Close this window and discard them?",
                        )
                    ) {
                        event.preventDefault();
                    }
                },
            );

            if (disposed) {
                nextUnlisten();
                return;
            }

            unlisten = nextUnlisten;
        };

        void subscribe().catch((error) => {
            console.warn("Failed to subscribe to window close requests.", error);
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [workspaceRef]);
}

function useCliWorkspaceSync(workspace: WorkspaceState | null) {
    useEffect(() => {
        if (!isTauriRuntime() || workspace) {
            return;
        }

        void syncCliWorkspaceSnapshot(null).catch((error) => {
            console.warn("Failed to sync CLI workspace snapshot.", error);
        });
    }, [workspace]);
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}

async function noopAsync() {}

function hasDirtyTabs(workspace: WorkspaceState) {
    return workspace.tabOrder.some((tabId) => isDirtyTab(workspace.tabs[tabId]));
}

function isDirtyTab(tab: WorkspaceTab | undefined): tab is WorkspaceTab {
    return Boolean(tab?.dirty);
}

function WorkspaceEmptyState({
    status,
    message,
    onChooseWorkspace,
    canChooseWorkspace,
}: {
    status: string;
    message: string | null;
    onChooseWorkspace: () => void;
    canChooseWorkspace: boolean;
}) {
    const isLoading = status === "loading";

    return (
        <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)]">
            <header className="flex items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div className="text-sm font-semibold">MDX</div>
                {canChooseWorkspace ? (
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300 disabled:text-base-content/30"
                        onClick={onChooseWorkspace}
                        disabled={isLoading}
                    >
                        Open Folder
                    </button>
                ) : (
                    <div className="text-xs text-base-content/50">
                        Desktop app required
                    </div>
                )}
            </header>

            <section className="flex min-h-0 items-center justify-center px-6">
                <div className="max-w-md text-center">
                    <div className="text-sm font-medium">
                        {isLoading
                            ? "Restoring workspace..."
                            : "No workspace open"}
                    </div>
                    <div className="mt-2 text-sm text-base-content/55">
                        {message ??
                            (canChooseWorkspace
                                ? "Choose a folder to open a workspace."
                                : "Open the desktop app to choose and restore a workspace folder.")}
                    </div>
                </div>
            </section>
        </div>
    );
}
