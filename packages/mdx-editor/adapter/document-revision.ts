import type {
    EditorCommandResult,
    EditorDocumentSnapshot,
    EditorReplaceReason,
    PinnedEditorCommand,
} from "./types";

/**
 * What the adapter should do with an incoming document snapshot.
 *
 * The session owns canonical Markdown, so every snapshot is either the session
 * confirming a change the adapter emitted, an explicit external replace, a
 * no-op, or something stale that must not touch the surface.
 */
export type SnapshotDisposition =
    | { kind: "initialize" }
    | { kind: "confirm"; revision: number }
    | { kind: "replace"; reason: EditorReplaceReason }
    | { kind: "idempotent" }
    | { kind: "reject"; code: SnapshotRejectionCode };

export type SnapshotRejectionCode =
    | "stale_document"
    | "stale_revision"
    | "unconfirmed_content";

/**
 * How many recently emitted Markdown values are retained for confirm matching.
 *
 * The session confirms edits one revision at a time while the user keeps
 * typing, so a confirm routinely arrives several edits behind the surface. Each
 * retained entry lets one more in-flight edit be recognised as a confirmation
 * rather than mistaken for foreign content.
 */
const EMITTED_HISTORY_LIMIT = 64;

/** Bounds the at-most-once command ledger for long-lived documents. */
const CONSUMED_COMMAND_LIMIT = 512;

export interface DocumentRevisionState {
    readonly documentId: string | null;
    readonly revision: number;
    readonly markdown: string;
    /**
     * The Markdown `revision` carries.
     *
     * It is the text a pinned command's offsets were computed against, which is
     * not the text the surface holds whenever local edits are still
     * unconfirmed. Executing such a command means carrying its offsets from one
     * to the other.
     */
    readonly revisionMarkdown: string;
    /** True when the surface holds edits the session has not confirmed yet. */
    readonly hasUnconfirmedEdits: boolean;
}

/**
 * Tracks which document and revision the surface currently holds, and decides
 * whether incoming snapshots and pinned commands may touch it.
 *
 * The guard is deliberately pure: it makes decisions but never mutates an
 * editor, reads a file, or clears dirty state.
 */
export interface DocumentRevisionGuard {
    state(): DocumentRevisionState;
    /** Decides what an incoming snapshot means without applying it. */
    evaluateSnapshot(snapshot: EditorDocumentSnapshot): SnapshotDisposition;
    /** Records that a snapshot disposition was applied to the surface. */
    commitSnapshot(snapshot: EditorDocumentSnapshot): void;
    /** Records that the session confirmed an earlier emission at `revision`. */
    commitConfirmation(snapshot: EditorDocumentSnapshot): void;
    /** Records Markdown the surface produced locally, keeping baseRevision. */
    recordLocalMarkdown(markdown: string): void;
    /** Decides whether a pinned command may run against the current surface. */
    evaluateCommand(command: PinnedEditorCommand): EditorCommandResult;
    /** Marks a commandId as consumed so it can never apply twice. */
    consumeCommand(commandId: string): boolean;
}

export function createDocumentRevisionGuard(): DocumentRevisionGuard {
    let documentId: string | null = null;
    let revision = 0;
    let markdown = "";
    /** The Markdown `revision` carries; `markdown` less every unconfirmed edit. */
    let revisionMarkdown = "";
    /** Markdown values the adapter emitted that the session has not confirmed. */
    let emitted: string[] = [];
    let consumedCommandIds: string[] = [];
    const consumedCommandSet = new Set<string>();

    function resetDocumentState(): void {
        emitted = [];
        consumedCommandIds = [];
        consumedCommandSet.clear();
    }

    function evaluateSnapshot(
        snapshot: EditorDocumentSnapshot,
    ): SnapshotDisposition {
        if (documentId === null) {
            return { kind: "initialize" };
        }

        if (snapshot.documentId !== documentId) {
            // A different document is always an explicit replace, never a stale
            // callback: the caller is switching what the surface shows.
            return { kind: "replace", reason: snapshot.replaceReason ?? "open" };
        }

        if (snapshot.revision < revision) {
            return { kind: "reject", code: "stale_revision" };
        }

        if (snapshot.replaceReason) {
            return { kind: "replace", reason: snapshot.replaceReason };
        }

        if (snapshot.revision === revision) {
            return snapshot.markdown === markdown
                ? { kind: "idempotent" }
                : { kind: "reject", code: "stale_revision" };
        }

        // A newer revision carrying Markdown the surface currently holds, or
        // Markdown it emitted while the session was catching up, is the session
        // confirming the adapter's own work. Confirming must never rewrite the
        // surface: doing so would discard every keystroke made since.
        if (snapshot.markdown === markdown || emitted.includes(snapshot.markdown)) {
            return { kind: "confirm", revision: snapshot.revision };
        }

        // Newer revision, content the adapter never produced, and no declared
        // replace reason. The caller has not said this may overwrite the
        // surface, so it must not.
        return { kind: "reject", code: "unconfirmed_content" };
    }

    function commitSnapshot(snapshot: EditorDocumentSnapshot): void {
        if (snapshot.documentId !== documentId) {
            resetDocumentState();
        } else {
            emitted = [];
        }
        documentId = snapshot.documentId;
        revision = snapshot.revision;
        markdown = snapshot.markdown;
        revisionMarkdown = snapshot.markdown;
    }

    function commitConfirmation(snapshot: EditorDocumentSnapshot): void {
        revision = snapshot.revision;
        revisionMarkdown = snapshot.markdown;
        // Drop everything the session has now caught up to, keeping the edits
        // that are still in flight ahead of it.
        const index = emitted.indexOf(snapshot.markdown);
        if (index >= 0) emitted = emitted.slice(index + 1);
    }

    function evaluateCommand(command: PinnedEditorCommand): EditorCommandResult {
        if (documentId === null || command.documentId !== documentId) {
            return { ok: false, code: "stale_document" };
        }
        if (command.baseRevision !== revision) {
            return { ok: false, code: "stale_revision" };
        }
        if (consumedCommandSet.has(command.commandId)) {
            return { ok: false, code: "stale_revision" };
        }
        // Whether the command's offsets still name what they named is not a
        // question about revisions: local edits keep the revision they were
        // made against, so the guard cannot see them move the text. The surface
        // that applied those edits carries the offsets across them, and refuses
        // the command when it cannot. Everything an external replace, a restore,
        // a conflict resolution or a tab change makes untrustworthy is already
        // refused above, because each of those changes the document identity or
        // the revision the command is pinned to.
        return { ok: true };
    }

    return {
        state() {
            return {
                documentId,
                revision,
                markdown,
                revisionMarkdown,
                hasUnconfirmedEdits: emitted.length > 0,
            };
        },
        evaluateSnapshot,
        commitSnapshot,
        commitConfirmation,
        recordLocalMarkdown(next) {
            markdown = next;
            emitted.push(next);
            if (emitted.length > EMITTED_HISTORY_LIMIT) {
                emitted = emitted.slice(-EMITTED_HISTORY_LIMIT);
            }
        },
        evaluateCommand,
        consumeCommand(commandId) {
            if (consumedCommandSet.has(commandId)) return false;
            consumedCommandSet.add(commandId);
            consumedCommandIds.push(commandId);
            if (consumedCommandIds.length > CONSUMED_COMMAND_LIMIT) {
                const evicted = consumedCommandIds.shift();
                if (evicted !== undefined) consumedCommandSet.delete(evicted);
            }
            return true;
        },
    };
}
