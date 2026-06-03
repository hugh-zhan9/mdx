import { describe, expect, it, vi } from "vitest";
import {
    createExclusiveOperationRunner,
    getLlmWikiOperationLabel,
} from "./operation-state";

describe("getLlmWikiOperationLabel", () => {
    it("returns user-facing labels for long-running operations", () => {
        expect(getLlmWikiOperationLabel("initialize")).toBe("正在初始化");
        expect(getLlmWikiOperationLabel("rescan")).toBe("正在扫描");
        expect(getLlmWikiOperationLabel("lint")).toBe("正在检查");
        expect(getLlmWikiOperationLabel("graph")).toBe("正在刷新图谱");
        expect(getLlmWikiOperationLabel("digest")).toBe("正在生成");
        expect(getLlmWikiOperationLabel(null)).toBeNull();
    });
});

describe("createExclusiveOperationRunner", () => {
    it("skips duplicate operations while one is running", async () => {
        const runner = createExclusiveOperationRunner();
        const task = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    setTimeout(() => resolve("done"), 5);
                }),
        );

        const first = runner.run("rescan", task);
        const second = await runner.run("rescan", task);

        expect(second).toEqual({
            status: "skipped",
            activeOperation: "rescan",
        });
        expect(task).toHaveBeenCalledTimes(1);
        await expect(first).resolves.toEqual({
            status: "completed",
            value: "done",
        });
    });

    it("clears active operation after failures", async () => {
        const runner = createExclusiveOperationRunner();

        await expect(
            runner.run("graph", async () => {
                throw new Error("failed");
            }),
        ).rejects.toThrow("failed");

        await expect(
            runner.run("graph", async () => "next"),
        ).resolves.toEqual({
            status: "completed",
            value: "next",
        });
    });
});
