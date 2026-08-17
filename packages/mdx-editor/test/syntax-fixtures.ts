/**
 * Behavior oracles for the MDX syntax layer.
 *
 * Each fixture states what must survive a parse → edit → serialize → reopen
 * cycle. `preservedSlices` lists substrings that must appear byte-for-byte in
 * the serialized output when the fixture is not edited; they are compared as
 * raw bytes including line endings, never as rendered text.
 */
export type RoundTripAnchor = "before" | "after";

export interface SyntaxFixture {
    name: string;
    /** Syntax family the fixture exercises. */
    kind:
        | "frontmatter"
        | "footnote"
        | "wikilink"
        | "mermaid"
        | "math"
        | "callout"
        | "html"
        | "reference"
        | "unknown"
        | "mixed";
    markdown: string;
    /** Substrings that must round-trip byte-for-byte when unedited. */
    preservedSlices: string[];
    /**
     * Where the edit that forces serialization goes. Defaults to `"before"`.
     *
     * The edit has to land outside the construct under test, and neither end
     * works for everything: a trailing paragraph is swallowed by a fence that
     * never closes, and a leading one moves frontmatter off line 1, where it
     * stops being frontmatter.
     */
    anchor?: RoundTripAnchor;
}

export const frontmatterFixtures: SyntaxFixture[] = [
    {
        name: "yaml frontmatter with nested keys",
        kind: "frontmatter",
        markdown: "---\ntitle: Example\ntags:\n  - a\n  - b\n---\n\nBody.\n",
        preservedSlices: ["---\ntitle: Example\ntags:\n  - a\n  - b\n---"],
        anchor: "after",
    },
    {
        name: "frontmatter key order is not rearranged",
        kind: "frontmatter",
        markdown: "---\nzebra: 1\nalpha: 2\n---\n\nBody.\n",
        preservedSlices: ["zebra: 1\nalpha: 2"],
        anchor: "after",
    },
    {
        name: "empty frontmatter block",
        kind: "frontmatter",
        markdown: "---\n---\n\nBody.\n",
        preservedSlices: ["---\n---"],
        anchor: "after",
    },
];

export const footnoteFixtures: SyntaxFixture[] = [
    {
        name: "reference and definition",
        kind: "footnote",
        markdown: "Text with a note[^n1].\n\n[^n1]: The note body.\n",
        preservedSlices: ["[^n1]"],
    },
    {
        name: "multi-line indented definition",
        kind: "footnote",
        markdown:
            "Ref[^long].\n\n[^long]: First line.\n    Second line.\n    Third line.\n",
        preservedSlices: ["[^long]"],
    },
];

export const wikilinkFixtures: SyntaxFixture[] = [
    {
        name: "bare target",
        kind: "wikilink",
        markdown: "See [[Target Page]] for details.\n",
        preservedSlices: ["[[Target Page]]"],
    },
    {
        name: "target with alias",
        kind: "wikilink",
        markdown: "See [[Target Page|the page]] for details.\n",
        preservedSlices: ["[[Target Page|the page]]"],
    },
    {
        name: "wikilink inside inline code is not a link",
        kind: "wikilink",
        markdown: "Literal `[[Not A Link]]` stays code.\n",
        preservedSlices: ["`[[Not A Link]]`"],
    },
];

export const mermaidFixtures: SyntaxFixture[] = [
    {
        name: "graph diagram",
        kind: "mermaid",
        markdown: "```mermaid\ngraph TD\n  A[Start] --> B{Choice}\n```\n",
        preservedSlices: ["graph TD\n  A[Start] --> B{Choice}"],
    },
    {
        name: "syntactically invalid diagram still keeps its source",
        kind: "mermaid",
        markdown: "```mermaid\nthis is not a diagram (((\n```\n",
        preservedSlices: ["this is not a diagram ((("],
    },
];

