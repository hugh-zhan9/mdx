use std::path::Path;

use pdf_core::model::{PdfExportRequest, PdfExportResult};
use serde_json::Value;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use crate::assets::load_image_asset;
use crate::models::WorkspaceError;

pub fn validate_export_request(request: &PdfExportRequest) -> Result<(), WorkspaceError> {
    if !request.output_path.ends_with(".pdf") {
        return Err(WorkspaceError::new(
            "invalid_name",
            "PDF export path must end with .pdf",
        ));
    }

    validate_revision_binding(request)?;

    Ok(())
}

/// Rejects a payload whose layout was not computed for the exported revision.
///
/// An export is captured against one document revision and the output has to
/// correspond to that revision. Editing during an export is allowed, so the
/// only thing that keeps the output honest is refusing a layout that answered
/// for anything other than the captured revision.
fn validate_revision_binding(request: &PdfExportRequest) -> Result<(), WorkspaceError> {
    let document = parse_payload(&request.layout_document_json)?;
    let snapshot = parse_payload(&request.layout_snapshot_json)?;

    for (payload, label) in [(&document, "layout document"), (&snapshot, "layout snapshot")] {
        let Some(revision) = payload.get("revision").and_then(Value::as_u64) else {
            continue;
        };

        if revision != request.revision {
            return Err(WorkspaceError::new(
                "revision_mismatch",
                format!(
                    "{label} is for revision {revision}, export requested revision {}",
                    request.revision
                ),
            ));
        }
    }

    if let Some(document_id) = document.get("documentId").and_then(Value::as_str) {
        if document_id != request.document_id {
            return Err(WorkspaceError::new(
                "revision_mismatch",
                format!(
                    "layout document is for {document_id}, export requested {}",
                    request.document_id
                ),
            ));
        }
    }

    Ok(())
}

fn parse_payload(json: &str) -> Result<Value, WorkspaceError> {
    serde_json::from_str(json)
        .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))
}

/// Refuses an output path the process cannot write, without leaving a file.
///
/// This runs after every stage that can still fail, so a refused export never
/// leaves an empty or partial PDF behind for the user to mistake for a result.
fn ensure_output_writable(output_path: &str) -> Result<(), WorkspaceError> {
    let output = Path::new(output_path);
    let existed = output.exists();

    match std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(output)
    {
        Ok(_) => {
            if !existed {
                let _ = std::fs::remove_file(output);
            }

            Ok(())
        }
        Err(error) => Err(WorkspaceError::from_io(
            "output_path_denied",
            "cannot write the PDF export path",
            &error,
        )),
    }
}

#[tauri::command]
pub fn layout_export_pdf(
    root_path: String,
    request: PdfExportRequest,
) -> Result<PdfExportResult, WorkspaceError> {
    validate_export_request(&request)?;
    let request = enrich_image_draw_ops(root_path, request)?;
    ensure_output_writable(&request.output_path)?;
    pdf_core::export_pdf(&request).map_err(|error| WorkspaceError::new("pdf_export_failed", error))
}

fn enrich_image_draw_ops(
    root_path: String,
    mut request: PdfExportRequest,
) -> Result<PdfExportRequest, WorkspaceError> {
    let mut snapshot: Value = serde_json::from_str(&request.layout_snapshot_json)
        .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))?;
    let draw_ops_key = if snapshot.get("canvasDrawOps").is_some() {
        "canvasDrawOps"
    } else {
        "canvas_draw_ops"
    };
    let Some(draw_ops) = snapshot
        .get_mut(draw_ops_key)
        .and_then(Value::as_array_mut)
    else {
        request.layout_snapshot_json = serde_json::to_string(&snapshot)
            .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))?;
        return Ok(request);
    };

    for draw_op in draw_ops {
        if draw_op.get("kind").and_then(Value::as_str) != Some("Image") {
            continue;
        }

        let Some(data_string) = draw_op.get("data").and_then(Value::as_str) else {
            continue;
        };
        let mut data: Value = serde_json::from_str(data_string)
            .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))?;
        if data
            .get("bytesBase64")
            .or_else(|| data.get("bytes_base64"))
            .is_some()
        {
            continue;
        }

        let Some(src) = data
            .get("src")
            .or_else(|| data.get("text"))
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        // Image failures during an export are reported under one publishing
        // code. The asset loader's own codes describe file resolution, and two
        // of them collide with codes this command already uses for other
        // reasons, which would leave the caller unable to tell what failed.
        let image = load_image_asset(
            Some(root_path.clone()),
            Some(request.document_id.clone()),
            src,
        )
        .map_err(|error| WorkspaceError::new("image_read_failed", error.to_string()))?;

        data["mimeType"] = Value::String(image.mime_type);
        data["bytesBase64"] = Value::String(BASE64_STANDARD.encode(image.bytes));
        draw_op["data"] = Value::String(
            serde_json::to_string(&data)
                .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))?,
        );
    }

    request.layout_snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|error| WorkspaceError::new("invalid_pdf_snapshot", error.to_string()))?;
    Ok(request)
}
