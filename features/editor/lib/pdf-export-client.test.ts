import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNativePdfTransport, exportPdf } from "./pdf-export-client";
import type { PublishingPdfPayload } from "../../../packages/mdx-editor/publishing";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: async () => ({ invoke }),
}));

const PAYLOAD: PublishingPdfPayload = {
    requestKey: "note.md@3",
    rootPath: "/workspace",
    documentId: "note.md",
    revision: 3,
    layoutDocumentJson: '{"documentId":"note.md","revision":3,"blocks":[]}',
    layoutSnapshotJson: '{"revision":3,"lines":[],"canvasDrawOps":[]}',
    outputPath: "/workspace/note.pdf",
    page: {
        widthPt: 595,
        heightPt: 842,
        marginTopPt: 72,
        marginRightPt: 71,
        marginBottomPt: 70,
        marginLeftPt: 69,
        fontEmbedMode: "subset",
    },
};

let printCalls = 0;

beforeEach(() => {
    invoke.mockReset();
    printCalls = 0;
    const print = () => {
        printCalls += 1;
    };
    vi.stubGlobal("print", print);
    vi.stubGlobal("window", { print });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("exportPdf", () => {
    it("invokes the layout_export_pdf command", async () => {
        invoke.mockResolvedValue({ pageCount: 1, warnings: [], exportMs: 3 });

        const result = await exportPdf("/tmp/ws", { document_id: "doc-1" });

        expect(result.pageCount).toBe(1);
        expect(invoke).toHaveBeenCalledWith("layout_export_pdf", {
            rootPath: "/tmp/ws",
            request: { document_id: "doc-1" },
        });
    });
});

describe("the native PDF transport", () => {
    it("tells the command which document and revision the output is for", async () => {
        invoke.mockResolvedValue({ pageCount: 4, warnings: [], exportMs: 12 });

        await createNativePdfTransport().export(PAYLOAD);

        expect(invoke).toHaveBeenCalledWith("layout_export_pdf", {
            rootPath: "/workspace",
            request: {
                document_id: "note.md",
                revision: 3,
                layout_document_json:
                    '{"documentId":"note.md","revision":3,"blocks":[]}',
                layout_snapshot_json:
                    '{"revision":3,"lines":[],"canvasDrawOps":[]}',
                output_path: "/workspace/note.pdf",
                page_size: { width_pt: 595, height_pt: 842 },
                margins: {
                    top_pt: 72,
                    right_pt: 71,
                    bottom_pt: 70,
                    left_pt: 69,
                },
                font_embed_mode: "subset",
            },
        });
    });

    it("reports the pages and warnings the command produced", async () => {
        invoke.mockResolvedValue({
            pageCount: 4,
            warnings: ["mermaid block skipped"],
            exportMs: 12,
        });

        const result = await createNativePdfTransport().export(PAYLOAD);

        expect(result).toEqual({
            ok: true,
            pageCount: 4,
            warnings: ["mermaid block skipped"],
        });
    });

    it.each([
        ["image_read_failed", "image_read_failed"],
        ["output_path_denied", "output_path_denied"],
        ["revision_mismatch", "revision_mismatch"],
        ["invalid_name", "invalid_output_path"],
        ["font_data_unavailable", "font_failed"],
        ["font_parse_failed", "font_failed"],
        ["glyph_metric_unavailable", "font_failed"],
        ["unknown_font_id", "font_failed"],
        ["pdf_export_failed", "export_failed"],
        ["invalid_pdf_snapshot", "export_failed"],
        ["something_new", "export_failed"],
    ])("reports %s as %s", async (nativeCode, publishingCode) => {
        invoke.mockRejectedValue({
            error_code: nativeCode,
            message: "the command refused",
        });

        const result = await createNativePdfTransport().export(PAYLOAD);

        expect(result).toEqual({
            ok: false,
            error: { code: publishingCode, message: "the command refused" },
        });
    });

    it("reports a channel failure that carried no command error", async () => {
        invoke.mockRejectedValue(new Error("ipc closed"));

        const result = await createNativePdfTransport().export(PAYLOAD);

        expect(result).toEqual({
            ok: false,
            error: { code: "export_failed", message: "ipc closed" },
        });
    });

    it("never answers a failed export with a browser print", async () => {
        invoke.mockRejectedValue({
            error_code: "pdf_export_failed",
            message: "lopdf could not save",
        });

        const result = await createNativePdfTransport().export(PAYLOAD);

        expect(result.ok).toBe(false);
        expect(printCalls).toBe(0);
    });
});
