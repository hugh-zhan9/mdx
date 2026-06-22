import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
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
});
