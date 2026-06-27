use font_core::discovery::{get_default_font, load_font_bytes};
use font_core::glyph::{glyph_metrics_for_font_size, GlyphCache};
use font_core::{fallback, GlyphMetricsEntry};

fn dummy_entry(glyph_id: u32) -> GlyphMetricsEntry {
    GlyphMetricsEntry {
        glyph_id,
        advance: 10.0,
        x_min: 0.0,
        y_min: 0.0,
        x_max: 10.0,
        y_max: 10.0,
        bearing_x: 0.0,
        bearing_y: 0.0,
    }
}

#[test]
fn test_glyph_cache_basic() {
    let mut cache = GlyphCache::new(100);
    let result = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    assert!(result.is_some());
    assert_eq!(result.unwrap().glyph_id, 65);
}

#[test]
fn test_glyph_cache_hit_rate() {
    let mut cache = GlyphCache::new(100);
    // First call — miss
    let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    // Second call — hit
    let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    assert_eq!(cache.hit_rate(), 0.5);
    let (hits, misses) = cache.stats();
    assert_eq!(hits, 1);
    assert_eq!(misses, 1);
}

#[test]
fn test_glyph_cache_miss() {
    let mut cache = GlyphCache::new(100);
    let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    let (hits, misses) = cache.stats();
    assert_eq!(hits, 0);
    assert_eq!(misses, 1);
}

#[test]
fn test_glyph_cache_capacity() {
    let mut cache = GlyphCache::new(2);
    // Fill beyond capacity
    let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    let _ = cache.get_or_compute("Arial", 66, 16.0, || Some(dummy_entry(66)));
    let _ = cache.get_or_compute("Arial", 67, 16.0, || Some(dummy_entry(67)));

    // The oldest entry (65) should be evicted
    assert_eq!(cache.len(), 2);

    // Verify 65 is not in cache anymore (must recompute)
    let mut recomputed = false;
    let result = cache.get_or_compute("Arial", 65, 16.0, || {
        recomputed = true;
        Some(dummy_entry(65))
    });
    assert!(result.is_some());
    assert!(
        recomputed,
        "Entry 65 should have been evicted and recomputed"
    );
}

#[test]
fn test_fallback_chain_not_empty() {
    #[cfg(target_os = "macos")]
    {
        let chain = fallback::system_fallback_chain();
        assert!(
            !chain.is_empty(),
            "system fallback chain should not be empty"
        );
        assert!(chain.contains(&"PingFang SC".to_string()));
        assert!(chain.contains(&"Apple Color Emoji".to_string()));

        let cjk = fallback::cjk_fallback_fonts();
        assert!(!cjk.is_empty(), "CJK fallback chain should not be empty");
        assert!(cjk.contains(&"PingFang SC".to_string()));

        let math = fallback::math_fallback_fonts();
        assert!(!math.is_empty(), "math fallback chain should not be empty");
        assert!(math.contains(&"STIX Two Math".to_string()));
    }

    #[cfg(not(target_os = "macos"))]
    {
        assert!(fallback::system_fallback_chain().is_empty());
        assert!(fallback::cjk_fallback_fonts().is_empty());
        assert!(fallback::math_fallback_fonts().is_empty());
    }
}

#[test]
fn test_glyph_cache_none_result() {
    let mut cache = GlyphCache::new(100);
    // Compute returns None
    let result = cache.get_or_compute("Arial", 999, 16.0, || None);
    assert!(result.is_none());
    // Still counts as a miss
    let (hits, misses) = cache.stats();
    assert_eq!(hits, 0);
    assert_eq!(misses, 1);
}

#[test]
fn test_glyph_cache_different_keys() {
    let mut cache = GlyphCache::new(100);
    // Different font_id
    let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
    let _ = cache.get_or_compute("Times", 65, 16.0, || Some(dummy_entry(65)));
    assert_eq!(cache.len(), 2);

    // Different glyph_id
    let _ = cache.get_or_compute("Arial", 66, 16.0, || Some(dummy_entry(66)));
    assert_eq!(cache.len(), 3);

    // Different font_size
    let _ = cache.get_or_compute("Arial", 65, 18.0, || Some(dummy_entry(65)));
    assert_eq!(cache.len(), 4);

    // All were misses
    let (hits, misses) = cache.stats();
    assert_eq!(hits, 0);
    assert_eq!(misses, 4);
}

#[test]
fn glyph_metrics_read_real_font_data() {
    let default = get_default_font().expect("should have a default system font");
    let bytes = load_font_bytes(&default).expect("default font bytes should load");
    let metrics =
        glyph_metrics_for_font_size(&bytes, &[65, 32], 16.0).expect("glyph metrics should parse");

    assert_eq!(metrics.len(), 2);
    assert_eq!(metrics[0].glyph_id, 65);
    assert!(metrics[0].advance > 0.0);
    assert!(metrics[1].advance > 0.0);
}
