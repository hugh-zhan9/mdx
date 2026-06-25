use pdf_core::model::{PdfExportRequest, PdfExportResult};

use crate::models::WorkspaceError;

pub fn validate_export_request(request: &PdfExportRequest) -> Result<(), WorkspaceError> {
    if !request.output_path.ends_with(".pdf") {
        return Err(WorkspaceError::new(
            "invalid_name",
            "PDF export path must end with .pdf",
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn layout_export_pdf(
    _root_path: String,
    request: PdfExportRequest,
) -> Result<PdfExportResult, WorkspaceError> {
    validate_export_request(&request)?;
    pdf_core::export_pdf(&request)
        .map_err(|error| WorkspaceError::new("pdf_export_failed", error))
}
