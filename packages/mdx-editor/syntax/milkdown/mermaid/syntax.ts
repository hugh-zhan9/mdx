/** Info string that marks a fenced code block as a Mermaid diagram. */
export const MERMAID_LANGUAGE = "mermaid";

/**
 * mdast node type the remark transformer produces.
 *
 * Typed as `string` rather than a string literal so it can be used as a node
 * type without widening mdast's closed union of built-in node names.
 */
export const MERMAID_MDAST_TYPE: string = "mdxMermaid";

/** ProseMirror node name for a Mermaid diagram block. */
export const MERMAID_NODE_NAME = "mermaid_block";

/** Marks the element that carries a whole diagram block. */
export const MERMAID_DOM_MARKER = "data-mdx-mermaid";

/** Marks the editable fence source, which is the only source of truth. */
export const MERMAID_SOURCE_MARKER = "data-mdx-mermaid-source";

/** Marks the rendered diagram. */
export const MERMAID_PREVIEW_MARKER = "data-mdx-mermaid-preview";

/** Marks the local render-failure report. */
export const MERMAID_ERROR_MARKER = "data-mdx-mermaid-error";

/**
 * Marks a block whose diagram is currently drawn.
 *
 * Set by the NodeView when a render succeeds and taken off when one fails, so a
 * stylesheet can tell a diagram that stands in for its source from a fence that
 * still has to speak for itself.
 */
export const MERMAID_RENDERED_MARKER = "data-mdx-mermaid-rendered";

/**
 * Marks the block the selection is inside.
 *
 * A drawn diagram can hide the fence it came from, but not while someone is in
 * there changing it — and that source is the only place it can be changed.
 */
export const MERMAID_EDITING_MARKER = "data-mdx-mermaid-editing";

/**
 * Marks DOM that holds no document text.
 *
 * Everything under an element carrying `data-mdx-search="exclude"` is preview
 * chrome: it is never serialized and semantic scans — find/replace, outline,
 * word counts — must skip it so its text is never matched or counted.
 */
export const MDX_SEARCH_ATTRIBUTE = "data-mdx-search";

/** Value of {@link MDX_SEARCH_ATTRIBUTE} that excludes a subtree. */
export const MDX_SEARCH_EXCLUDE = "exclude";
