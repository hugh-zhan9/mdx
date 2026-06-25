use font_core::discovery::{discover_system_fonts, get_default_font};
use font_kit::handle::Handle;
use font_kit::source::SystemSource;
use ttf_parser::Face;

#[test]
fn test_discover_fonts() {
    let fonts = discover_system_fonts();
    assert!(!fonts.is_empty(), "should find at least some system fonts");
}

#[test]
fn test_default_font() {
    let default = get_default_font();
    assert!(default.is_some(), "should have a default system font");

    let default = default.unwrap();
    assert!(!default.postscript_name.is_empty());
    assert!(!default.family_name.is_empty());
}

#[test]
fn test_math_font_detection() {
    let fonts = discover_system_fonts();
    let math_fonts: Vec<_> = fonts.iter().filter(|font| font.math_available).collect();

    if math_fonts.is_empty() {
        eprintln!("No system font with a MATH table was discoverable in this environment.");
        return;
    }

    let source = SystemSource::new();
    for font in math_fonts {
        let handle = source
            .select_by_postscript_name(&font.postscript_name)
            .unwrap_or_else(|_| panic!("missing handle for {}", font.postscript_name));

        assert!(
            handle_has_math_table(&handle),
            "font {} was marked as math-enabled without a MATH table",
            font.postscript_name
        );
    }
}

fn handle_has_math_table(handle: &Handle) -> bool {
    match handle {
        Handle::Path { path, font_index } => std::fs::read(path)
            .ok()
            .and_then(|bytes| face_has_math_table(&bytes, *font_index)),
        Handle::Memory { bytes, font_index } => face_has_math_table(bytes, *font_index),
    }
    .unwrap_or(false)
}

fn face_has_math_table(data: &[u8], font_index: u32) -> Option<bool> {
    Face::parse(data, font_index)
        .ok()
        .map(|face| face.tables().math.is_some())
}
