import type { SyntaxPlugin } from "../../kernel";
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
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export { MermaidNodeView, mermaidBlockParsers };
