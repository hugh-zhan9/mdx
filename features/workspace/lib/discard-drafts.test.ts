import { describe, expect, it, vi } from "vitest";
import {
    collectDiscardedWorkspaceDraftPaths,
    deleteDiscardedWorkspaceDrafts,
} from "./discard-drafts";
import type { WorkspaceState } from "./types";

describe("workspace discard draft cleanup", () => {
    it("collects unique dirty markdown tab paths", () => {
        expect(
            collectDiscardedWorkspaceDraftPaths(
                workspaceWithTabs([
                    { path: "/tmp/ws/a.md", dirty: true },
                    { path: "/tmp/ws/a.md", dirty: true },
                    { path: "/tmp/ws/b.txt", dirty: true },
                    { path: "/tmp/ws/c.md", dirty: false },
                    { path: "/tmp/ws/d.markdown", dirty: true },
                ]),
            ),
        ).toEqual(["/tmp/ws/a.md", "/tmp/ws/d.markdown"]);
    });

    it("deletes discarded draft paths and rejects on cleanup failure", async () => {
        const deleteDraft = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("draft cleanup failed"));

        await expect(
            deleteDiscardedWorkspaceDrafts(
                workspaceWithTabs([
                    { path: "/tmp/ws/a.md", dirty: true },
                    { path: "/tmp/ws/b.md", dirty: true },
                ]),
                deleteDraft,
            ),
        ).rejects.toThrow("draft cleanup failed");

        expect(deleteDraft).toHaveBeenCalledWith({ realPath: "/tmp/ws/a.md" });
        expect(deleteDraft).toHaveBeenCalledWith({ realPath: "/tmp/ws/b.md" });
    });
});

function workspaceWithTabs(
    tabs: Array<{ path: string; dirty: boolean }>,
): WorkspaceState {
    return {
        rootPath: "/tmp/ws",
        fileTree: [],
        tabs: Object.fromEntries(
            tabs.map((tab, index) => [
                `tab-${index}`,
                {
                    tabId: `tab-${index}`,
                    path: tab.path,
                    title: tab.path.split("/").at(-1) ?? tab.path,
                    dirty: tab.dirty,
                    needsRenameOnFirstSave: false,
                    markdown: tab.dirty ? "# Draft" : "# Clean",
                },
            ]),
        ),
        tabOrder: tabs.map((_, index) => `tab-${index}`),
        activeTabId: tabs.length > 0 ? "tab-0" : null,
        panel: {
            leftCollapsed: false,
            leftWidth: 300,
            rightCollapsed: false,
            rightWidth: 300,
        },
        search: { query: "" },
    };
}
