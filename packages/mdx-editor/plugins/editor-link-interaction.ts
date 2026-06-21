import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const EDITABLE_LINK_SELECTOR =
    'a[data-mdx-node-type="link"],a[data-mdx-node-type="wikilink"]';

export function createEditableLinkPlugin() {
    return new Plugin({
        props: {
            handleDOMEvents: {
                click: suppressEditableLinkNavigation,
                auxclick: suppressEditableLinkNavigation,
            },
        },
    });
}

function suppressEditableLinkNavigation(view: EditorView, event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return false;
    }

    const link = target.closest(EDITABLE_LINK_SELECTOR);
    if (!link || !view.dom.contains(link)) {
        return false;
    }

    event.preventDefault();
    return false;
}
