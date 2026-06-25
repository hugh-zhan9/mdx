use std::collections::HashMap;

pub trait FontMetricsProvider {
    fn char_advance(&self, c: char, font_size: f32) -> Option<f32>;
    fn glyph_width(&self, glyph_id: u32, font_size: f32) -> Option<f32>;

    fn text_width(&self, text: &str, font_size: f32) -> f32 {
        text.chars()
            .map(|c| {
                self.char_advance(c, font_size)
                    .unwrap_or_else(|| default_char_advance(c, font_size))
            })
            .sum()
    }
}

/// Development-time metric estimator used by tests and the initial WASM bridge.
#[derive(Debug, Default)]
pub struct MockFontMetrics {
    cache: HashMap<char, f32>,
}

impl MockFontMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_advance(mut self, c: char, advance: f32) -> Self {
        self.cache.insert(c, advance);
        self
    }
}

impl FontMetricsProvider for MockFontMetrics {
    fn char_advance(&self, c: char, font_size: f32) -> Option<f32> {
        self.cache
            .get(&c)
            .copied()
            .or_else(|| Some(default_char_advance(c, font_size)))
    }

    fn glyph_width(&self, _glyph_id: u32, font_size: f32) -> Option<f32> {
        Some(font_size * 0.5)
    }
}

fn default_char_advance(c: char, font_size: f32) -> f32 {
    if c == ' ' {
        font_size * 0.25
    } else if c.is_ascii_punctuation() {
        font_size * 0.35
    } else if c.is_ascii() {
        font_size * 0.5
    } else {
        font_size
    }
}
