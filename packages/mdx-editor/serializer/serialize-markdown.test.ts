import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { parseMarkdown } from "../parser/parse-markdown";
import { sourceRange } from "../core/source-map";
import { roundTripFixtures } from "../test/fixtures";
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

    it("preserves literal markdown-looking text as plain text", () => {
        const markdown = String.raw`Escaped \[\[Page\]\] and \[x\]\(y\).\n`;
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("preserves unchanged frontmatter and fenced code inner text", () => {
        const markdown = "---\ntitle: Test\n\n---\n\n```mermaid live\ngraph TD\n  A --> B\n```\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("round-trips structured advanced markdown blocks", () => {
        for (const name of [
            "gfm task list",
            "gfm table",
            "math",
            "footnote",
            "callout",
            "mermaid fence",
        ]) {
            const fixture = roundTripFixtures.find(
                (candidate) => candidate.name === name,
            );
            expect(fixture, name).toBeDefined();
            const parsed = parseMarkdown(fixture!.markdown);

            expect(serializeMarkdown(parsed)).toBe(fixture!.markdown);
        }
    });

    it("serializes generated advanced block structures", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.bullet_list.create(null, [
                schema.nodes.task_item.create(
                    { checked: true },
                    schema.nodes.paragraph.create(null, [schema.text("Done")]),
                ),
                schema.nodes.task_item.create(
                    { checked: false },
                    schema.nodes.paragraph.create(null, [schema.text("Todo")]),
                ),
            ]),
            schema.nodes.math_block.create(null, schema.text("y = mx + b\n")),
            schema.nodes.footnote_definition.create(
                { label: "1" },
                schema.nodes.paragraph.create(null, [schema.text("Footnote body.")]),
            ),
            schema.nodes.mermaid_block.create(
                { info: "mermaid live" },
                schema.text("graph TD\n  A --> B\n"),
            ),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "- [x] Done\n- [ ] Todo\n\n$$\ny = mx + b\n$$\n\n[^1]: Footnote body.\n\n```mermaid live\ngraph TD\n  A --> B\n```\n",
        );
    });

    it("serializes source fallback markdown exactly", () => {
        const markdown = "<div>Unsupported</div>\n";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.source_fallback.create({
                markdown,
                reason: "unsupported",
            }),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(markdown);
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

    it("serializes image nodes as markdown image syntax", () => {
        const markdown = '![Diagram](.assets/a.png "Preview")\n';
        const parsed = parseMarkdown(markdown);

        expect(parsed.doc.child(0).child(0).type.name).toBe("image");
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("serializes inline marks, math, and footnote refs", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("A "),
                schema.text("bold", [schema.marks.strong.create()]),
                schema.text(" "),
                schema.text("em", [schema.marks.emphasis.create()]),
                schema.text(" "),
                schema.text("gone", [schema.marks.strike.create()]),
                schema.text(" "),
                schema.text("code", [schema.marks.inline_code.create()]),
                schema.text(" "),
                schema.nodes.math_inline.create({ latex: "x+1" }),
                schema.text(" "),
                schema.nodes.footnote_ref.create({ label: "note" }),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "A **bold** *em* ~~gone~~ `code` $x+1$ [^note]\n",
        );
    });

    it("serializes atom-only paragraphs instead of treating them as placeholders", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.nodes.image.create({ src: "image.png", alt: "Alt" }),
                schema.nodes.math_inline.create({ latex: "x+1" }),
                schema.nodes.footnote_ref.create({ label: "note" }),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "![Alt](image.png)$x+1$[^note]\n",
        );
    });

    it("escapes generated plain text active delimiters so they stay plain", () => {
        const schema = mdxEditorSchema;
        const plainText = "plain **bold** *em* ~~gone~~ `code` $x+1$";
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [schema.text(plainText)]),
        ]);
        const serialized = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(serialized);

        expect(serialized).toBe(
            String.raw`plain \*\*bold\*\* \*em\* \~\~gone\~\~ \`code\` \$x+1\$` + "\n",
        );
        expect(reparsed.doc.child(0).childCount).toBe(1);
        expect(reparsed.doc.child(0).textContent).toBe(plainText);
    });

    it("round-trips backslashes inside inline code and math", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text(String.raw`a\b`, [schema.marks.inline_code.create()]),
                schema.text(" "),
                schema.nodes.math_inline.create({ latex: String.raw`\alpha` }),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe(String.raw`` + "`" + String.raw`a\b` + "` " + String.raw`$\\alpha$` + "\n");
        expect(reparsed.doc.child(0).child(0).text).toBe(String.raw`a\b`);
        expect(reparsed.doc.child(0).child(2).attrs.latex).toBe(String.raw`\alpha`);
    });

    it("round-trips inline math containing dollars and trailing backslashes", () => {
        const schema = mdxEditorSchema;
        const cases = [
            { latex: "x$", markdown: String.raw`$x\$$` + "\n" },
            { latex: "x\\", markdown: String.raw`$x\\$` + "\n" },
        ];

        for (const testCase of cases) {
            const doc = schema.nodes.doc.create(null, [
                schema.nodes.paragraph.create(null, [
                    schema.nodes.math_inline.create({ latex: testCase.latex }),
                ]),
            ]);
            const markdown = serializeMarkdown(emptyParsedDocument(doc));
            const reparsed = parseMarkdown(markdown);

            expect(markdown).toBe(testCase.markdown);
            expect(reparsed.doc.child(0).child(0).type.name).toBe("math_inline");
            expect(reparsed.doc.child(0).child(0).attrs.latex).toBe(
                testCase.latex,
            );
        }
    });

    it("round-trips literal backticks inside inline code", () => {
        const schema = mdxEditorSchema;
        const cases = [
            { text: "`", markdown: "`` ` ``\n" },
            { text: "a`", markdown: "`` a` ``\n" },
            { text: "`a", markdown: "`` `a ``\n" },
            { text: "a`b", markdown: "``a`b``\n" },
        ];

        for (const testCase of cases) {
            const doc = schema.nodes.doc.create(null, [
                schema.nodes.paragraph.create(null, [
                    schema.text(testCase.text, [
                        schema.marks.inline_code.create(),
                    ]),
                ]),
            ]);
            const markdown = serializeMarkdown(emptyParsedDocument(doc));
            const reparsed = parseMarkdown(markdown);

            expect(markdown).toBe(testCase.markdown);
            expect(reparsed.doc.child(0).type.name).toBe("paragraph");
            expect(reparsed.doc.child(0).child(0).text).toBe(testCase.text);
            expect(reparsed.doc.child(0).child(0).marks[0]?.type.name).toBe(
                "inline_code",
            );
        }
    });

    it("round-trips combined strong and inline code marks", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("x", [
                    schema.marks.strong.create(),
                    schema.marks.inline_code.create(),
                ]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("**`x`**\n");
        expect(reparsed.doc.child(0).child(0).text).toBe("x");
        expect(reparsed.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "inline_code",
        ]);
    });

    it("round-trips outer marks on generated inline atom nodes", () => {
        const schema = mdxEditorSchema;
        const strong = schema.marks.strong.create();
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.nodes.math_inline.create({ latex: "x" }).mark([strong]),
                schema.text(" "),
                schema.nodes.footnote_ref.create({ label: "n" }).mark([strong]),
                schema.text(" "),
                schema.nodes.image.create({ src: "src", alt: "alt" }).mark([
                    strong,
                ]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("**$x$** **[^n]** **![alt](src)**\n");
        expect(reparsed.doc.child(0).child(0).type.name).toBe("math_inline");
        expect(reparsed.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
        expect(reparsed.doc.child(0).child(2).type.name).toBe("footnote_ref");
        expect(reparsed.doc.child(0).child(2).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
        expect(reparsed.doc.child(0).child(4).type.name).toBe("image");
        expect(reparsed.doc.child(0).child(4).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
        ]);
    });

    it("round-trips parsed marks on inline atom nodes", () => {
        const parsed = parseMarkdown("**$x$** **[^n]** **![alt](src)**");
        const markdown = serializeMarkdown(emptyParsedDocument(parsed.doc));

        expect(markdown).toBe("**$x$** **[^n]** **![alt](src)**\n");
    });

    it("does not reuse source when removing marks from inline atom nodes", () => {
        const parsed = parseMarkdown("**$x$**\n\n**[^n]**\n");
        const mathParagraph = parsed.doc.child(0);
        const footnoteParagraph = parsed.doc.child(1);
        const mathWithoutStrong = mathParagraph.type.create(
            mathParagraph.attrs,
            mathParagraph.child(0).mark([]),
        );
        const footnoteWithoutStrong = footnoteParagraph.type.create(
            footnoteParagraph.attrs,
            footnoteParagraph.child(0).mark([]),
        );
        const editedDoc = parsed.doc.copy(
            parsed.doc.content
                .replaceChild(0, mathWithoutStrong)
                .replaceChild(1, footnoteWithoutStrong),
        );

        expect(serializeMarkdown({ ...parsed, doc: editedDoc })).toBe(
            "$x$\n\n[^n]\n",
        );
    });

    it("does not reuse source when adding marks to inline atom nodes", () => {
        const parsed = parseMarkdown("$x$\n\n[^n]\n");
        const strong = mdxEditorSchema.marks.strong.create();
        const mathParagraph = parsed.doc.child(0);
        const footnoteParagraph = parsed.doc.child(1);
        const mathWithStrong = mathParagraph.type.create(
            mathParagraph.attrs,
            mathParagraph.child(0).mark([strong]),
        );
        const footnoteWithStrong = footnoteParagraph.type.create(
            footnoteParagraph.attrs,
            footnoteParagraph.child(0).mark([strong]),
        );
        const editedDoc = parsed.doc.copy(
            parsed.doc.content
                .replaceChild(0, mathWithStrong)
                .replaceChild(1, footnoteWithStrong),
        );

        expect(serializeMarkdown({ ...parsed, doc: editedDoc })).toBe(
            "**$x$**\n\n**[^n]**\n",
        );
    });

    it("does not block-escape leading triple-backtick inline code spans", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("``", [schema.marks.inline_code.create()]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("``` `` ```\n");
        expect(reparsed.doc.child(0).type.name).toBe("paragraph");
        expect(reparsed.doc.child(0).child(0).text).toBe("``");
        expect(reparsed.doc.child(0).child(0).marks[0]?.type.name).toBe(
            "inline_code",
        );
    });

    it("does not bracket-escape inline code content", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("Code "),
                schema.text(String.raw`a[b]\c`, [schema.marks.inline_code.create()]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            String.raw`Code ` + "`" + String.raw`a[b]\c` + "`\n",
        );
    });

    it("serializes inline marks inside table cells", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.table.create(
                { alignments: [] },
                schema.nodes.table_row.create(null, [
                    schema.nodes.table_header.create(null, [
                        schema.text("Head", [schema.marks.strong.create()]),
                    ]),
                    schema.nodes.table_cell.create(null, [
                        schema.text("Cell", [schema.marks.strong.create()]),
                    ]),
                ]),
            ),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "| **Head** | **Cell** |\n|---|---|\n",
        );
    });

    it("escapes table cell pipes so edited cells remain structured after reload", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.table.create(
                { alignments: [] },
                [
                    schema.nodes.table_row.create(null, [
                        schema.nodes.table_header.create(null, schema.text("A")),
                        schema.nodes.table_header.create(null, schema.text("B")),
                    ]),
                    schema.nodes.table_row.create(null, [
                        schema.nodes.table_cell.create(null, schema.text("A | B")),
                        schema.nodes.table_cell.create(null, schema.text("C")),
                    ]),
                ],
            ),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown).doc.child(0);

        expect(markdown).toBe("| A | B |\n|---|---|\n| A \\| B | C |\n");
        expect(reparsed.type.name).toBe("table");
        expect(reparsed.child(1).child(0).textContent).toBe("A | B");
        expect(reparsed.child(1).child(1).textContent).toBe("C");
    });

    it("serializes inline marks inside list item paragraphs", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.bullet_list.create(null, [
                schema.nodes.list_item.create(null, [
                    schema.nodes.paragraph.create(null, [
                        schema.text("bold", [schema.marks.strong.create()]),
                    ]),
                ]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe("- **bold**\n");
    });

    it("serializes generated basic block structures", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.bullet_list.create(null, [
                schema.nodes.list_item.create(null, [
                    schema.nodes.paragraph.create(null, [schema.text("one")]),
                ]),
                schema.nodes.list_item.create(null, [
                    schema.nodes.paragraph.create(null, [schema.text("two")]),
                ]),
            ]),
            schema.nodes.ordered_list.create({ order: 3 }, [
                schema.nodes.list_item.create(null, [
                    schema.nodes.paragraph.create(null, [schema.text("three")]),
                ]),
                schema.nodes.list_item.create(null, [
                    schema.nodes.paragraph.create(null, [schema.text("four")]),
                ]),
            ]),
            schema.nodes.blockquote.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("quoted")]),
            ]),
            schema.nodes.code_block.create(
                { language: "ts", info: "ts live" },
                schema.text("const value = 1;\n"),
            ),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "- one\n- two\n\n3. three\n4. four\n\n> quoted\n\n```ts live\nconst value = 1;\n```\n",
        );
    });

    it("reuses unchanged parsed source for structured basic blocks", () => {
        const markdown =
            "- one\n* two\n\n3. three\n4. four\n\n> quoted\n>\n> again\n\n```ts live\nconst value = 1;\n```\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("serializes inline marks inside callout paragraphs", () => {
        const schema = mdxEditorSchema;
        const doc = schema.nodes.doc.create(null, [
            schema.nodes.callout.create(
                { kind: "NOTE", title: null },
                schema.nodes.paragraph.create(null, [
                    schema.text("bold", [schema.marks.strong.create()]),
                ]),
            ),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "> [!NOTE]\n> **bold**\n",
        );
    });

    it("round-trips links whose href contains closing parentheses", () => {
        const markdown = String.raw`[docs](https://example.com/a\)b)\n`;
        const parsed = parseMarkdown(markdown);

        expect(parsed.doc.child(0).child(0).marks[0]?.attrs.href).toBe(
            "https://example.com/a)b",
        );
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("round-trips links whose title contains escaped quotes", () => {
        const markdown = String.raw`[docs](https://example.com "A \"quoted\" title")\n`;
        const parsed = parseMarkdown(markdown);

        expect(parsed.doc.child(0).child(0).marks[0]?.attrs.title).toBe(
            'A "quoted" title',
        );
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("round-trips normal link and image title backslashes", () => {
        const schema = mdxEditorSchema;
        const linkDoc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text("docs", [
                    schema.marks.link.create({
                        href: "https://example.com",
                        title: String.raw`a\b`,
                    }),
                ]),
            ]),
        ]);
        const imageDoc = schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.nodes.image.create({
                    src: "image.png",
                    alt: "Alt",
                    title: String.raw`a\b`,
                }),
            ]),
        ]);

        const linkMarkdown = serializeMarkdown(emptyParsedDocument(linkDoc));
        const imageMarkdown = serializeMarkdown(emptyParsedDocument(imageDoc));
        const reparsedLink = parseMarkdown(linkMarkdown);
        const reparsedImage = parseMarkdown(imageMarkdown);

        expect(linkMarkdown).toBe(String.raw`[docs](https://example.com "a\\b")` + "\n");
        expect(imageMarkdown).toBe(String.raw`![Alt](image.png "a\\b")` + "\n");
        expect(reparsedLink.doc.child(0).child(0).marks[0]?.attrs.title).toBe(
            String.raw`a\b`,
        );
        expect(reparsedImage.doc.child(0).child(0).attrs.title).toBe(
            String.raw`a\b`,
        );
    });

    it("serializes one normal link spanning multiple text nodes once", () => {
        const link = mdxEditorSchema.marks.link.create({
            href: "https://x.test",
        });
        const strong = mdxEditorSchema.marks.strong.create();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("bold", [link, strong]),
                mdxEditorSchema.text(" tail", [link]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "[**bold** tail](https://x.test)\n",
        );
    });

    it("round-trips math inside normal link labels", () => {
        const parsed = parseMarkdown("[eq $x$](https://x.test)");
        const markdown = serializeMarkdown(emptyParsedDocument(parsed.doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[eq $x$](https://x.test)\n");
        expect(reparsed.doc.child(0).child(0).marks[0]?.type.name).toBe("link");
        expect(reparsed.doc.child(0).child(1).type.name).toBe("math_inline");
        expect(reparsed.doc.child(0).child(1).marks[0]?.type.name).toBe("link");
    });

    it("round-trips image and footnote refs inside normal link labels", () => {
        const link = mdxEditorSchema.marks.link.create({
            href: "https://x.test",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("see ", [link]),
                mdxEditorSchema.nodes.footnote_ref
                    .create({ label: "n" })
                    .mark([link]),
                mdxEditorSchema.text(" ", [link]),
                mdxEditorSchema.nodes.image
                    .create({ src: "src", alt: "alt" })
                    .mark([link]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[see [^n] ![alt](src)](https://x.test)\n");
        expect(reparsed.doc.child(0).child(0).marks[0]?.type.name).toBe("link");
        expect(reparsed.doc.child(0).child(1).type.name).toBe("footnote_ref");
        expect(reparsed.doc.child(0).child(1).marks[0]?.type.name).toBe("link");
        expect(reparsed.doc.child(0).child(3).type.name).toBe("image");
        expect(reparsed.doc.child(0).child(3).marks[0]?.type.name).toBe("link");
    });

    it("round-trips math inside wikilink labels", () => {
        const parsed = parseMarkdown("[[Target|eq $x$]]");
        const markdown = serializeMarkdown(emptyParsedDocument(parsed.doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[[Target|eq $x$]]\n");
        expect(reparsed.doc.child(0).child(0).marks[0]?.type.name).toBe("link");
        expect(reparsed.doc.child(0).child(1).type.name).toBe("math_inline");
        expect(reparsed.doc.child(0).child(1).marks[0]?.type.name).toBe("link");
    });

    it("round-trips strong and emphasis inside normal link labels", () => {
        const parsed = parseMarkdown("[**bold** *em*](https://x.test)");
        const markdown = serializeMarkdown(emptyParsedDocument(parsed.doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[**bold** *em*](https://x.test)\n");
        expect(reparsed.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "link",
        ]);
        expect(reparsed.doc.child(0).child(2).marks.map((mark) => mark.type.name)).toEqual([
            "emphasis",
            "link",
        ]);
    });

    it("serializes one wikilink spanning multiple text nodes once", () => {
        const link = mdxEditorSchema.marks.link.create({
            href: "mdx-wikilink:Target%7CBold%20tail",
        });
        const strong = mdxEditorSchema.marks.strong.create();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("Bold", [link, strong]),
                mdxEditorSchema.text(" tail", [link]),
            ]),
        ]);

        expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(
            "[[Target|**Bold** tail]]\n",
        );
    });

    it("round-trips nested marks inside normal link labels", () => {
        const link = mdxEditorSchema.marks.link.create({
            href: "https://x.test",
        });
        const strong = mdxEditorSchema.marks.strong.create();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("bold", [link, strong]),
                mdxEditorSchema.text(" tail", [link]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[**bold** tail](https://x.test)\n");
        expect(reparsed.doc.child(0).textContent).toBe("bold tail");
        expect(reparsed.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "link",
        ]);
        expect(reparsed.doc.child(0).child(1).marks.map((mark) => mark.type.name)).toEqual([
            "link",
        ]);
    });

    it("round-trips nested marks inside wikilink labels", () => {
        const link = mdxEditorSchema.marks.link.create({
            href: "mdx-wikilink:Target%7C**Bold**%20tail",
        });
        const strong = mdxEditorSchema.marks.strong.create();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("Bold", [link, strong]),
                mdxEditorSchema.text(" tail", [link]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[[Target|**Bold** tail]]\n");
        expect(reparsed.doc.child(0).textContent).toBe("Bold tail");
        expect(reparsed.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual([
            "strong",
            "link",
        ]);
        expect(reparsed.doc.child(0).child(1).marks.map((mark) => mark.type.name)).toEqual([
            "link",
        ]);
    });

    it("serializes link hrefs containing spaces as angle-bracket hrefs", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("docs", [
                    mdxEditorSchema.marks.link.create({
                        href: "docs/My File.md",
                    }),
                ]),
            ]),
        ]);
        const markdown = serializeMarkdown(emptyParsedDocument(doc));
        const reparsed = parseMarkdown(markdown);

        expect(markdown).toBe("[docs](<docs/My File.md>)\n");
        expect(reparsed.doc.child(0).child(0).marks[0]?.attrs.href).toBe(
            "docs/My File.md",
        );
    });

    it("escapes paragraph line starts that would reparse as block syntax", () => {
        const schema = mdxEditorSchema;
        const cases = [
            { text: "# not heading", markdown: "\\# not heading\n" },
            { text: "- not list", markdown: "\\- not list\n" },
            { text: "1. not list", markdown: "\\1. not list\n" },
            { text: "- [x] not task", markdown: "\\- \\[x\\] not task\n" },
            { text: "> not quote", markdown: "\\> not quote\n" },
            { text: "```not fence", markdown: "\\`\\`\\`not fence\n" },
            { text: "| not | table |", markdown: "\\| not | table |\n" },
        ];

        for (const testCase of cases) {
            const doc = schema.nodes.doc.create(null, [
                schema.nodes.paragraph.create(null, [
                    schema.text(testCase.text),
                ]),
            ]);
            const markdown = serializeMarkdown(emptyParsedDocument(doc));
            const reparsed = parseMarkdown(markdown);

            expect(markdown).toBe(testCase.markdown);
            expect(reparsed.doc.child(0).type.name).toBe("paragraph");
            expect(reparsed.doc.child(0).textContent).toBe(testCase.text);
        }
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

    it("reuses original source for unchanged source-preserved opaque blocks", () => {
        const markdown = "> [!NOTE]\n> Keep this.\n\n";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.opaque_block.create(
                {
                    reason: "source-preserved",
                    sourceId: "source-0",
                },
                mdxEditorSchema.text("> [!NOTE]\n> Keep this."),
            ),
        ]);

        expect(
            serializeMarkdown({
                doc,
                originalMarkdown: markdown,
                sourceSlices: [
                    {
                        id: "source-0",
                        range: sourceRange(0, markdown.length),
                        text: markdown,
                    },
                ],
                diagnostics: [],
            }),
        ).toBe("> [!NOTE]\n> Keep this.\n");
    });

    it("does not reuse original source for edited source-preserved opaque blocks", () => {
        const markdown = "> [!NOTE]\n> Keep this.\n\n";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.opaque_block.create(
                {
                    reason: "source-preserved",
                    sourceId: "source-0",
                },
                mdxEditorSchema.text("> [!NOTE]\n> Changed this."),
            ),
        ]);

        expect(
            serializeMarkdown({
                doc,
                originalMarkdown: markdown,
                sourceSlices: [
                    {
                        id: "source-0",
                        range: sourceRange(0, markdown.length),
                        text: markdown,
                    },
                ],
                diagnostics: [],
            }),
        ).toBe("> [!NOTE]\n> Changed this.\n");
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
