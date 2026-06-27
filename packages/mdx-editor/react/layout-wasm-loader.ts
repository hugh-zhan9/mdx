import type { LayoutBridgeModule } from "./wasm-layout-bridge";

export type WasmLayoutBridgeModule = LayoutBridgeModule;

export function createLayoutWasmNotBuiltError(): Error {
    return new Error(
        "Layout WASM artifact is missing. Run npm run build:layout-wasm before using the TeX canvas editor.",
    );
}

export async function loadLayoutWasmModule(): Promise<WasmLayoutBridgeModule> {
    try {
        const wasmModule = await import("./wasm/layout-core/layout_core.js");
        await wasmModule.default();
        return wasmModule as WasmLayoutBridgeModule;
    } catch (error) {
        if (
            error instanceof Error &&
            /Cannot find module|Failed to fetch|404|ERR_MODULE_NOT_FOUND/u.test(
                error.message,
            )
        ) {
            throw createLayoutWasmNotBuiltError();
        }

        throw error;
    }
}
