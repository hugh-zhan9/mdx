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
