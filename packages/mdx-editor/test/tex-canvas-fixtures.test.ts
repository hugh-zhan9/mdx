import { describe, expect, it } from "vitest";

import {
    TEX_CANVAS_FIXTURE_CORPUS_JSON,
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
                "mixed-layout",
            ]),
        );

        const fixtureKinds = new Set(
            texCanvasFixtures.flatMap((fixture) => fixture.expected.blockKinds),
        );

        expect(Array.from(fixtureKinds).sort()).toEqual([
            "fallback",
            "mermaid",
            "paragraph",
            "table",
        ]);
        expect(TEX_CANVAS_FIXTURE_BLOCK_KINDS).toContain("math");
    });

    it("keeps fixture snapshots aligned with markdown text", () => {
        for (const fixture of texCanvasFixtures) {
            expect(fixture.markdown.endsWith("\n")).toBe(true);
            expect(fixture.expected.mirrorText.length).toBeGreaterThan(0);
            expect(fixture.expected.lineSnippets.length).toBeGreaterThan(0);
        }
    });

    it("exports a shared JSON corpus that round-trips to the typed fixtures", () => {
        expect(JSON.parse(TEX_CANVAS_FIXTURE_CORPUS_JSON)).toEqual(
            TEX_CANVAS_FIXTURES,
        );
    });

    it("pins the reviewed fixture semantics", () => {
        const byId = new Map(
            texCanvasFixtures.map((fixture) => [fixture.id, fixture]),
        );

        expect(byId.get("paragraph-cjk")?.expected).toMatchObject({
            blockKinds: ["paragraph"],
            canvasBlockKinds: [],
        });
        expect(byId.get("paragraph-cjk")?.expected.hasMathInline).toBeUndefined();

        expect(byId.get("math-inline")?.expected).toMatchObject({
            blockKinds: ["paragraph"],
            canvasBlockKinds: [],
            hasMathInline: true,
            mirrorText: "公式 x^2 + y^2 = z^2 跟正文混排。",
        });
        expect(byId.get("math-inline")?.markdown).toContain("$x^2 + y^2 = z^2$");

        expect(byId.get("html-fallback")).toMatchObject({
            markdown: "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n",
            expected: {
                blockKinds: ["fallback"],
                canvasBlockKinds: ["fallback"],
                mirrorText: "<div data-x=\"1\"> <span>HTML</span> </div>",
            },
        });

        expect(byId.get("mixed-layout")).toMatchObject({
            expected: {
                blockKinds: ["paragraph", "mermaid", "fallback", "table"],
                canvasBlockKinds: ["mermaid", "fallback", "table"],
                hasMathInline: true,
            },
        });
        expect(byId.get("mixed-layout")?.markdown).toContain("$a+b$");
        expect(byId.get("mixed-layout")?.expected.mirrorText).toContain(
            "<div class=\"unsupported\">raw html block</div>",
        );
    });
});
