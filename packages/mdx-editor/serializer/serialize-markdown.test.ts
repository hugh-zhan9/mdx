import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { parseMarkdown } from "../parser/parse-markdown";
import { serializeMarkdown } from "./serialize-markdown";

describe("serializeMarkdown", () => {
    it("returns the original Markdown when the document is unchanged", () => {
        const markdown = "# Title\n\nSee [[Page|Label]].\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("round-trips whitespace-only markdown through the placeholder document", () => {
        const markdown = "\n\n";
        const parsed = parseMarkdown(markdown);

        expect(parsed.sourceSlices).toEqual([]);
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("serializes edited headings and paragraphs without rewriting untouched blocks", () => {
        const markdown = "# Title\n\nBody.\n";
        const parsed = parseMarkdown(markdown);
        const heading = parsed.doc.child(0).type.create(
            parsed.doc.child(0).attrs,
            parsed.doc.type.schema.text("New Title"),
        );
        const editedDoc = parsed.doc.copy(parsed.doc.content.replaceChild(0, heading));

        expect(serializeMarkdown({ ...parsed, doc: editedDoc })).toBe("# New Title\n\nBody.\n");
    });

    it("restores wikilinks instead of serializing temporary mdx-wikilink links", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("Alias", [
                    mdxEditorSchema.marks.link.create({
                        href: "mdx-wikilink:Target%7CAlias",
                    }),
                ]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe("[[Target|Alias]]\n");
    });

    it("preserves multiple blank lines between untouched source blocks", () => {
        const markdown = "# Title\n\n\n\nBody.\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("preserves unchanged frontmatter and fenced code inner text", () => {
        const markdown = "---\ntitle: Test\n\n---\n\n```mermaid live\ngraph TD\n  A --> B\n```\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("serializes normal links with titles", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("docs", [
                    mdxEditorSchema.marks.link.create({
                        href: "https://example.com",
                        title: "Example Site",
                    }),
                ]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            '[docs](https://example.com "Example Site")\n',
        );
    });

    it("does not resurrect deleted trailing blocks from the original source", () => {
        const markdown = "# Title\n\nBody.\n";
        const parsed = parseMarkdown(markdown);
        const trimmedDoc = parsed.doc.copy(parsed.doc.content.cut(0, parsed.doc.child(0).nodeSize));

        expect(serializeMarkdown({ ...parsed, doc: trimmedDoc })).toBe("# Title\n");
    });

    it("does not resurrect deleted middle blocks from original source gaps", () => {
        const markdown = "# Title\n\nDelete me.\n\nKeep me.\n";
        const parsed = parseMarkdown(markdown);
        const nextContent = parsed.doc.content
            .cut(0, parsed.doc.child(0).nodeSize)
            .append(
                parsed.doc.content.cut(
                    parsed.doc.child(0).nodeSize + parsed.doc.child(1).nodeSize,
                ),
            );
        const editedDoc = parsed.doc.copy(nextContent);

        expect(serializeMarkdown({ ...parsed, doc: editedDoc })).toBe("# Title\n\nKeep me.\n");
    });

    it("preserves trailing blank source when the final source block is unchanged", () => {
        const markdown = "# Title\n\nBody.\n\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });
});

function emptyParsedDocument(doc: ReturnType<typeof mdxEditorSchema.nodes.doc.create>) {
    return {
        doc,
        originalMarkdown: "",
        sourceSlices: [],
        diagnostics: [],
    };
}
