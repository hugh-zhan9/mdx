use crate::font_api::MockFontMetrics;
use crate::hit_test::hit_test_point;
use crate::math::{layout_math, MathContext};
use crate::paragraph::layout_paragraph_greedy;
use crate::position::caret_anchors_for_lines;
use crate::selection::compute_selection_geometry;
use crate::{
    BlockKind, InlineKind, LayoutDocument, LayoutLine, LayoutSnapshot, MathDisplay,
    SelectionGeometry,
};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

fn build_snapshot(document: &LayoutDocument) -> LayoutSnapshot {
    let font = MockFontMetrics::new();
    let mut lines = Vec::new();
    let mut canvas_draw_ops = Vec::new();

    for block in &document.blocks {
        let line_width = (document.style_context.viewport_width - 40.0).max(1.0);
        let paragraph_input = crate::paragraph::ParagraphInput::new(
            block.block_id.clone(),
            &block.inlines,
            line_width,
            block.style.font_size,
            block.style.line_height,
            matches!(block.kind, BlockKind::Code),
            &document.style_context,
        );
        let block_lines = layout_paragraph_greedy(&paragraph_input, &font);

        if matches!(block.kind, BlockKind::MathBlock) {
            for inline in &block.inlines {
                if matches!(inline.kind, InlineKind::MathInline) {
                    let ctx = MathContext::new(
                        block.style.font_size,
                        if matches!(block.style.math_display, MathDisplay::Block) {
                            MathDisplay::Block
                        } else {
                            MathDisplay::Inline
                        },
                    );
                    canvas_draw_ops.extend(layout_math(&block.block_id, &inline.text, &ctx));
                }
            }
        }

        lines.extend(block_lines);
    }

    let caret_anchors = caret_anchors_for_lines(&lines);

    LayoutSnapshot {
        revision: document.revision,
        lines,
        canvas_draw_ops,
        hit_test_entries: Vec::new(),
        caret_anchors,
        selection_geometries: Vec::new(),
        mirror_blocks: Vec::new(),
    }
}

fn serialize_json<T: serde::Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap_or_default()
}

fn parse_json<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Option<T> {
    serde_json::from_slice(bytes).ok()
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn layout_initialize_document(
    _document_id: String,
    layout_ir_bytes: Vec<u8>,
    _style_context_bytes: Vec<u8>,
    _viewport_bytes: Vec<u8>,
    _platform_bytes: Vec<u8>,
) -> Vec<u8> {
    let Some(document) = parse_json::<LayoutDocument>(&layout_ir_bytes) else {
        return Vec::new();
    };
    serialize_json(&build_snapshot(&document))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn layout_update_document(
    document_id: String,
    _document_revision: u64,
    updated_blocks_bytes: Vec<u8>,
    _removed_block_ids_bytes: Vec<u8>,
    _viewport_bytes: Vec<u8>,
) -> Vec<u8> {
    layout_initialize_document(
        document_id,
        updated_blocks_bytes,
        Vec::new(),
        Vec::new(),
        Vec::new(),
    )
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn layout_get_viewport_snapshot(
    document_id: String,
    revision: u64,
    viewport_bytes: Vec<u8>,
    _device_pixel_ratio: f32,
) -> Vec<u8> {
    layout_update_document(
        document_id,
        revision,
        viewport_bytes,
        Vec::new(),
        Vec::new(),
    )
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn layout_hit_test(
    _document_id: String,
    _revision: u64,
    x: f32,
    y: f32,
    granularity_bytes: Vec<u8>,
) -> Vec<u8> {
    let Some(lines) = parse_json::<Vec<LayoutLine>>(&granularity_bytes) else {
        return Vec::new();
    };
    serialize_json(&hit_test_point(&lines, x, y))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn layout_get_selection_geometry(
    _document_id: String,
    _revision: u64,
    pm_from: u32,
    pm_to: u32,
) -> Vec<u8> {
    let geometry = SelectionGeometry {
        pm_from: pm_from as usize,
        pm_to: pm_to as usize,
        rects: Vec::new(),
    };
    serialize_json(&geometry)
}

pub fn handle_selection_geometry(
    lines: &[LayoutLine],
    pm_from: usize,
    pm_to: usize,
) -> SelectionGeometry {
    compute_selection_geometry(lines, pm_from, pm_to)
}
