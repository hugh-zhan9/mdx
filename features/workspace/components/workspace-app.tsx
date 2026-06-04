"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { EmptyState, TextControlButton } from "../../../common/components/ui-controls";
import { useWorkspaceBootstrap } from "../hooks/use-workspace-bootstrap";
import { syncCliWorkspaceSnapshot } from "../lib/cli-sync";
import { createWorkspaceEmptyState } from "../lib/empty-state-copy";
import type {
    AppPreferences,
    WorkspaceMenuActions,
    WorkspaceState,
    WorkspaceTab,
} from "../lib/types";
import {
    AppDialogProvider,
    useAppDialogs,
} from "./app-dialogs";
import { SettingsButton } from "./settings-button";
import { WorkspaceShell } from "./workspace-shell";

export function WorkspaceApp() {
    return (
        <AppDialogProvider>
            <WorkspaceAppInner />
        </AppDialogProvider>
    );
}

function WorkspaceAppInner() {
    const dialogs = useAppDialogs();
    const workspaceActionsRef = useRef<WorkspaceMenuActions | null>(null);
    const workspaceRef = useRef<WorkspaceState | null>(null);
    const {
        status,
        workspace,
        dispatch,
        chooseWorkspace,
        canChooseWorkspace,
        message,
        preferences,
        updatePreferences,
    } = useWorkspaceBootstrap();
    useEffect(() => {
        workspaceRef.current = workspace;
    }, [workspace]);

    const chooseWorkspaceWithGuard = useCallback(async () => {
        const currentWorkspace = workspaceRef.current;

        if (
            currentWorkspace &&
            hasDirtyTabs(currentWorkspace) &&
            !(await dialogs.confirm({
                title: "切换工作区",
                message:
                    "当前工作区有未保存更改。打开其他文件夹会丢弃这些更改，是否继续？",
                confirmLabel: "继续",
                destructive: true,
            }))
        ) {
            return;
        }

        await chooseWorkspace();
    }, [chooseWorkspace, dialogs]);

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
    useWorkspaceOpenFolderStartupAction(chooseWorkspaceWithGuard);
    useWorkspaceCloseGuard(workspaceRef, dialogs);

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
                    preferences={preferences}
                    onPreferencesChange={updatePreferences}
                    onActionsChange={handleActionsChange}
                />
            ) : (
                <WorkspaceEmptyState
                    status={status}
                    message={message}
                    onChooseWorkspace={chooseWorkspaceWithGuard}
                    canChooseWorkspace={canChooseWorkspace}
                    preferences={preferences}
                    onPreferencesChange={updatePreferences}
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
    dialogs: ReturnType<typeof useAppDialogs>,
) {
    const closingRef = useRef(false);

    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let disposed = false;
        let unlisten: (() => void) | null = null;

        const subscribe = async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const currentWindow = getCurrentWindow();
            const nextUnlisten = await currentWindow.onCloseRequested(
                (event) => {
                    const workspace = workspaceRef.current;

                    if (closingRef.current) {
                        return;
                    }

                    event.preventDefault();
                    closingRef.current = true;

                    if (
                        workspace &&
                        hasDirtyTabs(workspace)
                    ) {
                        void dialogs.confirm({
                            title: "关闭窗口",
                            message:
                                "当前工作区有未保存更改。关闭窗口会丢弃这些更改，是否继续？",
                            confirmLabel: "关闭",
                            destructive: true,
                        }).then((confirmed) => {
                            if (!confirmed) {
                                closingRef.current = false;
                                return;
                            }

                            void quitApp();
                        }).catch((error) => {
                            closingRef.current = false;
                            console.warn(
                                "Failed to confirm workspace close.",
                                error,
                            );
                        });
                        return;
                    }

                    void quitApp().catch((error) => {
                        closingRef.current = false;
                        console.warn("Failed to quit application.", error);
                    });
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
    }, [dialogs, workspaceRef]);
}

function useWorkspaceOpenFolderStartupAction(
    chooseWorkspace: () => Promise<void>,
) {
    useEffect(() => {
        if (
            typeof window === "undefined" ||
            window.location.search.length === 0
        ) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get("workspaceAction") !== "openFolder") {
            return;
        }

        params.delete("workspaceAction");
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${
            nextSearch ? `?${nextSearch}` : ""
        }${window.location.hash}`;
        window.history.replaceState(null, "", nextUrl);

        void chooseWorkspace().catch((error) => {
            console.warn(
                "Failed to run workspace startup open-folder action.",
                error,
            );
        });
    }, [chooseWorkspace]);
}

async function quitApp() {
    const { invoke } = await tauriCore();
    await invoke("quit_app");
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
    preferences,
    onPreferencesChange,
}: {
    status: string;
    message: string | null;
    onChooseWorkspace: () => void;
    canChooseWorkspace: boolean;
    preferences: AppPreferences;
    onPreferencesChange: (preferences: AppPreferences) => Promise<void>;
}) {
    const isLoading = status === "loading";
    const emptyState = createWorkspaceEmptyState({
        status,
        canChooseWorkspace,
        message,
    });

    return (
        <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)]">
            <header className="flex items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div />
                <div className="flex items-center gap-2">
                    {canChooseWorkspace ? (
                        <TextControlButton
                            onClick={onChooseWorkspace}
                            disabled={isLoading}
                        >
                            打开文件夹
                        </TextControlButton>
                    ) : (
                        <div className="text-xs text-base-content/65">
                            需要桌面版
                        </div>
                    )}
                    <SettingsButton
                        preferences={preferences}
                        onPreferencesChange={onPreferencesChange}
                    />
                </div>
            </header>

            <section className="flex min-h-0 items-center justify-center px-6">
                <EmptyState
                    title={emptyState.title}
                    description={emptyState.description}
                    actionLabel={emptyState.actionLabel}
                    onAction={canChooseWorkspace ? onChooseWorkspace : undefined}
                    actionDisabled={isLoading}
                />
            </section>
        </div>
    );
}
