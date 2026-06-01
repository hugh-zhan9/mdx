"use client";

import { useWorkspaceBootstrap } from "../hooks/use-workspace-bootstrap";
import { WorkspaceShell } from "./workspace-shell";

export function WorkspaceApp() {
    const {
        status,
        workspace,
        dispatch,
        chooseWorkspace,
        canChooseWorkspace,
        message,
    } = useWorkspaceBootstrap();

    return (
        <main
            data-mdx-root
            className="h-screen min-h-0 bg-base-100 text-base-content"
        >
            {workspace ? (
                <WorkspaceShell
                    workspace={workspace}
                    dispatch={dispatch}
                    onChooseWorkspace={chooseWorkspace}
                    canChooseWorkspace={canChooseWorkspace}
                    message={message}
                />
            ) : (
                <WorkspaceEmptyState
                    status={status}
                    message={message}
                    onChooseWorkspace={chooseWorkspace}
                    canChooseWorkspace={canChooseWorkspace}
                />
            )}
        </main>
    );
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
