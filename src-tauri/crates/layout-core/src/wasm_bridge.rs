use wasm_bindgen::prelude::wasm_bindgen;

fn placeholder_response(_request_bytes: &[u8]) -> Vec<u8> {
    Vec::new()
}

#[wasm_bindgen]
pub fn layout_initialize_document(request_bytes: &[u8]) -> Vec<u8> {
    placeholder_response(request_bytes)
}

#[wasm_bindgen]
pub fn layout_update_document(request_bytes: &[u8]) -> Vec<u8> {
    placeholder_response(request_bytes)
}

#[wasm_bindgen]
pub fn layout_get_viewport_snapshot(request_bytes: &[u8]) -> Vec<u8> {
    placeholder_response(request_bytes)
}

#[wasm_bindgen]
pub fn layout_hit_test(request_bytes: &[u8]) -> Vec<u8> {
    placeholder_response(request_bytes)
}

#[wasm_bindgen]
pub fn layout_get_selection_geometry(request_bytes: &[u8]) -> Vec<u8> {
    placeholder_response(request_bytes)
}
