import type { LlmWikiPanelState, LlmWikiStatusViewModel } from "./types";

const MAX_FAILED_DETAILS = 50;

export function createLlmWikiStatusViewModel(
    state: LlmWikiPanelState,
): LlmWikiStatusViewModel {
    if (state.mode === "ordinary") {
        return {
            title: "普通 Markdown 工作区",
            primaryAction: "初始化 LLM Wiki",
            statusStats: [{ label: "后台 LLM", value: "未启用" }],
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
    const statusStats = [
        { label: "状态", value: state.paused ? "已暂停" : "就绪" },
        { label: "raw 文件", value: String(state.totalRawFiles) },
        { label: "待处理", value: String(state.pendingCount) },
        { label: "已完成", value: String(state.completedCount) },
        { label: "失败", value: String(state.failedCount) },
        { label: "已跳过", value: String(state.skippedCount) },
        ...(hasHiddenFailedDetails
            ? [
                  {
                      label: "失败明细",
                      value: `显示前 ${MAX_FAILED_DETAILS} 条`,
                  },
              ]
            : []),
    ];

    return {
        title: "LLM Wiki",
        primaryAction: state.paused
            ? "恢复后台处理"
            : state.llmConfigured
              ? "重新扫描 raw"
              : "配置 LLM",
        statusStats,
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
