import type { SyntaxPlugin } from "../../kernel";

export function coreMarkdownSyntax(): SyntaxPlugin {
    return {
        id: "core",
        nodes: {
            doc: { content: "block+" },
            text: { group: "inline" },
            paragraph: {
                group: "block",
                content: "inline*",
                attrs: { sourceId: { default: null } },
                toDOM: (node) => [
                    "p",
                    {
                        "data-mdx-node-type": "paragraph",
                        "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                    },
                    0,
                ],
                parseDOM: [
                    {
                        tag: "p",
                        getAttrs: (dom) => ({
                            sourceId: (dom as HTMLElement).getAttribute(
                                "data-mdx-source-id",
                            ),
                        }),
                    },
                ],
            },
        },
        marks: {
            strong: {
                toDOM: () => ["strong", 0],
                parseDOM: [{ tag: "strong" }, { tag: "b" }],
            },
            emphasis: {
                toDOM: () => ["em", 0],
                parseDOM: [{ tag: "em" }, { tag: "i" }],
            },
            strike: {
                toDOM: () => ["s", 0],
                parseDOM: [{ tag: "s" }, { tag: "del" }],
            },
            inline_code: {
                code: true,
                toDOM: () => ["code", { "data-mdx-node-type": "inline_code" }, 0],
                parseDOM: [{ tag: "code[data-mdx-node-type='inline_code']" }],
            },
            link: {
                attrs: {
                    href: {},
                    title: { default: null },
                },
                inclusive: false,
                toDOM: (mark) => [
                    "a",
                    {
                        href: mark.attrs.href,
                        title: mark.attrs.title ?? undefined,
                        "data-mdx-node-type": mark.attrs.href?.startsWith(
                            "mdx-wikilink:",
                        )
                            ? "wikilink"
                            : "link",
                    },
                    0,
                ],
                parseDOM: [
                    {
                        tag: "a[href]",
                        getAttrs: (dom) => ({
                            href: (dom as HTMLAnchorElement).getAttribute("href"),
                            title: (dom as HTMLAnchorElement).getAttribute("title"),
                        }),
                    },
                ],
            },
        },
    };
}
