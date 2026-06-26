import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HybridEditorHost } from "./hybrid-editor-host";

describe("HybridEditorHost", () => {
    it("renders text runs and a canvas overlay", () => {
        const html = renderToStaticMarkup(
            <HybridEditorHost
                snapshot={{
                    revision: 1,
                    lines: [
                        {
                            id: "l1",
                            blockId: "b1",
                            y: 0,
                            baseline: 16,
                            height: 20,
                            textRuns: [
                                {
                                    blockId: "b1",
                                    pmFrom: 0,
                                    pmTo: 5,
                                    left: 0,
                                    baseline: 16,
                                    width: 40,
                                    height: 20,
                                    fontFamily: "Inter",
                                    fontSize: 14,
                                    text: "Hello",
                                },
                            ],
                        },
                    ],
                    canvasDrawOps: [],
                    hitTestEntries: [],
                    caretAnchors: [],
                    selectionGeometries: [],
                    mirrorBlocks: [],
                }}
            />,
        );

        expect(html).toContain("Hello");
        expect(html).toContain("data-layout-canvas-layer");
        expect(html).toContain("data-layout-svg-layer");
        expect(html).toContain("data-hybrid-editor-content");
        expect(html).toContain('data-layout-block-id="b1"');
        expect(html).toContain("height:20px");
        expect(html).toContain("width:40px");
        expect(html).toContain('data-canvas-draw-op-count="0"');
        expect(html).toContain('data-caret-anchor-count="0"');
        expect(html).toContain('data-selection-geometry-count="0"');
    });

    it("mounts the light mirror for canvas blocks without replacing text runs", () => {
        const html = renderToStaticMarkup(
            <HybridEditorHost
                snapshot={{
                    revision: 1,
                    lines: [
                        {
                            id: "l1",
                            blockId: "b1",
                            y: 0,
                            baseline: 16,
                            height: 20,
                            textRuns: [
                                {
                                    blockId: "b1",
                                    pmFrom: 0,
                                    pmTo: 5,
                                    left: 0,
                                    baseline: 16,
                                    width: 40,
                                    height: 20,
                                    fontFamily: "Inter",
                                    fontSize: 14,
                                    text: "Hello",
                                },
                            ],
                        },
                    ],
                    canvasDrawOps: [],
                    hitTestEntries: [],
                    caretAnchors: [],
                    selectionGeometries: [],
                    mirrorBlocks: [
                        {
                            blockId: "math-1",
                            pmFrom: 0,
                            pmTo: 4,
                            semanticText: "x squared",
                            ariaLabel: "math x squared",
                        },
                    ],
                }}
            />,
        );

        expect(html).toContain("Hello");
        expect(html).toContain("data-layout-light-mirror");
        expect(html).toContain("x squared");
        expect(html).toContain('aria-label="math x squared"');
    });
});
