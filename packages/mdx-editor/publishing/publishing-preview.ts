/**
 * The read-only preview surface's data.
 *
 * A preview is content plus the revision it came from. It has no editable
 * document, no selection, no caret and no hit-test entry point, so a preview
 * host built on it can present a revision and nothing else.
 */

import {
    publishingContentDigest,
    readPublishingContent,
} from "./publishing-content";
import { capturePublishingSnapshot } from "./publishing-snapshot";
import type {
    PublishingOutcome,
    PublishingPreview,
    PublishingSnapshot,
} from "./types";

export function buildPublishingPreview(
    snapshot: PublishingSnapshot,
): PublishingOutcome<PublishingPreview> {
    const captured = capturePublishingSnapshot(snapshot);

    try {
        const content = readPublishingContent(captured.markdown);

        return {
            ok: true,
            documentId: captured.documentId,
            revision: captured.revision,
            warnings: [],
            value: {
                documentId: captured.documentId,
                revision: captured.revision,
                blocks: content.blocks,
            },
        };
    } catch (error) {
        return {
            ok: false,
            documentId: captured.documentId,
            revision: captured.revision,
            error: {
                code: "invalid_snapshot",
                message: `publishing could not read the captured Markdown: ${describe(error)}`,
            },
        };
    }
}

/** The semantic reading of what a preview shows. */
export function publishingPreviewDigest(preview: PublishingPreview): string[] {
    return publishingContentDigest({ blocks: preview.blocks });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
