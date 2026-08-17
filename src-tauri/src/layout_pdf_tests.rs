use pdf_core::lopdf::content::Content;
use pdf_core::lopdf::{Document, Object};
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use tempfile::tempdir;

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
fn export_request_rejects_a_layout_computed_for_another_revision() {
    let request = PdfExportRequest::new(
        "note.md".into(),
        7,
        r#"{"documentId":"note.md","revision":7,"blocks":[]}"#.into(),
        r#"{"revision":9,"lines":[],"canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],"selectionGeometries":[],"mirrorBlocks":[]}"#.into(),
        "/tmp/out.pdf".into(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::validate_export_request(&request).unwrap_err();
    assert_eq!(err.error_code(), "revision_mismatch");
}

#[test]
fn export_request_rejects_a_layout_computed_for_another_document() {
    let request = PdfExportRequest::new(
        "note.md".into(),
        7,
        r#"{"documentId":"other.md","revision":7,"blocks":[]}"#.into(),
        r#"{"revision":7,"lines":[],"canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],"selectionGeometries":[],"mirrorBlocks":[]}"#.into(),
        "/tmp/out.pdf".into(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::validate_export_request(&request).unwrap_err();
    assert_eq!(err.error_code(), "revision_mismatch");
}

#[test]
fn export_request_accepts_a_layout_bound_to_the_exported_revision() {
    let request = PdfExportRequest::new(
        "note.md".into(),
        7,
        r#"{"documentId":"note.md","revision":7,"blocks":[]}"#.into(),
        r#"{"revision":7,"lines":[],"canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],"selectionGeometries":[],"mirrorBlocks":[]}"#.into(),
        "/tmp/out.pdf".into(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    crate::layout_pdf::validate_export_request(&request).expect("bound request validates");
}

#[test]
#[cfg(unix)]
fn export_pdf_reports_a_denied_output_path_without_writing_a_file() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let locked = dir.path().join("locked");
    std::fs::create_dir(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();

    let out = locked.join("out.pdf");
    let request = PdfExportRequest::new(
        "note.md".into(),
        1,
        empty_layout_document("note.md", 1),
        empty_layout_snapshot(1),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::layout_export_pdf(
        dir.path().to_string_lossy().into_owned(),
        request,
    )
    .expect_err("a denied output path fails the export");

    assert_eq!(err.error_code(), "output_path_denied");
    assert!(!out.exists(), "a refused export leaves no file behind");

    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn export_pdf_reports_an_image_read_failure_without_writing_a_file() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.pdf");
    let request = PdfExportRequest::new(
        "note.md".into(),
        1,
        empty_layout_document("note.md", 1),
        r#"{
            "revision":1,
            "lines":[],
            "canvasDrawOps":[
                {"blockId":"image-0","kind":"Image","x":24.0,"y":24.0,"width":16.0,"height":16.0,"data":"{\"src\":\".assets/missing.png\"}"}
            ],
            "hitTestEntries":[],
            "caretAnchors":[],
            "selectionGeometries":[],
            "mirrorBlocks":[]
        }"#
        .into(),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::layout_export_pdf(
        dir.path().to_string_lossy().into_owned(),
        request,
    )
    .expect_err("a missing image fails the export");

    assert_eq!(err.error_code(), "image_read_failed");
    assert!(!out.exists(), "a refused export leaves no file behind");
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
        empty_layout_document("note.md", 1),
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

/// The exported PDF carries the same content the screen shows.
///
/// This compares semantics, never pixels: the heading and body words, the code
/// and math text, the destination a link points at, and the presence of the
/// image — no position, size or colour is asserted anywhere.
#[test]
fn export_pdf_keeps_the_content_semantics_of_the_captured_revision() {
    let dir = tempdir().unwrap();
    let assets_dir = dir.path().join(".assets");
    std::fs::create_dir(&assets_dir).unwrap();
    std::fs::write(assets_dir.join("red.png"), red_pixel_png()).unwrap();
    let out = dir.path().join("semantics.pdf");

    let request = PdfExportRequest::new(
        "note.md".into(),
        4,
        empty_layout_document("note.md", 4),
        r#"{
            "revision":4,
            "lines":[
                {
                    "id":"line-heading",
                    "blockId":"heading-0",
                    "y":0.0,
                    "baseline":24.0,
                    "height":32.0,
                    "textRuns":[{"blockId":"heading-0","left":12.0,"baseline":24.0,"width":120.0,"height":28.0,"fontFamily":"Helvetica","fontSize":28.0,"text":"Release notes"}]
                },
                {
                    "id":"line-body",
                    "blockId":"paragraph-1",
                    "y":40.0,
                    "baseline":56.0,
                    "height":20.0,
                    "textRuns":[
                        {"blockId":"paragraph-1","left":12.0,"baseline":56.0,"width":60.0,"height":16.0,"fontFamily":"Helvetica","fontSize":14.0,"text":"See the "},
                        {"blockId":"paragraph-1","left":72.0,"baseline":56.0,"width":50.0,"height":16.0,"fontFamily":"Helvetica","fontSize":14.0,"text":"changelog","style":{"link":"https://example.com/changelog"}}
                    ]
                },
                {
                    "id":"line-code",
                    "blockId":"code-2",
                    "y":80.0,
                    "baseline":96.0,
                    "height":20.0,
                    "textRuns":[{"blockId":"code-2","left":12.0,"baseline":96.0,"width":80.0,"height":16.0,"fontFamily":"Helvetica","fontSize":13.0,"text":"let total = 1;"}]
                }
            ],
            "canvasDrawOps":[
                {"blockId":"math-3","kind":"Math","x":12.0,"y":88.0,"width":60.0,"height":20.0,"data":"{\"type\":\"text\",\"content\":\"E = mc^2\"}"},
                {"blockId":"image-4","kind":"Image","x":12.0,"y":92.0,"width":16.0,"height":16.0,"data":"{\"src\":\".assets/red.png\"}"}
            ],
            "hitTestEntries":[],
            "caretAnchors":[],
            "selectionGeometries":[],
            "mirrorBlocks":[]
        }"#
        .into(),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let result = crate::layout_pdf::layout_export_pdf(
        dir.path().to_string_lossy().into_owned(),
        request,
    )
    .expect("semantic fixture exports");

    assert_eq!(result.page_count, 1);

    let pdf = Document::load(&out).expect("exported pdf loads");
    let page_id = *pdf.get_pages().get(&1).expect("page 1");
    let drawn = drawn_text(&pdf, page_id);

    assert!(drawn.contains(&"Release notes".to_string()), "heading: {drawn:?}");
    assert!(drawn.contains(&"See the ".to_string()), "body: {drawn:?}");
    assert!(drawn.contains(&"changelog".to_string()), "link text: {drawn:?}");
    assert!(drawn.contains(&"let total = 1;".to_string()), "code: {drawn:?}");
    assert!(drawn.contains(&"E = mc^2".to_string()), "math: {drawn:?}");

    assert_eq!(
        link_destinations(&pdf, page_id),
        vec!["https://example.com/changelog".to_string()],
        "the exported document keeps where the link points",
    );
    assert!(
        page_has_image(&pdf, page_id),
        "the exported document keeps the image",
    );
}

fn empty_layout_document(document_id: &str, revision: u64) -> String {
    format!(r#"{{"documentId":"{document_id}","revision":{revision},"blocks":[]}}"#)
}

fn empty_layout_snapshot(revision: u64) -> String {
    format!(
        r#"{{"revision":{revision},"lines":[],"canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],"selectionGeometries":[],"mirrorBlocks":[]}}"#
    )
}

fn drawn_text(pdf: &Document, page_id: (u32, u16)) -> Vec<String> {
    let content = pdf.get_page_content(page_id).expect("page content");
    Content::decode(&content)
        .expect("decode page content")
        .operations
        .iter()
        .filter(|operation| operation.operator == "Tj")
        .filter_map(|operation| operation.operands.first().cloned())
        .filter_map(|operand| match operand {
            Object::String(bytes, _) => Some(String::from_utf8_lossy(&bytes).into_owned()),
            _ => None,
        })
        .collect()
}

fn link_destinations(pdf: &Document, page_id: (u32, u16)) -> Vec<String> {
    let page = pdf.get_dictionary(page_id).expect("page dictionary");
    let Ok(annotations) = page.get(b"Annots") else {
        return Vec::new();
    };
    let annotations = annotations.as_array().expect("annotation array");

    annotations
        .iter()
        .filter_map(|annotation| {
            let dictionary = match annotation {
                Object::Reference(id) => pdf.get_dictionary(*id).ok()?,
                Object::Dictionary(dictionary) => dictionary,
                _ => return None,
            };

            if dictionary.get(b"Subtype").ok()?.as_name().ok()? != b"Link" {
                return None;
            }

            let action = dictionary.get(b"A").ok()?.as_dict().ok()?;
            let uri = action.get(b"URI").ok()?.as_str().ok()?;
            Some(String::from_utf8_lossy(uri).into_owned())
        })
        .collect()
}

fn page_has_image(pdf: &Document, page_id: (u32, u16)) -> bool {
    let page = pdf.get_dictionary(page_id).expect("page dictionary");
    let Ok(resources) = page.get(b"Resources").and_then(|value| value.as_dict()) else {
        return false;
    };
    let Ok(xobjects) = resources.get(b"XObject").and_then(|value| value.as_dict()) else {
        return false;
    };

    xobjects.iter().any(|(_, value)| match value {
        Object::Reference(id) => pdf
            .get_object(*id)
            .ok()
            .and_then(|object| object.as_stream().ok())
            .map(|stream| {
                stream
                    .dict
                    .get(b"Subtype")
                    .and_then(|subtype| subtype.as_name())
                    .map(|name| name == b"Image")
                    .unwrap_or(false)
            })
            .unwrap_or(false),
        _ => false,
    })
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
