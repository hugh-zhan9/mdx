//! What an exported document does with text the base-14 fonts cannot draw.
//!
//! These run against whatever CJK font the machine has. A host with none — a
//! Linux CI box, say — cannot answer the question at all, so the tests say so
//! and stop rather than reporting a pass they did not earn.

use lopdf::{Document, Object};
use pdf_core::export_pdf;
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use tempfile::tempdir;

fn snapshot_with_text(text: &str) -> String {
    format!(
        r#"{{
            "revision":1,
            "lines":[{{"id":"l1","blockId":"b1","y":0.0,"baseline":12.0,"height":18.0,
              "textRuns":[{{"blockId":"b1","left":0.0,"baseline":12.0,"width":200.0,"height":18.0,
                "fontFamily":"Helvetica","fontSize":14.0,"text":"{text}"}}]}}],
            "canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],
            "selectionGeometries":[],"mirrorBlocks":[]
        }}"#
    )
}

fn export(text: &str, file_name: &str) -> (Document, tempfile::TempDir) {
    let dir = tempdir().expect("temp dir");
    let out = dir.path().join(file_name);
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{}".into(),
        snapshot_with_text(text),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    export_pdf(&request).expect("export succeeds");

    (Document::load(&out).expect("pdf loads"), dir)
}

fn fonts_of(pdf: &Document) -> Vec<lopdf::Dictionary> {
    pdf.objects
        .values()
        .filter_map(|object| object.as_dict().ok())
        .filter(|dictionary| {
            dictionary
                .get(b"Type")
                .and_then(|value| value.as_name())
                .map(|name| name == b"Font")
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

fn page_content(pdf: &Document) -> String {
    let pages = pdf.get_pages();
    let content = pdf
        .get_page_content(*pages.get(&1).expect("page 1"))
        .expect("page content");

    String::from_utf8_lossy(&content).into_owned()
}

fn cjk_font_available() -> bool {
    font_core::discovery::load_cjk_font_file().is_ok()
}

#[test]
fn chinese_text_is_drawn_from_an_embedded_subset_not_helvetica() {
    if !cjk_font_available() {
        eprintln!("skipped: no CJK font on this host");
        return;
    }

    let (pdf, _dir) = export("手机电池循环次数", "chinese.pdf");
    let fonts = fonts_of(&pdf);

    let type0 = fonts
        .iter()
        .find(|font| {
            font.get(b"Subtype")
                .and_then(|value| value.as_name())
                .map(|name| name == b"Type0")
                .unwrap_or(false)
        })
        .expect("the document embeds a Type0 font");

    assert_eq!(
        type0
            .get(b"Encoding")
            .and_then(|value| value.as_name())
            .expect("encoding"),
        b"Identity-H",
    );
    assert!(type0.get(b"ToUnicode").is_ok(), "text stays selectable");

    // The Chinese run must not be written as raw UTF-8 into a Latin font,
    // which is what produced `‡›Ø‰ fłŁ§` on the page.
    let content = page_content(&pdf);
    assert!(content.contains("/F2"), "content stream: {content}");
    assert!(
        !content.contains("手机电池"),
        "run was written as literal bytes: {content}"
    );
}

#[test]
fn every_embedded_glyph_maps_back_to_its_character() {
    if !cjk_font_available() {
        eprintln!("skipped: no CJK font on this host");
        return;
    }

    let (pdf, _dir) = export("手机电池", "tounicode.pdf");
    let type0 = fonts_of(&pdf)
        .into_iter()
        .find(|font| {
            font.get(b"Subtype")
                .and_then(|value| value.as_name())
                .map(|name| name == b"Type0")
                .unwrap_or(false)
        })
        .expect("Type0 font");
    let cmap_id = type0
        .get(b"ToUnicode")
        .and_then(Object::as_reference)
        .expect("ToUnicode reference");
    let cmap = pdf
        .get_object(cmap_id)
        .and_then(|object| object.as_stream().map(|stream| stream.decompressed_content()))
        .expect("ToUnicode stream")
        .expect("decompresses");
    let cmap = String::from_utf8_lossy(&cmap);

    // Selecting the text in a reader has to give back the characters, not the
    // glyph ids the page is drawn with.
    for character in "手机电池".chars() {
        let destination = format!("<{:04X}>", character as u32);
        assert!(
            cmap.contains(&destination),
            "{character} is missing from the ToUnicode map: {cmap}"
        );
    }
}

#[test]
fn the_embedded_font_program_travels_with_the_document() {
    if !cjk_font_available() {
        eprintln!("skipped: no CJK font on this host");
        return;
    }

    let (pdf, _dir) = export("手机电池循环次数", "embedded.pdf");
    let descriptor = pdf
        .objects
        .values()
        .filter_map(|object| object.as_dict().ok())
        .find(|dictionary| {
            dictionary
                .get(b"Type")
                .and_then(|value| value.as_name())
                .map(|name| name == b"FontDescriptor")
                .unwrap_or(false)
        })
        .expect("the document describes the embedded font");

    let program_id = descriptor
        .get(b"FontFile3")
        .or_else(|_| descriptor.get(b"FontFile2"))
        .and_then(Object::as_reference)
        .expect("the font program is embedded");
    let program = pdf
        .get_object(program_id)
        .and_then(|object| object.as_stream().map(|stream| stream.content.len()))
        .expect("font program stream");

    assert!(program > 0, "the embedded program is not empty");
    // A subset, not the 20-70 MB collection the glyphs came out of.
    assert!(
        program < 2_000_000,
        "embedded program is {program} bytes, which is not a subset"
    );
}

#[test]
fn an_ascii_only_document_embeds_no_font_at_all() {
    let (pdf, _dir) = export("Hello world", "ascii.pdf");
    let fonts = fonts_of(&pdf);

    assert_eq!(fonts.len(), 1, "only the built-in Latin font is written");
    assert_eq!(
        fonts[0]
            .get(b"BaseFont")
            .and_then(|value| value.as_name())
            .expect("base font"),
        b"Helvetica",
    );
    assert!(page_content(&pdf).contains("(Hello world)"));
}
