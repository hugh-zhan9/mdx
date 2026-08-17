import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

/**
 * The source surface's half of find highlighting.
 *
 * Both surfaces have to answer the same find with the same matches, so both
 * have to show them. The mechanism differs because the editors differ —
 * CodeMirror carries decorations in a state field updated by an effect, where
 * ProseMirror carries them in a plugin updated by transaction metadata — but
 * what the user sees is the same, and the two use the same CSS classes so a
 * theme cannot style one and forget the other.
 */

/** A match, in CodeMirror document offsets. */
export interface SourceFindHighlight {
    from: number;
    to: number;
    active: boolean;
}

export const setSourceFindHighlights = StateEffect.define<
    SourceFindHighlight[]
>();

const matchMark = Decoration.mark({ class: "mdx-find-match" });
const activeMatchMark = Decoration.mark({
    class: "mdx-find-match mdx-find-match-active",
});

const findHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(current, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setSourceFindHighlights)) {
                return build(effect.value, transaction.state.doc.length);
            }
        }
        // No new list, but the text moved: mapping keeps each highlight on the
        // characters it described until the next search replaces it.
        return current.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
});

function build(
    highlights: SourceFindHighlight[],
    docLength: number,
): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    for (const highlight of highlights) {
        // Out of range is dropped rather than clamped, for the same reason as in
        // the visual surface: a highlight over text the match never covered
        // misreports where the match is.
        if (highlight.from < 0 || highlight.to > docLength) continue;
        if (highlight.from >= highlight.to) continue;
        ranges.push(
            (highlight.active ? activeMatchMark : matchMark).range(
                highlight.from,
                highlight.to,
            ),
        );
    }
    // Decoration.set sorts for us, which matters because a match list is in
    // document order only as long as the search produced it that way.
    return Decoration.set(ranges, true);
}

export function findHighlightExtension(): Extension {
    return [findHighlightField];
}
