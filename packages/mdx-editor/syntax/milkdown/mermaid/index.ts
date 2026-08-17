import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $ctx, $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import { createMermaidNodeView } from "./node-view";
import { mermaidRemarkPlugin } from "./remark-mermaid";
import { renderMermaidDiagram, type MermaidRenderer } from "./renderer";
import {
    MERMAID_DOM_MARKER,
    MERMAID_LANGUAGE,
    MERMAID_MDAST_TYPE,
    MERMAID_NODE_NAME,
} from "./syntax";

export { MERMAID_RENDER_DELAY_MS } from "./node-view";
export { renderMermaidDiagram } from "./renderer";
export type {
    MermaidRenderRequest,
    MermaidRenderResult,
    MermaidRenderer,
} from "./renderer";
export {
    MDX_SEARCH_ATTRIBUTE,
    MDX_SEARCH_EXCLUDE,
    MERMAID_DOM_MARKER,
    MERMAID_ERROR_MARKER,
    MERMAID_LANGUAGE,
    MERMAID_NODE_NAME,
    MERMAID_PREVIEW_MARKER,
    MERMAID_SOURCE_MARKER,
} from "./syntax";

/**
 * The renderer the preview calls. Replaceable so a host that cannot run
 * Mermaid — or a test that must observe a specific outcome — can supply its
 * own without the NodeView knowing the difference.
 */
export const mermaidRendererCtx = $ctx<MermaidRenderer, "mdxMermaidRenderer">(
    renderMermaidDiagram,
    "mdxMermaidRenderer",
);

const mermaidRemark = $remark("mdxMermaid", () => mermaidRemarkPlugin);

/**
 * The fence source as an editable code block.
 *
 * Nothing derived from the diagram lives in the document: the node's only
 * content is the text between the fences, so serialization can never pick up
 * anything the preview produced.
 */
const mermaidSchema = $nodeSchema(MERMAID_NODE_NAME, () => ({
    content: "text*",
    group: "block",
    marks: "",
    defining: true,
    code: true,
    parseDOM: [
        {
            tag: `pre[${MERMAID_DOM_MARKER}]`,
            preserveWhitespace: "full" as const,
            // Wins over the CommonMark `pre` rule, which would otherwise claim
            // this element as an ordinary code block.
            priority: 70,
        },
    ],
    toDOM: () => [
        "pre",
        {
            [MERMAID_DOM_MARKER]: "",
            "data-language": MERMAID_LANGUAGE,
            class: "mdx-mermaid",
        },
        ["code", { spellcheck: "false" }, 0],
    ],
    parseMarkdown: {
        match: ({ type }) => type === MERMAID_MDAST_TYPE,
        runner: (state, node, type) => {
            const value = typeof node.value === "string" ? node.value : "";
            state.openNode(type);
            if (value) state.addText(value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node: ProseMirrorNode) =>
            node.type.name === MERMAID_NODE_NAME,
        runner: (state, node: ProseMirrorNode) => {
            state.addNode("code", undefined, node.textContent, {
                lang: MERMAID_LANGUAGE,
            });
        },
    },
}));

const mermaidView = $view(mermaidSchema.node, (ctx: Ctx) =>
    // Read on every render rather than captured here, so a renderer installed
    // after the view was built is the one that gets called.
    createMermaidNodeView(() => ctx.get(mermaidRendererCtx.key)),
);

/**
 * Mermaid diagrams: a ` ```mermaid ` fence becomes its own node whose source
 * round-trips byte for byte, with the rendered diagram attached as preview
 * chrome that is never serialized and never searched.
 *
 * Compose after the base plugins so CommonMark registers first and keeps owning
 * every other fenced code block.
 */
export function mermaidPlugins(): MilkdownPlugin[] {
    return [
        mermaidRendererCtx,
        mermaidRemark,
        mermaidSchema,
        mermaidView,
    ].flat();
}
