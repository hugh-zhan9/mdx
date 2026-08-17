/**
 * Initializes the layout WASM module for a test process.
 *
 * `loadLayoutWasmModule()` calls the glue module's async initializer, which
 * asks `fetch` for a `file:` URL. Browsers serve that; Node does not, so a test
 * that wants the real engine has to hand the bytes over itself. `initSync`
 * writes the same module-level instance the async initializer would, and the
 * async initializer returns early once it is set — so after this runs, the
 * product's own `loadLayoutWasmModule()` succeeds and returns the real engine.
 *
 * Nothing here is reachable from the product: it lives in the package's test
 * directory and is imported only by tests.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initSync } from "../react/wasm/layout-core/layout_core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function initializeLayoutWasmForTests(): void {
    initSync({
        module: readFileSync(
            path.join(
                HERE,
                "..",
                "react",
                "wasm",
                "layout-core",
                "layout_core_bg.wasm",
            ),
        ),
    });
}
