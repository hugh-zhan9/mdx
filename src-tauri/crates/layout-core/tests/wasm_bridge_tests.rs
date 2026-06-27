use layout_core::wasm_bridge::{layout_get_selection_geometry, layout_initialize_document};

fn encode_json(value: &serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(value).expect("json encodes")
}

#[test]
fn selection_geometry_uses_initialized_document_snapshot() {
    let document = serde_json::json!({
        "document_id": "doc-1",
        "revision": 7,
        "blocks": [
            {
                "block_id": "block-1",
                "kind": "Paragraph",
                "pm_from": 0,
                "pm_to": 11,
                "style": {
                    "heading_level": null,
                    "text_align": "Left",
                    "font_size": 14.0,
                    "font_family": "Inter",
                    "line_height": 1.5,
                    "math_display": "Inline"
                },
                "inlines": [
                    {
                        "text": "Hello world",
                        "kind": "Text",
                        "from": 0,
                        "to": 11,
                        "style": {
                            "bold": false,
                            "italic": false,
                            "code": false,
                            "link": null,
                            "strike": false,
                            "underline": false
                        }
                    }
                ],
                "depth": 0
            }
        ],
        "style_context": {
            "default_font_size": 14.0,
            "default_font_family": "Inter",
            "default_line_height": 1.5,
            "viewport_width": 800.0,
            "viewport_height": 600.0,
            "device_pixel_ratio": 1.0
        }
    });

    let snapshot_bytes = layout_initialize_document(
        "doc-1".into(),
        encode_json(&document),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    assert!(!snapshot_bytes.is_empty());

    let geometry_bytes = layout_get_selection_geometry("doc-1".into(), 7, 0, 5);
    let geometry: serde_json::Value =
        serde_json::from_slice(&geometry_bytes).expect("geometry json decodes");

    assert_eq!(geometry["pm_from"], 0);
    assert_eq!(geometry["pm_to"], 5);
    assert!(
        geometry["rects"]
            .as_array()
            .is_some_and(|rects| !rects.is_empty()),
        "selection geometry should include rects after document initialization"
    );
}
