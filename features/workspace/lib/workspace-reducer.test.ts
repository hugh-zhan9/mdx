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

    it("replaces a reused tab id atomically", () => {
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
                tabId: "tab-1",
                path: "/tmp/ws/Drafts/Updated.md",
                title: "Updated.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });

        expect(reopened.tabOrder).toEqual(["tab-1"]);
        expect(reopened.tabs["tab-1"].path).toBe("/tmp/ws/Drafts/Updated.md");
        expect(reopened.activeTabId).toBe("tab-1");
    });

    it("activates an existing tab when renaming to an open path", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(initialState, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/Drafts/Idea.md",
                title: "Idea.md",
                dirty: true,
                needsRenameOnFirstSave: false,
            },
        });
        const withTarget = workspaceReducer(opened, {
            type: "tab/opened",
            tab: {
                tabId: "tab-2",
                path: "/tmp/ws/Drafts/Target.md",
                title: "Target.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });
        const renamed = workspaceReducer(withTarget, {
            type: "tab/renamed",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Target.md",
            title: "Target.md",
        });

        expect(renamed.tabOrder).toEqual(["tab-2"]);
        expect(renamed.tabs["tab-2"].path).toBe("/tmp/ws/Drafts/Target.md");
        expect(renamed.tabs["tab-2"].dirty).toBe(false);
        expect(renamed.tabs["tab-1"]).toBeUndefined();
        expect(renamed.activeTabId).toBe("tab-2");
    });

    it("rejects invalid panel widths and clamps finite values", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const resized = workspaceReducer(initialState, {
            type: "panel/resized",
            side: "right",
            width: Infinity,
        });

        expect(resized.panel.rightWidth).toBe(240);

        const negative = workspaceReducer(resized, {
            type: "panel/resized",
            side: "right",
            width: -1,
        });

        expect(negative.panel.rightWidth).toBe(240);

        const tooSmall = workspaceReducer(negative, {
            type: "panel/resized",
            side: "right",
            width: 80,
        });
        const tooLarge = workspaceReducer(tooSmall, {
            type: "panel/resized",
            side: "right",
            width: 800,
        });

        expect(tooSmall.panel.rightWidth).toBe(160);
        expect(tooLarge.panel.rightWidth).toBe(640);
    });
});
