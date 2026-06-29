use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::font_api::MockFontMetrics;
use crate::hit_test::hit_test_point;
use crate::math::{layout_math, MathContext};
use crate::paragraph::layout_paragraph;
use crate::position::caret_anchors_for_lines;
use crate::selection::compute_selection_geometry;
use crate::{
    BlockKind, CanvasDrawKind, CanvasDrawOp, HitTestEntry, InlineKind, LayoutBlock, LayoutDocument,
    LayoutLine, LayoutSnapshot, MathDisplay, MirrorBlock, Rect, SelectionGeometry,
};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

static SNAPSHOTS: OnceLock<Mutex<HashMap<String, LayoutSnapshot>>> = OnceLock::new();

#[derive(Clone)]
struct MirrorBlockGeometry {
    mirror_block: MirrorBlock,
    rect: Rect,
}

fn snapshots() -> &'static Mutex<HashMap<String, LayoutSnapshot>> {
    SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_snapshot(document_id: &str, snapshot: &LayoutSnapshot) {
    if let Ok(mut snapshots) = snapshots().lock() {
        snapshots.insert(document_id.to_string(), snapshot.clone());
    }
}

fn remembered_snapshot(document_id: &str, revision: u64) -> Option<LayoutSnapshot> {
    snapshots()
        .lock()
        .ok()
        .and_then(|snapshots| snapshots.get(document_id).cloned())
        .filter(|snapshot| snapshot.revision == revision)
}

fn build_snapshot(document: &LayoutDocument) -> LayoutSnapshot {
    let font = MockFontMetrics::new();
    let mut lines = Vec::new();
    let mut canvas_draw_ops = Vec::new();
    let mut mirror_geometries = Vec::new();
    let mut document_y = 0.0f32;

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
        let mut block_lines = layout_paragraph(&paragraph_input, &font);
        offset_lines(&mut block_lines, document_y);

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
                    let mut math_ops = layout_math(&block.block_id, &inline.text, &ctx);
                    offset_canvas_ops(&mut math_ops, document_y);
                    canvas_draw_ops.extend(math_ops);
                }
            }
        }

        if let Some((draw_op, mirror_block)) =
            canvas_block_metadata(block, &block_lines, &document.style_context)
        {
            let rect = Rect {
                x: draw_op.x,
                y: draw_op.y,
                width: draw_op.width,
                height: draw_op.height,
            };
            canvas_draw_ops.push(draw_op);
            mirror_geometries.push(MirrorBlockGeometry { mirror_block, rect });
        }

        let block_height = block_extent(&block_lines, block, &document.style_context);
        lines.extend(block_lines);
        document_y += block_height;
    }

    let caret_anchors = caret_anchors_for_lines(&lines);
    let mirror_block_ids = mirror_geometries
        .iter()
        .map(|geometry| geometry.mirror_block.block_id.as_str())
        .collect::<Vec<_>>();
    let hit_test_entries = hit_test_entries_for_lines(&lines, &mirror_block_ids)
        .into_iter()
        .chain(hit_test_entries_for_mirror_blocks(&mirror_geometries))
        .collect::<Vec<_>>();
    let selection_geometries = selection_geometries_for_lines(&lines, &mirror_block_ids)
        .into_iter()
        .chain(selection_geometries_for_mirror_blocks(&mirror_geometries))
        .collect::<Vec<_>>();
    let mirror_blocks = mirror_geometries
        .into_iter()
        .map(|geometry| geometry.mirror_block)
        .collect::<Vec<_>>();

    LayoutSnapshot {
        revision: document.revision,
        lines,
        canvas_draw_ops,
        hit_test_entries,
        caret_anchors,
        selection_geometries,
        mirror_blocks,
    }
}

fn offset_lines(lines: &mut [LayoutLine], y_offset: f32) {
    for line in lines {
        line.y += y_offset;
    }
}

fn offset_canvas_ops(ops: &mut [CanvasDrawOp], y_offset: f32) {
    for op in ops {
        op.y += y_offset;
    }
}

fn block_extent(lines: &[LayoutLine], block: &LayoutBlock, style: &crate::StyleContext) -> f32 {
    let top = lines.first().map(|line| line.y).unwrap_or(0.0);
    let bottom = lines
        .iter()
        .map(|line| line.y + line.height)
        .fold(top, f32::max);
    let line_height = block.style.font_size * block.style.line_height;
    let default_line_height = style.default_font_size * style.default_line_height;
    let text_height = (bottom - top).max(line_height).max(default_line_height);

    if is_complex_block(block) {
        return complex_block_height(block, text_height, line_height);
    }

    text_height
}

