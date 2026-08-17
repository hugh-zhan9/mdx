/**
 * Capturing the immutable content publishing works on.
 *
 * The session owns Markdown, dirty, drafts, selection and conflicts. Publishing
 * is handed a copy of three fields and never the object those fields came from,
 * so an in-flight export cannot observe a later edit and cannot write anything
 * back onto the source it was captured from.
 */

import type { PublishingSnapshot } from "./types";

/**
 * Anything shaped like a document snapshot can be captured.
 *
 * Declared structurally so publishing never names a session or adapter type:
 * an `EditorDocumentSnapshot` satisfies it without publishing importing one.
 */
export interface PublishingSnapshotSource {
    readonly documentId: string;
    readonly revision: number;
    readonly markdown: string;
}

export class PublishingSnapshotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PublishingSnapshotError";
    }
}

/**
 * Copies `source` into a frozen publishing snapshot.
 *
 * The result never aliases `source`, so an edit that mutates the session's own
 * snapshot object mid-export cannot change what is being exported. The result
 * is frozen, so nothing downstream can normalize, trim or re-point it either.
 */
export function capturePublishingSnapshot(
    source: PublishingSnapshotSource,
): PublishingSnapshot {
    if (typeof source.documentId !== "string" || source.documentId.length === 0) {
        throw new PublishingSnapshotError(
            "publishing snapshot requires a document id",
        );
    }

    if (!Number.isInteger(source.revision) || source.revision < 0) {
        throw new PublishingSnapshotError(
            "publishing snapshot requires a non-negative integer revision",
        );
    }

    if (typeof source.markdown !== "string") {
        throw new PublishingSnapshotError(
            "publishing snapshot requires Markdown text",
        );
    }

    return Object.freeze({
        documentId: source.documentId,
        revision: source.revision,
        markdown: source.markdown,
    });
}

/**
 * The cache identity of a publishing request.
 *
 * Both the document and the revision are part of the key, so a request issued
 * for one revision can never be served from another revision's result, and two
 * documents never share an entry.
 */
export function publishingRequestKey(snapshot: PublishingSnapshot): string {
    return `${encodeURIComponent(snapshot.documentId)}@${snapshot.revision}`;
}
