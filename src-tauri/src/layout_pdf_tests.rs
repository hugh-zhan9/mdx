use tempfile::tempdir;
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

#[test]
fn export_pdf_resolves_workspace_image_bytes() {
    let dir = tempdir().unwrap();
    let assets_dir = dir.path().join(".assets");
    std::fs::create_dir(&assets_dir).unwrap();
    std::fs::write(assets_dir.join("red.png"), red_pixel_png()).unwrap();
    let out = dir.path().join("out.pdf");
    let request = PdfExportRequest::new(
        "note.md".into(),
        1,
        "{}".into(),
        r#"{
            "revision":1,
            "lines":[],
            "canvasDrawOps":[
                {"blockId":"image-1","kind":"Image","x":24.0,"y":24.0,"width":16.0,"height":16.0,"data":"{\"src\":\".assets/red.png\"}"}
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

    let result = crate::layout_pdf::layout_export_pdf(
        dir.path().to_string_lossy().into_owned(),
        request,
    )
    .expect("export resolves image bytes");

    assert_eq!(result.page_count, 1);
    assert!(std::fs::metadata(out).unwrap().len() > 0);
}

fn red_pixel_png() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0]).unwrap();
    }
    bytes
}
