/// System font fallback chains for glyph rendering.
///
/// Provides ordered lists of fallback fonts for CJK, math, and emoji scenarios.
/// Currently macOS-specific; additional platforms should add `#[cfg(...)]` blocks.

/// Full fallback chain for general glyph rendering, in priority order.
#[cfg(target_os = "macos")]
pub fn system_fallback_chain() -> Vec<String> {
    vec![
        "PingFang SC".into(),       // CJK (Simplified Chinese)
        "STIX Two Math".into(),     // Math
        "Apple Color Emoji".into(), // Emoji
        "Helvetica Neue".into(),    // Latin fallback
        "Apple Symbols".into(),     // Symbol fallback
    ]
}

/// Fallback chain for CJK (Chinese / Japanese / Korean) glyphs.
#[cfg(target_os = "macos")]
pub fn cjk_fallback_fonts() -> Vec<String> {
    vec![
        "PingFang SC".into(),
        "PingFang TC".into(),
        "Hiragino Sans GB".into(),
    ]
}

/// Fallback chain for mathematical glyphs.
#[cfg(target_os = "macos")]
pub fn math_fallback_fonts() -> Vec<String> {
    vec![
        "STIX Two Math".into(),
        "Latin Modern Math".into(),
        "XITS Math".into(),
        "Cambria Math".into(),
    ]
}

/// Stub implementation for non-macOS platforms.
#[cfg(not(target_os = "macos"))]
pub fn system_fallback_chain() -> Vec<String> {
    Vec::new()
}

/// Stub implementation for non-macOS platforms.
#[cfg(not(target_os = "macos"))]
pub fn cjk_fallback_fonts() -> Vec<String> {
    Vec::new()
}

/// Stub implementation for non-macOS platforms.
#[cfg(not(target_os = "macos"))]
pub fn math_fallback_fonts() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_chain_not_empty() {
        #[cfg(target_os = "macos")]
        {
            let chain = system_fallback_chain();
            assert!(
                !chain.is_empty(),
                "system fallback chain should not be empty"
            );
            assert!(chain.contains(&"PingFang SC".to_string()));
            assert!(chain.contains(&"Apple Color Emoji".to_string()));

            let cjk = cjk_fallback_fonts();
            assert!(!cjk.is_empty(), "CJK fallback chain should not be empty");
            assert!(cjk.contains(&"PingFang SC".to_string()));

            let math = math_fallback_fonts();
            assert!(!math.is_empty(), "math fallback chain should not be empty");
            assert!(math.contains(&"STIX Two Math".to_string()));
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert!(system_fallback_chain().is_empty());
            assert!(cjk_fallback_fonts().is_empty());
            assert!(math_fallback_fonts().is_empty());
        }
    }
}
