use crate::{FontError, GlyphAssembly, GlyphPart, MathConstants};
use ttf_parser::Face;

pub fn math_constants(font_bytes: &[u8]) -> Result<MathConstants, FontError> {
    let face = Face::parse(font_bytes, 0).map_err(|_| FontError::FontParseFailed)?;

    parse_math_table(&face).ok_or(FontError::MathTableUnavailable)
}

/// Parse MATH table constants from a font face.
///
/// Returns `None` if the font does not contain a MATH table or if the constants
/// subtable is missing.
pub fn parse_math_table(face: &Face) -> Option<MathConstants> {
    let math = face.tables().math?;
    let constants = math.constants?;

    Some(MathConstants {
        subscript_shift_down: constants.subscript_shift_down().value as f32,
        superscript_shift_up: constants.superscript_shift_up().value as f32,
        subscript_drop: constants.subscript_baseline_drop_min().value as f32,
        superscript_drop: constants.superscript_baseline_drop_max().value as f32,
        fraction_numerator_shift_up: constants.fraction_numerator_shift_up().value as f32,
        fraction_numerator_display_style_shift_up: constants
            .fraction_numerator_display_style_shift_up()
            .value as f32,
        fraction_denominator_shift_down: constants.fraction_denominator_shift_down().value as f32,
        fraction_denominator_display_style_shift_down: constants
            .fraction_denominator_display_style_shift_down()
            .value as f32,
        fraction_numerator_gap_min: constants.fraction_numerator_gap_min().value as f32,
        fraction_rule_thickness: constants.fraction_rule_thickness().value as f32,
        fraction_denominator_gap_min: constants.fraction_denominator_gap_min().value as f32,
        radical_extra_ascender: constants.radical_extra_ascender().value as f32,
        radical_rule_thickness: constants.radical_rule_thickness().value as f32,
        radical_vertical_gap: constants.radical_vertical_gap().value as f32,
        accent_base_height: constants.accent_base_height().value as f32,
        display_operator_min_height: constants.display_operator_min_height() as f32,
        stack_top_shift_up: constants.stack_top_shift_up().value as f32,
        stack_bottom_shift_down: constants.stack_bottom_shift_down().value as f32,
        stack_gap_min: constants.stack_gap_min().value as f32,
        stretch_stack_top_shift_up: constants.stretch_stack_top_shift_up().value as f32,
        stretch_stack_bottom_shift_down: constants.stretch_stack_bottom_shift_down().value as f32,
        stretch_stack_gap_above_min: constants.stretch_stack_gap_above_min().value as f32,
        stretch_stack_gap_below_min: constants.stretch_stack_gap_below_min().value as f32,
    })
}

/// Parse glyph assembly data for a stretchable glyph.
///
/// Returns `None` if the font does not contain a MATH table, if the glyph does not
/// have a vertical construction, or if the construction does not have an assembly table.
pub fn parse_glyph_assembly(face: &Face, glyph_id: u32) -> Option<GlyphAssembly> {
    let math = face.tables().math?;
    let variants = math.variants?;

    let gid = ttf_parser::GlyphId(glyph_id as u16);
    let construction = variants.vertical_constructions.get(gid)?;
    let assembly = construction.assembly?;

    let parts: Vec<GlyphPart> = assembly
        .parts
        .into_iter()
        .map(|part| GlyphPart {
            glyph_id: part.glyph_id.0 as u32,
            start_connector_length: part.start_connector_length as f32,
            end_connector_length: part.end_connector_length as f32,
            full_advance: part.full_advance as f32,
            part_flags: part.part_flags.0,
        })
        .collect();

    Some(GlyphAssembly {
        glyph_id,
        parts,
        italics_correction: assembly.italics_correction.value as f32,
    })
}
