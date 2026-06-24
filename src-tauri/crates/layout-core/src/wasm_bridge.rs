use wasm_bindgen::prelude::wasm_bindgen;

fn placeholder_response() -> Vec<u8> {
    Vec::new()
}

#[wasm_bindgen]
pub fn layout_initialize_document(
    _document_id: String,
    _layout_ir_bytes: Vec<u8>,
    _style_context_bytes: Vec<u8>,
    _viewport_bytes: Vec<u8>,
    _platform_bytes: Vec<u8>,
) -> Vec<u8> {
    placeholder_response()
}

#[wasm_bindgen]
pub fn layout_update_document(
    _document_id: String,
    _document_revision: u64,
    _updated_blocks_bytes: Vec<u8>,
    _removed_block_ids_bytes: Vec<u8>,
    _viewport_bytes: Vec<u8>,
) -> Vec<u8> {
    placeholder_response()
}

#[wasm_bindgen]
pub fn layout_get_viewport_snapshot(
    _document_id: String,
    _revision: u64,
    _viewport_bytes: Vec<u8>,
    _device_pixel_ratio: f32,
) -> Vec<u8> {
    placeholder_response()
}

#[wasm_bindgen]
pub fn layout_hit_test(
    _document_id: String,
    _revision: u64,
    _x: f32,
    _y: f32,
    _granularity_bytes: Vec<u8>,
) -> Vec<u8> {
    placeholder_response()
}

#[wasm_bindgen]
pub fn layout_get_selection_geometry(
    _document_id: String,
    _revision: u64,
    _pm_from: u32,
    _pm_to: u32,
) -> Vec<u8> {
    placeholder_response()
}
