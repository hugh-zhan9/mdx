import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const banned = (...parts: Array<string>) => parts.join("");

describe("TeX canvas gap governance", () => {
    it("does not mount the hidden ProseMirror DOM root in the product editor", () => {
        const source = read("features/editor/components/editor-pane.tsx");
        expect(source).not.toContain(banned("Current", "Product", "Editor", "Root"));
        expect(source).not.toContain(banned("opacity-0", " ", "caret-transparent"));
        expect(source).not.toContain('aria-hidden="true"');
        expect(source).not.toContain("data-mdx-editor-root");
    });

    it("does not ship the TypeScript fallback layout bridge in the product runtime", () => {
        const source = read("packages/mdx-editor/react/layout-bridge-runtime.ts");
        expect(source).not.toContain("fallbackLayoutBridgeModule");
        expect(source).not.toContain("snapshotFromRustDocumentBytes");
    });

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
