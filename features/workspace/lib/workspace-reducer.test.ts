import { describe, expect, it } from "vitest";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";

describe("workspaceReducer", () => {
    it("marks a tab dirty after content changes", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(initialState, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/Drafts/Idea.md",
                title: "Idea.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });
        const next = workspaceReducer(opened, {
            type: "tab/contentChanged",
            tabId: "tab-1",
            markdown: "hello",
        });
        expect(next.tabs["tab-1"].dirty).toBe(true);
    });

    it("activates existing tabs instead of duplicating paths", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(initialState, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/Drafts/Idea.md",
                title: "Idea.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });
        const reopened = workspaceReducer(opened, {
            type: "tab/opened",
            tab: {
                tabId: "tab-2",
                path: "/tmp/ws//Drafts/Idea.md",
                title: "Idea.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });
        expect(reopened.tabOrder).toEqual(["tab-1"]);
        expect(reopened.activeTabId).toBe("tab-1");
    });

    it("updates panel and search state", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const resized = workspaceReducer(initialState, {
            type: "panel/resized",
            side: "left",
            width: 320,
        });
        const collapsed = workspaceReducer(resized, {
            type: "panel/collapsedChanged",
            side: "right",
            collapsed: true,
        });
        const searched = workspaceReducer(collapsed, {
            type: "search/queryChanged",
            query: "idea",
        });
        expect(searched.panel.leftWidth).toBe(320);
        expect(searched.panel.rightCollapsed).toBe(true);
        expect(searched.search.query).toBe("idea");
    });
});
