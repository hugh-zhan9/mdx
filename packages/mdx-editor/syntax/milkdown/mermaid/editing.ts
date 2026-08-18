import { NodeSelection, Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import { MERMAID_EDITING_MARKER, MERMAID_NODE_NAME } from "./syntax";

/** A diagram block, and where the document holds it. */
export interface MermaidBlockAtSelection {
    pos: number;
    node: ProseMirrorNode;
}

/**
 * The diagram block the selection is inside, or null.
 *
 * Both ways in count: a caret among the fence's own text, and a selection of the
 * whole block, which is what arriving from outside with the keyboard produces.
 */
export function mermaidBlockAtSelection(
    state: EditorState,
): MermaidBlockAtSelection | null {
    const { selection } = state;

    if (
        selection instanceof NodeSelection &&
        selection.node.type.name === MERMAID_NODE_NAME
    ) {
        return { pos: selection.from, node: selection.node };
    }

    const $from = selection.$from;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);

        if (node.type.name === MERMAID_NODE_NAME) {
            return { pos: $from.before(depth), node };
        }
    }

    return null;
}

/**
 * Says which diagram block is being edited, so the stylesheet can bring its
 * source back.
 *
 * A node decoration rather than an attribute written by the NodeView: the mark
 * belongs to the selection, which is state, and this way it is put on and taken
 * off by the same machinery that redraws everything else.
 */
export const mermaidEditingProsePlugin = $prose(
    () =>
        new Plugin({
            props: {
                decorations: (state) => {
                    const found = mermaidBlockAtSelection(state);

                    if (!found) {
                        return null;
                    }

                    return DecorationSet.create(state.doc, [
                        Decoration.node(found.pos, found.pos + found.node.nodeSize, {
                            [MERMAID_EDITING_MARKER]: "",
                        }),
                    ]);
                },
            },
        }),
);
