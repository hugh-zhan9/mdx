use layout_core::wasm_bridge::{layout_get_selection_geometry, layout_initialize_document};
use serde_json::Value;

#[test]
fn snapshot_contains_hit_selection_and_mirror_entries() {
    let input = serde_json::json!({
        "document_id": "doc-1",
        "revision": 1,
        "blocks": [
            {
                "block_id": "p1",
                "kind": "Paragraph",
                "pm_from": 0,
                "pm_to": 5,
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
                        "text": "Hello",
                        "kind": "Text",
                        "from": 0,
                        "to": 5,
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
            },
            {
                "block_id": "m1",
                "kind": "MathBlock",
                "pm_from": 6,
                "pm_to": 13,
                "style": {
                    "heading_level": null,
                    "text_align": "Left",
                    "font_size": 14.0,
                    "font_family": "Inter",
                    "line_height": 1.5,
                    "math_display": "Block"
                },
                "inlines": [
                    {
                        "text": "x^2",
                        "kind": "MathInline",
                        "from": 6,
                        "to": 9,
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
            "viewport_width": 960.0,
            "viewport_height": 720.0,
            "device_pixel_ratio": 1.0
        }
    });

    let snapshot_bytes = layout_initialize_document(
        "doc-1".into(),
        serde_json::to_vec(&input).unwrap(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    let snapshot: Value = serde_json::from_slice(&snapshot_bytes).unwrap();

    assert!(snapshot["hit_test_entries"].as_array().unwrap().len() >= 2);
    assert!(snapshot["selection_geometries"].as_array().unwrap().len() >= 2);
    assert!(snapshot["mirror_blocks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|block| block["block_id"] == "m1"));

    let hit_entries = snapshot["hit_test_entries"].as_array().unwrap();
    let paragraph_hit = hit_entries
        .iter()
        .find(|entry| entry["block_id"] == "p1")
        .expect("paragraph hit entry");
    let math_hit = hit_entries
        .iter()
        .find(|entry| entry["block_id"] == "m1")
        .expect("math block hit entry");

    assert_eq!(math_hit["pm_from"], 6);
    assert_eq!(math_hit["pm_to"], 13);
    assert!(
        math_hit["rect"]["y"].as_f64().unwrap() > paragraph_hit["rect"]["y"].as_f64().unwrap(),
        "second block geometry should be offset below first block"
    );

    let paragraph_bottom = paragraph_hit["rect"]["y"].as_f64().unwrap()
        + paragraph_hit["rect"]["height"].as_f64().unwrap();
    let math_top = math_hit["rect"]["y"].as_f64().unwrap();
    let math_height = math_hit["rect"]["height"].as_f64().unwrap();
    assert!(math_top >= paragraph_bottom);
    assert!(
        math_height < math_top + 1.0,
        "math block height should be block-local, not inflated by document y"
    );

    let selection_bytes = layout_get_selection_geometry("doc-1".into(), 1, 6, 13);
    let selection: Value = serde_json::from_slice(&selection_bytes).unwrap();
    assert_eq!(selection["pm_from"], 6);
    assert_eq!(selection["pm_to"], 13);
    assert_eq!(selection["rects"][0], math_hit["rect"]);
}
