import { describe, expect, it, vi } from "vitest";
import {
    createTabSaveQueue,
    isCurrentTabSnapshot,
} from "./workspace-save";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";
import type {
    WorkspaceAction,
    WorkspaceState,
    WorkspaceTab,
} from "./types";

describe("workspace save coordination", () => {
    it("rejects snapshots after a tab path changes", () => {
        const workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                path: "/tmp/ws/Old.md",
                markdown: "body",
            }),
        );
        const renamed = workspaceReducer(workspace, {
            type: "tab/renamed",
            tabId: "tab-1",
            path: "/tmp/ws/New.md",
        });

        expect(
            isCurrentTabSnapshot(renamed, {
                rootPath: "/tmp/ws",
                tabId: "tab-1",
                path: "/tmp/ws/Old.md",
                markdown: "body",
            }),
        ).toBe(false);
    });

    it("serializes saves for one tab and writes the latest state second", async () => {
        let workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                markdown: "first",
            }),
        );
        const writes: string[] = [];
        let firstWriteStarted: (() => void) | null = null;
        const firstWriteStartedPromise = new Promise<void>((resolve) => {
            firstWriteStarted = resolve;
        });
        let releaseFirstWrite: (() => void) | null = null;
        const releaseFirstWritePromise = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        const dispatch = (action: WorkspaceAction) => {
            workspace = workspaceReducer(workspace, action);
        };
        const queue = createTabSaveQueue({
            getWorkspace: () => workspace,
            dispatch,
            invoke: vi.fn(async (command, args) => {
                if (command === "write_markdown_file") {
                    writes.push(String(args.content));

                    if (writes.length === 1) {
                        firstWriteStarted?.();
                        await releaseFirstWritePromise;
                    }
                }

                return undefined;
            }),
            promptName: () => null,
            alert: vi.fn(),
            warn: vi.fn(),
            refreshTree: vi.fn(async () => {}),
        });

        const firstSave = queue.saveTab("tab-1");
        await firstWriteStartedPromise;
        dispatch({
            type: "tab/contentChanged",
            tabId: "tab-1",
            markdown: "second",
        });
        const secondSave = queue.saveTab("tab-1");
        releaseFirstWrite?.();

        await expect(firstSave).resolves.toBe(false);
        await expect(secondSave).resolves.toBe(true);
        expect(writes).toEqual(["first", "second"]);
        expect(workspace.tabs["tab-1"].dirty).toBe(false);
        expect(workspace.tabs["tab-1"].markdown).toBe("second");
    });

    it("refreshes the original root after a first-save rename", async () => {
        let workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                path: "/tmp/ws/Untitled.md",
                title: "Untitled.md",
                markdown: "body",
                needsRenameOnFirstSave: true,
            }),
        );
        const refreshTree = vi.fn(async () => {});
        const queue = createTabSaveQueue({
            getWorkspace: () => workspace,
            dispatch: (action) => {
                workspace = workspaceReducer(workspace, action);
            },
            invoke: vi.fn(async (command) => {
                if (command === "rename_path") {
                    return {
                        oldPath: "/tmp/ws/Untitled.md",
                        newPath: "/tmp/ws/Notes.md",
                    };
                }

                return undefined;
            }),
            promptName: () => "Notes.md",
            alert: vi.fn(),
            warn: vi.fn(),
            refreshTree,
        });

        await expect(queue.saveTab("tab-1")).resolves.toBe(true);
        expect(refreshTree).toHaveBeenCalledWith("/tmp/ws");
    });

    it("drops stale first-save rename completion after a path change", async () => {
        let workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                path: "/tmp/ws/Untitled.md",
                title: "Untitled.md",
                markdown: "body",
                needsRenameOnFirstSave: true,
            }),
        );
        const dispatched: WorkspaceAction[] = [];
        const writes: string[] = [];
        const queue = createTabSaveQueue({
            getWorkspace: () => workspace,
            dispatch: (action) => {
                dispatched.push(action);
                workspace = workspaceReducer(workspace, action);
            },
            invoke: vi.fn(async (command) => {
                if (command === "rename_path") {
                    workspace = workspaceReducer(workspace, {
                        type: "tab/renamed",
                        tabId: "tab-1",
                        path: "/tmp/ws/Moved.md",
                    });

                    return {
                        oldPath: "/tmp/ws/Untitled.md",
                        newPath: "/tmp/ws/Notes.md",
                    };
                }

                if (command === "write_markdown_file") {
                    writes.push(command);
                }

                return undefined;
            }),
            promptName: () => "Notes.md",
            alert: vi.fn(),
            warn: vi.fn(),
            refreshTree: vi.fn(async () => {}),
        });

        await expect(queue.saveTab("tab-1")).resolves.toBe(false);
        expect(
            dispatched.some((action) => action.type === "tab/renamed"),
        ).toBe(false);
        expect(writes).toEqual([]);
        expect(workspace.tabs["tab-1"].path).toBe("/tmp/ws/Moved.md");
        expect(workspace.tabs["tab-1"].dirty).toBe(true);
    });

    it("skips refresh when the workspace root changes during save", async () => {
        let workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                path: "/tmp/ws/Untitled.md",
                title: "Untitled.md",
                markdown: "body",
                needsRenameOnFirstSave: true,
            }),
        );
        let afterWrite = false;
        const dispatched: WorkspaceAction[] = [];
        const refreshTree = vi.fn(async () => {});
        const queue = createTabSaveQueue({
            getWorkspace: () => workspace,
            dispatch: (action) => {
                dispatched.push(action);
                workspace = workspaceReducer(workspace, action);
            },
            invoke: vi.fn(async (command) => {
                if (command === "rename_path") {
                    return {
                        oldPath: "/tmp/ws/Untitled.md",
                        newPath: "/tmp/ws/Notes.md",
                    };
                }

                if (command === "write_markdown_file") {
                    afterWrite = true;
                    workspace = createWorkspaceState("/tmp/other");
                }

                return undefined;
            }),
            promptName: () => "Notes.md",
            alert: vi.fn(),
            warn: vi.fn(),
            refreshTree,
        });

        await expect(queue.saveTab("tab-1")).resolves.toBe(false);
        expect(afterWrite).toBe(true);
        expect(
            dispatched.some((action) => action.type === "tab/savedIfUnchanged"),
        ).toBe(false);
        expect(refreshTree).not.toHaveBeenCalled();
    });

    it("does not clear dirty when path changes during write", async () => {
        let workspace = withTab(
            createWorkspaceState("/tmp/ws"),
            createTab({
                path: "/tmp/ws/Note.md",
                markdown: "body",
            }),
        );
        const dispatched: WorkspaceAction[] = [];
        const queue = createTabSaveQueue({
            getWorkspace: () => workspace,
            dispatch: (action) => {
                dispatched.push(action);
                workspace = workspaceReducer(workspace, action);
            },
            invoke: vi.fn(async (command) => {
                if (command === "write_markdown_file") {
                    workspace = workspaceReducer(workspace, {
                        type: "tab/renamed",
                        tabId: "tab-1",
                        path: "/tmp/ws/Moved.md",
                    });
                }

                return undefined;
            }),
            promptName: () => null,
            alert: vi.fn(),
            warn: vi.fn(),
            refreshTree: vi.fn(async () => {}),
        });

        await expect(queue.saveTab("tab-1")).resolves.toBe(false);
        expect(
            dispatched.some((action) => action.type === "tab/savedIfUnchanged"),
        ).toBe(false);
        expect(workspace.tabs["tab-1"].path).toBe("/tmp/ws/Moved.md");
        expect(workspace.tabs["tab-1"].dirty).toBe(true);
    });
});

function createTab(patch: Partial<WorkspaceTab> = {}): WorkspaceTab {
    return {
        tabId: "tab-1",
        path: "/tmp/ws/Note.md",
        title: "Note.md",
        dirty: true,
        needsRenameOnFirstSave: false,
        markdown: "body",
        ...patch,
    };
}

function withTab(state: WorkspaceState, tab: WorkspaceTab) {
    return workspaceReducer(state, {
        type: "tab/opened",
        tab,
    });
}
