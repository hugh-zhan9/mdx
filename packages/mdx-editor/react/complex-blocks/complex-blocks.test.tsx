import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasSvgLayer } from "../canvas-svg-layer";
import { renderComplexBlock } from "./index";

describe("renderComplexBlock", () => {
    it("renders math ops through the math adapter", () => {
        const html = renderToStaticMarkup(
            renderComplexBlock({
                blockId: "math-1",
                kind: "math",
                rect: { x: 0, y: 0, width: 100, height: 20 },
                data: { type: "text", content: "x^2" },
            }),
        );

        expect(html).toContain('data-complex-block-kind="math"');
    });

    it("renders table ops through the table adapter", () => {
        const html = renderToStaticMarkup(
            renderComplexBlock({
                blockId: "table-1",
                kind: "table",
                rect: { x: 10, y: 20, width: 180, height: 60 },
                data: {
                    rows: [
                        ["Name", "Score"],
                        ["Ada", "42"],
                    ],
                },
            }),
        );

        expect(html).toContain('data-complex-block-kind="table"');
        expect(html).toContain("<table");
        expect(html).toContain("Name");
        expect(html).toContain("42");
    });

    it("renders html ops through the fallback adapter", () => {
        const html = renderToStaticMarkup(
            renderComplexBlock({
                blockId: "html-1",
                kind: "html",
                rect: { x: 0, y: 0, width: 120, height: 40 },
                data: {
                    html: "<details><summary>Open</summary><p>Body</p></details>",
                },
            }),
        );

        expect(html).toContain('data-complex-block-kind="html"');
        expect(html).toContain("Open");
    });

    it("renders fallback ops through the fallback adapter", () => {
        const html = renderToStaticMarkup(
            renderComplexBlock({
                blockId: "fallback-1",
                kind: "fallback",
                rect: { x: 0, y: 0, width: 120, height: 40 },
                data: {
                    markdown: "<Custom />",
                },
            }),
        );

        expect(html).toContain('data-complex-block-kind="fallback"');
        expect(html).toContain("&lt;Custom /&gt;");
    });

    it("renders complex block overlays from canvas draw ops", () => {
        const html = renderToStaticMarkup(
            <CanvasSvgLayer
                canvasDrawOps={[
                    {
                        blockId: "table-1",
                        kind: "table",
                        x: 12,
                        y: 24,
                        width: 200,
                        height: 72,
                        data: {
                            rows: [
                                ["A", "B"],
                                ["1", "2"],
                            ],
                        },
                    },
                    {
                        blockId: "fallback-1",
                        kind: "fallback",
                        x: 20,
                        y: 120,
                        width: 160,
                        height: 48,
                        data: {
                            markdown: "<Widget />",
                        },
                    },
                ]}
                caretAnchors={[]}
                hitTestEntries={[]}
                selectionGeometries={[]}
            />,
        );

        expect(html).toContain("data-layout-canvas-layer");
        expect(html).toContain("data-layout-svg-layer");
        expect(html).toContain('data-complex-block-kind="table"');
        expect(html).toContain('data-complex-block-kind="fallback"');
        expect(html).toContain("left:12px");
        expect(html).toContain("top:24px");
        expect(html).toContain("width:200px");
        expect(html).toContain("height:72px");
    });
});
