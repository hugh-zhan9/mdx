use crate::{FontDescriptor, FontError, FontFileData};
use font_kit::family_name::FamilyName;
use font_kit::handle::Handle;
use font_kit::properties::{Properties, Style};
use font_kit::source::SystemSource;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use ttf_parser::Face;

pub fn discover_system_fonts() -> Vec<FontDescriptor> {
    #[cfg(target_os = "macos")]
    {
        let fonts = platform::discover_system_fonts();
        if !fonts.is_empty() {
            return enrich_math_metadata(fonts);
        }
    }

    enrich_math_metadata(discover_with_font_kit())
}

pub fn get_default_font() -> Option<FontDescriptor> {
    #[cfg(target_os = "macos")]
    {
        if let Some(font) = platform::get_default_font() {
            return Some(font);
        }
    }

    select_default_from_discovered(&discover_with_font_kit())
}

pub fn resolve_font_descriptor(font_id: &str) -> Result<FontDescriptor, FontError> {
    discover_system_fonts()
        .into_iter()
        .find(|font| {
            font.font_id == font_id
                || font.postscript_name == font_id
                || font.family_name == font_id
        })
        .ok_or_else(|| FontError::UnknownFontId {
            font_id: font_id.to_string(),
        })
}

pub fn load_font_bytes(descriptor: &FontDescriptor) -> Result<Vec<u8>, FontError> {
    let source = SystemSource::new();
    let handle = source
        .select_by_postscript_name(&descriptor.postscript_name)
        .map_err(|_| FontError::FontDataUnavailable {
            font_id: descriptor.font_id.clone(),
        })?;

    load_font_bytes_from_handle(&handle, &descriptor.font_id)
}

/// Loads the first CJK-capable font file the system can give us.
///
/// Exact faces come first, because a family match picks whatever weight the
/// matcher likes — asking macOS for "PingFang SC" hands back Medium, which is
/// visibly heavier than the text on screen. Families are the backstop for a
/// machine that has some other CJK font installed.
pub fn load_cjk_font_file() -> Result<FontFileData, FontError> {
    for postscript_name in crate::fallback::cjk_embedding_faces() {
        if let Ok(file) = load_font_file_for_postscript_name(&postscript_name) {
            return Ok(file);
        }
    }

    for family in crate::fallback::cjk_fallback_fonts() {
        if let Ok(file) = load_font_file_for_family(&family) {
            return Ok(file);
        }
    }

    Err(FontError::FontDataUnavailable {
        font_id: "cjk".to_string(),
    })
}

/// Loads one exact face by PostScript name, with the index inside its file.
pub fn load_font_file_for_postscript_name(
    postscript_name: &str,
) -> Result<FontFileData, FontError> {
    let source = SystemSource::new();
    let handle = source
        .select_by_postscript_name(postscript_name)
        .map_err(|_| FontError::UnknownFontId {
            font_id: postscript_name.to_string(),
        })?;

    font_file_from_handle(handle, postscript_name)
}

/// Loads a family's font file together with the face index inside it.
///
/// Glyph metrics only need the bytes, so [`load_font_bytes`] drops the index.
/// Embedding a font in an exported document needs both: the CJK families that
/// ship with macOS live in collections — `PingFang.ttc` alone holds eighteen
/// faces — and a collection is not a font until an index picks one out.
pub fn load_font_file_for_family(family: &str) -> Result<FontFileData, FontError> {
    let source = SystemSource::new();
    let handle = source
        .select_best_match(
            &[FamilyName::Title(family.to_string())],
            &Properties::new(),
        )
        .map_err(|_| FontError::UnknownFontId {
            font_id: family.to_string(),
        })?;

    font_file_from_handle(handle, family)
}

