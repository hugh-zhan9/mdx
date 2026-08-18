/**
 * The product's read-only publishing entry.
 *
 * Both window modes reach publishing here and nowhere else. What crosses this
 * boundary in is an immutable `{documentId, revision, markdown}` and a path;
 * what comes back is a publishing outcome. Nothing here holds an editor
 * session, an adapter handle or a rendered surface, so a publishing failure
 * has nothing to write to and is reported rather than compensated for.
 *
 * The layout module is loaded lazily, inside the layout stage, so a build that
 * never ran `npm run build:layout-wasm` is reported through the same outcome as
 * any other layout failure instead of throwing past the caller. There is no
 * substitute layout path and no browser print: an export that cannot be laid
 * out does not happen.
 */

import {
    createReadOnlyPreviewLayoutPort,
    loadLayoutWasmModule,
} from "../../../packages/mdx-editor";
import {
    buildPublishingPreview,
    exportPublishingPdf,
} from "../../../packages/mdx-editor/publishing";
import type {
    PublishingExportOutput,
    PublishingLayoutPort,
    PublishingOutcome,
    PublishingPageSetup,
    PublishingPreview,
    PublishingSnapshot,
    PublishingViewport,
} from "../../../packages/mdx-editor/publishing";
import { createNativePdfTransport } from "./pdf-export-client";

/** A4 at 72 pt per inch, with one-inch margins. */
export const PUBLISHING_PAGE: PublishingPageSetup = {
    widthPt: 595,
    heightPt: 842,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
    fontEmbedMode: "subset",
};

/**
 * The printable area of `PUBLISHING_PAGE`, in points.
 *
 * Points, not CSS pixels: the exporter draws the layout's own numbers as PDF
 * points, so whatever unit the document is laid out in becomes the unit it is
 * printed in. Laid out at 601 by 931 — the same area in pixels at 96 dpi —
 * every measurement came out a third too large and lines wrapped at a width
 * wider than the paper itself.
 */
export const PUBLISHING_VIEWPORT: PublishingViewport = {
    // 595 - 72 - 72, and 842 - 72 - 72.
    width: 451,
    height: 698,
};

/** Wall-clock budget for laying one captured revision out. */
const LAYOUT_TIMEOUT_MS = 30_000;

export interface PublishingExportRequest {
    /** The revision being published. Copied by publishing before anything runs. */
    snapshot: PublishingSnapshot;
    /** The directory relative asset paths in the Markdown are resolved against. */
    rootPath: string;
    outputPath: string;
}

/**
 * Reads one captured revision as the content publishing would render.
 *
 * This is the whole of preview: content semantics for a revision, with no
 * caret, no selection and no way back into the document it came from.
 */
export function previewPublishedDocument(
    snapshot: PublishingSnapshot,
): PublishingOutcome<PublishingPreview> {
    return buildPublishingPreview(snapshot);
}

export function exportPublishedDocumentPdf(
    request: PublishingExportRequest,
): Promise<PublishingOutcome<PublishingExportOutput>> {
    return exportPublishingPdf({
        snapshot: request.snapshot,
        rootPath: request.rootPath,
        outputPath: request.outputPath,
        viewport: PUBLISHING_VIEWPORT,
        page: PUBLISHING_PAGE,
        layout: nativePreviewLayoutPort(),
        transport: createNativePdfTransport(),
        layoutTimeoutMs: LAYOUT_TIMEOUT_MS,
    });
}

/**
 * The read-only layout port, over the WASM module loaded on first use.
 *
 * The module is fetched when a layout is actually asked for rather than when
 * the entry is imported, so opening a document does not pull the layout engine
 * in, and a missing artifact surfaces as this export's layout failure.
 */
function nativePreviewLayoutPort(): PublishingLayoutPort {
    return {
        async layout(document) {
            const wasmModule = await loadLayoutWasmModule();

            return createReadOnlyPreviewLayoutPort(wasmModule).layout(document);
        },
    };
}

/** The publishing failure, in the words the product shows a person. */
export function describePublishingFailure(
    outcome: Extract<PublishingOutcome<unknown>, { ok: false }>,
): string {
    return `${PUBLISHING_FAILURES[outcome.error.code]}（${outcome.error.code}）${outcome.error.message}`;
}

const PUBLISHING_FAILURES: Record<string, string> = {
    invalid_snapshot: "无法读取要导出的内容。",
    invalid_output_path: "导出路径必须以 .pdf 结尾。",
    layout_timeout: "排版超时。",
    layout_failed: "排版失败。",
    image_read_failed: "无法读取文档引用的图片。",
    font_failed: "字体不可用。",
    output_path_denied: "没有写入该导出路径的权限。",
    revision_mismatch: "导出期间内容已变化。",
    export_failed: "导出 PDF 失败。",
};
