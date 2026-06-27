import { expect, it } from "vitest";
import { createLayoutWasmNotBuiltError } from "./layout-wasm-loader";

it("reports missing layout wasm as a build error", () => {
    expect(createLayoutWasmNotBuiltError().message).toContain(
        "npm run build:layout-wasm",
    );
});
