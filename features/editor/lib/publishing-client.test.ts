import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: async () => ({ invoke }),
}));

import { initializeLayoutWasmForTests } from "../../../packages/mdx-editor/test/layout-wasm-init";
import {
    publishingPayloadDigest,
    publishingPreviewDigest,
} from "../../../packages/mdx-editor/publishing";
import type { PublishingPdfPayload } from "../../../packages/mdx-editor/publishing";
import {
    PUBLISHING_PAGE,
    describePublishingFailure,
    exportPublishedDocumentPdf,
    previewPublishedDocument,
} from "./publishing-client";

/**
 * The product's publishing entry, driven against the real layout engine.
 *
 * Nothing between the entry and the native command is replaced here: the WASM
 * module the product loads is the one that answers, the read-only layout port
 * is the real one, and the only stub is the Tauri command channel itself — so
 * a break anywhere in the surviving layout chain fails this test rather than
 * being hidden behind a fake layout port.
 */

const SNAPSHOT = {
    documentId: "/tmp/ws/note.md",
    revision: 4,
    markdown:
        "# Release notes\n\nSee the [docs](https://example.com/docs) for details.\n\n" +
        "- first item\n- second item\n\n```rust\nfn main() {}\n```\n",
};

function exportRequest() {
    return {
        snapshot: SNAPSHOT,
        rootPath: "/tmp/ws",
        outputPath: "/tmp/ws/note.pdf",
    };
}

/** The payload the native command was handed, or a failure if it never was. */
function nativePayload(): {
    rootPath: string;
    request: Record<string, unknown>;
} {
    const call = invoke.mock.calls.find(
        ([command]) => command === "layout_export_pdf",
    );

    if (!call) {
        throw new Error("the native PDF command was never invoked");
    }

    return call[1] as { rootPath: string; request: Record<string, unknown> };
}

beforeAll(() => {
    initializeLayoutWasmForTests();
});

beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ pageCount: 1, warnings: [], exportMs: 5 });
});

describe("exporting a captured revision as PDF", () => {
    it("lays the captured revision out with the real engine and hands it to the command", async () => {
        const outcome = await exportPublishedDocumentPdf(exportRequest());

        expect(outcome.ok).toBe(true);
        expect(outcome.documentId).toBe("/tmp/ws/note.md");
        expect(outcome.revision).toBe(4);

        const { rootPath, request } = nativePayload();
        expect(rootPath).toBe("/tmp/ws");
        expect(request.document_id).toBe("/tmp/ws/note.md");
        expect(request.revision).toBe(4);
        expect(request.output_path).toBe("/tmp/ws/note.pdf");
        expect(request.page_size).toEqual({
            width_pt: PUBLISHING_PAGE.widthPt,
            height_pt: PUBLISHING_PAGE.heightPt,
        });

        // Geometry the engine actually computed, not an empty placeholder.
        const snapshot = JSON.parse(
            String(request.layout_snapshot_json),
        ) as {
            revision: number;
            lines: Array<{
                blockId: string;
                height: number;
                textRuns: Array<{
                    text: string;
                    width: number;
                    fontSize: number;
                    style: { link: string | null };
                }>;
            }>;
        };

        expect(snapshot.revision).toBe(4);
        expect(snapshot.lines.length).toBeGreaterThan(0);

        const runs = snapshot.lines.flatMap((line) => line.textRuns);
        const heading = runs.find((run) => run.text.includes("Release notes"));
        expect(heading).toBeDefined();
        expect(heading?.width).toBeGreaterThan(0);
        // A heading is laid out larger than body text, which is a decision only
        // the engine makes.
        expect(heading?.fontSize).toBeGreaterThan(14);
        expect(runs.some((run) => run.style.link === "https://example.com/docs")).toBe(
            true,
        );
    });

    it("never gives the exporter anything that could address a caret", async () => {
        await exportPublishedDocumentPdf(exportRequest());

        const snapshot = JSON.parse(
            String(nativePayload().request.layout_snapshot_json),
        ) as Record<string, unknown[]>;

        expect(snapshot.hitTestEntries).toEqual([]);
        expect(snapshot.caretAnchors).toEqual([]);
        expect(snapshot.selectionGeometries).toEqual([]);
        expect(snapshot.mirrorBlocks).toEqual([]);
    });

    it("shows the same content the preview reads", async () => {
        const preview = previewPublishedDocument(SNAPSHOT);
        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error("preview failed");

        await exportPublishedDocumentPdf(exportRequest());

        const payload = {
            layoutDocumentJson: String(nativePayload().request.layout_document_json),
        } as PublishingPdfPayload;

        expect(publishingPayloadDigest(payload)).toEqual(
            publishingPreviewDigest(preview.value),
        );
        expect(publishingPreviewDigest(preview.value)).toContain(
            "heading:1",
        );
    });

    it("reports a refused output path without reaching the command", async () => {
        const outcome = await exportPublishedDocumentPdf({
            ...exportRequest(),
            outputPath: "/tmp/ws/note.txt",
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error("expected a refusal");
        expect(outcome.error.code).toBe("invalid_output_path");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("reports what the command refused, in words the product can show", async () => {
        invoke.mockRejectedValue({
            error_code: "output_path_denied",
            message: "permission denied",
        });

        const outcome = await exportPublishedDocumentPdf(exportRequest());

        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error("expected a refusal");
        expect(outcome.error.code).toBe("output_path_denied");
        expect(describePublishingFailure(outcome)).toContain("output_path_denied");
        expect(describePublishingFailure(outcome)).toContain("permission denied");
    });
});

describe("previewing a captured revision", () => {
    it("reads the revision as content and identifies which one it was", () => {
        const preview = previewPublishedDocument(SNAPSHOT);

        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error("preview failed");
        expect(preview.value.documentId).toBe("/tmp/ws/note.md");
        expect(preview.value.revision).toBe(4);
        expect(preview.value.blocks[0]).toEqual({
            kind: "heading",
            level: 1,
            inlines: [{ kind: "text", text: "Release notes" }],
        });
        expect(
            preview.value.blocks.some(
                (block) => block.kind === "code" && block.language === "rust",
            ),
        ).toBe(true);
    });

    it("carries no caret, selection or hit-test data", () => {
        const preview = previewPublishedDocument(SNAPSHOT);
        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error("preview failed");

        expect(Object.keys(preview.value).sort()).toEqual([
            "blocks",
            "documentId",
            "revision",
        ]);
    });
});
