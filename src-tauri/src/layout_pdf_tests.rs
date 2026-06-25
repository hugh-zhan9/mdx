use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};

#[test]
fn export_request_rejects_non_pdf_output_paths() {
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{}".into(),
        "{}".into(),
        "/tmp/out.txt".into(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::validate_export_request(&request).unwrap_err();
    assert_eq!(err.error_code(), "invalid_name");
}
