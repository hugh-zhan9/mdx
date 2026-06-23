import type { SyntaxPlugin } from "../../kernel";
import { escapeAttribute, escapeHtml } from "../../kernel/clipboard";
import { MermaidNodeView } from "../../react/mermaid-node-view";
import { createReactNodeView } from "../../react/node-views";
import { mdxEditorSchema } from "../../schema/schema";
import { mermaidBlockParsers } from "./parse";

export function mermaidSyntax(): SyntaxPlugin {
    return {
        id: "mermaid",
        nodes: {
            mermaid_block: mdxEditorSchema.nodes.mermaid_block.spec,
        },
        blockParsers: mermaidBlockParsers,
        serializers: {
            nodeSerializers: {
                mermaid_block: (node) =>
                    `\`\`\`${String(node.attrs.info ?? "mermaid")}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`,
            },
        },
        nodeViews: {
            mermaid_block: createReactNodeView(MermaidNodeView, {
                textBacked: true,
            }),
        },
        clipboard: {
            toClipboardHtml: {
                mermaid_block: (node) => {
                    const info = String(node.attrs.info ?? "mermaid");

                    return `<pre data-mdx-node-type="mermaid_block" data-mdx-info="${escapeAttribute(info)}"><code>${escapeHtml(node.textContent)}</code></pre>`;
                },
            },
        },
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export { MermaidNodeView, mermaidBlockParsers };
