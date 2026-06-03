import { describe, expect, it } from "vitest";
import { findWikilinkAtTextOffset, resolveWikilinkFile } from "./wikilink";
import type { FileTreeNode } from "./types";

const fileTree: FileTreeNode[] = [
    {
        kind: "folder",
        name: "wiki",
        path: "/ws/wiki",
        children: [
            {
                kind: "folder",
                name: "concepts",
                path: "/ws/wiki/concepts",
                children: [
                    {
                        kind: "file",
                        name: "Vector DB.md",
                        path: "/ws/wiki/concepts/Vector DB.md",
                    },
                    {
                        kind: "file",
                        name: "RAG.markdown",
                        path: "/ws/wiki/concepts/RAG.markdown",
                    },
                ],
            },
            {
                kind: "folder",
                name: "entities",
                path: "/ws/wiki/entities",
                children: [
                    {
                        kind: "file",
                        name: "Karpathy.md",
                        path: "/ws/wiki/entities/Karpathy.md",
                    },
                ],
            },
        ],
    },
    {
        kind: "file",
        name: "index.md",
        path: "/ws/index.md",
    },
];

describe("findWikilinkAtTextOffset", () => {
    it("returns the wikilink target at a clicked text offset", () => {
        const text = "See [[Vector DB|vectors]] and [[RAG]].";

        expect(findWikilinkAtTextOffset(text, 8)).toBe("Vector DB|vectors");
        expect(findWikilinkAtTextOffset(text, 33)).toBe("RAG");
        expect(findWikilinkAtTextOffset(text, 2)).toBeNull();
    });
});

describe("resolveWikilinkFile", () => {
    it("resolves bare wikilinks by markdown basename", () => {
        const resolved = resolveWikilinkFile(
            "/ws",
            "/ws/wiki/entities/Karpathy.md",
            fileTree,
            "Vector DB",
        );

        expect(resolved).toBe("/ws/wiki/concepts/Vector DB.md");
    });

    it("resolves root-qualified wikilinks with heading and alias", () => {
        const resolved = resolveWikilinkFile(
            "/ws",
            "/ws/wiki/entities/Karpathy.md",
            fileTree,
            "wiki/concepts/RAG#Intro|RAG",
        );

        expect(resolved).toBe("/ws/wiki/concepts/RAG.markdown");
    });

    it("resolves root index wikilinks", () => {
        const resolved = resolveWikilinkFile(
            "/ws",
            "/ws/wiki/entities/Karpathy.md",
            fileTree,
            "index",
        );

        expect(resolved).toBe("/ws/index.md");
    });

    it("does not resolve paths outside the workspace", () => {
        const resolved = resolveWikilinkFile(
            "/ws",
            "/ws/wiki/entities/Karpathy.md",
            fileTree,
            "../../../../outside",
        );

        expect(resolved).toBeNull();
    });
});
