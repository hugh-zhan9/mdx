import { describe, expect, it, vi } from "vitest";
import { refreshCleanOpenTabFromDisk } from "./cli-file-updated";
import type { WorkspaceState } from "./types";

describe("refreshCleanOpenTabFromDisk", () => {
    it("refreshes a matching clean open tab from disk", async () => {
        const dispatch = vi.fn();
        const invoke = vi.fn(async () => "# Log\n\n- query RAG\n");
        const workspace = workspaceWithLogTab({ dirty: false });

        await expect(
            refreshCleanOpenTabFromDisk({
                dispatch,
                invoke,
                payload: { path: "/ws/log.md" },
                workspace,
            }),
        ).resolves.toBe(true);

        expect(invoke).toHaveBeenCalledWith("read_markdown_file", {
            rootPath: "/ws",
            path: "/ws/log.md",
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: "tab/saved",
            tabId: "log-tab",
            markdown: "# Log\n\n- query RAG\n",
        });
    });

    it("does not overwrite a matching dirty tab", async () => {
        const dispatch = vi.fn();
        const invoke = vi.fn(async () => "# Log\n\n- query RAG\n");
        const workspace = workspaceWithLogTab({ dirty: true });

        await expect(
            refreshCleanOpenTabFromDisk({
                dispatch,
                invoke,
                payload: { path: "/ws/log.md" },
                workspace,
            }),
        ).resolves.toBe(false);

        expect(invoke).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

function workspaceWithLogTab({ dirty }: { dirty: boolean }): WorkspaceState {
    return {
        rootPath: "/ws",
        fileTree: [],
        tabs: {
            "log-tab": {
                tabId: "log-tab",
                path: "/ws/log.md",
                title: "log.md",
                dirty,
                needsRenameOnFirstSave: false,
                markdown: dirty ? "# Local edit\n" : "# Log\n",
            },
        },
        tabOrder: ["log-tab"],
        activeTabId: "log-tab",
        panel: {
            leftCollapsed: false,
            leftWidth: 280,
            rightCollapsed: false,
            rightWidth: 320,
        },
        search: { query: "" },
    };
}
