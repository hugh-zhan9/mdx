import type {
    EditorChangeEvent,
    EditorDocumentSnapshot,
    EditorReplaceReason,
} from "../../../packages/mdx-editor";

/**
 * The session side of the controlled Markdown editor contract.
 *
 * The Workspace tab and the Document window own canonical Markdown, dirty,
 * drafts, watcher reload decisions, conflicts and the last-clean fingerprint.
 * This module owns only the two things that ownership requires of them: the
 * in-memory revision handed to the editor, and the verdict on whether a change
 * the editor reports may be applied.
 *
 * It reads no files, writes no files, clears no dirty state and deletes no
 * drafts. Everything here is a decision about identity and revision.
 */

/** A content change the session itself authored, not the editor. */
export interface EditorReplaceDeclaration {
    documentId: string;
    /** The exact Markdown the session is about to hold for this document. */
    markdown: string;
    reason: EditorReplaceReason;
}

export interface EditorSessionContent {
    documentId: string;
    markdown: string;
}

export type EditorChangeVerdict =
    | { kind: "accept"; documentId: string; markdown: string }
    | { kind: "reject"; code: EditorChangeRejectionCode; documentId: string };

/**
 * `unknown_document` — the change belongs to a document this session is not
 * tracking any more (a closed tab, or a window that moved on).
 * `stale_revision` — the change was computed against content the session has
 * since replaced from outside the editor.
 * `future_revision` — the change claims a revision the session never issued.
 */
export type EditorChangeRejectionCode =
    | "unknown_document"
    | "stale_revision"
    | "future_revision";

export interface EditorSessionBinding {
    /**
     * The snapshot for a document's current canonical Markdown.
     *
     * Calling this repeatedly with the same content returns the same snapshot,
     * so it is safe to call while rendering. New content advances the revision
     * once, and carries a replace reason only when the session declared one.
     */
    snapshotFor(content: EditorSessionContent): EditorDocumentSnapshot;
    /**
     * Declares that the session is about to hold `markdown` for `documentId`
     * because something other than the editor produced it.
     *
     * The declaration is matched against the Markdown that actually arrives. A
     * replace that never lands, or that lands with different content, expires
     * unused rather than marking an unrelated later change as a replace.
     */
    declareReplace(declaration: EditorReplaceDeclaration): void;
    /** Decides whether a change the editor reported may be applied. */
    acceptChange(event: EditorChangeEvent): EditorChangeVerdict;
    /** Drops documents the session no longer holds. */
    retain(documentIds: readonly string[]): void;
}

interface DocumentEntry {
    snapshot: EditorDocumentSnapshot;
    /**
     * The revision at which content the editor did not author last landed.
     * Changes based on anything older were computed against Markdown the
     * session has replaced, so applying them would resurrect it.
     */
    baselineRevision: number;
}

export function createEditorSessionBinding(): EditorSessionBinding {
    const documents = new Map<string, DocumentEntry>();
    let pendingReplace: EditorReplaceDeclaration | null = null;

    function takeDeclaredReason(
        content: EditorSessionContent,
    ): EditorReplaceReason | null {
        const declaration = pendingReplace;

        if (
            !declaration ||
            declaration.documentId !== content.documentId ||
            declaration.markdown !== content.markdown
        ) {
            return null;
        }

        pendingReplace = null;
        return declaration.reason;
    }

    return {
        snapshotFor(content) {
            const entry = documents.get(content.documentId);

            if (!entry) {
                // First content for this document is always an open, whatever
                // the caller declared: there is no surface to overwrite yet.
                takeDeclaredReason(content);
                const snapshot: EditorDocumentSnapshot = {
                    documentId: content.documentId,
                    revision: 1,
                    markdown: content.markdown,
                    replaceReason: "open",
                };
                documents.set(content.documentId, {
                    snapshot,
                    baselineRevision: 1,
                });
                return snapshot;
            }

            if (entry.snapshot.markdown === content.markdown) {
                return entry.snapshot;
            }

            const reason = takeDeclaredReason(content);
            const revision = entry.snapshot.revision + 1;
            const snapshot: EditorDocumentSnapshot = {
                documentId: content.documentId,
                revision,
                markdown: content.markdown,
                ...(reason === null ? {} : { replaceReason: reason }),
            };
            documents.set(content.documentId, {
                snapshot,
                baselineRevision:
                    reason === null ? entry.baselineRevision : revision,
            });
            return snapshot;
        },

        declareReplace(declaration) {
            pendingReplace = declaration;
        },

        acceptChange(event) {
            const entry = documents.get(event.documentId);

            if (!entry) {
                return {
                    kind: "reject",
                    code: "unknown_document",
                    documentId: event.documentId,
                };
            }

            if (event.baseRevision > entry.snapshot.revision) {
                return {
                    kind: "reject",
                    code: "future_revision",
                    documentId: event.documentId,
                };
            }

            if (event.baseRevision < entry.baselineRevision) {
                return {
                    kind: "reject",
                    code: "stale_revision",
                    documentId: event.documentId,
                };
            }

            return {
                kind: "accept",
                documentId: event.documentId,
                markdown: event.markdown,
            };
        },

        retain(documentIds) {
            const keep = new Set(documentIds);

            for (const documentId of [...documents.keys()]) {
                if (!keep.has(documentId)) {
                    documents.delete(documentId);
                }
            }
        },
    };
}
