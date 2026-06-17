export interface MarkdownFixture {
    name: string;
    markdown: string;
}

export const basicMarkdownFixtures: MarkdownFixture[] = [
    {
        name: "heading and paragraph",
        markdown: "# Title\n\nBody text.\n",
    },
    {
        name: "wikilink and normal link",
        markdown: "See [[Page|Label]] and [site](https://example.com).\n",
    },
    {
        name: "mermaid fence",
        markdown: "```mermaid\ngraph TD\n  A --> B\n```\n",
    },
];

export const roundTripFixtures: MarkdownFixture[] = [
    ...basicMarkdownFixtures,
    {
        name: "gfm task list",
        markdown: "- [x] Done\n- [ ] Todo\n",
    },
    {
        name: "gfm table",
        markdown: "| A | B |\n|---|---|\n| 1 | 2 |\n",
    },
    {
        name: "math",
        markdown: "Inline $x+1$.\n\n$$\ny = mx + b\n$$\n",
    },
    {
        name: "footnote",
        markdown: "A note[^1].\n\n[^1]: Footnote body.\n",
    },
    {
        name: "callout",
        markdown: "> [!NOTE]\n> Keep this.\n",
    },
    {
        name: "html opaque",
        markdown: "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n",
    },
];
