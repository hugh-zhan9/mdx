use font_core::{
    discovery, fallback, glyph, math_table, FontError, FontInitResult, GlyphMetrics,
    GlyphMetricsRequest, MathConstantsCache, SystemMetrics,
};

use crate::models::WorkspaceError;

#[tauri::command]
pub fn font_init_subsystem() -> Result<FontInitResult, WorkspaceError> {
    let fonts = discovery::discover_system_fonts();
    let default_fonts = discovery::get_default_font()
        .into_iter()
        .chain(fonts.first().cloned())
        .take(1)
        .collect::<Vec<_>>();

    Ok(FontInitResult {
        fallback_chain: fallback::system_fallback_chain(),
        system_metrics: SystemMetrics {
            font_count: fonts.len(),
            math_font_count: fonts.iter().filter(|font| font.math_available).count(),
            default_font_size: 14.0,
        },
        default_fonts,
    })
}

#[tauri::command]
pub fn font_get_glyph_metrics(
    request: GlyphMetricsRequest,
) -> Result<GlyphMetrics, WorkspaceError> {
    if request.font_size <= 0.0 {
        return Err(WorkspaceError::new(
            "invalid_font_size",
            "font size must be greater than zero",
        ));
    }
    if request.font_id.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_font_id",
            "font id must not be empty",
        ));
    }

    let descriptor = discovery::resolve_font_descriptor(&request.font_id).map_err(font_error)?;
    let bytes = discovery::load_font_bytes(&descriptor).map_err(font_error)?;
    let entries = glyph::glyph_metrics_for_font_size(&bytes, &request.glyph_ids, request.font_size)
        .map_err(font_error)?;

    Ok(GlyphMetrics { entries })
}

#[tauri::command]
pub fn font_get_math_constants(font_id: String) -> Result<MathConstantsCache, WorkspaceError> {
    if font_id.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_font_id",
            "font id must not be empty",
        ));
    }

    let descriptor = discovery::resolve_font_descriptor(&font_id).map_err(font_error)?;
    let bytes = discovery::load_font_bytes(&descriptor).map_err(font_error)?;

    Ok(MathConstantsCache {
        font_id,
        constants: math_table::math_constants(&bytes).map_err(font_error)?,
        glyph_assemblies: Vec::new(),
    })
}

fn font_error(error: FontError) -> WorkspaceError {
    WorkspaceError::new(error.code(), error.to_string())
}