export const mathFixtures: SyntaxFixture[] = [
    {
        name: "inline math",
        kind: "math",
        markdown: "Euler wrote $e^{i\\pi} + 1 = 0$ here.\n",
        preservedSlices: ["$e^{i\\pi} + 1 = 0$"],
    },
    {
        name: "display math",
        kind: "math",
        markdown: "$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n",
        preservedSlices: ["\\int_0^1 x^2 \\, dx = \\frac{1}{3}"],
    },
    {
        name: "invalid latex keeps its source",
        kind: "math",
        markdown: "Broken $\\frac{1}{$ math.\n",
        preservedSlices: ["$\\frac{1}{$"],
    },
];

export const calloutFixtures: SyntaxFixture[] = [
    {
        name: "warning callout",
        kind: "callout",
        markdown: "> [!WARNING]\n> Be careful here.\n",
        preservedSlices: ["[!WARNING]"],
    },
    {
        name: "callout with title",
        kind: "callout",
        markdown: "> [!NOTE] Custom title\n> Body line.\n",
        preservedSlices: ["[!NOTE] Custom title"],
    },
    {
        name: "unknown callout type is preserved",
        kind: "callout",
        markdown: "> [!BANANA]\n> Unrecognized type.\n",
        preservedSlices: ["[!BANANA]"],
    },
];

/**
 * HTML fixtures double as the security corpus. Every one of these must render
 * through a sanitized, inert preview: no script execution, no event handlers,
 * no `javascript:` navigation. The raw source stays editable and authoritative.
 */
export const htmlFixtures: SyntaxFixture[] = [
    {
        name: "benign block html",
        kind: "html",
        markdown: '<div class="note">\n  <p>Hello.</p>\n</div>\n',
        preservedSlices: ['<div class="note">\n  <p>Hello.</p>\n</div>'],
    },
    {
        name: "inline html",
        kind: "html",
        markdown: "Press <kbd>Cmd</kbd> + <kbd>Z</kbd>.\n",
        preservedSlices: ["<kbd>Cmd</kbd>"],
    },
    {
        name: "script tag",
        kind: "html",
        markdown: '<script>window.__pwned = true;</script>\n',
        preservedSlices: ["<script>window.__pwned = true;</script>"],
    },
    {
        name: "inline event handler attribute",
        kind: "html",
        markdown: '<img src="x" onerror="window.__pwned = true">\n',
        preservedSlices: ['onerror="window.__pwned = true"'],
    },
    {
        name: "javascript url",
        kind: "html",
        markdown: '<a href="javascript:window.__pwned=true">click</a>\n',
        preservedSlices: ["javascript:window.__pwned=true"],
    },
    {
        name: "svg script payload",
        kind: "html",
        markdown: "<svg><script>window.__pwned = true;</script></svg>\n",
        preservedSlices: ["<svg><script>window.__pwned = true;</script></svg>"],
    },
    {
        name: "iframe payload",
        kind: "html",
        markdown: '<iframe src="javascript:window.__pwned=true"></iframe>\n',
        preservedSlices: ["<iframe"],
    },
];

/**
 * Reference-style links and their definitions.
 *
 * These belong to the preservation layer rather than to WYSIWYG structure.
 * Inlining `[ref][1]` into `[ref](http://x)` copies a destination the author
 * wrote once into every place that referenced it, and deleting a definition
 * nothing points at throws away a target for a section not yet written; both
 * are content loss, and neither is recoverable from the file that results.
 */
