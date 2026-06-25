import { describe, expect, it, vi } from "vitest";
import { createLayoutBridge } from "./wasm-layout-bridge";

function decodeJson(bytes: number[]) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
}

const baseDocument = {
    documentId: "doc-1",
    revision: 1,
    blocks: [
        {
            blockId: "block-1",
            kind: "heading" as const,
            pmFrom: 0,
            pmTo: 5,
            depth: 0,
            inlines: [
                {
                    text: "Hello",
                    kind: "text" as const,
                    from: 0,
                    to: 5,
                    style: {
                        bold: true,
                        italic: false,
                        code: false,
                    },
                },
            ],
            style: {
                fontSize: 20,
                fontFamily: "Inter",
                lineHeight: 1.4,
                headingLevel: 1 as const,
            },
        },
    ],
    styleContext: {
        defaultFontSize: 14,
        defaultFontFamily: "Inter",
        defaultLineHeight: 1.5,
        viewportWidth: 800,
        viewportHeight: 600,
        devicePixelRatio: 1,
    },
};

const rustDocument = {
    document_id: "doc-1",
    revision: 1,
    blocks: [
        {
            block_id: "block-1",
            kind: "Heading",
            pm_from: 0,
            pm_to: 5,
            depth: 0,
            inlines: [
                {
                    text: "Hello",
                    kind: "Text",
                    from: 0,
                    to: 5,
                    style: {
                        bold: true,
                        italic: false,
                        code: false,
                        link: null,
                        strike: false,
                        underline: false,
                    },
                },
            ],
            style: {
                heading_level: 1,
                text_align: "Left",
                font_size: 20,
                font_family: "Inter",
                line_height: 1.4,
                math_display: "Inline",
            },
        },
    ],
    style_context: {
        default_font_size: 14,
        default_font_family: "Inter",
        default_line_height: 1.5,
        viewport_width: 800,
        viewport_height: 600,
        device_pixel_ratio: 1,
    },
};

