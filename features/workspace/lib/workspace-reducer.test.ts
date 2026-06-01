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

    it("remaps a file tab path after a file rename or move", () => {
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

        const remapped = workspaceReducer(opened, {
            type: "tab/pathRemapped",
            fromPath: "/tmp/ws/Drafts/Idea.md",
            toPath: "/tmp/ws/Drafts/Renamed.md",
        });

        expect(remapped.tabs["tab-1"].path).toBe(
            "/tmp/ws/Drafts/Renamed.md",
        );
        expect(remapped.tabs["tab-1"].title).toBe("Renamed.md");
        expect(remapped.tabs["tab-1"].dirty).toBe(true);
    });

    it("remaps every tab under a folder prefix after a directory rename or move", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(
            workspaceReducer(initialState, {
                type: "tab/opened",
                tab: {
                    tabId: "tab-1",
                    path: "/tmp/ws/Drafts/Idea.md",
                    title: "Idea.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            }),
            {
                type: "tab/opened",
                tab: {
                    tabId: "tab-2",
                    path: "/tmp/ws/Drafts/Notes/Sub.md",
                    title: "Sub.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            },
        );

        const remapped = workspaceReducer(opened, {
            type: "tab/prefixRemapped",
            affectedPrefix: {
                oldPrefix: "/tmp/ws/Drafts",
                newPrefix: "/tmp/ws/Archive/Drafts",
            },
        });

        expect(remapped.tabs["tab-1"].path).toBe(
            "/tmp/ws/Archive/Drafts/Idea.md",
        );
        expect(remapped.tabs["tab-2"].path).toBe(
            "/tmp/ws/Archive/Drafts/Notes/Sub.md",
        );
        expect(remapped.tabs["tab-1"].title).toBe("Idea.md");
        expect(remapped.tabs["tab-2"].title).toBe("Sub.md");
    });

    it("closes a tab after trashing a file path", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(
            workspaceReducer(initialState, {
                type: "tab/opened",
                tab: {
                    tabId: "tab-1",
                    path: "/tmp/ws/Drafts/Idea.md",
                    title: "Idea.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            }),
            {
                type: "tab/opened",
                tab: {
                    tabId: "tab-2",
                    path: "/tmp/ws/Notes.md",
                    title: "Notes.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            },
        );
        const activated = workspaceReducer(opened, {
            type: "tab/activated",
            tabId: "tab-1",
        });
        const closed = workspaceReducer(activated, {
            type: "tab/closedByPath",
            path: "/tmp/ws/Drafts/Idea.md",
        });

        expect(closed.tabs["tab-1"]).toBeUndefined();
        expect(closed.tabOrder).toEqual(["tab-2"]);
        expect(closed.activeTabId).toBe("tab-2");
    });

    it("closes every tab under a trashed folder prefix", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(
            workspaceReducer(
                workspaceReducer(initialState, {
                    type: "tab/opened",
                    tab: {
                        tabId: "tab-1",
                        path: "/tmp/ws/Drafts/Idea.md",
                        title: "Idea.md",
                        dirty: false,
                        needsRenameOnFirstSave: false,
                    },
                }),
                {
                    type: "tab/opened",
                    tab: {
                        tabId: "tab-2",
                        path: "/tmp/ws/Drafts/Sub/Note.md",
                        title: "Note.md",
                        dirty: false,
                        needsRenameOnFirstSave: false,
                    },
                },
            ),
            {
                type: "tab/opened",
                tab: {
                    tabId: "tab-3",
                    path: "/tmp/ws/Other.md",
                    title: "Other.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            },
        );
        const activated = workspaceReducer(opened, {
            type: "tab/activated",
            tabId: "tab-2",
        });
        const closed = workspaceReducer(activated, {
            type: "tab/closedByPrefix",
            prefix: "/tmp/ws/Drafts",
        });

        expect(closed.tabs["tab-1"]).toBeUndefined();
        expect(closed.tabs["tab-2"]).toBeUndefined();
        expect(closed.tabs["tab-3"]).toBeDefined();
        expect(closed.tabOrder).toEqual(["tab-3"]);
        expect(closed.activeTabId).toBe("tab-3");
    });

    it("activates the next surviving tab when a prefix close removes tabs before active", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(
            workspaceReducer(
                workspaceReducer(
                    workspaceReducer(initialState, {
                        type: "tab/opened",
                        tab: {
                            tabId: "tab-a",
                            path: "/tmp/ws/Drafts/A.md",
                            title: "A.md",
                            dirty: false,
                            needsRenameOnFirstSave: false,
                        },
                    }),
                    {
                        type: "tab/opened",
                        tab: {
                            tabId: "tab-b",
                            path: "/tmp/ws/Drafts/B.md",
                            title: "B.md",
                            dirty: false,
                            needsRenameOnFirstSave: false,
                        },
                    },
                ),
                {
                    type: "tab/opened",
                    tab: {
                        tabId: "tab-c",
                        path: "/tmp/ws/C.md",
                        title: "C.md",
                        dirty: false,
                        needsRenameOnFirstSave: false,
                    },
                },
            ),
            {
                type: "tab/opened",
                tab: {
                    tabId: "tab-d",
                    path: "/tmp/ws/D.md",
                    title: "D.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
            },
        );
        const activated = workspaceReducer(opened, {
            type: "tab/activated",
            tabId: "tab-b",
        });
        const closed = workspaceReducer(activated, {
            type: "tab/closedByPrefix",
            prefix: "/tmp/ws/Drafts",
        });

        expect(closed.tabOrder).toEqual(["tab-c", "tab-d"]);
        expect(closed.activeTabId).toBe("tab-c");
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
