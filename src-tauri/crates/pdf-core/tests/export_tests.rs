use pdf_core::export_pdf;
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use tempfile::tempdir;

#[test]
fn writes_non_empty_pdf_file() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.pdf");
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{\"documentId\":\"doc-1\",\"revision\":1,\"blocks\":[],\"styleContext\":{\"defaultFontSize\":14.0,\"defaultFontFamily\":\"Helvetica\",\"defaultLineHeight\":1.5,\"viewportWidth\":800.0,\"viewportHeight\":600.0,\"devicePixelRatio\":1.0}}".into(),
        "{\"revision\":1,\"lines\":[],\"canvasDrawOps\":[],\"hitTestEntries\":[],\"caretAnchors\":[],\"selectionGeometries\":[],\"mirrorBlocks\":[]}".into(),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let result = export_pdf(&request).expect("export succeeds");
    assert_eq!(result.page_count, 1);
    assert!(std::fs::metadata(out).unwrap().len() > 0);
}
