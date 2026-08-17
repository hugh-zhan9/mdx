// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../index";
import { proseSafeUnsafe } from "./remark-escapes";
import { readAuthoredEscapes, writeAuthoredEscapes } from "./syntax";

describe("readAuthoredEscapes", () => {
    it("reads the escape the author wrote", () => {
        expect(readAuthoredEscapes("[a]", "\\[a]", 0, 4)).toEqual([
            { escaped: true, value: "[", from: 0, to: 2 },
            { escaped: false, value: "a]", from: 2, to: 4 },
        ]);
    });

    it("reads a run of escapes as one run", () => {
        expect(readAuthoredEscapes("[[", "\\[\\[", 0, 4)).toEqual([
            { escaped: true, value: "[[", from: 0, to: 4 },
        ]);
    });

    it("reports prose the author never escaped as prose", () => {
        expect(readAuthoredEscapes("array[0]", "array[0]", 0, 8)).toEqual([
            { escaped: false, value: "array[0]", from: 0, to: 8 },
        ]);
    });

    it("reads a span that starts inside a longer document", () => {
        const source = "lead \\* tail";
        expect(readAuthoredEscapes("* tail", source, 5, source.length)).toEqual([
            { escaped: true, value: "*", from: 5, to: 7 },
            { escaped: false, value: " tail", from: 7, to: 12 },
        ]);
    });

    it("forgives the container decoration on a continuation line", () => {
        const source = "> one\n> two \\[x]";
        // The runs break where the marker was dropped: those two characters
        // belong to the blockquote, not to the text, and nothing in the value
        // stands for them.
        expect(readAuthoredEscapes("one\ntwo [x]", source, 2, source.length)).toEqual(
            [
                { escaped: false, value: "one\n", from: 2, to: 6 },
                { escaped: false, value: "two ", from: 8, to: 12 },
                { escaped: true, value: "[", from: 12, to: 14 },
                { escaped: false, value: "x]", from: 14, to: 16 },
            ],
        );
    });

    it("refuses a value its source cannot explain", () => {
        // `&amp;` reaches the value as `&`: the escape positions in a node the
        // parser rewrote are unknowable, so nothing is claimed for it.
        expect(readAuthoredEscapes("A & B", "A &amp; B", 0, 9)).toBeNull();
    });

    it("refuses to drop anything but container decoration", () => {
        const source = "one\nx two";
        expect(readAuthoredEscapes("one\ntwo", source, 0, source.length)).toBeNull();
    });

    it("refuses a span that leaves source unaccounted for", () => {
        expect(readAuthoredEscapes("ab", "abc", 0, 3)).toBeNull();
    });
});

describe("writeAuthoredEscapes", () => {
    it("writes a backslash before every punctuation character", () => {
        expect(writeAuthoredEscapes("[[")).toBe("\\[\\[");
        expect(writeAuthoredEscapes("*")).toBe("\\*");
    });

    it("leaves a character no backslash can escape alone", () => {
        expect(writeAuthoredEscapes("a")).toBe("a");
    });
});

describe("proseSafeUnsafe", () => {
    it("drops a pattern that only guards ordinary prose", () => {
        expect(
            proseSafeUnsafe([{ character: "[", inConstruct: "phrasing" }]),
        ).toEqual([]);
    });

    it("keeps a pattern that fires at the start of a line", () => {
        const atBreak = { atBreak: true, character: "#" };
        expect(proseSafeUnsafe([atBreak])).toEqual([atBreak]);
    });

    it("keeps a pattern scoped to a construct", () => {
        const inCell = { character: "|", inConstruct: "tableCell" };
        expect(proseSafeUnsafe([inCell])).toEqual([inCell]);
    });

    it("keeps the construct half of a pattern that names both", () => {
        // GFM's footnote extension scopes `[` to label, phrasing and reference
        // in one entry. Prose is the only part of that this layer takes over.
        expect(
            proseSafeUnsafe([
                { character: "[", inConstruct: ["label", "phrasing", "reference"] },
            ]),
        ).toEqual([{ character: "[", inConstruct: ["label", "reference"] }]);
    });

    it("keeps the characters whose escape decides which character it is", () => {
        const identity = [
            { character: "\\", inConstruct: "phrasing" },
            { character: "&", inConstruct: "phrasing" },
            { character: " ", inConstruct: "phrasing" },
        ];
        expect(proseSafeUnsafe(identity)).toEqual(identity);
    });
});

const EDIT_ANCHOR = "Edit anchor.\n\n";
const EDITED_ANCHOR = "Edit the anchor.\n\n";
/** Offset of `anchor` inside `EDIT_ANCHOR`, the one place every test edits. */
const EDIT_OFFSET = EDIT_ANCHOR.indexOf("anchor");

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string): Promise<{
    host: MilkdownEditorHost;
    root: HTMLElement;
}> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return { host, root };
}

