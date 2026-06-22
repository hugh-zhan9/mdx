import type { SyntaxPlugin } from "../../kernel";
import { createMdxNodeViews } from "../../react/node-views";
import { mdxEditorSchema } from "../../schema/schema";

const legacyNodeNames = [
    "image",
    "heading",
    "blockquote",
    "horizontal_rule",
    "bullet_list",
    "ordered_list",
    "list_item",
    "task_item",
    "code_block",
    "table",
    "table_row",
    "table_cell",
    "table_header",
    "footnote_ref",
    "footnote_definition",
    "math_inline",
    "math_block",
    "callout",
    "mermaid_block",
    "frontmatter",
] as const;

export function legacyMarkdownSyntax(): SyntaxPlugin {
    const nodes: NonNullable<SyntaxPlugin["nodes"]> = {};
    const allNodeViews = createMdxNodeViews();
    const nodeViews: NonNullable<SyntaxPlugin["nodeViews"]> = {};

    for (const name of legacyNodeNames) {
        nodes[name] = mdxEditorSchema.nodes[name].spec;
        if (allNodeViews[name]) {
            nodeViews[name] = allNodeViews[name];
        }
    }

    return {
        id: "legacy",
        nodes,
        nodeViews,
    };
}
