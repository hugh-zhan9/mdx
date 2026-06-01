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