/**
 * Serializes `markdown` after an edit that lands outside it.
 *
 * The host echoes its input until a transaction dirties the document, so an
 * assertion about what the writer produces has to edit first. The edit goes
 * into a leading anchor paragraph, never into the fixture, so the bytes that
 * come back for the fixture are the writer's own.
 */
async function roundTrip(markdown: string): Promise<string> {
    const { host } = await mount(EDIT_ANCHOR + markdown);
    expect(
        host.replaceSourceRange(
            { anchor: EDIT_OFFSET, head: EDIT_OFFSET },
            "the ",
        ),
        "the anchor edit was refused",
    ).toBe(true);
    host.flush();
    const serialized = host.getMarkdown();
    expect(serialized.startsWith(EDITED_ANCHOR)).toBe(true);
    return serialized.slice(EDITED_ANCHOR.length);
}

/** Serializes after inserting `text` into `markdown` at `at`, as an edit does. */
async function insertInto(
    markdown: string,
    at: number,
    text: string,
): Promise<string> {
    const { host } = await mount(markdown);
    expect(
        host.replaceSourceRange({ anchor: at, head: at }, text),
        "the insertion was refused",
    ).toBe(true);
    host.flush();
    return host.getMarkdown();
}

describe("prose the author never escaped comes back unescaped", () => {
    it("leaves a bracket in prose alone", async () => {
        expect(await roundTrip("array[0] value\n")).toBe("array[0] value\n");
    });

    it("leaves an asterisk in prose alone", async () => {
        expect(await roundTrip("2 * 3 = 6\n")).toBe("2 * 3 = 6\n");
    });

    it("leaves an underscored identifier alone", async () => {
        expect(await roundTrip("snake_case_word here\n")).toBe(
            "snake_case_word here\n",
        );
    });

    it("leaves it alone in a heading, a quote and a table cell", async () => {
        expect(await roundTrip("# head_ing here\n")).toBe("# head_ing here\n");
        expect(await roundTrip("> quote_d here\n")).toBe("> quote_d here\n");
        expect(await roundTrip("| a_b |\n| --- |\n| c_d |\n")).toBe(
            "| a_b |\n| --- |\n| c_d |\n",
        );
    });

    it("leaves it alone inside a link's own text", async () => {
        expect(await roundTrip("A [snake_case](docs/a_b.md) link\n")).toBe(
            "A [snake_case](docs/a_b.md) link\n",
        );
    });

    it("leaves an underscore that could open or close emphasis alone", async () => {
        // Whether this one opens emphasis depends on the rest of the document,
        // which is exactly the question the author already answered by not
        // escaping it.
        expect(await roundTrip("trailing under_ here\n")).toBe(
            "trailing under_ here\n",
        );
        expect(await roundTrip("**bold**_tail here\n")).toBe(
            "**bold**_tail here\n",
        );
    });

    it("leaves prose on a continuation line alone", async () => {
        expect(await roundTrip("one\ntwo[0] three\n")).toBe(
            "one\ntwo[0] three\n",
        );
    });
});

describe("an escape the author wrote comes back", () => {
    it("keeps escaped delimiters escaped", async () => {
        expect(await roundTrip("a \\* b \\_ c here\n")).toBe(
            "a \\* b \\_ c here\n",
        );
    });

    it("keeps a literal link from parsing back as a link", async () => {
        const settled = await roundTrip("See \\[a](b) literal\n");
        expect(settled).toBe("See \\[a](b) literal\n");
        const { root } = await mount(settled);
        expect(root.querySelector("a")).toBeNull();
        expect(root.textContent).toContain("See [a](b) literal");
    });

    it("keeps an escape whose bracket matches a definition", async () => {
        // The definition makes the bracket anything but inert: dropping the
        // escape would turn the author's literal text into a link.
        const document = "See \\[ref] literal.\n\n[ref]: http://x\n";
        expect(await roundTrip(document)).toBe(document);
        const { root } = await mount(document);
        expect(root.querySelector("a")).toBeNull();
    });

    it("keeps a run of escaped brackets from becoming a wikilink", async () => {
        const settled = await roundTrip("Not \\[\\[Target]] here\n");
        expect(settled).toBe("Not \\[\\[Target]] here\n");
        const { root } = await mount(settled);
        expect(root.querySelector("a[data-mdx-wikilink]")).toBeNull();
    });

    it("keeps an escape on a continuation line", async () => {
        expect(await roundTrip("one\ntwo \\[x] three\n")).toBe(
            "one\ntwo \\[x] three\n",
        );
    });

    it("keeps an escape inside a blockquote and a list item", async () => {
        expect(await roundTrip("> quoted \\[x] here\n")).toBe(
            "> quoted \\[x] here\n",
        );
        expect(await roundTrip("- item \\[x] here\n")).toBe("- item \\[x] here\n");
    });

    it("keeps an escape inside emphasis", async () => {
        expect(await roundTrip("A *span \\[x] here* now\n")).toBe(
            "A *span \\[x] here* now\n",
        );
    });

    it("keeps an escaped pipe inside a table cell", async () => {
        expect(await roundTrip("| a | b |\n| - | - |\n| c \\| d | e |\n")).toContain(
            "c \\| d",
        );
    });

    it("keeps an escape a family handed back as text", async () => {
        // The math family demotes a `$…$` span the Pandoc rules reject into
        // text rebuilt from its own source. That text only exists after every
        // other transformer has run, and it carries the author's escape.
        expect(await roundTrip("Prices $5 \\[a] and $10 today.\n")).toBe(
            "Prices $5 \\[a] and $10 today.\n",
        );
    });

    it("keeps each emphasis marker as it was written", async () => {
        expect(await roundTrip("*star* and _under_ here\n")).toBe(
            "*star* and _under_ here\n",
        );
    });

    it("keeps a wikilink unescaped and still a wikilink", async () => {
        expect(await roundTrip("See [[Target Page]] here\n")).toBe(
            "See [[Target Page]] here\n",
        );
        const { root } = await mount("See [[Target Page]] here\n");
        expect(root.querySelector("a[data-mdx-wikilink]")).not.toBeNull();
    });

    it("keeps a dangling footnote call unescaped", async () => {
        expect(await roundTrip("A dangling [^a] call here\n")).toBe(
            "A dangling [^a] call here\n",
        );
    });

    it("settles on the same bytes a second time", async () => {
        const once = await roundTrip("a \\* b [0] c\n");
        expect(await roundTrip(once)).toBe(once);
    });
});

