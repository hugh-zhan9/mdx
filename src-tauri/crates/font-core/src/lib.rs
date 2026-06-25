pub mod discovery;
pub mod fallback;
pub mod glyph;
pub mod math_table;

use std::num::NonZeroUsize;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontInitResult {
    pub default_fonts: Vec<FontDescriptor>,
    pub fallback_chain: Vec<String>,
    pub system_metrics: SystemMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontDescriptor {
    pub font_id: String,
    pub family_name: String,
    pub weight: u16,
    pub style: String,
    pub postscript_name: String,
    pub math_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub font_count: usize,
    pub math_font_count: usize,
    pub default_font_size: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetrics {
    pub entries: Vec<GlyphMetricsEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetricsEntry {
    pub glyph_id: u32,
    pub advance: f32,
    pub x_min: f32,
    pub y_min: f32,
    pub x_max: f32,
    pub y_max: f32,
    pub bearing_x: f32,
    pub bearing_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetricsRequest {
    pub font_id: String,
    pub glyph_ids: Vec<u32>,
    pub font_size: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MathConstantsCache {
    pub font_id: String,
    pub constants: MathConstants,
    pub glyph_assemblies: Vec<GlyphAssembly>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MathConstants {
    pub subscript_shift_down: f32,
    pub superscript_shift_up: f32,
    pub subscript_drop: f32,
    pub superscript_drop: f32,
    pub fraction_numerator_shift_up: f32,
    pub fraction_numerator_display_style_shift_up: f32,
    pub fraction_denominator_shift_down: f32,
    pub fraction_denominator_display_style_shift_down: f32,
    pub fraction_numerator_gap_min: f32,
    pub fraction_rule_thickness: f32,
    pub fraction_denominator_gap_min: f32,
    pub radical_extra_ascender: f32,
    pub radical_rule_thickness: f32,
    pub radical_vertical_gap: f32,
    pub accent_base_height: f32,
    pub display_operator_min_height: f32,
    pub stack_top_shift_up: f32,
    pub stack_bottom_shift_down: f32,
    pub stack_gap_min: f32,
    pub stretch_stack_top_shift_up: f32,
    pub stretch_stack_bottom_shift_down: f32,
    pub stretch_stack_gap_above_min: f32,
    pub stretch_stack_gap_below_min: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphAssembly {
    pub glyph_id: u32,
    pub parts: Vec<GlyphPart>,
    pub italics_correction: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphPart {
    pub glyph_id: u32,
    pub start_connector_length: f32,
    pub end_connector_length: f32,
    pub full_advance: f32,
    pub part_flags: u16,
}

pub(crate) struct FontSystem {
    pub(crate) fonts: Vec<LoadedFont>,
    pub(crate) metrics_cache: lru::LruCache<(String, u32, u32), GlyphMetricsEntry>,
    pub(crate) math_cache: lru::LruCache<String, MathConstants>,
}

pub(crate) struct LoadedFont {
    pub descriptor: FontDescriptor,
    pub font_data: Vec<u8>,
}

impl FontSystem {
    pub fn new() -> Self {
        let metrics_capacity =
            NonZeroUsize::new(5_000).expect("font metrics cache capacity must be non-zero");
        let math_capacity =
            NonZeroUsize::new(50).expect("math constants cache capacity must be non-zero");

        Self {
            fonts: Vec::new(),
            metrics_cache: lru::LruCache::new(metrics_capacity),
            math_cache: lru::LruCache::new(math_capacity),
        }
    }
}

impl Default for FontSystem {
    fn default() -> Self {
        Self::new()
    }
}
