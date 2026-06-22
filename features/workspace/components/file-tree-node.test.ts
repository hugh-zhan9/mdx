import { describe, expect, it } from "vitest";

import type { FileTreeNode } from "../lib/types";
import {
    flattenVisibleFileTreeNodes,
    selectedRangePaths,
    withoutDescendantsOfSelectedFolders,
} from "./file-tree-panel";
import { shouldOpenFileTreeContextMenuFromClick } from "./file-tree-node";

describe("shouldOpenFileTreeContextMenuFromClick", () => {
    it("treats a Control primary click as a context menu request", () => {
        expect(
            shouldOpenFileTreeContextMenuFromClick({
                button: 0,
                ctrlKey: true,
            }),
        ).toBe(true);
    });

    it("keeps ordinary primary clicks on the normal select path", () => {
        expect(
            shouldOpenFileTreeContextMenuFromClick({
                button: 0,
                ctrlKey: false,
            }),
        ).toBe(false);
    });
});

describe("file tree multi-selection helpers", () => {
    const tree: FileTreeNode[] = [
        {
            kind: "folder",
            name: "Docs",
            path: "/ws/Docs",
            children: [
                {
                    kind: "file",
                    name: "A.md",
                    path: "/ws/Docs/A.md",
                },
                {
                    kind: "file",
                    name: "B.md",
                    path: "/ws/Docs/B.md",
                },
            ],
        },
        {
            kind: "file",
            name: "C.md",
            path: "/ws/C.md",
        },
    ];

    it("builds a shift-click range from visible file tree rows", () => {
        const visible = flattenVisibleFileTreeNodes(
            tree,
            new Set(["/ws/Docs"]),
            false,
        );

        expect(selectedRangePaths(visible, "/ws/Docs/A.md", "/ws/C.md")).toEqual([
            "/ws/Docs/A.md",
            "/ws/Docs/B.md",
            "/ws/C.md",
        ]);
    });

    it("does not include collapsed descendants in a shift-click range", () => {
        const visible = flattenVisibleFileTreeNodes(tree, new Set(), false);

        expect(selectedRangePaths(visible, "/ws/Docs", "/ws/C.md")).toEqual([
            "/ws/Docs",
            "/ws/C.md",
        ]);
    });

    it("removes descendants when their folder is already selected", () => {
        expect(
            withoutDescendantsOfSelectedFolders([
                tree[0],
                (tree[0] as Extract<FileTreeNode, { kind: "folder" }>)
                    .children[0],
                tree[1],
            ]).map((node) => node.path),
        ).toEqual(["/ws/Docs", "/ws/C.md"]);
    });
});
