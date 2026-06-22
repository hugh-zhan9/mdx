import type { SyntaxPlugin } from "../../kernel";
import { createCodeBlockNodeView } from "../../react/node-views";
import { mdxEditorSchema } from "../../schema/schema";
import { codeBlockParsers } from "./parse";

export function codeSyntax(): SyntaxPlugin {
    return {
        id: "code",
        nodes: {
            code_block: mdxEditorSchema.nodes.code_block.spec,
            frontmatter: mdxEditorSchema.nodes.frontmatter.spec,
        },
        blockParsers: codeBlockParsers,
        serializers: {
            nodeSerializers: {
                code_block: (node) =>
                    `\`\`\`${String(node.attrs.info ?? node.attrs.language ?? "")}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`,
                frontmatter: (node) =>
                    `---\n${textBeforeClosingFence(node.textContent)}---\n`,
            },
        },
        nodeViews: {
            code_block: createCodeBlockNodeView,
        },
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export { codeBlockParsers };
