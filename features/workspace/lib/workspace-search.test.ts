import { describe, expect, it, vi } from "vitest";
import {
    collectDirtySearchOverrides,
    formatSearchSummary,
    queueWorkspaceSearchCancellation,
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

    it("waits for prior cancellation before running the next one", async () => {
        const steps: string[] = [];
        let releasePrior: (() => void) | null = null;
        const priorCancellation = new Promise<void>((resolve) => {
            releasePrior = () => {
                steps.push("release-prior");
                resolve();
            };
        });
        const cancelNext = vi.fn(async () => {
            steps.push("cancel-next");
        });

        const queued = queueWorkspaceSearchCancellation(
            priorCancellation,
            cancelNext,
        );

        await Promise.resolve();
        expect(steps).toEqual([]);

        releasePrior?.();
        await queued;

        expect(steps).toEqual(["release-prior", "cancel-next"]);
        expect(cancelNext).toHaveBeenCalledTimes(1);
    });
});
