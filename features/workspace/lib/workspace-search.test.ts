import { describe, expect, it } from "vitest";
import {
    collectDirtySearchOverrides,
    formatSearchSummary,
    shouldAcceptSearchResponse,
} from "./workspace-search";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";

describe("workspace-search helpers", () => {
    it("collects opened dirty markdown overrides", () => {
        let workspace = createWorkspaceState("/tmp/ws");
        workspace = workspaceReducer(workspace, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/raw/note.md",
                title: "note.md",
                dirty: true,
                needsRenameOnFirstSave: false,
                markdown: "# Unsaved\n",
            },
        });

        expect(collectDirtySearchOverrides(workspace)).toEqual([
            { path: "/tmp/ws/raw/note.md", markdown: "# Unsaved\n" },
        ]);
    });

    it("rejects stale search responses", () => {
        expect(
            shouldAcceptSearchResponse("req-2", { requestId: "req-1" }),
        ).toBe(false);
        expect(
            shouldAcceptSearchResponse("req-2", { requestId: "req-2" }),
        ).toBe(true);
    });

    it("formats skipped and truncated summary", () => {
        expect(
            formatSearchSummary({
                skippedLargeFiles: 2,
                skippedUnreadableFiles: 1,
                truncated: true,
                searchedFiles: 9,
            }),
        ).toBe("已搜索 9 个文件，跳过 2 个大文件、1 个无法读取文件，仅显示前若干结果。");
    });
});
