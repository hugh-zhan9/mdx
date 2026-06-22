import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { codeSyntax } from "../code";
import { mermaidSyntax } from "./index";

describe("mermaid syntax", () => {
    it("parses mermaid fences before ordinary code fences", () => {
        const kernel = createMdxEditorKernel({
            syntax: [
                coreMarkdownSyntax(),
                fallbackSyntax(),
                mermaidSyntax(),
                codeSyntax(),
            ],
        });
        const markdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("mermaid_block");
        expect(parsed.doc.child(0).textContent).toBe("graph TD\n  A --> B\n");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
    });

    it("does not call code parser helpers for mermaid fences", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), mermaidSyntax()],
        });
        const parsed = kernel.parseMarkdown("```mermaid\ngraph TD\n```\n");

        expect(parsed.doc.child(0).type.name).toBe("mermaid_block");
    });
});
