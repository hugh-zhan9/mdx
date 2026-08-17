import type { Node as ProseMirrorNode } from "prosemirror-model";

import { findTextMatches } from "./find-matches";
import type { SourceOffsetMap } from "./source-offsets";
import type { DocumentSelectionRange, EditorFindRequest } from "./types";

/**
 * A run of document text that came from one uninterrupted stretch of inline
 * content, with the position its first character occupies.
 *
 * Segments end at every inline node that is not text — an image, a wikilink, a
 * formula, a preserved source slice — and at every block boundary, because the
 * characters on either side of one are not adjacent in the document the user is
 * reading. Concatenating across them would let a search match text that is not
 * written anywhere.
 */
interface SemanticSegment {
    pmFrom: number;
    text: string;
}

/**
 * The document's semantic text, as segments.
 *
 * This is a walk of the document, not of the DOM. NodeView chrome — a Mermaid
 * diagram, KaTeX output, a button — is not document content and never appears
 * here, so it cannot be matched or counted a second time. The text that *is*
 * content, such as the source inside a Mermaid or math fence, appears exactly
 * once, at the position the document holds it.
 *
 * What a node keeps in an attribute is not text and is therefore not here: a
 * link's destination, an image's alt and src, an inline formula's LaTeX, a
 * callout's marker, a preserved inline slice's bytes. None of them has a text
 * position, so a match inside one could not be revealed — and a match the user
 * cannot navigate to is worse than no match.
 */
export function collectSemanticSegments(
    doc: ProseMirrorNode,
): SemanticSegment[] {
    const segments: SemanticSegment[] = [];
    let open: SemanticSegment | null = null;
    doc.descendants((node, pos) => {
        if (!node.isText) {
            // Any node that is not text breaks the run, whether it is a block
            // that starts a new one or an inline atom sitting between two.
            open = null;
            return true;
        }
        const text = node.text ?? "";
        if (text.length === 0) return false;
        if (open && open.pmFrom + open.text.length === pos) {
            open.text += text;
            return false;
        }
        open = { pmFrom: pos, text };
        segments.push(open);
        return false;
    });
    return segments;
}

export interface SemanticFindResult {
    /** Matches in document order, as offsets into the map's Markdown. */
    ranges: DocumentSelectionRange[];
    /** True when at least one match had no faithful source range. */
    unplaced: boolean;
}

/**
 * Every match for `request` in the document's semantic text.
 *
 * One implementation, used by whichever surface is mounted, because the two
 * must answer the same question: a query that meant one thing in WYSIWYG and
 * another in source would be a different feature depending on which view
 * happened to be open. The search is over the text the document holds, never
 * over the Markdown that spells it — the delimiters around `**bold**` are not
 * text the reader is looking at, and neither is a link's destination.
 *
 * A match the map cannot place is dropped and reported, never returned at a
 * guessed offset: a caller that jumps or replaces at a returned range has to be
 * able to trust it.
 */
export function findSemanticMatches(
    doc: ProseMirrorNode,
    map: SourceOffsetMap,
    request: EditorFindRequest,
): SemanticFindResult {
    const segments = collectSemanticSegments(doc);
    if (segments.length === 0) return { ranges: [], unplaced: false };

    // One search over every segment joined by a line break, with any match that
    // crosses a join thrown away. The join is a boundary the document really
    // has, so it also makes both sides of it a word boundary, exactly as the
    // Markdown between two blocks would.
    let joined = "";
    const spans: Array<{ start: number; end: number; pmFrom: number }> = [];
    for (const segment of segments) {
        if (joined.length > 0) joined += "\n";
        spans.push({
            start: joined.length,
            end: joined.length + segment.text.length,
            pmFrom: segment.pmFrom,
        });
        joined += segment.text;
    }

    const ranges: DocumentSelectionRange[] = [];
    let unplaced = false;
    let spanIndex = 0;
    for (const match of findTextMatches(joined, request)) {
        while (spanIndex < spans.length && spans[spanIndex].end < match.to) {
            spanIndex += 1;
        }
        const span = spans[spanIndex];
        if (!span || match.from < span.start) continue;
        const resolved = map.sourceRangeForSelection(
            span.pmFrom + (match.from - span.start),
            span.pmFrom + (match.to - span.start),
        );
        if (!resolved) {
            unplaced = true;
            continue;
        }
        ranges.push(resolved);
    }
    return { ranges, unplaced };
}
