import { describe, expect, it } from "vitest";

import { dirtyWorkspacePaths } from "./dirty-paths";
import type { WorkspaceState } from "./types";

const baseWorkspace: WorkspaceState = {
    rootPath: "/notes",
    fileTree: [],
    tabs: {},
    tabOrder: [],
    activeTabId: null,
    panel: {
        leftCollapsed: false,
        leftWidth: 260,
        rightCollapsed: false,
        rightWidth: 320,
    },
    search: {
        query: "",
    },
};

describe("dirtyWorkspacePaths", () => {
    it("returns dirty saved tab paths in tab order", () => {
        const workspace: WorkspaceState = {
            ...baseWorkspace,
            tabs: {
                a: {
                    tabId: "a",
                    path: "/notes/a.md",
                    title: "a.md",
                    dirty: true,
                    needsRenameOnFirstSave: false,
                },
                b: {
                    tabId: "b",
                    path: "/notes/b.md",
                    title: "b.md",
                    dirty: false,
                    needsRenameOnFirstSave: false,
                },
                c: {
                    tabId: "c",
                    path: "/notes/c.md",
                    title: "c.md",
                    dirty: true,
                    needsRenameOnFirstSave: false,
                },
            },
            tabOrder: ["c", "b", "a"],
        };

        expect(dirtyWorkspacePaths(workspace)).toEqual([
            "/notes/c.md",
            "/notes/a.md",
        ]);
    });

    it("skips unsaved first-save tabs and missing tab ids", () => {
        const workspace: WorkspaceState = {
            ...baseWorkspace,
            tabs: {
                draft: {
                    tabId: "draft",
                    path: "/notes/Untitled.md",
                    title: "Untitled.md",
                    dirty: true,
                    needsRenameOnFirstSave: true,
                },
                saved: {
                    tabId: "saved",
                    path: "/notes/saved.md",
                    title: "saved.md",
                    dirty: true,
                    needsRenameOnFirstSave: false,
                },
            },
            tabOrder: ["draft", "missing", "saved"],
        };

        expect(dirtyWorkspacePaths(workspace)).toEqual(["/notes/saved.md"]);
    });
});
