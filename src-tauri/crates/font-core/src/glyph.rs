use crate::GlyphMetricsEntry;
use lru::LruCache;
use std::num::NonZeroUsize;

/// An LRU cache for glyph metrics, keyed by (font_id, glyph_id, font_size).
///
/// Font size is stored as an integer (scaled by 100) to make it hashable.
/// Tracks hit/miss statistics for performance monitoring.
pub struct GlyphCache {
    inner: LruCache<(String, u32, u32), GlyphMetricsEntry>,
    hits: u64,
    misses: u64,
}

/// Convert a float font size to a hashable integer key (scaled by 100).
fn font_size_to_key(font_size: f32) -> u32 {
    (font_size * 100.0).round() as u32
}

impl GlyphCache {
    /// Create a new cache with the given capacity.
    ///
    /// `capacity` must be non-zero; panics otherwise.
    pub fn new(capacity: usize) -> Self {
        let inner = LruCache::new(
            NonZeroUsize::new(capacity).expect("GlyphCache capacity must be non-zero"),
        );
        Self {
            inner,
            hits: 0,
            misses: 0,
        }
    }

    /// Retrieve a cached glyph metric entry, or compute it via the closure on a miss.
    ///
    /// The `compute` closure is only called when the key is not already in the cache.
    /// If the closure returns `None`, the miss is still counted but nothing is stored.
    pub fn get_or_compute<F>(
        &mut self,
        font_id: &str,
        glyph_id: u32,
        font_size: f32,
        compute: F,
    ) -> Option<GlyphMetricsEntry>
    where
        F: FnOnce() -> Option<GlyphMetricsEntry>,
    {
        let key = (font_id.to_string(), glyph_id, font_size_to_key(font_size));
        if let Some(entry) = self.inner.get(&key) {
            self.hits += 1;
            return Some(entry.clone());
        }

        self.misses += 1;
        if let Some(entry) = compute() {
            self.inner.put(key, entry.clone());
            Some(entry)
        } else {
            None
        }
    }

    /// The ratio of cache hits to total lookups, in range [0.0, 1.0].
    ///
    /// Returns 0.0 when no lookups have been made.
    pub fn hit_rate(&self) -> f32 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f32 / total as f32
        }
    }

    /// Returns `(hits, misses)` counters.
    pub fn stats(&self) -> (u64, u64) {
        (self.hits, self.misses)
    }

    /// Returns the number of entries currently in the cache.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns `true` if the cache holds no entries.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(cache.stats(), (1, 1));
    }

    #[test]
    fn test_glyph_cache_miss() {
        let mut cache = GlyphCache::new(100);
        let _ = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
        assert_eq!(cache.stats(), (0, 1));
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

        // 65 is a miss now (evicted)
        let result = cache.get_or_compute("Arial", 65, 16.0, || Some(dummy_entry(65)));
        assert!(result.is_some());
        // misses: 65 first time + 67 first time + 65 after eviction = 3 actual misses
        // But our get_or_compute counts misses based on cache presence, not whether it was ever seen
        // Actually: 65 inserted (miss+1), 66 inserted (miss+1), 67 inserted (miss+1), 65 re-inserted (miss+1)
        // hits: none so far (we never re-used a cached key)
        assert_eq!(cache.stats(), (0, 4));
    }
}
