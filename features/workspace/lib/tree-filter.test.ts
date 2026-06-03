import { describe, expect, it } from "vitest";
import { filterTreeByName } from "./tree-filter";
import type { FileTreeNode } from "./types";

const sampleTree: FileTreeNode[] = [
    {
        kind: "folder",
        name: "Drafts",
        path: "/tmp/ws/Drafts",
        children: [
            {
                kind: "file",
                name: "Idea.md",
                path: "/tmp/ws/Drafts/Idea.md",
            },
        ],
    },
    {
        kind: "file",
        name: "Archive.md",
        path: "/tmp/ws/Archive.md",
    },
];

describe("filterTreeByName", () => {
    it("keeps matching folders and descendants", () => {
        const result = filterTreeByName(sampleTree, "draft");
        expect(result).toMatchObject([{ name: "Drafts" }]);
        expect(result[0]).toMatchObject({
            children: [{ name: "Idea.md" }],
        });
        expect(result[0].kind).toBe("folder");
        if (result[0].kind === "folder") {
            expect(result[0].children[0].nameSegments).toEqual([
                { text: "Idea.md", highlighted: false },
            ]);
        }
    });

    it("keeps ancestors for matching descendants", () => {
        const result = filterTreeByName(sampleTree, "idea");
        expect(result).toMatchObject([
            {
                name: "Drafts",
                children: [{ name: "Idea.md" }],
            },
        ]);
    });

    it("adds highlight segments for matched names", () => {
        const result = filterTreeByName(sampleTree, "arch");
        expect(result[0].nameSegments).toEqual([
            { text: "Arch", highlighted: true },
            { text: "ive.md", highlighted: false },
        ]);
    });
});
