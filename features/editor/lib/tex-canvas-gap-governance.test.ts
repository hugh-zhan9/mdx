import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * The no-fallback rules the TeX canvas gap closure established, for the modules
 * that still ship. The hidden-ProseMirror-root rule left with the hybrid editor
 * pane it governed, and the TypeScript fallback layout bridge rule left with
 * `layout-bridge-runtime.ts`; these two govern the native font metrics and the
 * PDF exporter, both of which read-only publishing depends on.
 */
describe("TeX canvas gap governance", () => {
    it("does not use native hard-coded font metric fallbacks", () => {
        const layoutFonts = read("src-tauri/src/layout_fonts.rs");
        expect(layoutFonts).not.toContain("fallback_glyph_metrics");
        expect(layoutFonts).not.toContain("fallback_math_constants");
    });

    it("does not export PDF placeholders for unsupported draw ops", () => {
        const pdfExport = read("src-tauri/crates/pdf-core/src/export.rs");
        expect(pdfExport).not.toContain("exported as placeholder");
    });
});
