use layout_core::wasm_bridge::{layout_get_selection_geometry, layout_initialize_document};
use serde_json::Value;

#[test]
fn snapshot_preserves_complete_cjk_heading_text_with_prosemirror_spans() {
    let input = serde_json::json!({
        "document_id": "doc-1",
        "revision": 1,
        "blocks": [
            {
                "block_id": "h1",
                "kind": "Heading",
                "pm_from": 0,
                "pm_to": 6,
                "style": {
                    "heading_level": 1,
                    "text_align": "Left",
                    "font_size": 28.0,
                    "font_family": "Inter",
                    "line_height": 1.5,
                    "math_display": "Inline"
                },
                "inlines": [
                    {
                        "text": "一级标题",
                        "kind": "Text",
                        "from": 1,
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
    let rendered = snapshot["lines"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|line| line["text_runs"].as_array().unwrap())
        .map(|run| run["text"].as_str().unwrap())
        .collect::<String>();

    assert_eq!(rendered, "一级标题");
    assert_eq!(snapshot["lines"][0]["text_runs"][0]["pm_from"], 1);
    assert_eq!(snapshot["lines"][0]["text_runs"][0]["pm_to"], 5);
}

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
        math_height > 40.0 && math_height < 120.0,
        "math block height should be block-local with enough display space"
    );

    let selection_bytes = layout_get_selection_geometry("doc-1".into(), 1, 6, 13);
    let selection: Value = serde_json::from_slice(&selection_bytes).unwrap();
    assert_eq!(selection["pm_from"], 6);
    assert_eq!(selection["pm_to"], 13);
    let selection_rects = selection["rects"].as_array().unwrap();
    assert!(!selection_rects.is_empty());
    assert!(selection_rects.iter().any(|rect| {
        rect["y"].as_f64().unwrap() >= paragraph_bottom
            && rect["height"].as_f64().unwrap() > 0.0
            && rect["width"].as_f64().unwrap() > 0.0
    }));
}

#[test]
fn snapshot_serializes_semantic_text_styles_and_complex_block_payloads() {
    let input = serde_json::json!({
        "document_id": "doc-1",
        "revision": 1,
        "blocks": [
            {
                "block_id": "p1",
                "kind": "Paragraph",
                "pm_from": 0,
                "pm_to": 8,
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
                        "text": "Docs",
                        "kind": "Text",
                        "from": 0,
                        "to": 4,
                        "style": {
                            "bold": false,
                            "italic": false,
                            "code": true,
                            "link": "https://example.com",
                            "strike": false,
                            "underline": false
                        }
                    }
                ],
                "depth": 0
            },
            {
                "block_id": "code-1",
                "kind": "Code",
                "pm_from": 9,
                "pm_to": 21,
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
                        "text": "let x = 1;",
                        "kind": "Text",
                        "from": 9,
                        "to": 19,
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
                "block_id": "mermaid-1",
                "kind": "Mermaid",
                "pm_from": 22,
                "pm_to": 44,
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
                        "text": "graph TD\nA --> B",
                        "kind": "Text",
                        "from": 22,
                        "to": 38,
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
    let text_run = snapshot["lines"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|line| line["text_runs"].as_array().unwrap())
        .find(|run| run["block_id"] == "p1")
        .expect("styled paragraph run");
    let code_op = snapshot["canvas_draw_ops"]
        .as_array()
        .unwrap()
        .iter()
        .find(|op| op["block_id"] == "code-1")
        .expect("code op");
    let mermaid_op = snapshot["canvas_draw_ops"]
        .as_array()
        .unwrap()
        .iter()
        .find(|op| op["block_id"] == "mermaid-1")
        .expect("mermaid op");

    assert_eq!(text_run["style"]["code"], true);
    assert_eq!(text_run["style"]["link"], "https://example.com");
    assert_eq!(code_op["kind"], "code_highlight");
    assert_eq!(mermaid_op["kind"], "mermaid");
    assert!(
        code_op["height"].as_f64().unwrap() > 40.0,
        "code block overlay should include code chrome, not only one text line"
    );
    assert!(
        mermaid_op["height"].as_f64().unwrap() >= 180.0,
        "mermaid overlay should reserve preview space"
    );

    let code_data: Value =
        serde_json::from_str(code_op["data"].as_str().expect("code data string")).unwrap();
    let mermaid_data: Value =
        serde_json::from_str(mermaid_op["data"].as_str().expect("mermaid data string")).unwrap();
    assert_eq!(code_data["code"], "let x = 1;");
    assert_eq!(mermaid_data["code"], "graph TD\nA --> B");
}

#[test]
fn snapshot_serializes_image_attrs_into_canvas_payload() {
    let input = serde_json::json!({
        "document_id": "doc-1",
        "revision": 1,
        "blocks": [
            {
                "block_id": "image-1",
                "kind": "Image",
                "pm_from": 0,
                "pm_to": 1,
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
                        "text": ".assets/a.png",
                        "kind": "ImageInline",
                        "from": 0,
                        "to": 1,
                        "attrs": {
                            "src": ".assets/a.png",
                            "alt": "Diagram",
                            "title": "Preview"
                        },
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
    let image_op = snapshot["canvas_draw_ops"]
        .as_array()
        .unwrap()
        .iter()
        .find(|op| op["block_id"] == "image-1")
        .expect("image op");
    let image_data: Value =
        serde_json::from_str(image_op["data"].as_str().expect("image data string")).unwrap();

    assert_eq!(image_op["kind"], "image");
    assert_eq!(image_data["src"], ".assets/a.png");
    assert_eq!(image_data["alt"], "Diagram");
    assert_eq!(image_data["title"], "Preview");
}
