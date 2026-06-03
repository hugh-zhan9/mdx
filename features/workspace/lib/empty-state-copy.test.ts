import { describe, expect, it } from "vitest";
import {
    createEditorEmptyState,
    createFileTreeEmptyState,
    createWorkspaceEmptyState,
} from "./empty-state-copy";

describe("workspace empty state copy", () => {
    it("guides browser-shell users to the desktop app", () => {
        const emptyState = createWorkspaceEmptyState({
            status: "idle",
            canChooseWorkspace: false,
            message: null,
        });

        expect(emptyState.title).toBe("需要桌面版打开本地工作区");
        expect(emptyState.description).toContain("文件夹访问只能在 MDX 桌面版中使用");
        expect(emptyState.actionLabel).toBeNull();
    });

    it("offers opening a folder when the desktop shell can choose a workspace", () => {
        const emptyState = createWorkspaceEmptyState({
            status: "idle",
            canChooseWorkspace: true,
            message: null,
        });

        expect(emptyState.title).toBe("打开一个 Markdown 工作区");
        expect(emptyState.description).toBe("选择本地文件夹后，可以浏览、创建和编辑 Markdown 文件。");
        expect(emptyState.actionLabel).toBe("打开文件夹");
    });

    it("explains how to start when no editor tab is active", () => {
        const emptyState = createEditorEmptyState({
            canCreateMarkdownFile: true,
        });

        expect(emptyState.title).toBe("选择文件开始编辑");
        expect(emptyState.description).toBe("从左侧文件树打开 Markdown 文件，或新建一个文档。");
        expect(emptyState.actionLabel).toBe("新建文档");
    });

    it("distinguishes empty file tree from empty search results", () => {
        expect(createFileTreeEmptyState({ searchActive: false })).toEqual({
            title: "没有文件",
            description: "在当前工作区中新建一个文档，或把文件放入这个文件夹。",
        });
        expect(createFileTreeEmptyState({ searchActive: true })).toEqual({
            title: "没有匹配结果",
            description: "换一个关键词，或清空搜索查看全部文件。",
        });
    });
});
