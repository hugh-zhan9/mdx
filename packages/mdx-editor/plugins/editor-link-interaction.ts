import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const EDITABLE_LINK_SELECTOR =
    'a[data-mdx-node-type="link"],a[data-mdx-node-type="wikilink"]';

export function createEditableLinkPlugin() {
    return new Plugin({
        props: {
            handleDOMEvents: {
                click: handleEditableLinkClick,
                auxclick: handleEditableLinkClick,
            },
        },
    });
}

function handleEditableLinkClick(view: EditorView, event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return false;
    }

    const link = target.closest(EDITABLE_LINK_SELECTOR);
    if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) {
        return false;
    }

    event.preventDefault();

    if (shouldOpenLink(event)) {
        const targetHref = normalizeLinkHref(link.getAttribute("href") ?? "");
        if (targetHref) {
            window.open(targetHref, "_blank", "noopener");
            return true;
        }
    }

    return false;
}

function shouldOpenLink(event: MouseEvent) {
    return event.metaKey || event.ctrlKey || event.button === 1;
}

function normalizeLinkHref(href: string) {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("mdx-wikilink:")) {
        return null;
    }

    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(trimmed)) {
        return trimmed;
    }

    return `https://${trimmed}`;
}
