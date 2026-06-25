use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};

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
