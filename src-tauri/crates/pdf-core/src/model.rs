use crate::{CanvasDrawOp, LayoutLine, LayoutSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageSize {
    pub width_pt: f32,
    pub height_pt: f32,
}

impl PageSize {
    pub fn a4_points() -> Self {
        Self {
            width_pt: 595.0,
            height_pt: 842.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageMargins {
    pub top_pt: f32,
    pub right_pt: f32,
    pub bottom_pt: f32,
    pub left_pt: f32,
}

impl PageMargins {
    pub fn uniform(value: f32) -> Self {
        Self {
            top_pt: value,
            right_pt: value,
            bottom_pt: value,
            left_pt: value,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportRequest {
    pub document_id: String,
    pub revision: u64,
    pub layout_document_json: String,
    pub layout_snapshot_json: String,
    pub output_path: String,
    pub page_size: PageSize,
    pub margins: PageMargins,
    pub font_embed_mode: String,
}

impl PdfExportRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        document_id: String,
        revision: u64,
        layout_document_json: String,
        layout_snapshot_json: String,
        output_path: String,
        page_size: PageSize,
        margins: PageMargins,
        font_embed_mode: String,
    ) -> Self {
        Self {
            document_id,
            revision,
            layout_document_json,
            layout_snapshot_json,
            output_path,
            page_size,
            margins,
            font_embed_mode,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportResult {
    pub page_count: usize,
    pub warnings: Vec<String>,
    pub export_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedPage {
    pub number: usize,
    pub lines: Vec<LayoutLine>,
    pub draw_ops: Vec<CanvasDrawOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedDocument {
    pub snapshot: LayoutSnapshot,
    pub page_size: PageSize,
    pub margins: PageMargins,
    pub pages: Vec<PaginatedPage>,
}
