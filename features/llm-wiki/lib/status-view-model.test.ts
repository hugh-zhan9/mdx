import { describe, expect, it } from "vitest";
import { createLlmWikiStatusViewModel } from "./status-view-model";
import type { LlmWikiPanelState } from "./types";

describe("createLlmWikiStatusViewModel", () => {
    it("describes an ordinary markdown workspace", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "ordinary",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 0,
            pendingCount: 0,
            completedCount: 0,
            failedCount: 0,
            skippedCount: 0,
        });

        expect(viewModel.title).toBe("普通 Markdown 工作区");
        expect(viewModel.primaryAction).toBe("初始化 LLM Wiki");
        expect(viewModel.statusLines).toContain("后台 LLM 未启用");
    });

    it("describes an llm wiki workspace without provider config", () => {
        const state: LlmWikiPanelState = {
            mode: "llm_wiki",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 5,
            pendingCount: 3,
            completedCount: 2,
            failedCount: 0,
            skippedCount: 1,
        };

        const viewModel = createLlmWikiStatusViewModel(state);

        expect(viewModel.title).toBe("LLM Wiki");
        expect(viewModel.primaryAction).toBe("配置 LLM");
        expect(viewModel.statusLines).toContain("待处理：3");
    });

    it("describes a paused llm wiki workspace", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "llm_wiki",
            llmConfigured: true,
            paused: true,
            totalRawFiles: 4,
            pendingCount: 1,
            completedCount: 2,
            failedCount: 1,
            skippedCount: 0,
        });

        expect(viewModel.primaryAction).toBe("恢复后台处理");
        expect(viewModel.statusLines).toContain("状态：已暂停");
    });
});
