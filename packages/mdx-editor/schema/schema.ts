import { Schema } from "prosemirror-model";

export const mdxEditorSchema = new Schema({
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
            parseDOM: [{ tag: "p" }],
        },
        heading: {
            group: "block",
            content: "inline*",
            attrs: {
                level: { default: 1 },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                `h${node.attrs.level}`,
                {
                    "data-mdx-node-type": "heading",
                    "data-mdx-heading-level": String(node.attrs.level),
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
                tag: `h${level}`,
                attrs: { level },
            })),
        },
        code_block: {
            group: "block",
            content: "text*",
            marks: "",
            code: true,
            attrs: {
                language: { default: "" },
                info: { default: "" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "code_block",
                    "data-mdx-code-block": "",
                    "data-mdx-language": node.attrs.language || undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
        },
        frontmatter: {
            group: "block",
            content: "text*",
            code: true,
            marks: "",
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "frontmatter",
                    "data-mdx-syntax": "frontmatter",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre[data-mdx-node-type='frontmatter']" }],
        },
        opaque_block: {
            group: "block",
            content: "text*",
            code: true,
            marks: "",
            attrs: {
                reason: { default: "unsupported" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "opaque",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre[data-mdx-node-type='opaque']" }],
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
            parseDOM: [{ tag: "code" }],
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
                    "data-mdx-node-type": mark.attrs.href?.startsWith("mdx-wikilink:")
                        ? "wikilink"
                        : "link",
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "a[href]",
                    getAttrs: (dom) => ({
                        href: (dom as HTMLElement).getAttribute("href"),
                        title: (dom as HTMLElement).getAttribute("title"),
                    }),
                },
            ],
        },
    },
});
