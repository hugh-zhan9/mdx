export type MarkdownNodeKind =
    | "doc"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "bullet_list"
    | "ordered_list"
    | "list_item"
    | "task_item"
    | "code_block"
    | "table"
    | "table_row"
    | "table_cell"
    | "table_header"
    | "image"
    | "link"
    | "wikilink"
    | "math"
    | "math_inline"
    | "math_block"
    | "footnote"
    | "footnote_ref"
    | "footnote_definition"
    | "callout"
    | "mermaid_block"
    | "frontmatter"
    | "opaque"
    | "source_fallback";

export interface MarkdownNodeMetadata {
    kind: MarkdownNodeKind;
    sourceId?: string;
    originalSyntax?: string;
}
