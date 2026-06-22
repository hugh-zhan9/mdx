import { describe, expect, it } from "vitest";
import { createMdxEditorKernel, type SyntaxPlugin } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { defaultMarkdownSyntax } from "../default";
import { fallbackSyntax } from "../fallback";
import { htmlSyntax } from "./index";

describe("html syntax", () => {
    it("owns inline_html and html_block schema", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), htmlSyntax()],
        });

        expect(kernel.schema.nodes.inline_html).toBeDefined();
        expect(kernel.schema.nodes.html_block).toBeDefined();
        expect(kernel.createNodeViews().inline_html).toBeDefined();
        expect(kernel.createNodeViews().html_block).toBeDefined();
    });

    it("preserves details as html_block and div as source fallback through the default kernel", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const details = kernel.parseMarkdown(
            "<details>\n  <summary>展开详情</summary>\n  <p>详情内容。</p>\n</details>\n",
        );
        const div = kernel.parseMarkdown(
            "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n",
        );

        expect(details.doc.child(0).type.name).toBe("html_block");
        expect(details.doc.child(0).attrs.tag).toBe("details");
        expect(div.doc.child(0).type.name).toBe("source_fallback");
    });

    it("dispatches html serializers through plugin contributions with context", () => {
        const overridePlugin: SyntaxPlugin = {
            id: "html-serializer-override",
            serializers: {
                nodeSerializers: {
                    inline_html: (node, _context) =>
                        `INLINE:${String(node.attrs.html ?? "")}`,
                    html_block: (node, context) =>
                        `BLOCK:${context.serializeInline(node)}\n`,
                },
            },
        };
        const kernel = createMdxEditorKernel({
            syntax: [
                coreMarkdownSyntax(),
                fallbackSyntax(),
                htmlSyntax(),
                overridePlugin,
            ],
        });
        const doc = kernel.schema.nodes.doc.create(null, [
            kernel.schema.nodes.paragraph.create(null, [
                kernel.schema.text("A "),
                kernel.schema.nodes.inline_html.create({
                    html: "<kbd>Command</kbd>",
                    tag: "kbd",
                    text: "Command",
                }),
            ]),
            kernel.schema.nodes.html_block.create(
                {
                    html: "<details>value</details>",
                    tag: "details",
                },
                kernel.schema.text("<details>value</details>"),
            ),
        ]);

        expect(kernel.serializeMarkdown(doc)).toBe(
            "A INLINE:<kbd>Command</kbd>\n\nBLOCK:<details>value</details>\n",
        );
    });
});
