//! Embedding a real font for text the base-14 fonts cannot draw.
//!
//! A PDF's built-in fonts are Latin: every byte of a string is one glyph in
//! StandardEncoding. Writing UTF-8 into one of those does not "fall back" to
//! anything — each byte of a Chinese character picks an unrelated Latin glyph,
//! which is why an exported note used to read `‡›Ø‰ fłŁ§` where it said
//! 手机电池. The fix is the way PDF has always spelled non-Latin text: embed a
//! font, address it by glyph id through Identity-H, and carry a ToUnicode map
//! so the text can still be selected and searched.
//!
//! Only the glyphs the document uses are embedded. A macOS CJK font is 20-70 MB
//! and nobody wants that stapled to a two-page note.

use std::collections::{BTreeMap, BTreeSet};

use subsetter::GlyphRemapper;
use ttf_parser::Face;

/// One glyph of the embedded subset.
#[derive(Debug, Clone, Copy)]
pub struct EmbeddedGlyph {
    /// Glyph id inside the subset, which is also its CID under Identity-H.
    pub subset_id: u16,
    /// Advance width in PDF glyph space (1000 units to the em).
    pub width: f32,
}

/// The font program to embed, plus everything the PDF objects need to describe it.
pub struct EmbeddedFont {
    pub postscript_name: String,
    pub program: Vec<u8>,
    /// True when the program carries CFF outlines, which PDF describes with a
    /// different descendant font type and font file key than TrueType.
    pub cff_outlines: bool,
    pub glyphs: BTreeMap<char, EmbeddedGlyph>,
    pub units_per_em: f32,
    pub ascender: f32,
    pub descender: f32,
    pub cap_height: f32,
    pub italic_angle: f32,
    pub bbox: [f32; 4],
    /// Characters the font had no glyph for, reported rather than drawn blank.
    pub missing: Vec<char>,
}

impl EmbeddedFont {
    pub fn glyph(&self, character: char) -> Option<EmbeddedGlyph> {
        self.glyphs.get(&character).copied()
    }

    /// The `/BaseFont` name, tagged the way PDF marks a subset.
    pub fn base_font_name(&self) -> String {
        format!("{}+{}", self.subset_tag(), self.postscript_name)
    }

    /// Six uppercase letters derived from the glyph set.
    ///
    /// The tag exists so two subsets of the same font are not mistaken for each
    /// other. Deriving it from the content keeps an export reproducible: the
    /// same document exported twice produces the same bytes.
    fn subset_tag(&self) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for (character, glyph) in &self.glyphs {
            for byte in (*character as u32)
                .to_le_bytes()
                .iter()
                .chain(glyph.subset_id.to_le_bytes().iter())
            {
                hash ^= u64::from(*byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }

        (0..6)
            .map(|index| {
                let shifted = (hash >> (index * 5)) & 0x1f;
                char::from(b'A' + (shifted % 26) as u8)
            })
            .collect()
    }
}

/// Builds the subset for one set of characters.
///
/// Returns `Ok(None)` when there is nothing to embed, so a document that is all
/// ASCII keeps the small, font-free output it had before.
pub fn build_embedded_font(
    font_bytes: &[u8],
    face_index: u32,
    postscript_name: &str,
    characters: &BTreeSet<char>,
) -> Result<Option<EmbeddedFont>, String> {
    if characters.is_empty() {
        return Ok(None);
    }

    let face = Face::parse(font_bytes, face_index)
        .map_err(|error| format!("cannot parse the embedded font: {error}"))?;
    let units_per_em = f32::from(face.units_per_em());
    if units_per_em <= 0.0 {
        return Err("embedded font declares no units per em".to_string());
    }
    let scale = 1000.0 / units_per_em;

    let mut remapper = GlyphRemapper::new();
    let mut source_ids = BTreeMap::new();
    let mut missing = Vec::new();

    for character in characters {
        match face.glyph_index(*character) {
            Some(glyph_id) => {
                source_ids.insert(*character, glyph_id);
            }
            None => missing.push(*character),
        }
    }

    if source_ids.is_empty() {
        return Err(format!(
            "the resolved font has no glyph for any of the {} non-Latin characters in this document",
            characters.len()
        ));
    }

    let mut glyphs = BTreeMap::new();
    for (character, glyph_id) in &source_ids {
        let subset_id = remapper.remap(glyph_id.0);
        let width = f32::from(face.glyph_hor_advance(*glyph_id).unwrap_or(0)) * scale;
        glyphs.insert(*character, EmbeddedGlyph { subset_id, width });
    }

    let program = subsetter::subset(font_bytes, face_index, &remapper)
        .map_err(|error| format!("cannot subset the embedded font: {error}"))?
        .to_vec();
    let cff_outlines = program.starts_with(b"OTTO");
    let bbox = face.global_bounding_box();

    Ok(Some(EmbeddedFont {
        postscript_name: sanitize_postscript_name(postscript_name),
        program,
        cff_outlines,
        glyphs,
        units_per_em,
        ascender: f32::from(face.ascender()) * scale,
        descender: f32::from(face.descender()) * scale,
        cap_height: face
            .capital_height()
            .map(|height| f32::from(height) * scale)
            .unwrap_or(f32::from(face.ascender()) * scale),
        italic_angle: face.italic_angle().unwrap_or(0.0),
        bbox: [
            f32::from(bbox.x_min) * scale,
            f32::from(bbox.y_min) * scale,
            f32::from(bbox.x_max) * scale,
            f32::from(bbox.y_max) * scale,
        ],
        missing,
    }))
}

/// Reads the PostScript name out of a face, for the `/BaseFont` entry.
pub fn postscript_name_of(font_bytes: &[u8], face_index: u32) -> Option<String> {
    let face = Face::parse(font_bytes, face_index).ok()?;
    face.names()
        .into_iter()
        .find(|name| name.name_id == ttf_parser::name_id::POST_SCRIPT_NAME)
        .and_then(|name| name.to_string())
}

/// PDF names cannot carry spaces or delimiters, and an empty name is not a name.
fn sanitize_postscript_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();

    if cleaned.is_empty() {
        "EmbeddedFont".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_to_embed_produces_no_font() {
        let embedded =
            build_embedded_font(&[], 0, "Whatever", &BTreeSet::new()).expect("empty set is fine");

        assert!(embedded.is_none());
    }

    #[test]
    fn sanitizes_a_name_with_spaces() {
        assert_eq!(sanitize_postscript_name("Hiragino Sans GB W3"), "HiraginoSansGBW3");
        assert_eq!(sanitize_postscript_name("  "), "EmbeddedFont");
    }
}
