import { describe, expect, it } from "vitest";

import {
    TEX_CANVAS_FIXTURES,
    TEX_CANVAS_FIXTURE_BLOCK_KINDS,
    texCanvasFixtures,
} from "./tex-canvas-fixtures";

describe("texCanvasFixtures", () => {
    it("covers paragraph, math, table, mermaid, and fallback scenarios", () => {
        expect(TEX_CANVAS_FIXTURES.map((fixture) => fixture.id)).toEqual(
            expect.arrayContaining([
                "paragraph-cjk",
                "math-inline",
                "table-basic",
                "mermaid-basic",
                "html-fallback",
            ]),
        );

        const fixtureKinds = new Set(
            texCanvasFixtures.flatMap((fixture) => fixture.expected.blockKinds),
        );

        expect(Array.from(fixtureKinds).sort()).toEqual(
            [...TEX_CANVAS_FIXTURE_BLOCK_KINDS].sort(),
        );
    });

    it("keeps fixture snapshots aligned with markdown text", () => {
        for (const fixture of texCanvasFixtures) {
            expect(fixture.markdown.endsWith("\n")).toBe(true);
            expect(fixture.expected.mirrorText.length).toBeGreaterThan(0);
            expect(fixture.expected.canvasBlockKinds.length).toBeGreaterThan(0);
            expect(fixture.expected.lineSnippets.length).toBeGreaterThan(0);
        }
    });
});
