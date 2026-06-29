import { describe, expect, it, vi } from "vitest";
import { createLayoutBridge } from "./wasm-layout-bridge";

function decodeJson(bytes: number[] | Uint8Array) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
}

const emptyJsonArrayBytes = new TextEncoder().encode("[]");

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
                    attrs: {},
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

    it("widens inline atom wire spans to their display text length", async () => {
        const layoutInitializeDocument = vi.fn(
            (_documentId: string, layoutIrBytes: number[]) => {
                expect(decodeJson(layoutIrBytes).blocks[0].inlines[0]).toMatchObject({
                    text: "x^2",
                    kind: "MathInline",
                    from: 1,
                    to: 4,
                });

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

        await bridge.initialize({
            ...baseDocument,
            blocks: [
                {
                    ...baseDocument.blocks[0],
                    kind: "paragraph",
                    pmFrom: 0,
                    pmTo: 5,
                    inlines: [
                        {
                            id: "math-1",
                            text: "x^2",
                            kind: "math_inline",
                            marks: [],
                            sourceFrom: 1,
                            sourceTo: 2,
                            style: {
                                bold: false,
                                italic: false,
                                code: false,
                            },
                        },
                    ],
                },
            ],
        });

        expect(layoutInitializeDocument).toHaveBeenCalledTimes(1);
    });

    it("preserves absolute ProseMirror positions for later blocks", async () => {
        const layoutInitializeDocument = vi.fn(
            (_documentId: string, layoutIrBytes: number[]) => {
                const document = decodeJson(layoutIrBytes);
                expect(document.blocks[1].inlines[0]).toMatchObject({
                    text: "Second",
                    from: 14,
                    to: 20,
                });

                return new TextEncoder().encode(
                    '{"revision":1,"lines":[{"id":"line-1","block_id":"block-2","y":0,"baseline":16,"height":20,"text_runs":[{"block_id":"block-2","pm_from":14,"pm_to":20,"left":0,"baseline":16,"width":48,"height":20,"font_family":"Inter","font_size":14,"text":"Second"}]}],"canvas_draw_ops":[],"hit_test_entries":[],"caret_anchors":[],"selection_geometries":[],"mirror_blocks":[]}',
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

        const snapshot = await bridge.initialize({
            ...baseDocument,
            blocks: [
                {
                    ...baseDocument.blocks[0],
                    blockId: "block-1",
                    pmFrom: 0,
                    pmTo: 8,
                },
                {
                    ...baseDocument.blocks[0],
                    blockId: "block-2",
                    pmFrom: 13,
                    pmTo: 21,
                    inlines: [
                        {
                            id: "run-2",
                            text: "Second",
                            kind: "text",
                            marks: [],
                            sourceFrom: 14,
                            sourceTo: 20,
                            style: {
                                bold: false,
                                italic: false,
                                code: false,
                            },
                        },
                    ],
                },
            ],
        });

        expect(snapshot.lines[0]?.textRuns[0]).toMatchObject({
            pmFrom: 14,
            pmTo: 20,
        });
    });

    it("rejects snapshots missing required product arrays", async () => {
        const bridge = createLayoutBridge({
            layout_initialize_document: vi.fn(() =>
                new TextEncoder().encode('{"revision":1,"lines":[],"canvas_draw_ops":[],"caret_anchors":[]}'),
            ),
            layout_update_document: vi.fn(),
            layout_get_viewport_snapshot: vi.fn(),
            layout_hit_test: vi.fn(),
            layout_get_selection_geometry: vi.fn(),
        });

        await expect(bridge.initialize(baseDocument)).rejects.toThrow(
            "layout snapshot missing hitTestEntries",
        );
    });

    it("decodes JSON object payloads embedded in canvas draw op data strings", async () => {
        const bridge = createLayoutBridge({
            layout_initialize_document: vi.fn(() =>
                new TextEncoder().encode(
                    JSON.stringify({
                        revision: 1,
                        lines: [],
                        canvas_draw_ops: [
                            {
                                block_id: "code-1",
                                kind: "code_highlight",
                                x: 0,
                                y: 0,
                                width: 120,
                                height: 40,
                                data: JSON.stringify({
                                    code: "let value = 1;",
                                    language: "ts",
                                }),
                            },
                        ],
                        hit_test_entries: [],
                        caret_anchors: [],
                        selection_geometries: [],
                        mirror_blocks: [],
                    }),
                ),
            ),
            layout_update_document: vi.fn(),
            layout_get_viewport_snapshot: vi.fn(),
            layout_hit_test: vi.fn(),
            layout_get_selection_geometry: vi.fn(),
        });

        const snapshot = await bridge.initialize(baseDocument);

        expect(snapshot.canvasDrawOps[0]?.data).toEqual({
            code: "let value = 1;",
            language: "ts",
        });
    });

    it("serializes full documents for update and viewport snapshot", async () => {
        const layoutUpdateDocument = vi.fn(
            (
                documentId: string,
                revision: bigint,
                updatedBlocksBytes: number[],
                removedBlockIdsBytes: number[],
                viewportBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(2n);
                expect(decodeJson(updatedBlocksBytes)).toEqual({
                    ...rustDocument,
                    revision: 2,
                });
                expect(removedBlockIdsBytes).toEqual(emptyJsonArrayBytes);
                expect(viewportBytes).toEqual(emptyJsonArrayBytes);

                return new TextEncoder().encode(
                    '{"revision":2,"lines":[],"canvas_draw_ops":[],"hit_test_entries":[],"caret_anchors":[],"selection_geometries":[],"mirror_blocks":[]}',
                );
            },
        );
        const layoutGetViewportSnapshot = vi.fn(
            (
                documentId: string,
                revision: bigint,
                viewportBytes: number[],
                devicePixelRatio: number,
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(3n);
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
                revision: bigint,
                x: number,
                y: number,
                granularityBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(revision).toBe(1n);
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
