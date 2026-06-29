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

    it("omits frontmatter from the visible layout document", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown(
            "---\ntitle: Markdown 语法支持检查\ndate: 2026-06-22\n---\n\n# Markdown 语法支持检查\n",
        );

        const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
            documentId: "doc-1",
            revision: 1,
            viewport: { width: 960, height: 720 },
        });

        expect(doc.blocks.map((block) => block.kind)).toEqual(["heading"]);
        expect(JSON.stringify(doc)).not.toContain("title: Markdown 语法支持检查");
    });

    it("scales heading font sizes by level", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown(
            "# 一级标题\n\n## 二级标题\n\n### 三级标题\n\n###### 六级标题\n",
        );

        const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
            documentId: "doc-1",
            revision: 1,
            viewport: { width: 960, height: 720 },
        });
        const headingSizes = doc.blocks.map((block) => block.style.fontSize);

        expect(headingSizes).toEqual([28, 22, 18, 14]);
    });

    it("passes image attributes into layout inline runs", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown("![Diagram](.assets/a.png \"Preview\")");

        const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
            documentId: "doc-1",
            revision: 1,
            viewport: { width: 960, height: 720 },
        });
        const imageRun = doc.blocks
            .flatMap((block) => block.inlines)
            .find((run) => run.kind === "image_inline");

        expect(imageRun?.attrs).toEqual({
            src: ".assets/a.png",
            alt: "Diagram",
            title: "Preview",
        });
    });
});