describe("createLayoutBridge", () => {
    it("serializes initialize requests with the current Rust wire shape", async () => {
        const layoutInitializeDocument = vi.fn(
            (
                documentId: string,
                layoutIrBytes: number[],
                styleContextBytes: number[],
                viewportBytes: number[],
                platformBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(decodeJson(layoutIrBytes)).toEqual(rustDocument);
                expect(decodeJson(styleContextBytes)).toEqual(
                    rustDocument.style_context,
                );
                expect(decodeJson(viewportBytes)).toEqual({
                    width: 800,
                    height: 600,
                    device_pixel_ratio: 1,
                });
                expect(decodeJson(platformBytes)).toEqual({});

                return new TextEncoder().encode(
                    '{"revision":1,"lines":[],"canvas_draw_ops":[],"hit_test_entries":[],"caret_anchors":[],"selection_geometries":[],"mirror_blocks":[]}',
                );
            },
        );

        const bridge = createLayoutBridge({
            layout_initialize_document: layoutInitializeDocument,
            layout_update_document: vi.fn(),
            layout_get_viewport_snapshot: vi.fn(),
            layout_hit_test: vi.fn(),
            layout_get_selection_geometry: vi.fn(),
        });

        const snapshot = await bridge.initialize(baseDocument);

        expect(layoutInitializeDocument).toHaveBeenCalledTimes(1);
        expect(snapshot).toMatchObject({
            revision: 1,
            canvasDrawOps: [],
            hitTestEntries: [],
            caretAnchors: [],
            selectionGeometries: [],
            mirrorBlocks: [],
        });
    });

    it("serializes full documents for update and viewport snapshot", async () => {
        const layoutUpdateDocument = vi.fn(
            (
                documentId: string,
                revision: number,
                updatedBlocksBytes: number[],
                removedBlockIdsBytes: number[],
                viewportBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(2);
                expect(decodeJson(updatedBlocksBytes)).toEqual({
                    ...rustDocument,
                    revision: 2,
                });
                expect(removedBlockIdsBytes).toEqual([]);
                expect(viewportBytes).toEqual([]);

                return new TextEncoder().encode(
                    '{"revision":2,"lines":[],"canvas_draw_ops":[],"hit_test_entries":[],"caret_anchors":[],"selection_geometries":[],"mirror_blocks":[]}',
                );
            },
        );
        const layoutGetViewportSnapshot = vi.fn(
            (
                documentId: string,
                revision: number,
                viewportBytes: number[],
                devicePixelRatio: number,
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(3);
                expect(decodeJson(viewportBytes)).toEqual({
                    ...rustDocument,
                    revision: 3,
                });
                expect(devicePixelRatio).toBe(2);

                return new TextEncoder().encode(
                    '{"revision":3,"lines":[],"canvas_draw_ops":[],"hit_test_entries":[],"caret_anchors":[],"selection_geometries":[],"mirror_blocks":[]}',
                );
            },
        );

        const bridge = createLayoutBridge({
            layout_initialize_document: vi.fn(),
            layout_update_document: layoutUpdateDocument,
            layout_get_viewport_snapshot: layoutGetViewportSnapshot,
            layout_hit_test: vi.fn(),
            layout_get_selection_geometry: vi.fn(),
        });

        await expect(
            bridge.update({
                ...baseDocument,
                revision: 2,
            }),
        ).resolves.toMatchObject({ revision: 2 });

        await expect(
            bridge.getViewportSnapshot({
                ...baseDocument,
                revision: 3,
                viewport: {
                    width: 1024,
                    height: 768,
                    devicePixelRatio: 2,
                },
            }),
        ).resolves.toMatchObject({ revision: 3 });
    });

    it("serializes hit-test granularity and decodes helper responses", async () => {
        const layoutHitTest = vi.fn(
            (
                documentId: string,
                revision: number,
                x: number,
                y: number,
                granularityBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(1);
                expect(x).toBe(10);
                expect(y).toBe(20);
                expect(decodeJson(granularityBytes)).toEqual([
                    {
                        id: "line-1",
                        block_id: "block-1",
                        y: 12,
                        baseline: 18,
                        height: 24,
                        text_runs: [
                            {
                                block_id: "block-1",
                                pm_from: 0,
                                pm_to: 5,
                                left: 4,
                                baseline: 18,
                                width: 40,
                                height: 20,
                                font_family: "Inter",
                                font_size: 14,
                                text: "Hello",
                            },
                        ],
                    },
                ]);

                return new TextEncoder().encode(
                    '{"block_id":"b1","rect":{"x":10,"y":20,"width":30,"height":40},"pm_from":3,"pm_to":4}',
                );
            },
        );

        const bridge = createLayoutBridge({
            layout_initialize_document: vi.fn(),
            layout_update_document: vi.fn(),
            layout_get_viewport_snapshot: vi.fn(),
            layout_hit_test: layoutHitTest,
            layout_get_selection_geometry: vi.fn(() =>
                new TextEncoder().encode(
                    '{"pm_from":3,"pm_to":7,"rects":[{"x":1,"y":2,"width":3,"height":4}]}',
                ),
            ),
        });

        await expect(
            bridge.hitTest({
                documentId: "doc-1",
                revision: 1,
                x: 10,
                y: 20,
                granularity: [
                    {
                        id: "line-1",
                        blockId: "block-1",
                        y: 12,
                        baseline: 18,
                        height: 24,
                        textRuns: [
                            {
                                blockId: "block-1",
                                pmFrom: 0,
                                pmTo: 5,
                                left: 4,
                                baseline: 18,
                                width: 40,
                                height: 20,
                                fontFamily: "Inter",
                                fontSize: 14,
                                text: "Hello",
                            },
                        ],
                    },
                ],
            }),
        ).resolves.toEqual({
            blockId: "b1",
            rect: {
                x: 10,
                y: 20,
                width: 30,
                height: 40,
            },
            pmFrom: 3,
            pmTo: 4,
        });

        await expect(
            bridge.getSelectionGeometry({
                documentId: "doc-1",
                revision: 1,
                pmFrom: 3,
                pmTo: 7,
            }),
        ).resolves.toEqual({
            pmFrom: 3,
            pmTo: 7,
            rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        });
    });
});
