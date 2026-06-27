use layout_core::{CanvasDrawKind, CanvasDrawOp, LayoutLine, LayoutSnapshot};
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use pdf_core::paginate_snapshot;

#[test]
fn export_request_defaults_to_a4_points() {
    let page = PageSize::a4_points();
    let margins = PageMargins::uniform(72.0);
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{}".into(),
        "{}".into(),
        "/tmp/out.pdf".into(),
        page,
        margins,
        "subset".into(),
    );

    assert_eq!(request.document_id, "doc-1");
    assert_eq!(request.page_size.width_pt, 595.0);
    assert_eq!(request.margins.left_pt, 72.0);
}

#[test]
fn paginates_lines_by_available_height() {
    let snapshot = LayoutSnapshot {
        revision: 1,
        lines: vec![
            LayoutLine {
                id: "l1".into(),
                block_id: "b1".into(),
                y: 0.0,
                baseline: 12.0,
                height: 24.0,
                text_runs: vec![],
            },
            LayoutLine {
                id: "l2".into(),
                block_id: "b1".into(),
                y: 24.0,
                baseline: 36.0,
                height: 24.0,
                text_runs: vec![],
            },
            LayoutLine {
                id: "l3".into(),
                block_id: "b1".into(),
                y: 48.0,
                baseline: 60.0,
                height: 24.0,
                text_runs: vec![],
            },
        ],
        canvas_draw_ops: vec![
            CanvasDrawOp {
                block_id: "math-1".into(),
                kind: CanvasDrawKind::Math,
                x: 0.0,
                y: 20.0,
                width: 30.0,
                height: 10.0,
                data: "{}".into(),
            },
            CanvasDrawOp {
                block_id: "math-2".into(),
                kind: CanvasDrawKind::Math,
                x: 0.0,
                y: 60.0,
                width: 30.0,
                height: 10.0,
                data: "{}".into(),
            },
        ],
        hit_test_entries: vec![],
        caret_anchors: vec![],
        selection_geometries: vec![],
        mirror_blocks: vec![],
    };

    let pages = paginate_snapshot(
        &snapshot,
        &PageSize {
            width_pt: 300.0,
            height_pt: 94.0,
        },
        &PageMargins::uniform(12.0),
    );

    assert_eq!(pages.pages.len(), 2);
    assert_eq!(pages.pages[0].number, 1);
    assert_eq!(pages.pages[1].number, 2);
    assert_eq!(pages.pages[0].lines.len(), 2);
    assert_eq!(pages.pages[1].lines.len(), 1);
    assert_eq!(pages.pages[0].draw_ops.len(), 1);
    assert_eq!(pages.pages[0].draw_ops[0].block_id, "math-1");
    assert_eq!(pages.pages[1].draw_ops.len(), 1);
    assert_eq!(pages.pages[1].draw_ops[0].block_id, "math-2");
}

#[test]
fn keeps_exact_fit_line_on_the_current_page() {
    let snapshot = LayoutSnapshot {
        revision: 1,
        lines: vec![
            LayoutLine {
                id: "l1".into(),
                block_id: "b1".into(),
                y: 0.0,
                baseline: 12.0,
                height: 24.0,
                text_runs: vec![],
            },
            LayoutLine {
                id: "l2".into(),
                block_id: "b1".into(),
                y: 24.0,
                baseline: 36.0,
                height: 24.0,
                text_runs: vec![],
            },
            LayoutLine {
                id: "l3".into(),
                block_id: "b1".into(),
                y: 48.0,
                baseline: 60.0,
                height: 24.0,
                text_runs: vec![],
            },
        ],
        canvas_draw_ops: vec![],
        hit_test_entries: vec![],
        caret_anchors: vec![],
        selection_geometries: vec![],
        mirror_blocks: vec![],
    };

    let pages = paginate_snapshot(
        &snapshot,
        &PageSize {
            width_pt: 300.0,
            height_pt: 96.0,
        },
        &PageMargins::uniform(12.0),
    );

    assert_eq!(pages.pages.len(), 1);
    assert_eq!(pages.pages[0].lines.len(), 3);
}

#[test]
fn paginates_draw_ops_when_snapshot_has_no_text_lines() {
    let snapshot = LayoutSnapshot {
        revision: 1,
        lines: vec![],
        canvas_draw_ops: vec![
            CanvasDrawOp {
                block_id: "math-1".into(),
                kind: CanvasDrawKind::Math,
                x: 0.0,
                y: 20.0,
                width: 30.0,
                height: 10.0,
                data: "{}".into(),
            },
            CanvasDrawOp {
                block_id: "image-1".into(),
                kind: CanvasDrawKind::Image,
                x: 0.0,
                y: 120.0,
                width: 30.0,
                height: 10.0,
                data: "{}".into(),
            },
        ],
        hit_test_entries: vec![],
        caret_anchors: vec![],
        selection_geometries: vec![],
        mirror_blocks: vec![],
    };

    let pages = paginate_snapshot(
        &snapshot,
        &PageSize {
            width_pt: 300.0,
            height_pt: 100.0,
        },
        &PageMargins::uniform(10.0),
    );

    assert_eq!(pages.pages.len(), 2);
    assert_eq!(pages.pages[0].draw_ops[0].block_id, "math-1");
    assert_eq!(pages.pages[1].draw_ops[0].block_id, "image-1");
    assert_eq!(pages.pages[1].draw_ops[0].y, 40.0);
}
