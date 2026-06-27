use lopdf::content::Content;
use lopdf::Document;
use lopdf::Stream;
use pdf_core::export_pdf;
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use tempfile::tempdir;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

#[test]
fn exports_text_math_and_mermaid_without_placeholder_warning() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("vector.pdf");
    let request = PdfExportRequest::new(
        "doc-vector".into(),
        1,
        "{}".into(),
        r#"{
            "revision":1,
            "lines":[],
            "canvasDrawOps":[
                {"blockId":"code-1","kind":"CodeHighlight","x":24.0,"y":0.0,"width":120.0,"height":20.0,"data":"{\"text\":\"Hello\"}"},
                {"blockId":"math-1","kind":"Math","x":24.0,"y":30.0,"width":80.0,"height":24.0,"data":"{\"type\":\"text\",\"content\":\"x2\"}"},
                {"blockId":"math-rule","kind":"Math","x":24.0,"y":58.0,"width":80.0,"height":4.0,"data":"{\"type\":\"frac_line\"}"},
                {"blockId":"svg-1","kind":"Mermaid","x":24.0,"y":72.0,"width":160.0,"height":80.0,"data":"{\"svg\":\"<svg><rect x=\\\"0\\\" y=\\\"0\\\" width=\\\"40\\\" height=\\\"20\\\"/><line x1=\\\"0\\\" y1=\\\"0\\\" x2=\\\"40\\\" y2=\\\"20\\\"/><circle cx=\\\"20\\\" cy=\\\"10\\\" r=\\\"6\\\"/><text x=\\\"4\\\" y=\\\"14\\\">A</text></svg>\"}"},
                {"blockId":"image-1","kind":"Image","x":24.0,"y":164.0,"width":16.0,"height":16.0,"data":"{\"mimeType\":\"image/jpeg\",\"bytesBase64\":\"/9j/2Q==\",\"imageWidth\":1,\"imageHeight\":1}"}
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

    assert_eq!(result.page_count, 1);
    assert!(result
        .warnings
        .iter()
        .all(|warning| !warning.contains("placeholder")));
    assert!(std::fs::metadata(&out).unwrap().len() > 0);

    let pdf = Document::load(&out).expect("pdf loads");
    let page_id = *pdf.get_pages().get(&1).expect("page 1 id");
    let content = pdf.get_page_content(page_id).expect("page content");
    let ops = Content::decode(&content).expect("decode page content");

    assert!(ops.operations.iter().any(|op| op.operator == "Tj"));
    assert!(ops.operations.iter().any(|op| op.operator == "l"));
    assert!(ops.operations.iter().any(|op| op.operator == "c"));
    assert!(ops.operations.iter().any(|op| op.operator == "Do"));

    let image = first_page_image_stream(&pdf);
    assert_eq!(image.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
    assert_eq!(image.dict.get(b"Width").unwrap().as_i64().unwrap(), 1);
    assert_eq!(image.dict.get(b"Height").unwrap().as_i64().unwrap(), 1);
    assert_eq!(
        image.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
        b"DeviceRGB"
    );
    assert_eq!(
        image.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(),
        8
    );
    assert_eq!(image.dict.get(b"Filter").unwrap().as_name().unwrap(), b"DCTDecode");
    assert_eq!(image.content, vec![255, 216, 255, 217]);
}

#[test]
fn image_export_requires_external_bytes() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("missing-image.pdf");
    let request = PdfExportRequest::new(
        "doc-vector".into(),
        1,
        "{}".into(),
        r#"{
            "revision":1,
            "lines":[],
            "canvasDrawOps":[
                {"blockId":"image-1","kind":"Image","x":24.0,"y":24.0,"width":16.0,"height":16.0,"data":"{\"src\":\"missing.png\"}"}
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

    let err = export_pdf(&request).expect_err("missing image bytes should fail");
    assert!(err.contains("missing image bytes"));
}

#[test]
fn embeds_png_image_bytes_as_xobject() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("png-image.pdf");
    let png_bytes = red_pixel_png_base64();
    let snapshot = format!(
        r#"{{
            "revision":1,
            "lines":[],
            "canvasDrawOps":[
                {{"blockId":"image-1","kind":"Image","x":24.0,"y":24.0,"width":16.0,"height":16.0,"data":"{{\"mimeType\":\"image/png\",\"bytesBase64\":\"{png_bytes}\"}}"}}
            ],
            "hitTestEntries":[],
            "caretAnchors":[],
            "selectionGeometries":[],
            "mirrorBlocks":[]
        }}"#
    );
    let request = PdfExportRequest::new(
        "doc-vector".into(),
        1,
        "{}".into(),
        snapshot,
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let result = export_pdf(&request).expect("png export succeeds");
    assert_eq!(result.page_count, 1);

    let pdf = Document::load(&out).expect("pdf loads");
    let page_id = *pdf.get_pages().get(&1).expect("page 1 id");
    let content = pdf.get_page_content(page_id).expect("page content");
    let ops = Content::decode(&content).expect("decode page content");

    assert!(ops.operations.iter().any(|op| op.operator == "Do"));

    let image = first_page_image_stream(&pdf);
    assert_eq!(image.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
    assert_eq!(image.dict.get(b"Width").unwrap().as_i64().unwrap(), 1);
    assert_eq!(image.dict.get(b"Height").unwrap().as_i64().unwrap(), 1);
    assert_eq!(
        image.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
        b"DeviceRGB"
    );
    assert_eq!(
        image.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(),
        8
    );
    assert!(!image.dict.has(b"Filter"));
    assert_eq!(image.content, vec![255, 0, 0]);
}

fn first_page_image_stream(pdf: &Document) -> &Stream {
    let page_id = *pdf.get_pages().get(&1).expect("page 1 id");
    let page = pdf.get_dictionary(page_id).expect("page dictionary");
    let resources = pdf
        .get_dict_in_dict(page, b"Resources")
        .expect("page resources");
    let xobjects = pdf
        .get_dict_in_dict(resources, b"XObject")
        .expect("page xobjects");

    for (_name, object) in xobjects.iter() {
        let object_id = object.as_reference().expect("xobject reference");
        let stream = pdf
            .get_object(object_id)
            .expect("xobject object")
            .as_stream()
            .expect("xobject stream");
        if stream.dict.get(b"Subtype").unwrap().as_name().unwrap() == b"Image" {
            return stream;
        }
    }

    panic!("page has no image xobject");
}

fn red_pixel_png_base64() -> String {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0]).unwrap();
    }
    BASE64_STANDARD.encode(bytes)
}
