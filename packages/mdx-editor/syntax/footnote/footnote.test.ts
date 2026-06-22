import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { footnoteSyntax } from "./index";

describe("footnote syntax", () => {
    it("parses footnote refs and multi-line definitions", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), footnoteSyntax()],
        });
        const parsed = kernel.parseMarkdown(
            [
                "A note[^long-note].",
                "",
                "[^long-note]: First line.",
                "    Second line.",
                "    Third line.",
                "",
            ].join("\n"),
        );

        expect(parsed.doc.child(0).child(1).type.name).toBe("footnote_ref");
        expect(parsed.doc.child(0).child(1).attrs.label).toBe("long-note");
        expect(parsed.doc.child(1).type.name).toBe("footnote_definition");
        expect(parsed.doc.child(1).childCount).toBe(3);
    });

    it("serializes footnote refs and definitions back to markdown", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), footnoteSyntax()],
        });
        const markdown = "A note[^n].\n\n[^n]: Body\n";

        expect(kernel.serializeMarkdown(kernel.parseMarkdown(markdown).doc)).toBe(markdown);
    });
});
