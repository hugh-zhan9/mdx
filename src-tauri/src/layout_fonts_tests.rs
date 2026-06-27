use font_core::GlyphMetricsRequest;

#[test]
fn font_commands_expose_discovery_metrics_and_fallbacks() {
    let result = crate::layout_fonts::font_init_subsystem().unwrap();

    assert!(!result.fallback_chain.is_empty());
    assert_eq!(result.system_metrics.default_font_size, 14.0);
}

#[test]
fn glyph_metrics_command_returns_requested_glyphs() {
    let font = crate::layout_fonts::font_init_subsystem()
        .unwrap()
        .default_fonts
        .into_iter()
        .next()
        .expect("expected a discovered default font");
    let metrics = crate::layout_fonts::font_get_glyph_metrics(GlyphMetricsRequest {
        font_id: font.font_id,
        glyph_ids: vec![65, 32],
        font_size: 16.0,
    })
    .unwrap();

    assert_eq!(metrics.entries.len(), 2);
    assert_eq!(metrics.entries[0].glyph_id, 65);
    assert!(metrics.entries[0].advance > metrics.entries[1].advance);
}

#[test]
fn font_commands_return_typed_errors_instead_of_fallbacks() {
    let err = crate::layout_fonts::font_get_glyph_metrics(GlyphMetricsRequest {
        font_id: "__missing_font__".into(),
        glyph_ids: vec![65],
        font_size: 16.0,
    })
    .unwrap_err();
    assert_eq!(err.error_code(), "unknown_font_id");

    let err = crate::layout_fonts::font_get_math_constants("__missing_font__".into()).unwrap_err();
    assert_eq!(err.error_code(), "unknown_font_id");
}

#[test]
fn math_constants_command_requires_font_id_and_reads_real_constants_when_available() {
    let err = crate::layout_fonts::font_get_math_constants(" ".into()).unwrap_err();
    assert_eq!(err.error_code(), "invalid_font_id");

    let math_font = crate::layout_fonts::font_init_subsystem()
        .unwrap()
        .default_fonts
        .into_iter()
        .find(|font| font.math_available)
        .or_else(|| {
            font_core::discovery::discover_system_fonts()
                .into_iter()
                .find(|font| font.math_available)
        });

    if let Some(font) = math_font {
        let constants = crate::layout_fonts::font_get_math_constants(font.font_id.clone()).unwrap();
        assert_eq!(constants.font_id, font.font_id);
        assert!(constants.constants.fraction_rule_thickness > 0.0);
    }
}

#[test]
fn math_constants_report_unavailable_when_font_has_no_math_table() {
    let font = font_core::discovery::discover_system_fonts()
        .into_iter()
        .find(|font| font.math_checked && !font.math_available);

    if let Some(font) = font {
        let err = crate::layout_fonts::font_get_math_constants(font.font_id).unwrap_err();
        assert_eq!(err.error_code(), "math_table_unavailable");
    }
}

#[test]
fn tauri_command_surface_registers_font_commands() {
    let source = include_str!("lib.rs");

    for command in [
        "layout_fonts::font_init_subsystem",
        "layout_fonts::font_get_glyph_metrics",
        "layout_fonts::font_get_math_constants",
    ] {
        assert!(source.contains(command), "{command} should be registered");
    }
}
