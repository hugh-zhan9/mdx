import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse-markdown";

describe("parseMarkdown", () => {
    it("parses heading, paragraph, wikilink, and normal link into editor nodes", () => {
        const parsed = parseMarkdown("# Title\n\nSee [[Page|Label]] and [site](https://example.com).\n");

        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.doc.type.name).toBe("doc");
        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("heading");
        expect(parsed.doc.child(0).attrs.level).toBe(1);
        expect(parsed.doc.textContent).toContain("Title");
        expect(parsed.doc.textContent).toContain("Label");
        expect(parsed.sourceSlices.length).toBeGreaterThan(0);

        const paragraph = parsed.doc.child(1);
        const wikilink = paragraph.child(1).marks[0];
        const normalLink = paragraph.child(3).marks[0];
        expect(wikilink.attrs.href).toBe("mdx-wikilink:Page%7CLabel");
        expect(normalLink.attrs.href).toBe("https://example.com");
    });

    it("preserves frontmatter and mermaid fences as typed nodes with source slices", () => {
        const markdown = "---\n  title: Test\n\n---\n\n```mermaid live\ngraph TD\n  A --> B\n```\n";
        const parsed = parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("frontmatter");
        expect(parsed.doc.child(0).textContent).toBe("  title: Test\n\n");
        expect(parsed.doc.child(1).type.name).toBe("code_block");
        expect(parsed.doc.child(1).attrs.language).toBe("mermaid");
        expect(parsed.doc.child(1).attrs.info).toBe("mermaid live");
        expect(parsed.doc.child(1).textContent).toBe("graph TD\n  A --> B\n");
        const codeStart = markdown.indexOf("```mermaid live");
        const frontmatterEnd = codeStart - 1;
        expect(parsed.sourceSlices).toEqual([
            {
                id: "source-0",
                range: { start: 0, end: frontmatterEnd },
                text: markdown.slice(0, frontmatterEnd),
            },
            {
                id: "source-1",
                range: { start: codeStart, end: markdown.length },
                text: markdown.slice(codeStart),
            },
        ]);
        expect(parsed.doc.child(0).attrs.sourceId).toBe("source-0");
        expect(parsed.doc.child(1).attrs.sourceId).toBe("source-1");
    });

    it("parses normal link title attrs", () => {
        const parsed = parseMarkdown('[docs](https://example.com "Example Site")');
        const link = parsed.doc.child(0).child(0).marks[0];

        expect(link.attrs).toEqual({
            href: "https://example.com",
            title: "Example Site",
        });
    });

    it("consumes an unclosed fence through EOF as a code block", () => {
        const markdown = "```ts\n# not a heading\nbody";
        const parsed = parseMarkdown(markdown);

        expect(parsed.doc.childCount).toBe(1);
        expect(parsed.doc.child(0).type.name).toBe("code_block");
        expect(parsed.doc.child(0).attrs.language).toBe("ts");
        expect(parsed.doc.child(0).textContent).toBe("# not a heading\nbody");
        expect(parsed.sourceSlices[0]).toEqual({
            id: "source-0",
            range: { start: 0, end: markdown.length },
            text: markdown,
        });
    });
});
