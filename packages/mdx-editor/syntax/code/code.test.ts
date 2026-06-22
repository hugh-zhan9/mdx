import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { codeSyntax } from "./index";

describe("code syntax", () => {
    it("parses and serializes ordinary fenced code", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), codeSyntax()],
        });
        const markdown = "```ts\nconst value = 1;\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("code_block");
        expect(parsed.doc.child(0).attrs.language).toBe("ts");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
    });

    it("keeps markdown fenced code as code text", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), codeSyntax()],
        });
        const markdown = "```md\n# Not a heading\n[Link](https://x.test)\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("code_block");
        expect(parsed.doc.child(0).textContent).toContain("# Not a heading");
    });
});
