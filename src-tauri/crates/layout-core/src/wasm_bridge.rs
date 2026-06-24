use serde_json::{json, Value};
use wasm_bindgen::prelude::wasm_bindgen;

fn placeholder_response(operation: &str, request_json: &str, payload: Value) -> String {
    let request: Value = serde_json::from_str(request_json).unwrap_or_else(|_| {
        json!({
            "raw": request_json,
            "decodeError": "INVALID_JSON_PLACEHOLDER_REQUEST"
        })
    });

    serde_json::to_string(&json!({
        "operation": operation,
        "status": "placeholder",
        "request": request,
        "payload": payload,
        "diagnostics": [{
            "code": "BOOTSTRAP_PLACEHOLDER",
            "message": "layout-core WASM bridge is scaffolded but not implemented"
        }]
    }))
    .expect("placeholder bridge responses must serialize")
}

#[wasm_bindgen]
pub fn layout_initialize_document(request_json: &str) -> String {
    placeholder_response(
        "layout_initialize_document",
        request_json,
        json!({
            "documentRevision": 0,
            "initialSnapshot": null
        }),
    )
}

#[wasm_bindgen]
pub fn layout_update_document(request_json: &str) -> String {
    placeholder_response(
        "layout_update_document",
        request_json,
        json!({
            "nextRevision": null,
            "invalidatedRegions": [],
            "snapshotHints": null
        }),
    )
}

#[wasm_bindgen]
pub fn layout_get_viewport_snapshot(request_json: &str) -> String {
    placeholder_response(
        "layout_get_viewport_snapshot",
        request_json,
        json!({
            "snapshot": null,
            "selectionAnchors": [],
            "caretAnchors": []
        }),
    )
}

#[wasm_bindgen]
pub fn layout_hit_test(request_json: &str) -> String {
    placeholder_response(
        "layout_hit_test",
        request_json,
        json!({
            "pmPosition": null,
            "bias": null,
            "blockId": null
        }),
    )
}

#[wasm_bindgen]
pub fn layout_get_selection_geometry(request_json: &str) -> String {
    placeholder_response(
        "layout_get_selection_geometry",
        request_json,
        json!({
            "rects": [],
            "lineRects": [],
            "caretRect": null
        }),
    )
}