export const referenceLinkFixtures: SyntaxFixture[] = [
    {
        name: "full reference and its definition",
        kind: "reference",
        markdown: "See [ref][1] here.\n\n[1]: http://x\n",
        preservedSlices: ["[ref][1]", "[1]: http://x"],
    },
    {
        name: "collapsed reference",
        kind: "reference",
        markdown: "Collapsed [ref][].\n\n[ref]: http://x\n",
        preservedSlices: ["[ref][]", "[ref]: http://x"],
    },
    {
        name: "shortcut reference",
        kind: "reference",
        markdown: "A [shortcut] link.\n\n[shortcut]: http://x\n",
        preservedSlices: ["[shortcut]", "[shortcut]: http://x"],
    },
    {
        name: "image reference",
        kind: "reference",
        markdown: "Image ![alt][1].\n\n[1]: http://x\n",
        preservedSlices: ["![alt][1]", "[1]: http://x"],
    },
    {
        name: "definition nothing references",
        kind: "reference",
        markdown: "Prose only.\n\n[unused]: http://x\n",
        preservedSlices: ["[unused]: http://x"],
    },
    {
        name: "adjacent definitions stay adjacent",
        kind: "reference",
        markdown: "[a][1] and [b][2].\n\n[1]: http://x\n[2]: http://y\n",
        preservedSlices: ["[1]: http://x\n[2]: http://y"],
    },
    {
        name: "definition carrying a title",
        kind: "reference",
        markdown: 'Titled [t][1].\n\n[1]: http://x "Title"\n',
        preservedSlices: ['[1]: http://x "Title"'],
    },
    {
        name: "definition inside a blockquote",
        kind: "reference",
        markdown: "> [q][1]\n>\n> [1]: http://x\n",
        preservedSlices: ["[q][1]"],
    },
];

export const unknownSyntaxFixtures: SyntaxFixture[] = [
    {
        name: "unclosed fence runs to end of file",
        kind: "unknown",
        markdown: "```unknownlang\nnever closed\n",
        preservedSlices: ["```unknownlang\nnever closed"],
    },
    {
        name: "unknown directive block",
        kind: "unknown",
        markdown: ":::spoiler\nHidden content.\n:::\n",
        preservedSlices: [":::spoiler\nHidden content.\n:::"],
    },
    {
        name: "unknown inline extension",
        kind: "unknown",
        markdown: "Text with {{macro:value}} inside.\n",
        preservedSlices: ["{{macro:value}}"],
    },
];

/**
 * Documents that put several plugins next to each other, so the registry's
 * ownership boundaries and priority order are exercised rather than assumed.
 */
export const mixedSyntaxFixtures: SyntaxFixture[] = [
    {
        name: "frontmatter above every other family",
        kind: "mixed",
        markdown: [
            "---",
            "title: Everything",
            "---",
            "",
            "# Heading",
            "",
            "Body with [[Wiki Link|alias]], math $a^2$, and a note[^n].",
            "",
            "> [!TIP]",
            "> A callout.",
            "",
            "```mermaid",
            "graph LR",
            "  A --> B",
            "```",
            "",
            '<div class="raw">kept</div>',
            "",
            ":::unknown",
            "fallback content",
            ":::",
            "",
            "[^n]: Note body.",
            "",
        ].join("\n"),
        preservedSlices: [
            "---\ntitle: Everything\n---",
            "[[Wiki Link|alias]]",
            "$a^2$",
            "[!TIP]",
            "graph LR\n  A --> B",
            '<div class="raw">kept</div>',
            ":::unknown\nfallback content\n:::",
        ],
        anchor: "after",
    },
    {
        name: "adjacent fallback blocks do not merge",
        kind: "mixed",
        markdown: ":::one\nfirst\n:::\n\n:::two\nsecond\n:::\n",
        preservedSlices: [":::one\nfirst\n:::", ":::two\nsecond\n:::"],
    },
    {
        name: "code fence containing other syntax stays literal",
        kind: "mixed",
        markdown: [
            "```md",
            "# Not a heading",
            "[[Not a wikilink]]",
            "> [!NOT] a callout",
            "$not math$",
            "```",
            "",
        ].join("\n"),
        preservedSlices: [
            "# Not a heading\n[[Not a wikilink]]\n> [!NOT] a callout\n$not math$",
        ],
    },
];

/**
 * Line-ending fidelity.
 *
 * remark normalizes every line ending to `\n` while parsing, so a document
 * arrives at the schema, at its preserved slices and at its code blocks holding
 * `\n` whatever the file used. A file written with CRLF keeps it because the
 * ending goes back on once, where the serializer's output leaves the host —
 * never inside the document, where a carriage return would survive into the
 * next serialization and be written a second time. The fenced fixture is the
 * one that catches that: an earlier attempt turned ```` ```\r\na\r\n```\r\n ````
 * into ```` ```\r\nxa\r\r\n```\r\n ````, compounding on every keystroke.
 */
