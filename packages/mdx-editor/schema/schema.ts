import { Schema } from "prosemirror-model";

export const mdxEditorSchema = new Schema({
    nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        image: {
            inline: true,
            group: "inline",
            atom: true,
            attrs: {
                src: {},
                alt: { default: "" },
                title: { default: null },
            },
            toDOM: (node) => [
                "img",
                {
                    src: node.attrs.src,
                    alt: node.attrs.alt || "",
                    title: node.attrs.title ?? undefined,
                    "data-mdx-node-type": "image",
                },
            ],
            parseDOM: [
                {
                    tag: "img[src]",
                    getAttrs: (dom) => ({
                        src: (dom as HTMLElement).getAttribute("src"),
                        alt: (dom as HTMLElement).getAttribute("alt") ?? "",
                        title: (dom as HTMLElement).getAttribute("title"),
                    }),
                },
            ],
        },
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
                getAttrs: (dom) => ({
                    level: Number(
                        (dom as HTMLElement).getAttribute(
                            "data-mdx-heading-level",
                        ) ?? level,
                    ),
                    sourceId: (dom as HTMLElement).getAttribute(
                        "data-mdx-source-id",
                    ),
                }),
            })),
        },
        blockquote: {
            group: "block",
            content: "block+",
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "blockquote",
                {
                    "data-mdx-node-type": "blockquote",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "blockquote",
                    getAttrs: (dom) => ({
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        bullet_list: {
            group: "block",
            content: "listItem+",
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "ul",
                {
                    "data-mdx-node-type": "bullet_list",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "ul",
                    getAttrs: (dom) => ({
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        ordered_list: {
            group: "block",
            content: "listItem+",
            attrs: {
                order: { default: 1 },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "ol",
                {
                    start:
                        node.attrs.order === 1 ? undefined : node.attrs.order,
                    "data-mdx-node-type": "ordered_list",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "ol",
                    getAttrs: (dom) => ({
                        order: Number((dom as HTMLOListElement).start || 1),
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        list_item: {
            group: "listItem",
            content: "paragraph block*",
            defining: true,
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "li",
                {
                    "data-mdx-node-type": "list_item",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "li:not([data-mdx-task-item])",
                    getAttrs: (dom) => ({
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        task_item: {
            group: "listItem",
            content: "paragraph block*",
            defining: true,
            attrs: {
                checked: { default: false },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "li",
                {
                    "data-mdx-node-type": "task_item",
                    "data-mdx-task-item": "",
                    "data-mdx-checked": node.attrs.checked ? "true" : "false",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "li[data-mdx-task-item]",
                    getAttrs: (dom) => ({
                        checked:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-checked",
                            ) === "true",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        table: {
            group: "block",
            content: "table_row+",
            attrs: {
                alignments: { default: [] },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "table",
                {
                    "data-mdx-node-type": "table",
                    "data-mdx-alignments": node.attrs.alignments?.length
                        ? node.attrs.alignments.join(",")
                        : undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["tbody", 0],
            ],
            parseDOM: [
                {
                    tag: "table",
                    getAttrs: (dom) => {
                        const alignments = (dom as HTMLElement).getAttribute(
                            "data-mdx-alignments",
                        );

                        return {
                            alignments: alignments ? alignments.split(",") : [],
                            sourceId: (dom as HTMLElement).getAttribute(
                                "data-mdx-source-id",
                            ),
                        };
                    },
                },
            ],
        },
        table_row: {
            content: "(table_cell | table_header)+",
            toDOM: () => ["tr", { "data-mdx-node-type": "table_row" }, 0],
            parseDOM: [{ tag: "tr" }],
        },
        table_cell: {
            content: "inline*",
            attrs: { align: { default: null } },
            toDOM: (node) => [
                "td",
                {
                    "data-mdx-node-type": "table_cell",
                    "data-mdx-align": node.attrs.align ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "td",
                    getAttrs: (dom) => ({
                        align: (dom as HTMLElement).getAttribute(
                            "data-mdx-align",
                        ),
                    }),
                },
            ],
        },
        table_header: {
            content: "inline*",
            attrs: { align: { default: null } },
            toDOM: (node) => [
                "th",
                {
                    "data-mdx-node-type": "table_header",
                    "data-mdx-align": node.attrs.align ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "th",
                    getAttrs: (dom) => ({
                        align: (dom as HTMLElement).getAttribute(
                            "data-mdx-align",
                        ),
                    }),
                },
            ],
        },
        footnote_ref: {
            inline: true,
            group: "inline",
            atom: true,
            attrs: {
                label: {},
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "span",
                {
                    "data-mdx-node-type": "footnote_ref",
                    "data-mdx-label": node.attrs.label,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                `[^${node.attrs.label}]`,
            ],
            parseDOM: [
                {
                    tag: "span[data-mdx-node-type='footnote_ref']",
                    getAttrs: (dom) => ({
                        label: (dom as HTMLElement).getAttribute(
                            "data-mdx-label",
                        ),
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        footnote_definition: {
            group: "block",
            content: "block+",
            attrs: {
                label: {},
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "section",
                {
                    "data-mdx-node-type": "footnote_definition",
                    "data-mdx-label": node.attrs.label,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "section[data-mdx-node-type='footnote_definition']",
                    getAttrs: (dom) => ({
                        label: (dom as HTMLElement).getAttribute(
                            "data-mdx-label",
                        ),
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        math_inline: {
            inline: true,
            group: "inline",
            atom: true,
            attrs: {
                latex: { default: "" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "span",
                {
                    "data-mdx-node-type": "math_inline",
                    "data-mdx-latex": node.attrs.latex,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                node.attrs.latex,
            ],
            parseDOM: [
                {
                    tag: "span[data-mdx-node-type='math_inline']",
                    getAttrs: (dom) => ({
                        latex:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-latex",
                            ) ??
                            (dom as HTMLElement).textContent ??
                            "",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        math_block: {
            group: "block",
            atom: true,
            selectable: true,
            attrs: {
                latex: { default: "" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "math_block",
                    "data-mdx-syntax": "math",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", node.attrs.latex],
            ],
            parseDOM: [
                {
                    tag: "pre[data-mdx-node-type='math_block']",
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        latex: (dom as HTMLElement).textContent ?? "",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        callout: {
            group: "block",
            content: "block+",
            attrs: {
                kind: { default: "NOTE" },
                title: { default: null },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "aside",
                {
                    "data-mdx-node-type": "callout",
                    "data-mdx-callout-kind": node.attrs.kind,
                    "data-mdx-title": node.attrs.title ?? undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "aside[data-mdx-node-type='callout']",
                    getAttrs: (dom) => ({
                        kind:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-callout-kind",
                            ) ?? "NOTE",
                        title: (dom as HTMLElement).getAttribute(
                            "data-mdx-title",
                        ),
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        mermaid_block: {
            group: "block",
            atom: true,
            selectable: true,
            attrs: {
                code: { default: "" },
                info: { default: "mermaid" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "mermaid_block",
                    "data-mdx-language": "mermaid",
                    "data-mdx-info": node.attrs.info || undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", node.attrs.code],
            ],
            parseDOM: [
                {
                    tag: "pre[data-mdx-node-type='mermaid_block']",
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        code: (dom as HTMLElement).textContent ?? "",
                        info:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-info",
                            ) ?? "mermaid",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
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
                    "data-mdx-info": node.attrs.info || undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [
                {
                    tag: "pre[data-mdx-code-block]",
                    priority: 70,
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        language:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-language",
                            ) ?? "",
                        info:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-info",
                            ) ?? "",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
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
            parseDOM: [
                {
                    tag: "pre[data-mdx-node-type='frontmatter']",
                    priority: 90,
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
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
                    "data-mdx-reason": node.attrs.reason || undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [
                {
                    tag: "pre[data-mdx-node-type='opaque']",
                    priority: 80,
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        reason:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-reason",
                            ) ?? "unsupported",
                        sourceId: (dom as HTMLElement).getAttribute(
                            "data-mdx-source-id",
                        ),
                    }),
                },
            ],
        },
        source_fallback: {
            group: "block",
            atom: true,
            selectable: true,
            attrs: {
                markdown: { default: "" },
                reason: { default: "unsupported" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "source_fallback",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                    "data-mdx-reason": node.attrs.reason || undefined,
                },
                ["code", node.attrs.markdown],
            ],
            parseDOM: [
                {
                    tag: "pre[data-mdx-node-type='source_fallback']",
                    priority: 85,
                    preserveWhitespace: "full",
                    getAttrs: (dom) => ({
                        markdown: (dom as HTMLElement).textContent ?? "",
                        reason:
                            (dom as HTMLElement).getAttribute(
                                "data-mdx-reason",
                            ) ?? "unsupported",
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
                        href: (dom as HTMLElement).getAttribute("href"),
                        title: (dom as HTMLElement).getAttribute("title"),
                    }),
                },
            ],
        },
    },
});
