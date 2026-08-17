import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createReadOnlyPreviewLayoutPort } from "./read-only-preview-layout";
import type { LayoutBridgeModule } from "./wasm-layout-bridge";
import type { PublishingLayoutDocument } from "../publishing";

const encoder = new TextEncoder();

function bridgeModule() {
    const initialize = vi.fn<LayoutBridgeModule["layout_initialize_document"]>(
        () =>
            encoder.encode(
            JSON.stringify({
                revision: 3,
                lines: [
                    {
                        id: "line-0",
                        block_id: "paragraph-0",
                        y: 0,
                        baseline: 12,
                        height: 16,
                        text_runs: [
                            {
                                block_id: "paragraph-0",
                                pm_from: 1,
                                pm_to: 6,
                                left: 4,
                                baseline: 12,
                                width: 40,
                                height: 16,
                                font_family: "Helvetica",
                                font_size: 14,
                                text: "docs",
                                style: { link: "https://example.com/docs" },
                            },
                        ],
                    },
                ],
                canvas_draw_ops: [
                    {
                        block_id: "image-1",
                        kind: "Image",
                        x: 0,
                        y: 20,
                        width: 16,
                        height: 16,
                        data: JSON.stringify({ src: "./red.png" }),
                    },
                ],
                hit_test_entries: [
                    {
                        block_id: "paragraph-0",
                        rect: { x: 0, y: 0, width: 40, height: 16 },
                        pm_from: 1,
                        pm_to: 6,
                    },
                ],
                caret_anchors: [
                    { line_id: "line-0", pm_position: 1, x: 4, y: 0, height: 16 },
                ],
                selection_geometries: [{ pm_from: 1, pm_to: 6, rects: [] }],
                mirror_blocks: [
                    {
                        block_id: "paragraph-0",
                        pm_from: 1,
                        pm_to: 6,
                        semantic_text: "docs",
                        aria_label: "paragraph",
                    },
                ],
            }),
        ),
    );
    const update = vi.fn(() => encoder.encode("{}"));
    const viewportSnapshot = vi.fn(() => encoder.encode("{}"));
    const hitTest = vi.fn(() => encoder.encode("{}"));
    const selectionGeometry = vi.fn(() => encoder.encode("{}"));

    /**
     * The built artifact still exports the interactive entry points; the typed
     * contract deliberately no longer names them. The mock keeps them so the
     * assertions below prove the port ignores what it could otherwise reach,
     * rather than only proving the type stopped it.
     */
    const wasmModule = {
        layout_initialize_document: initialize,
        layout_update_document: update,
        layout_get_viewport_snapshot: viewportSnapshot,
        layout_hit_test: hitTest,
        layout_get_selection_geometry: selectionGeometry,
    } as unknown as LayoutBridgeModule;

    return {
        wasmModule,
        initialize,
        update,
        viewportSnapshot,
        hitTest,
        selectionGeometry,
    };
}

const DOCUMENT: PublishingLayoutDocument = {
    documentId: "note.md",
    revision: 3,
    viewport: { width: 800, height: 600 },
    blocks: [
        {
            blockId: "paragraph-0",
            kind: "paragraph",
            level: 0,
            ordered: false,
            checked: null,
            header: false,
            language: "",
            text: "",
            inlines: [
                {
                    text: "docs",
                    kind: "link",
                    link: "https://example.com/docs",
                    src: null,
                    emphasis: [],
                    code: false,
                },
            ],
            cells: [],
        },
    ],
    styleContext: {
        defaultFontSize: 14,
        defaultFontFamily: "Helvetica",
        defaultLineHeight: 1.5,
        viewportWidth: 800,
        viewportHeight: 600,
    },
};

describe("the read-only preview layout port", () => {
    it("never names an interactive layout entry point", () => {
        const source = readFileSync(
            path.join(
                path.dirname(fileURLToPath(import.meta.url)),
                "read-only-preview-layout.ts",
            ),
            "utf8",
        )
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "");

        for (const entryPoint of [
            "hitTest",
            "layout_hit_test",
            "getSelectionGeometry",
            "layout_get_selection_geometry",
            "hitTestLayout",
            "getViewportSnapshot",
            "updateLayoutDocument",
        ]) {
            expect(source.includes(entryPoint), `names ${entryPoint}`).toBe(false);
        }
    });

    it("offers laying content out and nothing else", () => {
        const port = createReadOnlyPreviewLayoutPort(bridgeModule().wasmModule);

        expect(Object.keys(port)).toEqual(["layout"]);
    });

    it("asks the layout engine only to lay a document out", async () => {
        const bridge = bridgeModule();

        await createReadOnlyPreviewLayoutPort(bridge.wasmModule).layout(DOCUMENT);

        expect(bridge.initialize).toHaveBeenCalledTimes(1);
        expect(bridge.hitTest).not.toHaveBeenCalled();
        expect(bridge.selectionGeometry).not.toHaveBeenCalled();
        expect(bridge.update).not.toHaveBeenCalled();
        expect(bridge.viewportSnapshot).not.toHaveBeenCalled();
    });

    it("drops every interactive answer the engine returned", async () => {
        const bridge = bridgeModule();

        const snapshot = await createReadOnlyPreviewLayoutPort(
            bridge.wasmModule,
        ).layout(DOCUMENT);

        expect(Object.keys(snapshot).sort()).toEqual([
            "canvasDrawOps",
            "lines",
            "revision",
        ]);
        expect(JSON.stringify(snapshot)).not.toContain("pmFrom");
        expect(JSON.stringify(snapshot)).not.toContain("pmPosition");
        expect(JSON.stringify(snapshot)).not.toContain("semanticText");
    });

    it("keeps the content the exporter needs", async () => {
        const bridge = bridgeModule();

        const snapshot = await createReadOnlyPreviewLayoutPort(
            bridge.wasmModule,
        ).layout(DOCUMENT);

        expect(snapshot.revision).toBe(3);
        expect(snapshot.lines[0].textRuns[0]).toEqual({
            blockId: "paragraph-0",
            left: 4,
            baseline: 12,
            width: 40,
            height: 16,
            fontFamily: "Helvetica",
            fontSize: 14,
            text: "docs",
            link: "https://example.com/docs",
        });
        expect(snapshot.canvasDrawOps[0].kind).toBe("Image");
        expect(snapshot.canvasDrawOps[0].data).toContain("./red.png");
    });

    it("hands the engine content, not editor positions", async () => {
        const bridge = bridgeModule();

        await createReadOnlyPreviewLayoutPort(bridge.wasmModule).layout(DOCUMENT);

        const [documentId, layoutIrBytes] = bridge.initialize.mock.calls[0];
        const sent = JSON.parse(new TextDecoder().decode(layoutIrBytes)) as {
            revision: number;
            blocks: Array<{
                pm_from: number;
                pm_to: number;
                inlines: Array<{ from: number; to: number; text: string }>;
            }>;
        };

        expect(documentId).toBe("note.md");
        expect(sent.revision).toBe(3);
        expect(sent.blocks[0].pm_from).toBe(0);
        expect(sent.blocks[0].pm_to).toBe(0);
        expect(sent.blocks[0].inlines[0].text).toBe("docs");
    });
});