export const lineEndingFixtures: SyntaxFixture[] = [
    {
        name: "crlf line endings survive unedited",
        kind: "unknown",
        markdown: ":::keep\r\nwindows line endings\r\n:::\r\n",
        preservedSlices: [":::keep\r\nwindows line endings\r\n:::"],
    },
    {
        name: "crlf inside a fenced code block is not doubled",
        kind: "unknown",
        markdown: "```js\r\nconst a = 1;\r\nconst b = 2;\r\n```\r\n",
        preservedSlices: ["const a = 1;\r\nconst b = 2;"],
    },
    {
        name: "crlf prose keeps its endings",
        kind: "unknown",
        markdown: "First paragraph.\r\n\r\nSecond paragraph.\r\n",
        preservedSlices: ["First paragraph.\r\n\r\nSecond paragraph."],
    },
];

export const allSyntaxFixtures: SyntaxFixture[] = [
    ...frontmatterFixtures,
    ...footnoteFixtures,
    ...wikilinkFixtures,
    ...mermaidFixtures,
    ...mathFixtures,
    ...calloutFixtures,
    ...htmlFixtures,
    ...referenceLinkFixtures,
    ...unknownSyntaxFixtures,
    ...mixedSyntaxFixtures,
    ...lineEndingFixtures,
];

/**
 * One document in the preservation-membership corpus.
 *
 * Membership in the preservation layer is a rule, not a list: any construct
 * whose unedited round-trip does not reproduce its original bytes belongs to
 * it. That makes the set checkable, and this corpus is the check — every entry
 * is opened, edited outside itself, serialized, and compared byte-for-byte.
 */
export interface RoundTripCase {
    name: string;
    markdown: string;
    /** Where the edit that forces serialization goes. Defaults to `"before"`. */
    anchor?: RoundTripAnchor;
}

/**
 * A construct that does not round-trip today and is not being fixed yet.
 *
 * This is a debt register, not a skip list. The round-trip test asserts that
 * every entry here still diverges, so an entry that becomes correct fails until
 * it is deleted: the list can only ever shrink, and it can never quietly hide a
 * regression that reintroduces a divergence someone already removed.
 */
export interface RoundTripException {
    name: string;
    reason: string;
}