fn hit_test_entries_for_lines(
    lines: &[LayoutLine],
    excluded_block_ids: &[&str],
) -> Vec<HitTestEntry> {
    lines
        .iter()
        .flat_map(|line| {
            line.text_runs.iter().filter_map(|run| {
                if excluded_block_ids.contains(&run.block_id.as_str()) {
                    return None;
                }

                Some(HitTestEntry {
                    block_id: run.block_id.clone(),
                    rect: Rect {
                        x: run.left,
                        y: line.y,
                        width: run.width,
                        height: line.height,
                    },
                    pm_from: run.pm_from,
                    pm_to: run.pm_to,
                })
            })
        })
        .collect()
}

fn selection_geometries_for_lines(
    lines: &[LayoutLine],
    excluded_block_ids: &[&str],
) -> Vec<SelectionGeometry> {
    lines
        .iter()
        .flat_map(|line| {
            line.text_runs.iter().filter_map(|run| {
                if excluded_block_ids.contains(&run.block_id.as_str()) {
                    return None;
                }

                Some(SelectionGeometry {
                    pm_from: run.pm_from,
                    pm_to: run.pm_to,
                    rects: vec![Rect {
                        x: run.left,
                        y: line.y,
                        width: run.width,
                        height: line.height,
                    }],
                })
            })
        })
        .collect()
}

fn hit_test_entries_for_mirror_blocks(
    mirror_geometries: &[MirrorBlockGeometry],
) -> Vec<HitTestEntry> {
    mirror_geometries
        .iter()
        .map(|geometry| {
            let mirror = &geometry.mirror_block;
            HitTestEntry {
                block_id: mirror.block_id.clone(),
                rect: geometry.rect.clone(),
                pm_from: mirror.pm_from,
                pm_to: mirror.pm_to,
            }
        })
        .collect()
}

fn selection_geometries_for_mirror_blocks(
    mirror_geometries: &[MirrorBlockGeometry],
) -> Vec<SelectionGeometry> {
    mirror_geometries
        .iter()
        .map(|geometry| {
            let mirror = &geometry.mirror_block;
            SelectionGeometry {
                pm_from: mirror.pm_from,
                pm_to: mirror.pm_to,
                rects: vec![geometry.rect.clone()],
            }
        })
        .collect()
}

fn canvas_block_metadata(
    block: &LayoutBlock,
    block_lines: &[LayoutLine],
    style: &crate::StyleContext,
) -> Option<(CanvasDrawOp, MirrorBlock)> {
    let kind = match block.kind {
        BlockKind::Code => CanvasDrawKind::CodeHighlight,
        BlockKind::MathBlock => CanvasDrawKind::Math,
        BlockKind::Mermaid => CanvasDrawKind::Mermaid,
        BlockKind::Image => CanvasDrawKind::Image,
        BlockKind::Table => CanvasDrawKind::TableGrid,
        BlockKind::Html => CanvasDrawKind::Html,
        BlockKind::Fallback => CanvasDrawKind::Fallback,
        _ => return None,
    };
    let text = block_text(block);
    let font_size = block.style.font_size;
    let line_height = font_size * block.style.line_height;
    let text_height = block_height(block, block_lines, line_height);
    let width = complex_block_width(block, block_lines, font_size, style);
    let height = complex_block_height(block, text_height, line_height);
    let data = canvas_block_data(block, &text).to_string();
    let draw_op = CanvasDrawOp {
        block_id: block.block_id.clone(),
        kind,
        x: 0.0,
        y: block_lines.first().map(|line| line.y).unwrap_or(0.0),
        width,
        height,
        data,
    };
    let mirror_block = MirrorBlock {
        block_id: block.block_id.clone(),
        pm_from: block.pm_from,
        pm_to: block.pm_to,
        semantic_text: text.clone(),
        aria_label: format!("{} {}", block_kind_label(block), text),
    };

    Some((draw_op, mirror_block))
}

fn is_complex_block(block: &LayoutBlock) -> bool {
    matches!(
        block.kind,
        BlockKind::Code
            | BlockKind::MathBlock
            | BlockKind::Mermaid
            | BlockKind::Image
            | BlockKind::Table
            | BlockKind::Html
            | BlockKind::Fallback
    )
}

fn canvas_block_data(block: &LayoutBlock, text: &str) -> serde_json::Value {
    match block.kind {
        BlockKind::Code => serde_json::json!({
            "code": text,
            "text": text,
            "language": null,
        }),
        BlockKind::MathBlock => serde_json::json!({
            "content": text,
            "latex": text,
            "text": text,
        }),
        BlockKind::Mermaid => serde_json::json!({
            "code": text,
            "text": text,
            "ariaHiddenText": true,
        }),
        BlockKind::Html => serde_json::json!({
            "html": text,
            "markdown": text,
            "text": text,
        }),
        BlockKind::Fallback => serde_json::json!({
            "markdown": text,
            "text": text,
        }),
        BlockKind::Image => {
            let attrs = block.inlines.iter().find_map(|inline| {
                if matches!(inline.kind, InlineKind::ImageInline) || inline.attrs.contains_key("src") {
                    Some(&inline.attrs)
                } else {
                    None
                }
            });

            serde_json::json!({
                "src": attrs.and_then(|attrs| attrs.get("src")).cloned().unwrap_or_else(|| text.to_string()),
                "alt": attrs.and_then(|attrs| attrs.get("alt")).cloned().unwrap_or_default(),
                "title": attrs.and_then(|attrs| attrs.get("title")).cloned().unwrap_or_default(),
                "text": text,
            })
        }
        _ => serde_json::json!({
            "text": text,
            "kind": format!("{:?}", block.kind),
        }),
    }
}

