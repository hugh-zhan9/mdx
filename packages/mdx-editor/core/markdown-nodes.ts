export type MarkdownNodeKind =
    | "doc"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "bullet_list"
    | "ordered_list"
    | "task_item"
    | "code_block"
    | "table"
    | "image"
    | "link"
    | "wikilink"
    | "math"
    | "footnote"
    | "callout"
    | "frontmatter"
    | "opaque";

export interface MarkdownNodeMetadata {
    kind: MarkdownNodeKind;
    sourceId?: string;
    originalSyntax?: string;
}
