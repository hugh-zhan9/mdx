import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse-markdown";
import { roundTripFixtures } from "../test/fixtures";

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

    it("parses markdown image syntax into an image node", () => {
        const parsed = parseMarkdown('![Diagram](.assets/a.png "Preview")\n');
        const image = parsed.doc.child(0).child(0);

        expect(image.type.name).toBe("image");
        expect(image.attrs).toEqual({
            src: ".assets/a.png",
            alt: "Diagram",
            title: "Preview",
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

    it("parses unsupported block features as source-preserved opaque blocks", () => {
        const fixtures = roundTripFixtures.filter((fixture) =>
            [
                "gfm task list",
                "gfm table",
                "callout",
                "html opaque",
            ].includes(fixture.name),
        );

        for (const fixture of fixtures) {
            const parsed = parseMarkdown(fixture.markdown);

            expect(parsed.diagnostics).toEqual([]);
            expect(parsed.doc.childCount).toBe(1);
            expect(parsed.doc.child(0).type.name).toBe("opaque_block");
            expect(parsed.doc.child(0).attrs.reason).toBe("source-preserved");
            expect(parsed.doc.child(0).attrs.sourceId).toBe("source-0");
            expect(parsed.sourceSlices).toEqual([
                {
                    id: "source-0",
                    range: { start: 0, end: fixture.markdown.length },
                    text: fixture.markdown,
                },
            ]);
        }
    });

    it("source-preserves block math and footnote definition blocks while leaving supported paragraphs intact", () => {
        const math = roundTripFixtures.find((fixture) => fixture.name === "math");
        const footnote = roundTripFixtures.find((fixture) => fixture.name === "footnote");

        expect(math).toBeDefined();
        expect(footnote).toBeDefined();

        const parsedMath = parseMarkdown(math!.markdown);
        expect(parsedMath.doc.childCount).toBe(2);
        expect(parsedMath.doc.child(0).type.name).toBe("paragraph");
        expect(parsedMath.doc.child(0).textContent).toBe("Inline $x+1$.");
        expect(parsedMath.doc.child(1).type.name).toBe("opaque_block");
        expect(parsedMath.doc.child(1).attrs.reason).toBe("source-preserved");

        const parsedFootnote = parseMarkdown(footnote!.markdown);
        expect(parsedFootnote.doc.childCount).toBe(2);
        expect(parsedFootnote.doc.child(0).type.name).toBe("paragraph");
        expect(parsedFootnote.doc.child(0).textContent).toBe("A note[^1].");
        expect(parsedFootnote.doc.child(1).type.name).toBe("opaque_block");
        expect(parsedFootnote.doc.child(1).attrs.reason).toBe("source-preserved");
    });

    it("does not let source-preserved callouts swallow following headings", () => {
        const parsed = parseMarkdown("> [!NOTE]\n> note\n# Title\n");

        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("opaque_block");
        expect(parsed.doc.child(1).type.name).toBe("heading");
        expect(parsed.doc.child(1).textContent).toBe("Title");
    });

    it("does not let source-preserved task lists swallow following headings", () => {
        const parsed = parseMarkdown("- [x] done\n# Title\n");

        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("opaque_block");
        expect(parsed.doc.child(1).type.name).toBe("heading");
        expect(parsed.doc.child(1).textContent).toBe("Title");
    });
});
