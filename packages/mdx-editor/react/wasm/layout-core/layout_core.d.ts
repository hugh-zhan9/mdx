/* tslint:disable */
/* eslint-disable */

export function layout_get_selection_geometry(document_id: string, revision: bigint, pm_from: number, pm_to: number): Uint8Array;

export function layout_get_viewport_snapshot(document_id: string, revision: bigint, document_bytes: Uint8Array, _device_pixel_ratio: number): Uint8Array;

export function layout_hit_test(_document_id: string, _revision: bigint, x: number, y: number, granularity_bytes: Uint8Array): Uint8Array;

export function layout_initialize_document(document_id: string, layout_ir_bytes: Uint8Array, _style_context_bytes: Uint8Array, _viewport_bytes: Uint8Array, _platform_bytes: Uint8Array): Uint8Array;

export function layout_update_document(document_id: string, _document_revision: bigint, updated_blocks_bytes: Uint8Array, _removed_block_ids_bytes: Uint8Array, _viewport_bytes: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly layout_get_selection_geometry: (a: number, b: number, c: bigint, d: number, e: number) => [number, number];
    readonly layout_get_viewport_snapshot: (a: number, b: number, c: bigint, d: number, e: number, f: number) => [number, number];
    readonly layout_hit_test: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number) => [number, number];
    readonly layout_initialize_document: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly layout_update_document: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
