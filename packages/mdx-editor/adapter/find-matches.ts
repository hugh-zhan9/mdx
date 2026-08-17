import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

import type { EditorFindRequest } from "./types";

/** A match as half-open offsets into whatever text was searched. */
export interface TextMatchRange {
    from: number;
    to: number;
}

/**
 * Finds every occurrence of `request.query` in `text`.
 *
 * Both surfaces search through this one function so a query can never mean two
 * different things depending on which view happens to be mounted: case folding,
 * Unicode normalization and word-boundary classification all come from the same
 * implementation. `@codemirror/search` owns those rules — the source surface is
 * a CodeMirror document and would use them anyway — so the visual surface
 * borrows them rather than growing a second matcher that could disagree.
 *
 * `text` is plain text, not a document: the visual surface passes the semantic
 * text it walked out of the document, and the source surface passes the
 * Markdown it holds. The returned offsets are indexes into `text`, and the
 * caller maps them into the coordinate space it owns.
 *
 * Matches never overlap: after one is found the scan resumes past its end,
 * which is what keeps `aa` matching twice in `aaaa` rather than three times.
 */
export function findTextMatches(
    text: string,
    request: EditorFindRequest,
): TextMatchRange[] {
    const query = new SearchQuery({
        search: request.query,
        caseSensitive: request.caseSensitive,
        wholeWord: request.wholeWord,
        // The query is a literal string from the product, so `\n` in it is a
        // backslash followed by an `n`, not a line break.
        literal: true,
    });
    // An empty query matches nothing rather than every position.
    if (!query.valid) return [];

    const found: TextMatchRange[] = [];
    // A state built from the text alone, rather than a live editor state, so
    // both surfaces classify word characters identically.
    const cursor = query.getCursor(EditorState.create({ doc: text }));
    for (let step = cursor.next(); step.done !== true; step = cursor.next()) {
        found.push({ from: step.value.from, to: step.value.to });
    }
    return found;
}
