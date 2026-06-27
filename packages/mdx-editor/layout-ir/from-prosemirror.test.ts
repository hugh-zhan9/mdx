import { describe, expect, it } from "vitest";
import { createMdxEditorKernel, defaultMarkdownSyntax } from "..";
import { normalizeProseMirrorLayoutDocument } from "./from-prosemirror";

describe("normalizeProseMirrorLayoutDocument", () => {
    it("normalizes mixed markdown from the ProseMirror document", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown(
            "# Title\n\nHello **world** [link](https://example.com)\n\n```mermaid\ngraph TD\nA-->B\n```",
        );

        const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
            documentId: "doc-1",
            revision: 1,
            viewport: { width: 960, height: 720 },
        });

        expect(doc.blocks.map((block) => block.kind)).toContain("heading");
        expect(doc.blocks.map((block) => block.kind)).toContain("paragraph");
        expect(doc.blocks.map((block) => block.kind)).toContain("mermaid");
        expect(JSON.stringify(doc)).toContain("https://example.com");
    });

    it("keeps inline atom source ranges on the ProseMirror atom", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown("Before $x^2$ after");

        const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
            documentId: "doc-1",
            revision: 1,
            viewport: { width: 960, height: 720 },
        });

        const mathRun = doc.blocks[0]?.inlines.find(
            (run) => run.kind === "math_inline",
        );

        expect(mathRun).toMatchObject({ text: "x^2" });
        expect((mathRun?.sourceTo ?? 0) - (mathRun?.sourceFrom ?? 0)).toBe(1);
    });
});
