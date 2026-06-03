export type LlmWikiOperation =
    | "initialize"
    | "rescan"
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