/** CommonMark and GFM constructs the syntax fixtures above do not reach. */
const commonMarkRoundTripCases: RoundTripCase[] = [
    { name: "atx heading", markdown: "# Heading\n" },
    { name: "atx heading with closing sequence", markdown: "# Heading #\n" },
    { name: "setext heading level 1", markdown: "Heading\n=======\n" },
    { name: "setext heading level 2", markdown: "Heading\n-------\n" },
    { name: "all six heading levels", markdown: "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n" },
    { name: "thematic break with dashes", markdown: "---\n", anchor: "after" },
    { name: "thematic break with asterisks", markdown: "***\n" },
    { name: "thematic break with underscores", markdown: "___\n" },
    { name: "bullet list with dashes", markdown: "- one\n- two\n" },
    { name: "bullet list with asterisks", markdown: "* one\n* two\n" },
    { name: "bullet list with pluses", markdown: "+ one\n+ two\n" },
    { name: "ordered list with dots", markdown: "1. one\n2. two\n" },
    { name: "ordered list with parens", markdown: "1) one\n2) two\n" },
    { name: "ordered list starting past one", markdown: "3. three\n4. four\n" },
    { name: "nested bullet list", markdown: "- one\n  - inner\n- two\n" },
    { name: "loose list", markdown: "- one\n\n- two\n" },
    { name: "list item with two paragraphs", markdown: "- one\n\n  more\n" },
    { name: "task list", markdown: "- [ ] todo\n- [x] done\n" },
    { name: "empty list item", markdown: "- \n- two\n" },
    { name: "blockquote", markdown: "> quoted\n" },
    { name: "nested blockquote", markdown: "> outer\n>\n> > inner\n" },
    { name: "lazy blockquote continuation", markdown: "> one\ntwo\n" },
    { name: "backtick code fence", markdown: "```\nplain\n```\n" },
    { name: "tilde code fence", markdown: "~~~\nplain\n~~~\n" },
    { name: "code fence with a language", markdown: "```js\nconst a = 1;\n```\n" },
    { name: "indented code block", markdown: "    indented\n    code\n" },
    { name: "inline code", markdown: "Use `code` here.\n" },
    { name: "inline code with double backticks", markdown: "Use ``a ` b`` here.\n" },
    { name: "emphasis with asterisks", markdown: "Some *em* here.\n" },
    { name: "emphasis with underscores", markdown: "Some _em_ here.\n" },
    { name: "strong with asterisks", markdown: "Some **strong** here.\n" },
    { name: "strong with underscores", markdown: "Some __strong__ here.\n" },
    { name: "strikethrough", markdown: "Some ~~gone~~ here.\n" },
    { name: "autolink", markdown: "Go <http://example.test> now.\n" },
    { name: "gfm literal autolink", markdown: "Go http://example.test now.\n" },
    { name: "hard break as two spaces", markdown: "line one  \nline two\n" },
    { name: "hard break as a backslash", markdown: "line one\\\nline two\n" },
    { name: "soft line breaks", markdown: "one\ntwo\nthree\n" },
    { name: "consecutive blank lines", markdown: "a\n\n\nb\n" },
    { name: "named character reference", markdown: "A &amp; B\n" },
    { name: "numeric character reference", markdown: "A &#65; B\n" },
    { name: "escaped punctuation", markdown: "Not \\*emphasis\\* here.\n" },
    { name: "underscores inside a word", markdown: "snake_case_name here.\n" },
    { name: "asterisk in prose", markdown: "2 * 3 = 6\n" },
    { name: "bracket in prose", markdown: "array[0] value\n" },
    { name: "ampersand in prose", markdown: "Tom & Jerry\n" },
    { name: "angle brackets in prose", markdown: "1 < 2 > 0\n" },
    { name: "pipe in prose", markdown: "a | b\n" },
    { name: "image", markdown: "![alt](http://x)\n" },
    { name: "image with a title", markdown: '![alt](http://x "T")\n' },
    { name: "link with a title", markdown: 'A [l](http://x "T") here.\n' },
    { name: "link with an angled destination", markdown: "A [l](<http://x y>) here.\n" },
    { name: "gfm table", markdown: "| a | b |\n| - | - |\n| 1 | 2 |\n" },
    { name: "gfm table with alignment", markdown: "| a | b |\n| :- | -: |\n| 1 | 2 |\n" },
    { name: "html comment", markdown: "<!-- note -->\n" },
    {
        name: "several block kinds in a row",
        markdown: "Para.\n\n> Quote.\n\n- List.\n\n```\ncode\n```\n",
    },
];

/**
 * Every document the round-trip rule is checked against.
 *
 * The syntax fixtures are included rather than restated: a construct that has a
 * behavior oracle above must also satisfy the membership rule, and one corpus
 * means a family cannot be exercised in one place and forgotten in the other.
 */
export const roundTripCorpus: RoundTripCase[] = [
    ...commonMarkRoundTripCases,
    ...allSyntaxFixtures.map((fixture) => ({
        name: `${fixture.kind}: ${fixture.name}`,
        markdown: fixture.markdown,
        anchor: fixture.anchor,
    })),
];

/**
 * Constructs that do not reproduce their bytes today.
 *
 * By the recorded rule each of these belongs in the preservation layer, or
 * needs the serializer to stop rewriting it. Until one of those happens the
 * divergence is written down here, in the open, with what it actually costs.
 */
