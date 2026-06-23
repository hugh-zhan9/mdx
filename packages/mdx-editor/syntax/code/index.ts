import type { SyntaxPlugin } from "../../kernel";
import { escapeAttribute, escapeHtml } from "../../kernel/clipboard";
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
        clipboard: {
            toClipboardHtml: {
                code_block: (node) => {
                    const info = String(
                        node.attrs.info ?? node.attrs.language ?? "",
                    );

                    return `<pre data-mdx-node-type="code_block" data-mdx-info="${escapeAttribute(info)}"><code>${escapeHtml(node.textContent)}</code></pre>`;
                },
                frontmatter: (node) =>
                    `<pre data-mdx-node-type="frontmatter"><code>${escapeHtml(node.textContent)}</code></pre>`,
            },
        },
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export { codeBlockParsers };
