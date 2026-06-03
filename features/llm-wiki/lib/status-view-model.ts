import type { LlmWikiPanelState, LlmWikiStatusViewModel } from "./types";

export function createLlmWikiStatusViewModel(
    state: LlmWikiPanelState,
): LlmWikiStatusViewModel {
    if (state.mode === "ordinary") {
        return {
            title: "普通 Markdown 工作区",
            primaryAction: "初始化 LLM Wiki",
            statusLines: ["后台 LLM 未启用"],
        };
    }

    const statusLines = [
        state.paused ? "状态：已暂停" : "状态：就绪",
        `raw 文件：${state.totalRawFiles}`,
        `待处理：${state.pendingCount}`,
        `已完成：${state.completedCount}`,
        `失败：${state.failedCount}`,
        `已跳过：${state.skippedCount}`,
    ];

    return {
        title: "LLM Wiki",
        primaryAction: state.paused
            ? "恢复后台处理"
            : state.llmConfigured
              ? "重新扫描 raw"
              : "配置 LLM",
        statusLines,
    };
}
