import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";

import { createMathBlockNodeView, createMathInlineNodeView } from "./node-view";
import { mathRemarkPlugin, mathTextEscapePlugin } from "./remark";
import {
    INLINE_MATH_MDAST_TYPE,
    MATH_BLOCK_NODE_NAME,
    MATH_INLINE_NODE_NAME,
    MATH_MDAST_TYPE,
} from "./syntax";

export { MATH_BLOCK_NODE_NAME, MATH_INLINE_NODE_NAME } from "./syntax";

const DOM_TYPE = "data-mdx-node-type";
const DOM_LATEX = "data-mdx-latex";
const DOM_META = "data-mdx-math-meta";

function readLatex(node: ProseMirrorNode): string {
    return String(node.attrs.latex ?? "");
}

function readMeta(node: ProseMirrorNode): string | null {
    const meta = node.attrs.meta;
    return typeof meta === "string" ? meta : null;
}

const mathRemark = $remark("mdxMath", () => mathRemarkPlugin);

/**
 * An inline atom holding the LaTeX source.
 *
 * The source is an attribute rather than child text so the formula cannot be
 * half-selected by an ordinary caret move, which is what lets the NodeView own
 * the editing surface. Nothing rendered ever reaches this node.
 */
const mathInlineSchema = $nodeSchema(MATH_INLINE_NODE_NAME, () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
        latex: {
            default: "",
            validate: "string",
        },
    },
    parseDOM: [
        {
            tag: `span[${DOM_TYPE}='${MATH_INLINE_NODE_NAME}']`,
            getAttrs: (dom: HTMLElement | string) => {
                if (typeof dom === "string") return null;
                return { latex: dom.getAttribute(DOM_LATEX) ?? "" };
            },
        },
    ],
    toDOM: (node: ProseMirrorNode) => [
        "span",
        {
            [DOM_TYPE]: MATH_INLINE_NODE_NAME,
            [DOM_LATEX]: readLatex(node),
            class: "mdx-math mdx-math-inline",
        },
        readLatex(node),
    ],
    parseMarkdown: {
        match: ({ type }) => type === INLINE_MATH_MDAST_TYPE,
        runner: (state, node, type) => {
            state.addNode(type, {
                latex: typeof node.value === "string" ? node.value : "",
            });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === MATH_INLINE_NODE_NAME,
        runner: (state, node) => {
            state.addNode(
                INLINE_MATH_MDAST_TYPE,
                undefined,
                readLatex(node),
            );
        },
    },
}));

/**
 * A code-block-shaped node whose text content is the display formula exactly as
 * written. `meta` carries whatever followed the opening `$$` so the fence line
 * comes back as it was typed.
 */
const mathBlockSchema = $nodeSchema(MATH_BLOCK_NODE_NAME, () => ({
    content: "text*",
    group: "block",
    marks: "",
    defining: true,
    code: true,
    attrs: {
        meta: {
            default: null,
        },
    },
    parseDOM: [
        {
            tag: `pre[${DOM_TYPE}='${MATH_BLOCK_NODE_NAME}']`,
            preserveWhitespace: "full" as const,
            // Wins over the commonmark `pre` rule, which would otherwise claim
            // this element as a code block.
            priority: 70,
            getAttrs: (dom: HTMLElement | string) => {
                if (typeof dom === "string") return null;
                return { meta: dom.getAttribute(DOM_META) };
            },
        },
    ],
    toDOM: (node: ProseMirrorNode) => {
        const meta = readMeta(node);
        return [
            "pre",
            {
                [DOM_TYPE]: MATH_BLOCK_NODE_NAME,
                ...(meta === null ? {} : { [DOM_META]: meta }),
                class: "mdx-math mdx-math-block",
            },
            ["code", { spellcheck: "false" }, 0],
        ];
    },
    parseMarkdown: {
        match: ({ type }) => type === MATH_MDAST_TYPE,
        runner: (state, node, type) => {
            const value = typeof node.value === "string" ? node.value : "";
            const meta = typeof node.meta === "string" ? node.meta : null;
            state.openNode(type, { meta });
            if (value) state.addText(value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === MATH_BLOCK_NODE_NAME,
        runner: (state, node) => {
            state.addNode(MATH_MDAST_TYPE, undefined, node.textContent, {
                meta: readMeta(node),
            });
        },
    },
}));

const mathInlineView = $view(mathInlineSchema.node, () =>
    createMathInlineNodeView(),
);

const mathBlockView = $view(mathBlockSchema.node, () =>
    createMathBlockNodeView(),
);

/**
 * Math support: `$…$` becomes an inline node and `$$…$$` a block node, each
 * holding the LaTeX it was written with and serializing back to those bytes.
 * KaTeX only ever draws a preview beside the source.
 *
 * Compose after the base plugins so the commonmark schema registers first and
 * keeps owning the document's default block type.
 */
export function mathPlugins(): MilkdownPlugin[] {
    return [
        mathTextEscapePlugin,
        mathRemark,
        mathInlineSchema,
        mathBlockSchema,
        mathInlineView,
        mathBlockView,
    ].flat();
}
