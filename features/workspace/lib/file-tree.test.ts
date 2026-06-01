import { describe, expect, it } from "vitest";
import { buildFileTree } from "./file-tree";
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
    it("keeps folders, markdown files, and assets folders only", () => {
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
        ]);

        expect(tree).toMatchObject([
            {
                kind: "folder",
                name: ".assets",
                children: [],
            },
            {
                kind: "folder",
                name: "Docs",
                children: [{ kind: "file", name: "Guide.MD" }],
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
