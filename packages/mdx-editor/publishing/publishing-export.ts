/**
 * The PDF export call chain.
 *
 * Every stage takes the captured snapshot and returns a publishing outcome. No
 * stage has anything to write back with: there is no session, no handle and no
 * callback into the editor anywhere in this module, and a failure at any stage
 * returns an error rather than substituting a different result. In particular a
 * failed native export is never answered with a browser print — this module
 * never reaches for one.
 */

import {
    buildPublishingLayoutDocument,
    buildPublishingPdfPayload,
} from "./publishing-layout";
import { readPublishingContent } from "./publishing-content";
import {
    capturePublishingSnapshot,
    publishingRequestKey,
} from "./publishing-snapshot";
import type {
    PublishingError,
    PublishingExportOutput,
    PublishingExportRequest,
    PublishingOutcome,
    PublishingSnapshot,
} from "./types";

class PublishingLayoutTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`publishing layout exceeded ${timeoutMs} ms`);
        this.name = "PublishingLayoutTimeoutError";
    }
}

export async function exportPublishingPdf(
    request: PublishingExportRequest,
): Promise<PublishingOutcome<PublishingExportOutput>> {
    let snapshot: PublishingSnapshot;

    try {
        snapshot = capturePublishingSnapshot(request.snapshot);
    } catch (error) {
        return {
            ok: false,
            documentId: String(request.snapshot?.documentId ?? ""),
            revision: Number(request.snapshot?.revision ?? -1),
            error: {
                code: "invalid_snapshot",
                message: describe(error),
            },
        };
    }

    if (!request.outputPath.endsWith(".pdf")) {
        return failure(snapshot, {
            code: "invalid_output_path",
            message: "PDF export path must end with .pdf",
        });
    }

    let layoutDocument;

    try {
        layoutDocument = buildPublishingLayoutDocument(
            snapshot,
            readPublishingContent(snapshot.markdown),
            request.viewport,
        );
    } catch (error) {
        return failure(snapshot, {
            code: "invalid_snapshot",
            message: `publishing could not read the captured Markdown: ${describe(error)}`,
        });
    }

    let layoutSnapshot;

    try {
        layoutSnapshot = await withLayoutTimeout(
            request.layout.layout(layoutDocument),
            request.layoutTimeoutMs,
        );
    } catch (error) {
        return failure(snapshot, {
            code:
                error instanceof PublishingLayoutTimeoutError
                    ? "layout_timeout"
                    : "layout_failed",
            message: describe(error),
        });
    }


    if (layoutSnapshot.revision !== snapshot.revision) {
        return failure(snapshot, {
            code: "revision_mismatch",
            message: `layout answered for revision ${layoutSnapshot.revision}, export captured revision ${snapshot.revision}`,
        });
    }

    const payload = buildPublishingPdfPayload({
        snapshot,
        rootPath: request.rootPath,
        outputPath: request.outputPath,
        page: request.page,
        layoutDocument,
        layoutSnapshot,
    });

    let transported;

    try {
        transported = await request.transport.export(payload);
    } catch (error) {
        return failure(snapshot, {
            code: "export_failed",
            message: describe(error),
        });
    }

    if (!transported.ok) {
        return failure(snapshot, transported.error);
    }

    return {
        ok: true,
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        warnings: [...transported.warnings],
        value: {
            outputPath: request.outputPath,
            pageCount: transported.pageCount,
            requestKey: publishingRequestKey(snapshot),
        },
    };
}

function failure(
    snapshot: PublishingSnapshot,
    error: PublishingError,
): PublishingOutcome<PublishingExportOutput> {
    return {
        ok: false,
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        error,
    };
}

async function withLayoutTimeout<TValue>(
    work: Promise<TValue>,
    timeoutMs: number,
): Promise<TValue> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new PublishingLayoutTimeoutError(timeoutMs));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
