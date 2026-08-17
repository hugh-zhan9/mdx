import type {
    EditorSourceSelection,
    PinnedEditorCommand,
} from "../../../packages/mdx-editor";
import type { PendingCliEditorCommand } from "../../workspace/lib/types";

/**
 * Turns product requests into pinned editor commands.
 *
 * Everything a command needs is fixed at the moment the request arrives: which
 * document it is for, the revision its offsets were computed against, and the
 * source selection it must land in. Nothing here reads the editor, so a command
 * can never quietly re-aim itself at wherever the caret happens to be by the
 * time an asynchronous step finishes.
 */
export interface EditorCommandPin {
    /** Identity of the document the request was aimed at. */
    documentId: string;
    /** The document revision the pinned offsets belong to. */
    baseRevision: number;
    /** The target document's last known source selection, or null. */
    selection: EditorSourceSelection | null;
}

/**
 * Builds the command for a CLI request.
 *
 * Returns `null` for a request this surface must not act on: one aimed at a
 * different document, or one whose payload is missing the value its kind is
 * defined by. Refusing here keeps a malformed request from being turned into a
 * plausible-looking edit somewhere else in the document.
 */
export function pinnedCommandForCliRequest(
    request: PendingCliEditorCommand,
    pin: EditorCommandPin,
    markdown: string,
): PinnedEditorCommand | null {
    if (request.tabId !== pin.documentId) {
        return null;
    }

    const base = {
        commandId: request.id,
        documentId: pin.documentId,
        baseRevision: pin.baseRevision,
        selection: pin.selection,
    };

    switch (request.kind) {
        case "focus":
            return { ...base, kind: "focus" };

        case "insert": {
            if (request.text === undefined) {
                return null;
            }

            // A document with no known selection takes the insert at its start,
            // which is where an unfocused editor's caret already is. The
            // rendered document is never consulted for a better guess.
            const selection = pin.selection ?? { anchor: 0, head: 0 };
            return {
                ...base,
                selection,
                kind: "replace-selection",
                text: request.text,
            };
        }

        case "scrollToLine": {
            if (request.lineNumber === undefined) {
                return null;
            }

            const range = sourceRangeForMarkdownLine(markdown, request.lineNumber);
            if (!range) {
                return null;
            }

            return { ...base, kind: "reveal-range", range };
        }
    }
}

/**
 * The source span of one Markdown line, as UTF-16 offsets.
 *
 * Line numbers are one-based and count the same line breaks a text editor
 * shows. A CRLF line ending is two characters, and both are excluded from the
 * span so the range never names half a line terminator. Returns `null` for a
 * line the document does not have, rather than clamping onto a line the caller
 * did not ask for.
 */
export function sourceRangeForMarkdownLine(
    markdown: string,
    lineNumber: number,
): EditorSourceSelection | null {
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
        return null;
    }

    let anchor = 0;
    let line = 1;

    while (line < lineNumber) {
        const newlineIndex = markdown.indexOf("\n", anchor);
        if (newlineIndex === -1) {
            return null;
        }
        anchor = newlineIndex + 1;
        line += 1;
    }

    const newlineIndex = markdown.indexOf("\n", anchor);
    const end = newlineIndex === -1 ? markdown.length : newlineIndex;
    const head =
        end > anchor && markdown.charCodeAt(end - 1) === 13 ? end - 1 : end;

    return { anchor, head };
}

/**
 * Moves a pinned insertion point past text that was just inserted there.
 *
 * A batch of images is one user action with one pinned origin: each file lands
 * after the one before it instead of all of them landing on the same offset in
 * reverse. The distance comes from how much the document actually grew, so this
 * never has to know how the editor spells an image in Markdown.
 */
export function advancePinnedSelection(
    selection: EditorSourceSelection,
    insertedLength: number,
): EditorSourceSelection {
    const start = Math.min(selection.anchor, selection.head);
    const next = start + Math.max(0, insertedLength);

    return { anchor: next, head: next };
}
