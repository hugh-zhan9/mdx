import { describe, expect, it } from "vitest";
import { buildFileTree, focusedTreeNodes } from "./file-tree";
import { filterTreeByName } from "./tree-filter";
import type { FileTreeNode } from "./types";

const root = "/tmp/ws";

function expectBuiltTree(rawNodes: FileTreeNode[]) {
    const result = buildFileTree(rawNodes);

    if (!result.ok) {
        throw new Error(result.error.message);
    }

    return result.nodes;
}

describe("buildFileTree", () => {
    it("keeps folders and visible files", () => {
        const tree = expectBuiltTree([
            {
                kind: "folder",
                name: "Docs",
                path: `${root}/Docs`,
                children: [
                    {
                        kind: "file",
                        name: "Guide.MD",
                        path: `${root}/Docs/Guide.MD`,
                    },
                    {
                        kind: "file",
                        name: "photo.png",
                        path: `${root}/Docs/photo.png`,
                    },
                ],
            },
            {
                kind: "folder",
                name: ".assets",
                path: `${root}/.assets`,
                children: [
                    {
                        kind: "file",
                        name: "cover.png",
                        path: `${root}/.assets/cover.png`,
                    },
                ],
            },
            {
                kind: "file",
                name: "Readme.markdown",
                path: `${root}/Readme.markdown`,
            },
            {
                kind: "file",
                name: "notes.txt",
                path: `${root}/notes.txt`,
            },
            {
                kind: "file",
                name: ".hidden.md",
                path: `${root}/.hidden.md`,
            },
        ]);

        expect(tree).toMatchObject([
            {
                kind: "folder",
                name: ".assets",
                children: [{ kind: "file", name: "cover.png" }],
            },
            {
                kind: "folder",
                name: "Docs",
                children: [
                    { kind: "file", name: "Guide.MD" },
                    { kind: "file", name: "photo.png" },
                ],
            },
            {
                kind: "file",
                name: "notes.txt",
            },
            {
                kind: "file",
                name: "Readme.markdown",
            },
        ]);
    });

    it("sorts folders before files with case-insensitive natural order", () => {
        const tree = expectBuiltTree([
            {
                kind: "file",
                name: "note-10.md",
                path: `${root}/note-10.md`,
            },
            {
                kind: "folder",
                name: "b",
                path: `${root}/b`,
                children: [],
            },
            {
                kind: "file",
                name: "Note-2.md",
                path: `${root}/Note-2.md`,
            },
            {
                kind: "folder",
                name: "A",
                path: `${root}/A`,
                children: [],
            },
        ]);

        expect(tree.map((node) => node.name)).toEqual([
            "A",
            "b",
            "Note-2.md",
            "note-10.md",
        ]);
    });

    it("preserves empty folders", () => {
        const tree = expectBuiltTree([
            {
                kind: "folder",
                name: "Empty",
                path: `${root}/Empty`,
                children: [],
            },
        ]);

        expect(tree).toEqual([
            {
                kind: "folder",
                name: "Empty",
                path: `${root}/Empty`,
                children: [],
            },
        ]);
    });

    it("returns an error for same-name sibling conflicts", () => {
        const result = buildFileTree([
            {
                kind: "file",
                name: "Guide.md",
                path: `${root}/Guide.md`,
            },
            {
                kind: "file",
                name: "guide.MD",
                path: `${root}/guide.MD`,
            },
        ]);

        expect(result).toMatchObject({
            ok: false,
            error: {
                code: "duplicate_name",
                path: root,
            },
        });
    });
});

describe("filterTreeByName", () => {
    it("keeps matching ancestors after name search", () => {
        const tree = expectBuiltTree([
            {
                kind: "folder",
                name: "Projects",
                path: `${root}/Projects`,
                children: [
                    {
                        kind: "folder",
                        name: "Client",
                        path: `${root}/Projects/Client`,
                        children: [
                            {
                                kind: "file",
                                name: "Meeting.md",
                                path: `${root}/Projects/Client/Meeting.md`,
                            },
                        ],
                    },
                ],
            },
        ]);

        expect(filterTreeByName(tree, "meet")).toMatchObject([
            {
                name: "Projects",
                children: [
                    {
                        name: "Client",
                        children: [{ name: "Meeting.md" }],
                    },
                ],
            },
        ]);
    });

    it("highlights matched name segments", () => {
        const tree = expectBuiltTree([
            {
                kind: "file",
                name: "MeetingNotes.md",
                path: `${root}/MeetingNotes.md`,
            },
        ]);

        expect(filterTreeByName(tree, "notes")[0].nameSegments).toEqual([
            { text: "Meeting", highlighted: false },
            { text: "Notes", highlighted: true },
            { text: ".md", highlighted: false },
        ]);
    });
});

describe("focusedTreeNodes", () => {
    const tree = buildFileTree([
        {
            kind: "folder",
            name: "raw",
            path: "/tmp/ws/raw",
            children: [
                { kind: "file", name: "a.md", path: "/tmp/ws/raw/a.md" },
                {
                    kind: "folder",
                    name: "notes",
                    path: "/tmp/ws/raw/notes",
                    children: [
                        {
                            kind: "file",
                            name: "b.md",
                            path: "/tmp/ws/raw/notes/b.md",
                        },
                    ],
                },
            ],
        },
        { kind: "folder", name: "wiki", path: "/tmp/ws/wiki", children: [] },
        { kind: "file", name: "index.md", path: "/tmp/ws/index.md" },
    ]).nodes;

    it("shows the workspace as if it started at that folder", () => {
        const nodes = focusedTreeNodes(tree, "/tmp/ws/raw");

        expect(nodes?.map((node) => node.name)).toEqual(["notes", "a.md"]);
    });

    it("finds a folder nested inside another", () => {
        const nodes = focusedTreeNodes(tree, "/tmp/ws/raw/notes");

        expect(nodes?.map((node) => node.name)).toEqual(["b.md"]);
    });

    it("tells an empty folder apart from a folder that is not there", () => {
        expect(focusedTreeNodes(tree, "/tmp/ws/wiki")).toEqual([]);
        expect(focusedTreeNodes(tree, "/tmp/ws/gone")).toBeNull();
        // A file is not a folder to look inside.
        expect(focusedTreeNodes(tree, "/tmp/ws/index.md")).toBeNull();
    });
});
