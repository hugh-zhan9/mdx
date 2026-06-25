use font_core::discovery::{
    apply_math_probe_result, discover_system_fonts, enrich_math_metadata_with_probe,
    get_default_font, select_preferred_font_for_family,
};

#[test]
fn test_discover_fonts() {
    let fonts = discover_system_fonts();
    assert!(!fonts.is_empty(), "should find at least some system fonts");
}

#[test]
fn test_default_font() {
    let default = get_default_font();
    assert!(default.is_some(), "should have a default system font");

    let default = default.unwrap();
    assert!(!default.postscript_name.is_empty());
    assert!(!default.family_name.is_empty());
}

#[test]
fn test_reopen_failure_keeps_descriptor() {
    let descriptor = font_core::FontDescriptor {
        font_id: "demo-math".into(),
        family_name: "Demo Math".into(),
        weight: 400,
        style: "normal".into(),
        postscript_name: "DemoMath-Regular".into(),
        math_checked: true,
        math_available: true,
    };

    let recovered = apply_math_probe_result(descriptor.clone(), false, false);
    assert_eq!(recovered.font_id, descriptor.font_id);
    assert_eq!(recovered.family_name, descriptor.family_name);
    assert_eq!(recovered.postscript_name, descriptor.postscript_name);
    assert!(!recovered.math_checked);
    assert!(!recovered.math_available);
}

#[test]
fn test_unprobed_descriptor_keeps_unknown_math_state() {
    let fonts = vec![font_core::FontDescriptor {
        font_id: "demo-basic".into(),
        family_name: "Demo Basic".into(),
        weight: 400,
        style: "normal".into(),
        postscript_name: "DemoBasic-Regular".into(),
        math_checked: false,
        math_available: false,
    }];

    let selected = select_preferred_font_for_family(&fonts, "Demo Basic")
        .expect("expected a preferred font for the synthetic family");

    assert_eq!(selected.postscript_name, "DemoBasic-Regular");
    assert!(!selected.math_checked);
    assert!(!selected.math_available);
}

#[test]
fn test_math_metadata_probe_runs_for_every_discovered_font() {
    let fonts = vec![
        font_core::FontDescriptor {
            font_id: "demo-a".into(),
            family_name: "Demo Math".into(),
            weight: 400,
            style: "normal".into(),
            postscript_name: "DemoMath-A".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-b".into(),
            family_name: "Demo Math".into(),
            weight: 500,
            style: "italic".into(),
            postscript_name: "DemoMath-B".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-c".into(),
            family_name: "Demo Math".into(),
            weight: 300,
            style: "oblique".into(),
            postscript_name: "DemoMath-C".into(),
            math_checked: false,
            math_available: false,
        },
    ];

    let mut probed = Vec::new();
    let enriched = enrich_math_metadata_with_probe(fonts.clone(), |postscript_name| {
        probed.push(postscript_name.to_string());
        Some(postscript_name == "DemoMath-B")
    });

    assert_eq!(
        probed,
        vec![
            "DemoMath-A".to_string(),
            "DemoMath-B".to_string(),
            "DemoMath-C".to_string(),
        ]
    );
    assert_eq!(enriched.len(), fonts.len());
    assert!(enriched.iter().all(|font| font.math_checked));
    assert!(!enriched[0].math_available);
    assert!(enriched[1].math_available);
    assert!(!enriched[2].math_available);
}

#[test]
fn test_default_font_selection_prefers_normal_regular_and_weight_400_nearby() {
    let fonts = vec![
        font_core::FontDescriptor {
            font_id: "demo-italic-400".into(),
            family_name: "Demo Sans".into(),
            weight: 400,
            style: "italic".into(),
            postscript_name: "DemoSans-Italic".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-normal-500".into(),
            family_name: "Demo Sans".into(),
            weight: 500,
            style: "normal".into(),
            postscript_name: "DemoSans-Regular-500".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-normal-399".into(),
            family_name: "Demo Sans".into(),
            weight: 399,
            style: "normal".into(),
            postscript_name: "DemoSans-Regular-399".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-regular-400-b".into(),
            family_name: "Demo Sans".into(),
            weight: 400,
            style: "Regular".into(),
            postscript_name: "DemoSans-Regular-B".into(),
            math_checked: false,
            math_available: false,
        },
        font_core::FontDescriptor {
            font_id: "demo-normal-400".into(),
            family_name: "Demo Sans".into(),
            weight: 400,
            style: "normal".into(),
            postscript_name: "DemoSans-Regular-A".into(),
            math_checked: false,
            math_available: false,
        },
    ];

    let selected = select_preferred_font_for_family(&fonts, "Demo Sans")
        .expect("expected a preferred font for the synthetic family");

    assert_eq!(selected.style.to_lowercase(), "normal");
    assert_eq!(selected.weight, 400);
    assert_eq!(selected.postscript_name, "DemoSans-Regular-A");
}
