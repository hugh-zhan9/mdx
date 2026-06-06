export type LlmWikiOperation =
    | "initialize"
    | "rescan"
    | "ingest"
    | "query"
    | "lint"
    | "graph"
    | "digest";

export type ExclusiveOperationResult<T> =
    | {
          status: "completed";
          value: T;
      }
    | {
          status: "skipped";
          activeOperation: LlmWikiOperation;
      };

export function getLlmWikiOperationLabel(
    operation: LlmWikiOperation | null,
) {
    switch (operation) {
        case "initialize":
            return "正在初始化";
        case "rescan":
            return "正在扫描";
        case "ingest":
            return "正在处理 raw";
        case "query":
            return "正在查询";
        case "lint":
            return "正在检查";
        case "graph":
            return "正在刷新图谱";
        case "digest":
            return "正在生成";
        case null:
            return null;
    }
}

export function getLlmWikiStageLabel(stage: string | null) {
    switch (stage) {
        case "reading_index":
            return "读取 index";
        case "selecting_pages":
            return "选择相关页面";
        case "reading_pages":
            return "读取 Wiki 页面";
        case "answering":
            return "生成回答";
        case "writing_synthesis":
            return "写入综述";
        case "analyzing_raw":
            return "分析 raw";
        case "generating_updates":
            return "生成 Wiki 更新";
        case "writing_pages":
            return "写入 Wiki 页面";
        case "mechanical_linting":
            return "机械检查";
        case "semantic_linting":
            return "语义检查";
        case "completed":
            return "完成";
        case null:
            return null;
        default:
            return stage;
    }
}

export interface LlmWikiActiveOperationSnapshot {
    activeOperation: LlmWikiOperation | null;
    activeOperationId: string | null;
}

export function isLlmWikiActiveOperationOwner(
    snapshot: LlmWikiActiveOperationSnapshot,
    operation: LlmWikiOperation,
    operationId: string | null,
) {
    if (snapshot.activeOperation !== operation) {
        return false;
    }

    return snapshot.activeOperationId === operationId;
}

export function createExclusiveOperationRunner() {
    let activeOperation: LlmWikiOperation | null = null;

    return {
        getActiveOperation() {
            return activeOperation;
        },
        async run<T>(
            operation: LlmWikiOperation,
            task: () => Promise<T>,
        ): Promise<ExclusiveOperationResult<T>> {
            if (activeOperation) {
                return {
                    status: "skipped",
                    activeOperation,
                };
            }

            activeOperation = operation;

            try {
                return {
                    status: "completed",
                    value: await task(),
                };
            } finally {
                activeOperation = null;
            }
        },
    };
}
