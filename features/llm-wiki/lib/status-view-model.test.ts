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
            failed: [],
            skippedCount: 0,
        });

        expect(viewModel.title).toBe("普通 Markdown 工作区");
        expect(viewModel.primaryAction).toBe("初始化 LLM Wiki");
        expect(viewModel.statusLines).toContain("后台 LLM 未启用");
    });

    it("describes an llm wiki workspace without provider config", () => {
        const state: LlmWikiPanelState = {
            mode: "llmWiki",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 5,
            pendingCount: 3,
            completedCount: 2,
            failedCount: 0,
            failed: [],
            skippedCount: 1,
        };

        const viewModel = createLlmWikiStatusViewModel(state);

        expect(viewModel.title).toBe("LLM Wiki");
        expect(viewModel.primaryAction).toBe("配置 LLM");
        expect(viewModel.statusLines).toContain("待处理：3");
    });

    it("describes a paused llm wiki workspace", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "llmWiki",
            llmConfigured: true,
            paused: true,
            totalRawFiles: 4,
            pendingCount: 1,
            completedCount: 2,
            failedCount: 1,
            failed: [],
            skippedCount: 0,
        });

        expect(viewModel.primaryAction).toBe("恢复后台处理");
        expect(viewModel.statusLines).toContain("状态：已暂停");
    });

    it("exposes failed raw files with reasons", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "llmWiki",
            llmConfigured: true,
            paused: false,
            totalRawFiles: 3,
            pendingCount: 1,
            completedCount: 1,
            failedCount: 1,
            failed: [
                {
                    path: "raw/notes/a.md",
                    reason: "llm_failed: first failure",
                },
            ],
            skippedCount: 0,
        });

        expect(viewModel.statusLines).toContain("待处理：1");
        expect(viewModel.statusLines).toContain("失败：1");
        expect(viewModel.failed).toEqual([
            {
                path: "raw/notes/a.md",
                reason: "llm_failed: first failure",
            },
        ]);
    });

    it("groups panel modes by task priority", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "llmWiki",
            llmConfigured: true,
            paused: false,
            totalRawFiles: 8,
            pendingCount: 1,
            completedCount: 6,
            failedCount: 1,
            failed: [],
            skippedCount: 0,
        });

        expect(viewModel.modes).toEqual([
            {
                id: "status",
                label: "状态",
                disabled: false,
            },
            {
                id: "ask",
                label: "提问",
                disabled: false,
            },
            {
                id: "digest",
                label: "综述",
                disabled: false,
            },
        ]);
        expect(viewModel.secondaryActions).toEqual([
            { id: "lint", label: "检查", disabled: false },
            { id: "graph", label: "图谱", disabled: false },
        ]);
    });

    it("disables ask and digest modes before LLM is configured", () => {
        const viewModel = createLlmWikiStatusViewModel({
            mode: "llmWiki",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 3,
            pendingCount: 3,
            completedCount: 0,
            failedCount: 0,
            failed: [],
            skippedCount: 0,
        });

        expect(viewModel.modes.filter((mode) => mode.disabled)).toEqual([
            {
                id: "ask",
                label: "提问",
                disabled: true,
            },
            {
                id: "digest",
                label: "综述",
                disabled: true,
            },
        ]);
        expect(viewModel.emptyState).toEqual({
            title: "先配置 LLM",
            description: "配置 Base URL、模型和 API Key 后，才能提问或生成综述。",
            actionLabel: "配置 LLM",
        });
    });
});