fn font_file_from_handle(handle: Handle, font_id: &str) -> Result<FontFileData, FontError> {
    match handle {
        Handle::Path { path, font_index } => Ok(FontFileData {
            bytes: fs::read(&path).map_err(|_| FontError::FontDataUnavailable {
                font_id: font_id.to_string(),
            })?,
            face_index: font_index,
        }),
        Handle::Memory { bytes, font_index } => Ok(FontFileData {
            bytes: (*bytes).clone(),
            face_index: font_index,
        }),
    }
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

fn enrich_math_metadata(fonts: Vec<FontDescriptor>) -> Vec<FontDescriptor> {
    let source = SystemSource::new();
    enrich_math_metadata_with_probe(fonts, |postscript_name| {
        probe_math_font(&source, postscript_name)
    })
}

fn probe_math_font(source: &SystemSource, postscript_name: &str) -> Option<bool> {
    source
        .select_by_postscript_name(postscript_name)
        .ok()
        .and_then(|handle| handle_has_math_table(&handle))
}

fn font_descriptor_from_handle(handle: &Handle) -> Option<FontDescriptor> {
    let font = handle.load().ok()?;
    let postscript_name = font.postscript_name()?;
    let properties = font.properties();

    Some(FontDescriptor {
        font_id: postscript_name.clone(),
        family_name: font.family_name(),
        weight: css_weight_from_font_kit_weight(properties.weight.0),
        style: style_label(properties.style),
        postscript_name,
        math_checked: false,
        math_available: false,
    })
}

fn load_font_bytes_from_handle(handle: &Handle, font_id: &str) -> Result<Vec<u8>, FontError> {
    let font = handle.load().map_err(|_| FontError::FontDataUnavailable {
        font_id: font_id.to_string(),
    })?;
    let bytes = font
        .copy_font_data()
        .ok_or_else(|| FontError::FontDataUnavailable {
            font_id: font_id.to_string(),
        })?;

    Ok((*bytes).clone())
}

fn handle_has_math_table(handle: &Handle) -> Option<bool> {
    match handle {
        Handle::Path { path, font_index } => fs::read(path)
            .ok()
            .and_then(|bytes| face_has_math_table(&bytes, *font_index)),
        Handle::Memory { bytes, font_index } => face_has_math_table(bytes, *font_index),
    }
}

fn face_has_math_table(data: &[u8], font_index: u32) -> Option<bool> {
    Face::parse(data, font_index)
        .ok()
        .map(|face| face.tables().math.is_some())
}

fn css_weight_from_normalized_weight(normalized_weight: f64) -> u16 {
    (400.0 + normalized_weight * 300.0)
        .round()
        .clamp(1.0, 900.0) as u16
}

fn css_weight_from_font_kit_weight(weight: f32) -> u16 {
    weight.round().clamp(1.0, 900.0) as u16
}

pub fn enrich_math_metadata_with_probe<F>(
    mut fonts: Vec<FontDescriptor>,
    mut probe: F,
) -> Vec<FontDescriptor>
where
    F: FnMut(&str) -> Option<bool>,
{
    for font in &mut fonts {
        let (math_checked, math_available) = match probe(&font.postscript_name) {
            Some(math_available) => (true, math_available),
            None => (false, false),
        };
        *font = apply_math_probe_result(font.clone(), math_checked, math_available);
    }

    fonts
}

pub fn apply_math_probe_result(
    mut descriptor: FontDescriptor,
    math_checked: bool,
    math_available: bool,
) -> FontDescriptor {
    descriptor.math_checked = math_checked;
    descriptor.math_available = math_available;
    descriptor
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
        &[
            "Arial",
            "Helvetica",
            "DejaVu Sans",
            "Noto Sans",
            "Liberation Sans",
        ]
    }
}

pub fn select_preferred_font_for_family(
    fonts: &[FontDescriptor],
    family_name: &str,
) -> Option<FontDescriptor> {
    fonts
        .iter()
        .filter(|font| font.family_name == family_name)
        .min_by(|left, right| compare_font_preference(left, right))
        .cloned()
}

fn select_default_from_discovered(fonts: &[FontDescriptor]) -> Option<FontDescriptor> {
    for family in default_family_candidates() {
        if let Some(font) = select_preferred_font_for_family(fonts, family) {
            return Some(font);
        }
    }

    fonts
        .iter()
        .min_by(|left, right| compare_font_preference(left, right))
        .cloned()
}

fn compare_font_preference(left: &FontDescriptor, right: &FontDescriptor) -> Ordering {
    font_preference_rank(left)
        .cmp(&font_preference_rank(right))
        .then_with(|| left.weight.abs_diff(400).cmp(&right.weight.abs_diff(400)))
        .then_with(|| left.postscript_name.cmp(&right.postscript_name))
        .then_with(|| left.font_id.cmp(&right.font_id))
        .then_with(|| left.family_name.cmp(&right.family_name))
}

fn font_preference_rank(font: &FontDescriptor) -> u8 {
    if font.style.eq_ignore_ascii_case("normal") || font.style.eq_ignore_ascii_case("regular") {
        0
    } else {
        1
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::apply_math_probe_result;
    use crate::FontDescriptor;
    use core_text::font_collection;
    use core_text::font_descriptor::TraitAccessors;
    use std::collections::HashSet;

    pub fn discover_system_fonts() -> Vec<FontDescriptor> {
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

                descriptors.push(apply_math_probe_result(
                    FontDescriptor {
                        font_id: postscript_name.clone(),
                        family_name: descriptor.family_name(),
                        weight: super::css_weight_from_normalized_weight(
                            descriptor.traits().normalized_weight(),
                        ),
                        style: descriptor.style_name(),
                        postscript_name,
                        math_checked: false,
                        math_available: false,
                    },
                    false,
                    false,
                ));
            }
        }

        descriptors
    }

    pub fn get_default_font() -> Option<FontDescriptor> {
        super::select_default_from_discovered(&discover_system_fonts())
    }
}
