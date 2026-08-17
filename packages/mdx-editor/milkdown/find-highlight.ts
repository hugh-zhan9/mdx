import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Paints every find match, not just the one the caret is on.
 *
 * Find already knew where the matches were — it counted them for the "3 / 17"
 * label and moved the selection to one of them — but the other sixteen were
 * invisible, and the current one was only as visible as a selection in an
 * unfocused editor, which is barely. Counting matches the user cannot see is
 * most of a find feature and none of the point.
 *
 * The matches are decorations rather than marks: they are not part of the
 * document, they must not enter the Markdown, and they must not survive being
 * serialized. A document with highlights and the same document without them
 * differ on screen and nowhere else.
 */

/** A match, in ProseMirror document positions. */
export interface FindHighlightRange {
    from: number;
    to: number;
}

export interface FindHighlightRequest {
    ranges: FindHighlightRange[];
    /** Which range is the current one, or null when none is. */
    activeIndex: number | null;
}

export const findHighlightKey = new PluginKey<DecorationSet>(
    "mdxFindHighlight",
);

export function createFindHighlightPlugin(): Plugin<DecorationSet> {
    return new Plugin<DecorationSet>({
        key: findHighlightKey,
        state: {
            init: () => DecorationSet.empty,
            apply(tr, current) {
                const request = tr.getMeta(findHighlightKey) as
                    | FindHighlightRequest
                    | undefined;
                if (request) {
                    return buildDecorations(tr.doc, request);
                }
                // No new match list, but the document moved. Mapping keeps the
                // existing highlights on the text they described until the next
                // search arrives — without it, one keystroke leaves every
                // highlight a character off.
                return current.map(tr.mapping, tr.doc);
            },
        },
        props: {
            decorations: (state) => findHighlightKey.getState(state),
        },
    });
}

function buildDecorations(
    doc: ProseMirrorNode,
    { ranges, activeIndex }: FindHighlightRequest,
): DecorationSet {
    const decorations: Decoration[] = [];

    ranges.forEach((range, index) => {
        // A range that no longer fits the document is dropped rather than
        // clamped: a highlight over text the match never covered is a lie about
        // where the match is.
        if (range.from < 0 || range.to > doc.content.size) return;
        if (range.from >= range.to) return;

        const active = index === activeIndex;
        decorations.push(
            Decoration.inline(range.from, range.to, {
                class: active
                    ? "mdx-find-match mdx-find-match-active"
                    : "mdx-find-match",
            }),
        );
    });

    return DecorationSet.create(doc, decorations);
}