export const roundTripExceptions: RoundTripException[] = [
    {
        name: "atx heading with closing sequence",
        reason:
            "`# Heading #` loses its optional closing run and comes back as `# Heading`. The heading is unchanged; only the author's chosen spelling of it is.",
    },
    {
        name: "setext heading level 1",
        reason:
            "`Heading\\n=======` comes back as `# Heading`. Same heading, different style; the serializer has one heading style.",
    },
    {
        name: "setext heading level 2",
        reason:
            "`Heading\\n-------` comes back as `## Heading`, for the same reason as level 1.",
    },
    {
        name: "thematic break with dashes",
        reason:
            "`---` comes back as `***`, deliberately: a `---` written at the top of a document parses back as a frontmatter delimiter on the next open, so the serializer never emits it.",
    },
    {
        name: "thematic break with underscores",
        reason: "`___` comes back as `***`, the one thematic break the serializer writes.",
    },
    {
        name: "bullet list with asterisks",
        reason:
            "`*` bullets come back as `-`. The serializer is configured with one bullet marker, which is what keeps an unrelated edit from rewriting every list in the file.",
    },
    {
        name: "bullet list with pluses",
        reason: "`+` bullets come back as `-`, for the same reason as `*`.",
    },
    {
        name: "ordered list with parens",
        reason: "`1)` comes back as `1.`; the serializer has one ordered marker.",
    },
    {
        name: "empty list item",
        reason:
            "`- ` gains content: the item comes back as `- <br />`. CommonMark's empty-line placeholder is written into a document that never held it, which is markup the author did not type. This one is content, not spelling.",
    },
    {
        name: "lazy blockquote continuation",
        reason:
            "`> one\\ntwo` comes back with the marker filled in on the second line. The quote is the same quote; the lazy spelling is lost.",
    },
    {
        name: "tilde code fence",
        reason:
            "`~~~` comes back as a backtick fence. The code is byte-identical; the fence character is not.",
    },
    {
        name: "indented code block",
        reason:
            "A four-space indented block comes back fenced. The code is byte-identical; the block's spelling is not.",
    },
    {
        name: "gfm literal autolink",
        reason:
            "A bare `http://example.test` comes back as `<http://example.test>`. Both are the same link, but the angle brackets are characters the author did not write.",
    },
    {
        name: "hard break as two spaces",
        reason:
            "A two-space hard break comes back as a backslash break. Same break, different spelling — and the trailing spaces are invisible, so this one is the least noticeable and the least harmful.",
    },
    {
        name: "consecutive blank lines",
        reason:
            "Runs of blank lines between blocks collapse to one. Spacing the author chose is not reproduced.",
    },
    {
        name: "named character reference",
        reason:
            "`&amp;` comes back decoded, as `&`. It still parses to the same text, but a file written with entities does not stay written with them.",
    },
    {
        name: "numeric character reference",
        reason: "`&#65;` comes back decoded, as `A`, for the same reason as `&amp;`.",
    },
    {
        name: "gfm table with alignment",
        reason:
            "Cells are re-padded to the width of the alignment row, so `| a | b |` comes back as `| a  |  b |`. The table is the same table; the column widths are the serializer's.",
    },
];

/** Payloads that must never execute, whatever path they arrive by. */
export const scriptExecutionProbes = [
    '<script>window.__pwned = true;</script>',
    '<img src="x" onerror="window.__pwned = true">',
    '<a href="javascript:window.__pwned=true">x</a>',
    '<svg onload="window.__pwned = true"></svg>',
    '<body onload="window.__pwned = true">',
    '<iframe srcdoc="&lt;script&gt;window.__pwned=true&lt;/script&gt;"></iframe>',
] as const;

/**
 * Clipboard HTML claiming to be MDX syntax metadata. Only payloads the product
 * itself signed may rehydrate structured syntax; anything else is treated as
 * ordinary sanitized content.
 */
export const forgedClipboardPayloads = [
    '<div data-mdx-node-type="math_block" data-mdx-source-id="forged">x</div>',
    '<div data-mdx-source-id="../../etc/passwd">x</div>',
    '<span data-mdx-node-type="source_fallback" onclick="window.__pwned=true">x</span>',
] as const;
