import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { footnoteSyntax } from "./index";

describe("footnote syntax", () => {
    it("keeps footnote refs as text when footnote syntax is not registered", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax()],
        });
        const parsed = kernel.parseMarkdown("A note[^n].\n");

        expect(parsed.doc.child(0).type.name).toBe("paragraph");
        expect(parsed.doc.child(0).childCount).toBe(1);
        expect(parsed.doc.child(0).textContent).toBe("A note[^n].");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe("A note[^n].\n");
    });

    it("keeps footnote definitions as source fallback when footnote syntax is not registered", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax()],
        });
        const markdown = "[^n]: Body\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("source_fallback");
        expect(parsed.doc.child(0).attrs.markdown).toBe(markdown);
        expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
    });

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

        expect(
            kernel.serializeMarkdown(kernel.parseMarkdown(markdown).doc),
        ).toBe(markdown);
    });

    it("registers serializer and node view ownership through the plugin", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), footnoteSyntax()],
        });
        const schema = kernel.schema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("A "),
                schema.nodes.footnote_ref.create({ label: "n" }),
            ]),
            schema.nodes.footnote_definition.create(
                { label: "n" },
                schema.nodes.paragraph.create(null, [schema.text("Body")]),
            ),
        ]);

        expect(kernel.registry.serializers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    nodeSerializers: expect.objectContaining({
                        footnote_ref: expect.any(Function),
                        footnote_definition: expect.any(Function),
                    }),
                }),
            ]),
        );
        expect(kernel.registry.nodeViews).toHaveProperty("footnote_definition");
        expect(kernel.serializeMarkdown(doc)).toBe("A [^n]\n\n[^n]: Body\n");
    });
});