fn block_text(block: &LayoutBlock) -> String {
    block
        .inlines
        .iter()
        .map(|inline| inline.text.as_str())
        .collect::<Vec<_>>()
        .join("")
}

fn block_width(block: &LayoutBlock, block_lines: &[LayoutLine], font_size: f32) -> f32 {
    block_lines
        .iter()
        .flat_map(|line| line.text_runs.iter())
        .map(|run| run.left + run.width)
        .fold(0.0, f32::max)
        .max(block_text(block).chars().count() as f32 * font_size * 0.6)
        .max(1.0)
}

fn complex_block_width(
    block: &LayoutBlock,
    block_lines: &[LayoutLine],
    font_size: f32,
    style: &crate::StyleContext,
) -> f32 {
    let text_width = block_width(block, block_lines, font_size);
    let column_width = (style.viewport_width - 40.0).max(1.0);

    if is_complex_block(block) {
        return text_width.max(column_width);
    }

    text_width
}

fn block_height(block: &LayoutBlock, block_lines: &[LayoutLine], line_height: f32) -> f32 {
    let top = block_lines.first().map(|line| line.y).unwrap_or(0.0);
    let bottom = block_lines
        .iter()
        .map(|line| line.y + line.height)
        .fold(top, f32::max);

    (bottom - top)
        .max(line_height * block_text(block).lines().count().max(1) as f32)
        .max(1.0)
}

fn complex_block_height(block: &LayoutBlock, text_height: f32, line_height: f32) -> f32 {
    let line_count = block_text(block).lines().count().max(1) as f32;

    match block.kind {
        BlockKind::Code => (line_height * line_count + 26.0).max(text_height + 26.0),
        BlockKind::MathBlock => (line_height * line_count + 36.0).max(56.0),
        BlockKind::Mermaid => (line_height * line_count + 112.0).max(180.0),
        BlockKind::Image => 160.0,
        BlockKind::Table => (line_height * line_count + 32.0).max(text_height + 24.0),
        BlockKind::Html | BlockKind::Fallback => {
            (line_height * line_count + 24.0).max(text_height + 16.0).max(48.0)
        }
        _ => text_height,
    }
}

fn block_kind_label(block: &LayoutBlock) -> &'static str {
    match block.kind {
        BlockKind::MathBlock => "math",
        BlockKind::Mermaid => "mermaid",
        BlockKind::Image => "image",
        BlockKind::Table => "table",
        BlockKind::Html => "html",
        BlockKind::Fallback => "unsupported",
        _ => "block",
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
    document_id: String,
    layout_ir_bytes: Vec<u8>,
    _style_context_bytes: Vec<u8>,
    _viewport_bytes: Vec<u8>,
    _platform_bytes: Vec<u8>,
) -> Vec<u8> {
    let Some(document) = parse_json::<LayoutDocument>(&layout_ir_bytes) else {
        return Vec::new();
    };
    let snapshot = build_snapshot(&document);
    remember_snapshot(&document_id, &snapshot);
    serialize_json(&snapshot)
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
    document_bytes: Vec<u8>,
    _device_pixel_ratio: f32,
) -> Vec<u8> {
    layout_update_document(
        document_id,
        revision,
        document_bytes,
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
    document_id: String,
    revision: u64,
    pm_from: u32,
    pm_to: u32,
) -> Vec<u8> {
    let geometry = remembered_snapshot(&document_id, revision)
        .map(|snapshot| {
            handle_selection_geometry(
                &snapshot.lines,
                &snapshot.selection_geometries,
                pm_from as usize,
                pm_to as usize,
            )
        })
        .unwrap_or(SelectionGeometry {
            pm_from: pm_from as usize,
            pm_to: pm_to as usize,
            rects: Vec::new(),
        });
    serialize_json(&geometry)
}

pub fn handle_selection_geometry(
    lines: &[LayoutLine],
    snapshot_geometries: &[SelectionGeometry],
    pm_from: usize,
    pm_to: usize,
) -> SelectionGeometry {
    if let Some(geometry) = snapshot_geometries
        .iter()
        .find(|geometry| geometry.pm_from <= pm_from && geometry.pm_to >= pm_to)
    {
        return SelectionGeometry {
            pm_from,
            pm_to,
            rects: geometry.rects.clone(),
        };
    }

    compute_selection_geometry(lines, pm_from, pm_to)
}
