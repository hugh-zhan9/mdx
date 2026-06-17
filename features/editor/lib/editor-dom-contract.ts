export const MDX_EDITOR_ROOT_SELECTOR = "[data-mdx-editor-root]";
export const MDX_CODE_BLOCK_SELECTOR = "[data-mdx-code-block]";
export const MDX_BLOCK_SELECTOR =
    "[data-mdx-node-type='heading'],[data-mdx-node-type='paragraph'],[data-mdx-node-type='bullet_list'],[data-mdx-node-type='ordered_list'],[data-mdx-node-type='code_block'],[data-mdx-node-type='blockquote'],[data-mdx-node-type='table'],[data-mdx-node-type='horizontal_rule'],[data-mdx-node-type='frontmatter'],[data-mdx-node-type='opaque']";
export const MDX_MERMAID_PREVIEW_SELECTOR = "[data-mdx-mermaid-preview]";
export const MDX_SYNTAX_SELECTOR = "[data-mdx-syntax]";

export function isMdxSyntaxElement(element: Element): boolean {
    return element.matches(MDX_SYNTAX_SELECTOR);
}
