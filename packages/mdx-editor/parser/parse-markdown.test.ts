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
        expect(parsed.doc.child(1).type.name).toBe("mermaid_block");
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

    it("parses inline markdown marks, footnote refs, and math into structured nodes", () => {
        const parsed = parseMarkdown("A **bold** *em* ~~gone~~ `code` $x+1$ [^note].\n");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(1).text).toBe("bold");
        expect(paragraph.child(1).marks[0]?.type.name).toBe("strong");
        expect(paragraph.child(3).text).toBe("em");
        expect(paragraph.child(3).marks[0]?.type.name).toBe("emphasis");
        expect(paragraph.child(5).text).toBe("gone");
        expect(paragraph.child(5).marks[0]?.type.name).toBe("strike");
        expect(paragraph.child(7).text).toBe("code");
        expect(paragraph.child(7).marks[0]?.type.name).toBe("inline_code");
        expect(paragraph.child(9).type.name).toBe("math_inline");
        expect(paragraph.child(9).attrs.latex).toBe("x+1");
        expect(paragraph.child(11).type.name).toBe("footnote_ref");
        expect(paragraph.child(11).attrs.label).toBe("note");
    });

    it("recursively parses inline syntax inside strong, emphasis, and strike marks", () => {
        const parsed = parseMarkdown("**`code`** *`em`* ~~`gone`~~");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).text).toBe("code");
        expect(paragraph.child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "inline_code",
        ]);
        expect(paragraph.child(2).text).toBe("em");
        expect(paragraph.child(2).marks.map((mark) => mark.type.name)).toEqual([
            "emphasis",
            "inline_code",
        ]);
        expect(paragraph.child(4).text).toBe("gone");
        expect(paragraph.child(4).marks.map((mark) => mark.type.name)).toEqual([
            "strike",
            "inline_code",
        ]);
    });

    it("preserves outer marks on parsed inline atom nodes", () => {
        const parsed = parseMarkdown("**$x$** **[^n]** **![alt](src)**");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).type.name).toBe("math_inline");
        expect(paragraph.child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
        expect(paragraph.child(2).type.name).toBe("footnote_ref");
        expect(paragraph.child(2).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
        expect(paragraph.child(4).type.name).toBe("image");
        expect(paragraph.child(4).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
    });

    it("keeps escaped inline markdown delimiters as literal text", () => {
        const markdown = String.raw`\*\*bold\*\* \*em\* \~\~gone\~\~ \`code\` \$x+1\$ \[\^note\]`;
        const parsed = parseMarkdown(markdown);
        const paragraph = parsed.doc.child(0);

        expect(paragraph.childCount).toBe(1);
        expect(paragraph.textContent).toBe("**bold** *em* ~~gone~~ `code` $x+1$ [^note]");
    });

    it("preserves backslashes inside inline code and math", () => {
        const parsed = parseMarkdown("`a\\b` $\\alpha$");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).text).toBe(String.raw`a\b`);
        expect(paragraph.child(0).marks[0]?.type.name).toBe("inline_code");
        expect(paragraph.child(2).type.name).toBe("math_inline");
        expect(paragraph.child(2).attrs.latex).toBe(String.raw`\alpha`);
    });

    it("parses escaped dollars and backslashes inside inline math", () => {
        const parsed = parseMarkdown(String.raw`$x\$$ $x\\$`);

        expect(parsed.doc.child(0).child(0).attrs.latex).toBe("x$");
        expect(parsed.doc.child(0).child(2).attrs.latex).toBe("x\\");
    });

    it("parses angle-bracket link hrefs containing spaces", () => {
        const parsed = parseMarkdown("[docs](<docs/My File.md>)");
        const link = parsed.doc.child(0).child(0).marks[0];

        expect(link.attrs.href).toBe("docs/My File.md");
    });

    it("parses inline marks inside normal link labels", () => {
        const parsed = parseMarkdown("[**bold** tail](https://x.test)");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).text).toBe("bold");
        expect(paragraph.child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "link",
        ]);
        expect(paragraph.child(1).text).toBe(" tail");
        expect(paragraph.child(1).marks.map((mark) => mark.type.name)).toEqual([
            "link",
        ]);
    });

    it("parses inline math inside normal link labels", () => {
        const parsed = parseMarkdown("[eq $x$](https://x.test)");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).text).toBe("eq ");
        expect(paragraph.child(0).marks[0]?.type.name).toBe("link");
        expect(paragraph.child(1).type.name).toBe("math_inline");
        expect(paragraph.child(1).attrs.latex).toBe("x");
        expect(paragraph.child(1).marks[0]?.type.name).toBe("link");
    });

    it("parses inline math inside wikilink labels", () => {
        const parsed = parseMarkdown("[[Target|eq $x$]]");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.child(0).text).toBe("eq ");
        expect(paragraph.child(0).marks[0]?.attrs.href).toBe(
            "mdx-wikilink:Target%7Ceq%20%24x%24",
        );
        expect(paragraph.child(1).type.name).toBe("math_inline");
        expect(paragraph.child(1).attrs.latex).toBe("x");
        expect(paragraph.child(1).marks[0]?.attrs.href).toBe(
            "mdx-wikilink:Target%7Ceq%20%24x%24",
        );
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

    it("parses contiguous plain bullet list lines as list item structure", () => {
        const markdown = "- **one**\n* two [site](https://example.com)\n\nAfter.\n";
        const parsed = parseMarkdown(markdown);
        const list = parsed.doc.child(0);

        expect(list.type.name).toBe("bullet_list");
        expect(list.attrs.sourceId).toBe("source-0");
        expect(list.childCount).toBe(2);
        expect(list.child(0).type.name).toBe("list_item");
        expect(list.child(0).child(0).type.name).toBe("paragraph");
        expect(list.child(0).child(0).child(0).text).toBe("one");
        expect(list.child(0).child(0).child(0).marks[0]?.type.name).toBe(
            "strong",
        );
        expect(list.child(1).child(0).child(1).marks[0]?.attrs.href).toBe(
            "https://example.com",
        );
        expect(parsed.doc.child(1).type.name).toBe("paragraph");
        expect(parsed.doc.child(1).textContent).toBe("After.");
    });

    it("parses contiguous ordered list lines with the first marker order", () => {
        const parsed = parseMarkdown("3. first\n4. second\n");
        const list = parsed.doc.child(0);

        expect(list.type.name).toBe("ordered_list");
        expect(list.attrs.order).toBe(3);
        expect(list.childCount).toBe(2);
        expect(list.child(0).type.name).toBe("list_item");
        expect(list.child(0).child(0).textContent).toBe("first");
        expect(list.child(1).child(0).textContent).toBe("second");
    });

    it("parses contiguous blockquote lines into paragraph children", () => {
        const parsed = parseMarkdown(
            "> quoted **text**\n>\n> [site](https://example.com)\n",
        );
        const quote = parsed.doc.child(0);

        expect(quote.type.name).toBe("blockquote");
        expect(quote.childCount).toBe(2);
        expect(quote.child(0).type.name).toBe("paragraph");
        expect(quote.child(0).child(1).marks[0]?.type.name).toBe("strong");
        expect(quote.child(1).child(0).marks[0]?.attrs.href).toBe(
            "https://example.com",
        );
    });

    it("parses fenced backtick code blocks with language, info, and source id", () => {
        const markdown = "```ts live\nconst value = 1;\n```\n";
        const parsed = parseMarkdown(markdown);
        const code = parsed.doc.child(0);

        expect(code.type.name).toBe("code_block");
        expect(code.attrs.language).toBe("ts");
        expect(code.attrs.info).toBe("ts live");
        expect(code.attrs.sourceId).toBe("source-0");
        expect(code.textContent).toBe("const value = 1;\n");
        expect(parsed.sourceSlices[0]?.text).toBe(markdown);
    });

    it("parses advanced markdown blocks as structured nodes", () => {
        const cases = [
            { name: "gfm task list", expected: ["bullet_list"] },
            { name: "gfm table", expected: ["table"] },
            { name: "callout", expected: ["callout"] },
            { name: "math", expected: ["paragraph", "math_block"] },
            { name: "footnote", expected: ["paragraph", "footnote_definition"] },
            { name: "mermaid fence", expected: ["mermaid_block"] },
        ];

        for (const testCase of cases) {
            const fixture = roundTripFixtures.find(
                (candidate) => candidate.name === testCase.name,
            );
            expect(fixture, testCase.name).toBeDefined();
            const parsed = parseMarkdown(fixture!.markdown);

            expect(
                Array.from(
                    { length: parsed.doc.childCount },
                    (_, index) => parsed.doc.child(index).type.name,
                ),
            ).toEqual(testCase.expected);
        }
    });

    it("parses advanced block details into schema attrs and children", () => {
        const taskList = parseMarkdown("- [x] Done\n- [ ] Todo\n").doc.child(0);
        expect(taskList.child(0).type.name).toBe("task_item");
        expect(taskList.child(0).attrs.checked).toBe(true);
        expect(taskList.child(0).child(0).textContent).toBe("Done");
        expect(taskList.child(1).attrs.checked).toBe(false);
        expect(taskList.child(1).child(0).textContent).toBe("Todo");

        const table = parseMarkdown(
            "| A | B | C | D |\n|:---|---:|:---:|---|\n| 1 | 2 | 3 | 4 |\n",
        ).doc.child(0);
        expect(table.attrs.alignments).toEqual([
            "left",
            "right",
            "center",
            null,
        ]);
        expect(table.child(0).child(0).type.name).toBe("table_header");
        expect(table.child(1).child(0).type.name).toBe("table_cell");

        const callout = parseMarkdown("> [!tip] Remember\n> Keep this.\n").doc.child(
            0,
        );
        expect(callout.attrs.kind).toBe("TIP");
        expect(callout.attrs.title).toBe("Remember");
        expect(callout.child(0).textContent).toBe("Keep this.");
    });

    it("keeps unsupported block boundaries source-preserved", () => {
        const html = roundTripFixtures.find(
            (fixture) => fixture.name === "html opaque",
        );
        expect(html).toBeDefined();

        const parsedHtml = parseMarkdown(html!.markdown);
        expect(parsedHtml.doc.childCount).toBe(1);
        expect(parsedHtml.doc.child(0).type.name).toBe("opaque_block");
        expect(parsedHtml.doc.child(0).attrs.reason).toBe("source-preserved");
        expect(parsedHtml.doc.child(0).attrs.sourceId).toBe("source-0");

        const parsedFootnote = parseMarkdown("[^1]: Body\n    Nested body\n");
        expect(parsedFootnote.doc.childCount).toBe(1);
        expect(parsedFootnote.doc.child(0).type.name).toBe("opaque_block");
        expect(parsedFootnote.doc.child(0).attrs.reason).toBe("source-preserved");
        expect(parsedFootnote.doc.child(0).attrs.sourceId).toBe("source-0");
    });

    it("parses block math and footnote definition blocks while leaving supported paragraphs intact", () => {
        const math = roundTripFixtures.find((fixture) => fixture.name === "math");
        const footnote = roundTripFixtures.find((fixture) => fixture.name === "footnote");

        expect(math).toBeDefined();
        expect(footnote).toBeDefined();

        const parsedMath = parseMarkdown(math!.markdown);
        expect(parsedMath.doc.childCount).toBe(2);
        expect(parsedMath.doc.child(0).type.name).toBe("paragraph");
        expect(parsedMath.doc.child(0).textContent).toBe("Inline .");
        expect(parsedMath.doc.child(0).child(1).type.name).toBe("math_inline");
        expect(parsedMath.doc.child(0).child(1).attrs.latex).toBe("x+1");
        expect(parsedMath.doc.child(1).type.name).toBe("math_block");
        expect(parsedMath.doc.child(1).textContent).toBe("y = mx + b\n");

        const parsedFootnote = parseMarkdown(footnote!.markdown);
        expect(parsedFootnote.doc.childCount).toBe(2);
        expect(parsedFootnote.doc.child(0).type.name).toBe("paragraph");
        expect(parsedFootnote.doc.child(0).textContent).toBe("A note.");
        expect(parsedFootnote.doc.child(0).child(1).type.name).toBe("footnote_ref");
        expect(parsedFootnote.doc.child(0).child(1).attrs.label).toBe("1");
        expect(parsedFootnote.doc.child(1).type.name).toBe("footnote_definition");
        expect(parsedFootnote.doc.child(1).attrs.label).toBe("1");
        expect(parsedFootnote.doc.child(1).child(0).textContent).toBe("Footnote body.");
    });

    it("does not let callouts swallow following headings", () => {
        const parsed = parseMarkdown("> [!NOTE]\n> note\n# Title\n");

        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("callout");
        expect(parsed.doc.child(1).type.name).toBe("heading");
        expect(parsed.doc.child(1).textContent).toBe("Title");
    });

    it("does not let task lists swallow following headings", () => {
        const parsed = parseMarkdown("- [x] done\n# Title\n");

        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("bullet_list");
        expect(parsed.doc.child(1).type.name).toBe("heading");
        expect(parsed.doc.child(1).textContent).toBe("Title");
    });
});
