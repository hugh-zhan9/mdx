pub mod break_model;
pub mod font_api;
pub mod hit_test;
pub mod ir;
pub mod math;
pub mod paragraph;
pub mod position;
pub mod selection;

#[cfg(target_arch = "wasm32")]
pub mod wasm_bridge;

use serde::{Deserialize, Serialize};

/// Shared core types used across layout modules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutDocument {
    pub document_id: String,
    pub revision: u64,
    pub blocks: Vec<LayoutBlock>,
    pub style_context: StyleContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutBlock {
    pub block_id: String,
    pub kind: BlockKind,
    pub pm_from: usize,
    pub pm_to: usize,
    pub style: BlockStyle,
    pub inlines: Vec<InlineRun>,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlockKind {
    Paragraph,
    Heading,
    List,
    Table,
    Code,
    Image,
    Mermaid,
    Html,
    MathBlock,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineRun {
    pub text: String,
    pub kind: InlineKind,
    pub from: usize,
    pub to: usize,
    pub style: InlineStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InlineKind {
    Text,
    MathInline,
    HardBreak,
    ImageInline,
    HtmlInline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockStyle {
    pub heading_level: Option<u8>,
    pub text_align: TextAlign,
    pub font_size: f32,
    pub font_family: String,
    pub line_height: f32,
    pub math_display: MathDisplay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TextAlign {
    Left,
    Right,
    Center,
    Justify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MathDisplay {
    Inline,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineStyle {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub link: Option<String>,
    pub strike: bool,
    pub underline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleContext {
    pub default_font_size: f32,
    pub default_font_family: String,
    pub default_line_height: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub device_pixel_ratio: f32,
}

/// Layout snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutSnapshot {
    pub revision: u64,
    pub lines: Vec<LayoutLine>,
    pub canvas_draw_ops: Vec<CanvasDrawOp>,
    pub hit_test_entries: Vec<HitTestEntry>,
    pub caret_anchors: Vec<CaretAnchor>,
    pub selection_geometries: Vec<SelectionGeometry>,
    pub mirror_blocks: Vec<MirrorBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutLine {
    pub id: String,
    pub block_id: String,
    pub y: f32,
    pub baseline: f32,
    pub height: f32,
    pub text_runs: Vec<TextRunPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRunPosition {
    pub block_id: String,
    pub pm_from: usize,
    pub pm_to: usize,
    pub left: f32,
    pub baseline: f32,
    pub width: f32,
    pub height: f32,
    pub font_family: String,
    pub font_size: f32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasDrawOp {
    pub block_id: String,
    pub kind: CanvasDrawKind,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CanvasDrawKind {
    Math,
    TableGrid,
    CodeHighlight,
    Image,
    Mermaid,
    Decoration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HitTestEntry {
    pub block_id: String,
    pub rect: Rect,
    pub pm_from: usize,
    pub pm_to: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaretAnchor {
    pub line_id: String,
    pub pm_position: usize,
    pub x: f32,
    pub y: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionGeometry {
    pub pm_from: usize,
    pub pm_to: usize,
    pub rects: Vec<Rect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorBlock {
    pub block_id: String,
    pub pm_from: usize,
    pub pm_to: usize,
    pub semantic_text: String,
    pub aria_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
