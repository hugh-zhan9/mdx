use std::time::Instant;

use layout_core::{
    CanvasDrawKind, CanvasDrawOp, CaretAnchor, HitTestEntry, LayoutLine, LayoutSnapshot,
    MirrorBlock, Rect, SelectionGeometry, TextRunPosition,
};
use lopdf::{
    content::{Content, Operation},
    dictionary, Document, Object, Stream,
};
use serde::Deserialize;

use crate::model::{PdfExportRequest, PdfExportResult};
use crate::pagination::paginate_snapshot;

pub fn export_pdf(request: &PdfExportRequest) -> Result<PdfExportResult, String> {
    let started = Instant::now();
    let snapshot = parse_layout_snapshot(&request.layout_snapshot_json)?;
    let paginated = paginate_snapshot(&snapshot, &request.page_size, &request.margins);

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let mut page_ids = Vec::new();
    let page_count = paginated.pages.len().max(1);
    for page_index in 0..page_count {
        let page = paginated.pages.get(page_index);
        let mut content = Content {
            operations: Vec::new(),
        };

        for line in page.map(|page| page.lines.as_slice()).unwrap_or(&[]) {
            for run in &line.text_runs {
                content.operations.push(Operation::new("BT", vec![]));
                content.operations.push(Operation::new(
                    "Tf",
                    vec![Object::Name(b"F1".to_vec()), run.font_size.into()],
                ));
                content.operations.push(Operation::new(
                    "Td",
                    vec![
                        run.left.into(),
                        (request.page_size.height_pt
                            - request.margins.top_pt
                            - (line.y + (run.baseline - line.baseline)))
                            .into(),
                    ],
                ));
                content.operations.push(Operation::new(
                    "Tj",
                    vec![Object::string_literal(run.text.clone())],
                ));
                content.operations.push(Operation::new("ET", vec![]));
            }
        }

        for draw_op in page.map(|page| page.draw_ops.as_slice()).unwrap_or(&[]) {
            if matches!(
                draw_op.kind,
                CanvasDrawKind::TableGrid | CanvasDrawKind::Decoration
            ) {
                let bottom = request.page_size.height_pt - request.margins.top_pt - draw_op.y;
                let top = bottom - draw_op.height;
                content.operations.push(Operation::new("q", vec![]));
                content.operations.push(Operation::new("w", vec![1.into()]));
                content.operations.push(Operation::new(
                    "re",
                    vec![
                        draw_op.x.into(),
                        top.into(),
                        draw_op.width.into(),
                        draw_op.height.into(),
                    ],
                ));
                content.operations.push(Operation::new("S", vec![]));
                content.operations.push(Operation::new("Q", vec![]));
            }
        }

        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().map_err(|error| error.to_string())?,
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id }
            },
            "MediaBox" => vec![
                0.into(),
                0.into(),
                request.page_size.width_pt.into(),
                request.page_size.height_pt.into()
            ],
        });
        page_ids.push(page_id);
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(&request.output_path)
        .map_err(|error| error.to_string())?;

    Ok(PdfExportResult {
        page_count: page_ids.len(),
        warnings: Vec::new(),
        export_ms: started.elapsed().as_millis() as u64,
    })
}

fn parse_layout_snapshot(snapshot_json: &str) -> Result<LayoutSnapshot, String> {
    let snapshot: LayoutSnapshotCompat =
        serde_json::from_str(snapshot_json).map_err(|error| error.to_string())?;

    Ok(LayoutSnapshot {
        revision: snapshot.revision,
        lines: snapshot.lines.into_iter().map(Into::into).collect(),
        canvas_draw_ops: snapshot
            .canvas_draw_ops
            .into_iter()
            .map(Into::into)
            .collect(),
        hit_test_entries: snapshot
            .hit_test_entries
            .into_iter()
            .map(Into::into)
            .collect(),
        caret_anchors: snapshot.caret_anchors.into_iter().map(Into::into).collect(),
        selection_geometries: snapshot
            .selection_geometries
            .into_iter()
            .map(Into::into)
            .collect(),
        mirror_blocks: snapshot.mirror_blocks.into_iter().map(Into::into).collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutSnapshotCompat {
    revision: u64,
    lines: Vec<LayoutLineCompat>,
    canvas_draw_ops: Vec<CanvasDrawOpCompat>,
    hit_test_entries: Vec<HitTestEntryCompat>,
    caret_anchors: Vec<CaretAnchorCompat>,
    selection_geometries: Vec<SelectionGeometryCompat>,
    mirror_blocks: Vec<MirrorBlockCompat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutLineCompat {
    id: String,
    block_id: String,
    y: f32,
    baseline: f32,
    height: f32,
    text_runs: Vec<TextRunPositionCompat>,
}

impl From<LayoutLineCompat> for LayoutLine {
    fn from(value: LayoutLineCompat) -> Self {
        Self {
            id: value.id,
            block_id: value.block_id,
            y: value.y,
            baseline: value.baseline,
            height: value.height,
            text_runs: value.text_runs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRunPositionCompat {
    block_id: String,
    pm_from: usize,
    pm_to: usize,
    left: f32,
    baseline: f32,
    width: f32,
    height: f32,
    font_family: String,
    font_size: f32,
    text: String,
}

impl From<TextRunPositionCompat> for TextRunPosition {
    fn from(value: TextRunPositionCompat) -> Self {
        Self {
            block_id: value.block_id,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            left: value.left,
            baseline: value.baseline,
            width: value.width,
            height: value.height,
            font_family: value.font_family,
            font_size: value.font_size,
            text: value.text,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasDrawOpCompat {
    block_id: String,
    kind: CanvasDrawKind,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    data: String,
}

impl From<CanvasDrawOpCompat> for CanvasDrawOp {
    fn from(value: CanvasDrawOpCompat) -> Self {
        Self {
            block_id: value.block_id,
            kind: value.kind,
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            data: value.data,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitTestEntryCompat {
    block_id: String,
    rect: Rect,
    pm_from: usize,
    pm_to: usize,
}

impl From<HitTestEntryCompat> for HitTestEntry {
    fn from(value: HitTestEntryCompat) -> Self {
        Self {
            block_id: value.block_id,
            rect: value.rect,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaretAnchorCompat {
    line_id: String,
    pm_position: usize,
    x: f32,
    y: f32,
    height: f32,
}

impl From<CaretAnchorCompat> for CaretAnchor {
    fn from(value: CaretAnchorCompat) -> Self {
        Self {
            line_id: value.line_id,
            pm_position: value.pm_position,
            x: value.x,
            y: value.y,
            height: value.height,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionGeometryCompat {
    pm_from: usize,
    pm_to: usize,
    rects: Vec<Rect>,
}

impl From<SelectionGeometryCompat> for SelectionGeometry {
    fn from(value: SelectionGeometryCompat) -> Self {
        Self {
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            rects: value.rects,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorBlockCompat {
    block_id: String,
    pm_from: usize,
    pm_to: usize,
    semantic_text: String,
    aria_label: String,
}

impl From<MirrorBlockCompat> for MirrorBlock {
    fn from(value: MirrorBlockCompat) -> Self {
        Self {
            block_id: value.block_id,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            semantic_text: value.semantic_text,
            aria_label: value.aria_label,
        }
    }
}
