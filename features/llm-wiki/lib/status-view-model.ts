import type { LlmWikiPanelState, LlmWikiStatusViewModel } from "./types";

const MAX_FAILED_DETAILS = 50;

export function createLlmWikiStatusViewModel(
    state: LlmWikiPanelState,
): LlmWikiStatusViewModel {
    if (state.mode === "ordinary") {
        return {
            title: "普通 Markdown 工作区",
            primaryAction: "初始化 LLM Wiki",
            statusLines: ["后台 LLM 未启用"],
            failed: [],
            modes: createModes(false),
            secondaryActions: createSecondaryActions(true),
            emptyState: {
                title: "初始化 LLM Wiki",
                description: "创建 Wiki 目录后，可以用当前工作区内容提问或生成综述。",
                actionLabel: "初始化 LLM Wiki",
            },
        };
    }

    const hasHiddenFailedDetails = state.failed.length > MAX_FAILED_DETAILS;
    const statusLines = [
        state.paused ? "状态：已暂停" : "状态：就绪",
        `raw 文件：${state.totalRawFiles}`,
        `待处理：${state.pendingCount}`,
        `已完成：${state.completedCount}`,
        `失败：${state.failedCount}`,
        `已跳过：${state.skippedCount}`,
        ...(hasHiddenFailedDetails
            ? [`失败明细：显示前 ${MAX_FAILED_DETAILS} 条`]
            : []),
    ];

    return {
        title: "LLM Wiki",
        primaryAction: state.paused
            ? "恢复后台处理"
            : state.llmConfigured
              ? "重新扫描 raw"
              : "配置 LLM",
        statusLines,
        failed: state.failed.slice(0, MAX_FAILED_DETAILS),
        modes: createModes(state.llmConfigured),
        secondaryActions: createSecondaryActions(!state.llmConfigured),
        emptyState: state.llmConfigured
            ? null
            : {
                  title: "先配置 LLM",
                  description:
                      "配置 Base URL、模型和 API Key 后，才能提问或生成综述。",
                  actionLabel: "配置 LLM",
              },
    };
}

function createModes(llmConfigured: boolean) {
    return [
        {
            id: "status" as const,
            label: "状态",
            disabled: false,
        },
        {
            id: "ask" as const,
            label: "提问",
            disabled: !llmConfigured,
        },
        {
            id: "digest" as const,
            label: "综述",
            disabled: !llmConfigured,
        },
    ];
}

function createSecondaryActions(disabled: boolean) {
    return [
        { id: "lint" as const, label: "检查", disabled },
        { id: "graph" as const, label: "图谱", disabled },
    ];
}