describe("text with no source keeps the writer's own escaping", () => {
    it("writes an inserted bracket as it was inserted", async () => {
        const result = await insertInto("Lead here.\n", "Lead ".length, "array[0] ");
        expect(result).toBe("Lead array[0] here.\n");
    });

    it("escapes a backslash inserted in front of punctuation", async () => {
        // `a\*b` written as it stands would come back as `a*b`, so the
        // backslash the user actually typed is the one that needs escaping.
        const result = await insertInto("Lead here.\n", "Lead ".length, "a\\*b ");
        expect(result).toBe("Lead a\\\\*b here.\n");
    });

    it("escapes a pipe inserted into a table cell", async () => {
        // Nothing about the cell delimiter is the author's prose: an unescaped
        // pipe here would split the row into a column that was never there.
        const table = "| a | b |\n| - | - |\n| c | d |\n";
        const result = await insertInto(table, table.indexOf("| c |") + 3, "|");
        expect(result).toContain("c\\|");
        expect(result.split("\n")).toHaveLength(4);
    });

    it("does not extend the author's escape onto what is typed next to it", async () => {
        // The insertion lands directly after the escaped bracket. Inheriting
        // the mark there would put a backslash in front of a character the
        // author never escaped.
        const document = "See \\[x] here.\n";
        const result = await insertInto(document, document.indexOf("x"), "*");
        expect(result).toBe("See \\[*x] here.\n");
    });

    it("escapes an inserted character that would start a block", async () => {
        // Whether a `#` opens a heading is not a question about the author's
        // prose: it depends on the line it lands at the start of, and the
        // serializer is the one putting it there.
        const result = await insertInto("Lead here.\n", 0, "# ");
        expect(result).toBe("\\# Lead here.\n");
    });

    it("escapes an inserted bracket inside a link's own label", async () => {
        // Inserted between two characters of the label, so it really is inside
        // it: an insertion at the boundary lands outside the link mark and
        // would be prose, where the same bracket is written as it stands.
        const document = "A [label](http://x) here.\n";
        const result = await insertInto(document, document.indexOf("label") + 2, "[");
        expect(result).toBe("A [la\\[bel](http://x) here.\n");
    });

    it("escapes an inserted ampersand that would start a reference", async () => {
        // `&amp;` written as it stands comes back as `&`, which is not the text
        // that was inserted.
        const result = await insertInto("Lead here.\n", "Lead ".length, "&amp; ");
        expect(result).toBe("Lead \\&amp; here.\n");
    });

    it("escapes an inserted backslash that would become a line break", async () => {
        const result = await insertInto("one\ntwo\n", 3, "\\");
        expect(result).toBe("one\\\\\ntwo\n");
    });

    it("keeps an inserted space at the end of a line from disappearing", async () => {
        // Written as it stands, a space against a line ending is dropped by the
        // next parse, and two of them are a hard break.
        const result = await insertInto("one\ntwo\n", 3, " ");
        expect(result).toBe("one&#x20;\ntwo\n");
    });

    it("falls back to full escaping when the source cannot be read", async () => {
        // `&amp;` reaches the value decoded, so this paragraph's provenance is
        // unknowable — and the fallback still writes the author's own escape.
        const settled = await roundTrip("A &amp; \\[x] B\n");
        expect(settled).toBe("A & \\[x] B\n");
        const { root } = await mount(settled);
        expect(root.querySelector("a")).toBeNull();
    });
});
