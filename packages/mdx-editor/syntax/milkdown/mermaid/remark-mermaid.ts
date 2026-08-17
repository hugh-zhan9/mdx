import type { MarkdownNode, RemarkPluginRaw } from "@milkdown/kit/transformer";

import { MERMAID_LANGUAGE, MERMAID_MDAST_TYPE } from "./syntax";

/**
 * True for a fenced code block whose info string is exactly `mermaid`.
 *
 * A fence carrying extra words (` ```mermaid title=x `) keeps its info string
 * beyond the language, which this node has nowhere to store, so it is declined
 * here and preserved verbatim by the source-preservation layer — the ordinary
 * code block has nowhere to store it either.
 */
function isMermaidFence(node: MarkdownNode): boolean {
    if (node.type !== "code" || node.lang !== MERMAID_LANGUAGE) return false;
    const meta = node.meta;
    return meta === null || meta === undefined || meta === "";
}

function replaceMermaidFences(parent: MarkdownNode): void {
    const children = parent.children;
    if (!children) return;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (isMermaidFence(child)) {
            children[index] = {
                type: MERMAID_MDAST_TYPE,
                value: typeof child.value === "string" ? child.value : "",
                // Carried across so a later pass can still read the fence's own
                // bytes. Source preservation needs them to see that a fence
                // never closed, which this node has no way to write back.
                position: child.position,
            };
            continue;
        }
        replaceMermaidFences(child);
    }
}

export type MermaidRemarkOptions = Record<string, never>;

/**
 * Gives Mermaid fences their own mdast type before the parser sees them.
 *
 * The parser takes the first schema whose `match` accepts a node and CommonMark
 * registers first, so `code_block` would otherwise claim every `code` node. The
 * stringify side is deliberately untouched: a diagram serializes back to a
 * plain `code` node, which leaves fence length and interior indentation to
 * mdast-util-to-markdown rather than to a hand-written writer.
 */
export const mermaidRemarkPlugin: RemarkPluginRaw<MermaidRemarkOptions> =
    function mermaidRemark() {
        return (tree) => {
            replaceMermaidFences(tree as MarkdownNode);
        };
    };
