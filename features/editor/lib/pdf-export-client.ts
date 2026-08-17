import { tauriCore } from "@/common/lib/tauri";
import type {
    PublishingError,
    PublishingErrorCode,
    PublishingPdfPayload,
    PublishingPdfTransport,
    PublishingPdfTransportResult,
} from "../../../packages/mdx-editor/publishing";

/**
 * The native PDF export boundary.
 *
 * This module is a transport and nothing else. It serializes a publishing
 * payload into the command's wire shape, reports what the command answered, and
 * translates the command's error code into a publishing error code. It holds no
 * editor state and has no way to reach any: a failed export produces a
 * publishing error and stops there. There is no browser print here, and a
 * failure is never reported as a success.
 */

type PdfExportResult = {
    pageCount: number;
    warnings: string[];
    exportMs: number;
};

export async function exportPdf(
    rootPath: string,
    request: Record<string, unknown>,
) {
    const { invoke } = await tauriCore();
    return invoke<PdfExportResult>("layout_export_pdf", {
        rootPath,
        request,
    });
}

export function createNativePdfTransport(): PublishingPdfTransport {
    return {
        async export(payload): Promise<PublishingPdfTransportResult> {
            try {
                const result = await exportPdf(
                    payload.rootPath,
                    toNativeExportRequest(payload),
                );

                return {
                    ok: true,
                    pageCount: result.pageCount,
                    warnings: [...(result.warnings ?? [])],
                };
            } catch (error) {
                return { ok: false, error: toPublishingError(error) };
            }
        },
    };
}

/**
 * The command's request shape.
 *
 * The document and the revision the output corresponds to are part of it, so
 * the native side can refuse a payload whose layout was computed for a
 * different revision than the export was captured for.
 */
function toNativeExportRequest(
    payload: PublishingPdfPayload,
): Record<string, unknown> {
    return {
        document_id: payload.documentId,
        revision: payload.revision,
        layout_document_json: payload.layoutDocumentJson,
        layout_snapshot_json: payload.layoutSnapshotJson,
        output_path: payload.outputPath,
        page_size: {
            width_pt: payload.page.widthPt,
            height_pt: payload.page.heightPt,
        },
        margins: {
            top_pt: payload.page.marginTopPt,
            right_pt: payload.page.marginRightPt,
            bottom_pt: payload.page.marginBottomPt,
            left_pt: payload.page.marginLeftPt,
        },
        font_embed_mode: payload.page.fontEmbedMode,
    };
}

/** Font subsystem failure codes, as reported by `font-core`. */
const FONT_ERROR_CODES = new Set([
    "font_data_unavailable",
    "font_parse_failed",
    "glyph_metric_unavailable",
    "math_table_unavailable",
    "unknown_font_id",
    "invalid_font_id",
    "invalid_font_size",
]);

const ERROR_CODES: Record<string, PublishingErrorCode> = {
    invalid_name: "invalid_output_path",
    output_path_denied: "output_path_denied",
    revision_mismatch: "revision_mismatch",
    image_read_failed: "image_read_failed",
};

function toPublishingError(error: unknown): PublishingError {
    const code = nativeErrorCode(error);

    if (code === null) {
        return { code: "export_failed", message: describe(error) };
    }

    if (FONT_ERROR_CODES.has(code)) {
        return { code: "font_failed", message: describe(error) };
    }

    return {
        code: ERROR_CODES[code] ?? "export_failed",
        message: describe(error),
    };
}

function nativeErrorCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }

    const code = (error as { error_code?: unknown }).error_code;
    return typeof code === "string" ? code : null;
}

function describe(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const message = (error as { message?: unknown }).message;

        if (typeof message === "string") {
            return message;
        }
    }

    return error instanceof Error ? error.message : String(error);
}
