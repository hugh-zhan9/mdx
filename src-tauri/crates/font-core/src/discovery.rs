use crate::FontDescriptor;
use font_kit::handle::Handle;
use font_kit::properties::Style;
use font_kit::source::SystemSource;
use std::collections::HashSet;
use std::fs;
use ttf_parser::Face;

pub fn discover_system_fonts() -> Vec<FontDescriptor> {
    #[cfg(target_os = "macos")]
    {
        let fonts = platform::discover_system_fonts();
        if !fonts.is_empty() {
            return fonts;
        }
    }

    discover_with_font_kit()
}

pub fn get_default_font() -> Option<FontDescriptor> {
    #[cfg(target_os = "macos")]
    {
        if let Some(font) = platform::get_default_font() {
            return Some(font);
        }
    }

    select_default_from_discovered(discover_with_font_kit())
}

fn discover_with_font_kit() -> Vec<FontDescriptor> {
    let source = SystemSource::new();
    let mut seen_postscript = HashSet::new();
    let mut descriptors = Vec::new();

    if let Ok(handles) = source.all_fonts() {
        for handle in handles {
            if let Some(font) = font_descriptor_from_handle(&handle) {
                if seen_postscript.insert(font.postscript_name.clone()) {
                    descriptors.push(font);
                }
            }
        }
    }

    descriptors
}

fn font_descriptor_from_handle(handle: &Handle) -> Option<FontDescriptor> {
    let font = handle.load().ok()?;
    let postscript_name = font.postscript_name()?;
    let properties = font.properties();

    Some(FontDescriptor {
        font_id: postscript_name.clone(),
        family_name: font.family_name(),
        weight: properties.weight.0.round().clamp(1.0, u16::MAX as f32) as u16,
        style: style_label(properties.style),
        postscript_name,
        math_available: handle_has_math_table(handle),
    })
}

fn handle_has_math_table(handle: &Handle) -> bool {
    match handle {
        Handle::Path { path, font_index } => fs::read(path)
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

fn style_label(style: Style) -> String {
    match style {
        Style::Normal => "normal",
        Style::Italic => "italic",
        Style::Oblique => "oblique",
    }
    .to_string()
}

fn default_family_candidates() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &[
            ".AppleSystemUIFont",
            "SF Pro Text",
            "Helvetica Neue",
            "Helvetica",
            "Arial",
        ]
    }

    #[cfg(not(target_os = "macos"))]
    {
        &["Arial", "Helvetica", "DejaVu Sans", "Noto Sans", "Liberation Sans"]
    }
}

fn select_default_from_discovered(fonts: Vec<FontDescriptor>) -> Option<FontDescriptor> {
    for family in default_family_candidates() {
        if let Some(font) = fonts.iter().find(|font| font.family_name == *family) {
            return Some(font.clone());
        }
    }

    fonts.into_iter().next()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::font_descriptor_from_handle;
    use crate::FontDescriptor;
    use core_text::font_collection;
    use font_kit::source::SystemSource;
    use std::collections::HashSet;

    pub fn discover_system_fonts() -> Vec<FontDescriptor> {
        let source = SystemSource::new();
        let collection = font_collection::create_for_all_families();
        let mut seen_postscript = HashSet::new();
        let mut descriptors = Vec::new();

        if let Some(fonts) = collection.get_descriptors() {
            for index in 0..fonts.len() {
                let descriptor = fonts.get(index).unwrap();
                let postscript_name = descriptor.font_name();
                if !seen_postscript.insert(postscript_name.clone()) {
                    continue;
                }

                if let Ok(handle) = source.select_by_postscript_name(&postscript_name) {
                    if let Some(font) = font_descriptor_from_handle(&handle) {
                        descriptors.push(font);
                    }
                }
            }
        }

        descriptors
    }

    pub fn get_default_font() -> Option<FontDescriptor> {
        super::select_default_from_discovered(discover_system_fonts())
    }
}
