import { describe, expect, it, vi } from "vitest";
import { createLayoutBridge } from "./wasm-layout-bridge";

describe("createLayoutBridge", () => {
    it("serializes initialize requests and decodes the snapshot", async () => {
        const layoutInitializeDocument = vi.fn(
            (
                documentId: string,
                layoutIrBytes: number[],
                styleContextBytes: number[],
                viewportBytes: number[],
                platformBytes: number[],
            ) => {
                expect(documentId).toBe("doc-1");
                expect(
                    JSON.parse(new TextDecoder().decode(new Uint8Array(layoutIrBytes))),
                ).toMatchObject({
                    documentId: "doc-1",
                    revision: 1,
                    blocks: [],
                });
                expect(
                    JSON.parse(
                        new TextDecoder().decode(new Uint8Array(styleContextBytes)),
                    ),
                ).toEqual({
                    defaultFontSize: 14,
                    defaultFontFamily: "Inter",
                    defaultLineHeight: 1.5,
                    viewportWidth: 800,
                    viewportHeight: 600,
                    devicePixelRatio: 1,
                });
                expect(
                    JSON.parse(new TextDecoder().decode(new Uint8Array(viewportBytes))),
                ).toEqual({
                    width: 800,
                    height: 600,
                    devicePixelRatio: 1,
                });
                expect(
                    JSON.parse(new TextDecoder().decode(new Uint8Array(platformBytes))),
                ).toEqual({});

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

        const snapshot = await bridge.initialize({
            documentId: "doc-1",
            revision: 1,
            blocks: [],
            styleContext: {
                defaultFontSize: 14,
                defaultFontFamily: "Inter",
                defaultLineHeight: 1.5,
                viewportWidth: 800,
                viewportHeight: 600,
                devicePixelRatio: 1,
            },
        });

        expect(layoutInitializeDocument).toHaveBeenCalledTimes(1);
        expect(snapshot.revision).toBe(1);
        expect(snapshot.canvasDrawOps).toEqual([]);
        expect(snapshot.hitTestEntries).toEqual([]);
        expect(snapshot.caretAnchors).toEqual([]);
        expect(snapshot.selectionGeometries).toEqual([]);
        expect(snapshot.mirrorBlocks).toEqual([]);
    });

    it("decodes hit tests and selection geometry", async () => {
        const bridge = createLayoutBridge({
            layout_initialize_document: vi.fn(),
            layout_update_document: vi.fn(),
            layout_get_viewport_snapshot: vi.fn(),
            layout_hit_test: vi.fn(() =>
                new TextEncoder().encode(
                    '{"block_id":"b1","rect":{"x":10,"y":20,"width":30,"height":40},"pm_from":3,"pm_to":4}',
                ),
            ),
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
                granularity: [],
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
