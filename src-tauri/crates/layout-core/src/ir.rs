use crate::BlockKind;

pub fn normalize_block_kind(kind: &str) -> BlockKind {
    match kind {
        "paragraph" => BlockKind::Paragraph,
        "heading" => BlockKind::Heading,
        "list" => BlockKind::List,
        "table" => BlockKind::Table,
        "code" => BlockKind::Code,
        "image" => BlockKind::Image,
        "mermaid" => BlockKind::Mermaid,
        "html" => BlockKind::Html,
        "math_block" => BlockKind::MathBlock,
        _ => BlockKind::Fallback,
    }
}
