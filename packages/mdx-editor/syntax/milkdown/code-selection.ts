import { keymap } from "@milkdown/kit/prose/keymap";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Command, EditorState } from "@milkdown/kit/prose/state";

/** The content of a block of literal code, as document positions. */
export interface CodeContentRange {
    from: number;
    to: number;
}

/**
 * The innermost block of literal code the selection starts in, or null.
 *
 * Judged on the schema's own `code` flag rather than a list of node names, so a
 * fenced block, a diagram's fence, a formula's source and a fence the parser
 * could not close all answer for themselves — and anything added later does too,
 * without this having to hear about it.
 */
export function codeContentAroundSelection(
    state: EditorState,
): CodeContentRange | null {
    const $from = state.selection.$from;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.spec.code) {
            return { from: $from.start(depth), to: $from.end(depth) };
        }
    }

    return null;
}

/**
 * Selects the code the caret is in, rather than the whole document.
 *
 * Inside a code block "everything" means the code: that is the thing being
 * worked on, and reaching for the whole note from in there is almost never what
 * was meant. Pressing again does reach the note, because a selection that already
 * covers the block declines the key and lets the default answer it — the
 * escalation costs no state of its own.
 */
export const selectInsideCode: Command = (state, dispatch) => {
    const range = codeContentAroundSelection(state);

    if (!range) {
        return false;
    }

    const { from, to } = state.selection;

    if (from <= range.from && to >= range.to) {
        return false;
    }

    dispatch?.(
        state.tr.setSelection(
            TextSelection.create(state.doc, range.from, range.to),
        ),
    );

    return true;
};

/**
 * Must be composed before the presets: their keymap answers `Mod-a` with the
 * whole document, and the first handler to return true is the one that decides.
 */
export const codeSelectionProsePlugin = $prose(() =>
    keymap({ "Mod-a": selectInsideCode }),
);
