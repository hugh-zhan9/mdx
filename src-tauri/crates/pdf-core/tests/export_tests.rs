use lopdf::content::Content;
use lopdf::Document;
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

#[test]
fn exports_non_text_draw_ops_as_content_without_placeholder_warnings() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("draw-ops.pdf");
    let request = PdfExportRequest::new(
        "doc-3".into(),
        3,
        "{}".into(),
        r#"{
            "revision":3,
            "lines":[],
            "canvasDrawOps":[
                {"blockId":"math-1","kind":"Math","x":10.0,"y":20.0,"width":40.0,"height":20.0,"data":"{\"type\":\"text\",\"content\":\"x^2\"}"},
                {"blockId":"chart-1","kind":"Mermaid","x":20.0,"y":50.0,"width":80.0,"height":30.0,"data":"{\"text\":\"graph TD\"}"}
            ],
            "hitTestEntries":[],
            "caretAnchors":[],
            "selectionGeometries":[],
            "mirrorBlocks":[]
        }"#.into(),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let result = export_pdf(&request).expect("export succeeds");

    assert!(result.warnings.is_empty());

    let pdf = Document::load(&out).expect("pdf loads");
    let pages = pdf.get_pages();
    let page_content = pdf
        .get_page_content(*pages.get(&1).expect("page 1 id"))
        .unwrap();
    let ops = Content::decode(&page_content).expect("decode page");
    assert!(ops.operations.iter().any(|op| op.operator == "Tj"));
}

#[test]
fn writes_multi_page_pdf_with_text_content() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("multi-page.pdf");
    let request = PdfExportRequest::new(
        "doc-2".into(),
        2,
        "{}".into(),
        r#"{
            "revision":2,
            "lines":[
                {
                    "id":"l1",
                    "blockId":"b1",
                    "y":0.0,
                    "baseline":16.0,
                    "height":40.0,
                    "textRuns":[{"blockId":"b1","pmFrom":0,"pmTo":5,"left":12.0,"baseline":16.0,"width":40.0,"height":20.0,"fontFamily":"Helvetica","fontSize":14.0,"text":"Hello"}]
                },
                {
                    "id":"l2",
                    "blockId":"b2",
                    "y":240.0,
                    "baseline":256.0,
                    "height":40.0,
                    "textRuns":[{"blockId":"b2","pmFrom":6,"pmTo":11,"left":12.0,"baseline":256.0,"width":40.0,"height":20.0,"fontFamily":"Helvetica","fontSize":14.0,"text":"World"}]
                }
            ],
            "canvasDrawOps":[
                {"blockId":"grid-1","kind":"TableGrid","x":10.0,"y":245.0,"width":20.0,"height":10.0,"data":"{}"}
            ],
            "hitTestEntries":[],
            "caretAnchors":[],
            "selectionGeometries":[],
            "mirrorBlocks":[]
        }"#.into(),
        out.to_string_lossy().into_owned(),
        PageSize {
            width_pt: 200.0,
            height_pt: 119.0,
        },
        PageMargins::uniform(20.0),
        "subset".into(),
    );

    let result = export_pdf(&request).expect("export succeeds");
    assert_eq!(result.page_count, 2);

    let pdf = Document::load(&out).expect("pdf loads");
    let pages = pdf.get_pages();
    assert_eq!(pages.len(), 2);

    let first_page_content = pdf
        .get_page_content(*pages.get(&1).expect("page 1 id"))
        .unwrap();
    let second_page_content = pdf
        .get_page_content(*pages.get(&2).expect("page 2 id"))
        .unwrap();

    let first_ops = Content::decode(&first_page_content).expect("decode page 1");
    let second_ops = Content::decode(&second_page_content).expect("decode page 2");

    assert!(first_ops.operations.iter().any(|op| op.operator == "Tj"));
    assert!(second_ops.operations.iter().any(|op| op.operator == "Tj"));

    let second_td = second_ops
        .operations
        .iter()
        .find(|op| op.operator == "Td")
        .expect("page 2 text position");
    let second_y = second_td
        .operands
        .get(1)
        .and_then(|operand| operand.as_float().ok())
        .expect("page 2 y operand");
    assert!(
        second_y > 0.0,
        "page 2 text should be rebased into page-local coordinates"
    );
}
