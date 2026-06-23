import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "./default";
import { markdownSyntaxSupportFixture } from "./fixtures/markdown-syntax-support.fixture";

describe("default syntax golden round trip", () => {
    it("parses key syntax nodes without cross-syntax regressions", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown(markdownSyntaxSupportFixture);
        const nodeNames: string[] = [];

        parsed.doc.descendants((node) => {
            nodeNames.push(node.type.name);
            return true;
        });

        expect(nodeNames).toContain("code_block");
        expect(nodeNames).toContain("footnote_ref");
        expect(nodeNames).toContain("footnote_definition");
        expect(nodeNames).toContain("mermaid_block");
        expect(nodeNames).toContain("inline_html");
        expect(nodeNames).toContain("source_fallback");
        expect(nodeNames).toContain("html_block");
    });

    it("serializes the comprehensive fixture without dropping protected source", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const serialized = kernel.serializeMarkdown(
            kernel.parseMarkdown(markdownSyntaxSupportFixture).doc,
        );

        expect(serialized).toContain("# 这里不应该变成标题");
        expect(serialized).toContain("[^long-note]:");
        expect(serialized).toContain("```mermaid");
        expect(serialized).toContain('<div class="custom-block">');
        expect(serialized).toContain("<details>");
    });
});
