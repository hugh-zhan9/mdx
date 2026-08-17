import { describe, expect, it } from "vitest";

import {
    publishingContentDigest,
    readPublishingContent,
} from "./publishing-content";

const MIXED_MARKDOWN = [
    "---",
    "title: Release",
    "---",
    "",
    "# Release notes",
    "",
    "See the [changelog](https://example.com/changelog) and **read** it.",
    "",
    "![red pixel](./.assets/red.png)",
    "",
    "```ts",
    "const total = 1;",
    "```",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "Inline math $a^2 + b^2$ and inline `code`.",
    "",
    "> quoted line",
    "",
    "- first",
    "- [x] done",
    "",
    "| head | other |",
    "| --- | --- |",
    "| cell | more |",
    "",
    "---",
    "",
].join("\n");

describe("reading a captured revision as content", () => {
    it("reads headings with their level and text", () => {
        const content = readPublishingContent("## Second level\n");

        expect(content.blocks).toEqual([
            {
                kind: "heading",
                level: 2,
                inlines: [{ kind: "text", text: "Second level" }],
            },
        ]);
    });

    it("keeps where a link points, not only the words that carried it", () => {
        const content = readPublishingContent(
            "Go to [the docs](https://example.com/docs).\n",
        );
        const paragraph = content.blocks[0];

        expect(paragraph.kind).toBe("paragraph");
        expect(paragraph.kind === "paragraph" ? paragraph.inlines : []).toEqual([
            { kind: "text", text: "Go to " },
            { kind: "link", text: "the docs", target: "https://example.com/docs" },
            { kind: "text", text: "." },
        ]);
    });

    it("keeps an image source and its alternative text", () => {
        const content = readPublishingContent('![a red pixel](./red.png "Red")\n');
        const paragraph = content.blocks[0];

        expect(paragraph.kind === "paragraph" ? paragraph.inlines : []).toEqual([
            {
                kind: "image",
                text: "",
                target: "./red.png",
                alt: "a red pixel",
                title: "Red",
            },
        ]);
    });

    it("keeps code verbatim with its language", () => {
        const content = readPublishingContent(
            "```rust\nfn main() {\n    // keep me\n}\n```\n",
        );

        expect(content.blocks).toEqual([
            {
                kind: "code",
                language: "rust",
                text: "fn main() {\n    // keep me\n}",
            },
        ]);
    });

    it("keeps block and inline math as math, not as text", () => {
        const content = readPublishingContent(
            "$$\n\\frac{1}{2}\n$$\n\nwith $x_1$ inline.\n",
        );

        expect(content.blocks[0]).toEqual({
            kind: "math",
            text: "\\frac{1}{2}",
        });
        const paragraph = content.blocks[1];
        expect(paragraph.kind === "paragraph" ? paragraph.inlines : []).toContainEqual(
            { kind: "math", text: "x_1" },
        );
    });

    it("records list ordering and task state", () => {
        const content = readPublishingContent(
            "1. first\n2. second\n\n- [ ] open\n- [x] done\n",
        );

        expect(content.blocks).toEqual([
            {
                kind: "list_item",
                ordered: true,
                depth: 0,
                checked: null,
                inlines: [{ kind: "text", text: "first" }],
            },
            {
                kind: "list_item",
                ordered: true,
                depth: 0,
                checked: null,
                inlines: [{ kind: "text", text: "second" }],
            },
            {
                kind: "list_item",
                ordered: false,
                depth: 0,
                checked: false,
                inlines: [{ kind: "text", text: "open" }],
            },
            {
                kind: "list_item",
                ordered: false,
                depth: 0,
                checked: true,
                inlines: [{ kind: "text", text: "done" }],
            },
        ]);
    });

    it("reads a table as header and body rows of cells", () => {
        const content = readPublishingContent(
            "| head | other |\n| --- | --- |\n| cell | more |\n",
        );

        expect(content.blocks).toEqual([
            {
                kind: "table_row",
                header: true,
                cells: [
                    [{ kind: "text", text: "head" }],
                    [{ kind: "text", text: "other" }],
                ],
            },
            {
                kind: "table_row",
                header: false,
                cells: [
                    [{ kind: "text", text: "cell" }],
                    [{ kind: "text", text: "more" }],
                ],
            },
        ]);
    });

    it("keeps emphasis on the run that carries it", () => {
        const content = readPublishingContent("plain **bold** and *italic*\n");
        const paragraph = content.blocks[0];

        expect(paragraph.kind === "paragraph" ? paragraph.inlines : []).toEqual([
            { kind: "text", text: "plain " },
            { kind: "text", text: "bold", emphasis: ["strong"] },
            { kind: "text", text: " and " },
            { kind: "text", text: "italic", emphasis: ["emphasis"] },
        ]);
    });

    it("reads an empty document as no content", () => {
        expect(readPublishingContent("")).toEqual({ blocks: [] });
    });
});

describe("the semantic digest of publishing content", () => {
    it("names every content family in document order", () => {
        const digest = publishingContentDigest(
            readPublishingContent(MIXED_MARKDOWN),
        );

        expect(digest).toEqual([
            "frontmatter=title: Release",
            "heading:1",
            "text=Release notes",
            "paragraph",
            "text=See the ",
            "link=https://example.com/changelog|changelog",
            "text= and ",
            "text[strong]=read",
            "text= it.",
            "paragraph",
            "image=./.assets/red.png|red pixel",
            "code:ts=const total = 1;",
            "math=E = mc^2",
            "paragraph",
            "text=Inline math ",
            "inline_math=a^2 + b^2",
            "text= and inline ",
            "inline_code=code",
            "text=.",
            "quote",
            "text=quoted line",
            "list_item:bullet:0:none",
            "text=first",
            "list_item:bullet:0:true",
            "text=done",
            "table_row:header",
            "table_cell",
            "text=head",
            "table_cell",
            "text=other",
            "table_row:body",
            "table_cell",
            "text=cell",
            "table_cell",
            "text=more",
            "thematic_break",
        ]);
    });

    it("changes when a link destination changes", () => {
        const before = publishingContentDigest(
            readPublishingContent("[label](https://one.example)\n"),
        );
        const after = publishingContentDigest(
            readPublishingContent("[label](https://two.example)\n"),
        );

        expect(before).not.toEqual(after);
    });

    it("changes when a heading level changes", () => {
        const before = publishingContentDigest(readPublishingContent("# Title\n"));
        const after = publishingContentDigest(readPublishingContent("## Title\n"));

        expect(before).not.toEqual(after);
    });
});
