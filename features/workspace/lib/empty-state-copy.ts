export interface WorkspaceEmptyStateInput {
    status: string;
    canChooseWorkspace: boolean;
    message: string | null;
}

export interface EditorEmptyStateInput {
    canCreateMarkdownFile: boolean;
}

export interface FileTreeEmptyStateInput {
    searchActive: boolean;
}

export interface EmptyStateCopy {
    title: string;
    description: string;
    actionLabel?: string | null;
}

export function createWorkspaceEmptyState({
    status,
    canChooseWorkspace,
    message,
}: WorkspaceEmptyStateInput): EmptyStateCopy {
    if (status === "loading") {
        return {
            title: "正在恢复工作区",
            description: message ?? "MDX 正在读取上次打开的本地文件夹。",
            actionLabel: null,
        };
    }

    if (!canChooseWorkspace) {
        return {
            title: "需要桌面版打开本地工作区",
            description:
                message ?? "文件夹访问只能在 MDX 桌面版中使用。请启动桌面版后选择工作区。",
            actionLabel: null,
        };
    }

    return {
        title: "打开一个 Markdown 工作区",
        description:
            message ?? "选择本地文件夹后，可以浏览、创建和编辑 Markdown 文件。",
        actionLabel: "打开文件夹",
    };
}

export function createEditorEmptyState({
    canCreateMarkdownFile,
}: EditorEmptyStateInput): EmptyStateCopy {
    return {
        title: "选择文件开始编辑",
        description: canCreateMarkdownFile
            ? "从左侧文件树打开 Markdown 文件，或新建一个文档。"
            : "从左侧文件树打开 Markdown 文件。",
        actionLabel: canCreateMarkdownFile ? "新建文档" : null,
    };
}

export function createFileTreeEmptyState({
    searchActive,
}: FileTreeEmptyStateInput): EmptyStateCopy {
    if (searchActive) {
        return {
            title: "没有匹配结果",
            description: "换一个关键词，或清空搜索查看全部文件。",
        };
    }

    return {
        title: "没有文件",
        description: "在当前工作区中新建一个文档，或把文件放入这个文件夹。",
    };
}
