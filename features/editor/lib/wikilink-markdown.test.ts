import { describe, expect, it } from "vitest";
import {
    renderWikilinksForEditor,
    restoreWikilinksFromEditor,
} from "./wikilink-markdown";

describe("renderWikilinksForEditor", () => {
    it("renders bare wikilinks as temporary markdown links", () => {
        expect(renderWikilinksForEditor("See [[RAG]].")).toBe(
            "See [RAG](mdx-wikilink:RAG).",
        );
    });

    it("renders aliased wikilinks with the alias as link text", () => {
        expect(renderWikilinksForEditor("See [[Vector DB|vectors]].")).toBe(
            "See [vectors](mdx-wikilink:Vector%20DB%7Cvectors).",
        );
    });

    it("does not render wikilinks inside inline code", () => {
        expect(renderWikilinksForEditor("Use `[[RAG]]` here.")).toBe(
            "Use `[[RAG]]` here.",
        );
    });

    it("does not render wikilinks inside fenced code blocks", () => {
        const markdown = "Before [[RAG]]\n```md\n[[Code]]\n```\nAfter [[Wiki]]";

        expect(renderWikilinksForEditor(markdown)).toBe(
            "Before [RAG](mdx-wikilink:RAG)\n```md\n[[Code]]\n```\nAfter [Wiki](mdx-wikilink:Wiki)",
        );
    });
});

describe("restoreWikilinksFromEditor", () => {
    it("restores temporary markdown links to wikilinks", () => {
        expect(
            restoreWikilinksFromEditor(
                "See [vectors](mdx-wikilink:Vector%20DB%7Cvectors).",
            ),
        ).toBe("See [[Vector DB|vectors]].");
    });

    it("leaves ordinary markdown links unchanged", () => {
        expect(restoreWikilinksFromEditor("[site](https://example.com)")).toBe(
            "[site](https://example.com)",
        );
    });
});
