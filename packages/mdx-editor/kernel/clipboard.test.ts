import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultMarkdownSyntax } from "../syntax/default";
import { createMdxEditorKernel } from "./create-kernel";

describe("kernel clipboard", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("serializes source fallback to markdown through plugin serializer", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const fallback = kernel.schema.nodes.source_fallback.create({
            markdown: "<div>Raw</div>\n",
            reason: "unsupported",
            sourceId: "source-0",
        });
        const doc = kernel.schema.nodes.doc.create(null, [fallback]);

        expect(kernel.clipboard.serializeMarkdown(doc)).toBe("<div>Raw</div>\n");
    });

    it("sanitizes pasted script html into safe text or fallback", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.clipboard.parseHtml(
            "<script>alert(1)</script><p>Safe</p>",
        );

        expect(kernel.serializeMarkdown(parsed.doc)).toContain("Safe");
        expect(kernel.serializeMarkdown(parsed.doc)).not.toContain("script");
    });

    it("serializes syntax-owned nodes to clipboard html", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const doc = kernel.schema.nodes.doc.create(null, [
            kernel.schema.nodes.source_fallback.create({
                markdown: "<div>Raw</div>\n",
                reason: "unsupported",
                sourceId: "source-0",
            }),
            kernel.schema.nodes.code_block.create(
                { language: "ts", info: "ts" },
                kernel.schema.text("const value = 1;\n"),
            ),
            kernel.schema.nodes.mermaid_block.create(
                { info: "mermaid" },
                kernel.schema.text("graph TD;\n"),
            ),
            kernel.schema.nodes.footnote_definition.create(
                { label: "note" },
                kernel.schema.nodes.paragraph.create(null, [
                    kernel.schema.text("Footnote body"),
                ]),
            ),
        ]);

        const html = kernel.clipboard.serializeHtml(doc);

        expect(html).toContain('data-mdx-node-type="source_fallback"');
        expect(html).toContain("&lt;div&gt;Raw&lt;/div&gt;");
        expect(html).toContain('data-mdx-node-type="code_block"');
        expect(html).toContain('data-mdx-node-type="mermaid_block"');
        expect(html).toContain('data-mdx-node-type="footnote_definition"');
    });

    it("parses kernel clipboard html back through markdown preservation paths", () => {
        vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);

        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const doc = kernel.schema.nodes.doc.create(null, [
            kernel.schema.nodes.source_fallback.create({
                markdown: "<div>Raw</div>\n",
                reason: "unsupported",
                sourceId: "source-0",
            }),
            kernel.schema.nodes.mermaid_block.create(
                { info: "mermaid" },
                kernel.schema.text("graph TD;\n"),
            ),
        ]);

        const parsed = kernel.clipboard.parseHtml(
            kernel.clipboard.serializeHtml(doc),
        );

        expect(kernel.serializeMarkdown(parsed.doc)).toBe(
            "<div>Raw</div>\n\n```mermaid\ngraph TD;\n```\n",
        );
    });

    it("removes unsafe event handlers and urls while keeping safe text", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.clipboard.parseHtml(
            '<p onclick="alert(1)">Safe <a href="javascript:alert(2)">link</a></p>',
        );
        const markdown = kernel.serializeMarkdown(parsed.doc);

        expect(markdown).toContain("Safe");
        expect(markdown).toContain("link");
        expect(markdown).not.toContain("onclick");
        expect(markdown).not.toContain("javascript");
        expect(markdown).not.toContain("alert");
    });
});
