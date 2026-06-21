import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import {
    Decoration,
    DecorationSet,
    type EditorView,
} from "prosemirror-view";

const EDITABLE_LINK_SELECTOR =
    'a[data-mdx-node-type="link"],a[data-mdx-node-type="wikilink"]';
const LINK_MARKDOWN_EDITOR_SELECTOR = "[data-mdx-link-markdown-editor]";

type ActiveLink = {
    from: number;
    href: string;
    title: string | null;
    to: number;
};

const editableLinkPluginKey = new PluginKey<ActiveLink | null>(
    "editableLink",
);

export function createEditableLinkPlugin() {
    return new Plugin({
        key: editableLinkPluginKey,
        state: {
            init(_, state) {
                return findActiveLink(state);
            },
            apply(transaction, previous, _oldState, newState) {
                if (
                    !transaction.docChanged &&
                    !transaction.selectionSet &&
                    transaction.getMeta(editableLinkPluginKey) === undefined
                ) {
                    return previous;
                }

                return findActiveLink(newState);
            },
        },
        props: {
            decorations(state) {
                const activeLink = editableLinkPluginKey.getState(state);
                if (!activeLink) {
                    return DecorationSet.empty;
                }

                return DecorationSet.create(state.doc, [
                    Decoration.widget(
                        activeLink.from,
                        () => createMarkdownToken("["),
                        {
                            key: `link-open-${activeLink.from}-${activeLink.to}`,
                            side: -1,
                        },
                    ),
                    Decoration.widget(
                        activeLink.to,
                        (view) => createHrefEditor(view, activeLink),
                        {
                            key: `link-href-${activeLink.from}-${activeLink.to}-${activeLink.href}`,
                            side: 1,
                            stopEvent: (event) =>
                                event.target instanceof Element &&
                                Boolean(
                                    event.target.closest(
                                        LINK_MARKDOWN_EDITOR_SELECTOR,
                                    ),
                                ),
                        },
                    ),
                ]);
            },
            handleDOMEvents: {
                click: handleEditableLinkClick,
                auxclick: handleEditableLinkClick,
                mousedown: handleMarkdownHrefEditorEvent,
                keydown: handleMarkdownHrefEditorEvent,
                beforeinput: handleMarkdownHrefEditorEvent,
                input: handleMarkdownHrefEditorEvent,
            },
        },
    });
}

function createMarkdownToken(text: string) {
    const token = document.createElement("span");
    token.dataset.mdxLinkMarkdownToken = "true";
    token.contentEditable = "false";
    token.textContent = text;
    return token;
}

function createHrefEditor(view: EditorView, activeLink: ActiveLink) {
    const wrapper = document.createElement("span");
    wrapper.dataset.mdxLinkMarkdownEditor = "true";
    wrapper.contentEditable = "false";

    const closeLabel = document.createElement("span");
    closeLabel.dataset.mdxLinkMarkdownToken = "true";
    closeLabel.contentEditable = "false";
    closeLabel.textContent = "](";

    const input = document.createElement("input");
    input.dataset.mdxLinkHrefInput = "true";
    input.type = "text";
    input.contentEditable = "true";
    input.value = activeLink.href;
    input.setAttribute("aria-label", "Link URL");
    sizeHrefInput(input);

    const closeHref = document.createElement("span");
    closeHref.dataset.mdxLinkMarkdownToken = "true";
    closeHref.contentEditable = "false";
    closeHref.textContent = ")";

    input.addEventListener("mousedown", (event) => {
        event.stopPropagation();
    });
    input.addEventListener("click", (event) => {
        event.stopPropagation();
    });
    input.addEventListener("input", () => {
        sizeHrefInput(input);
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commitLinkHref(view, activeLink, input.value);
            view.focus();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            input.value = activeLink.href;
            view.focus();
        }
    });
    input.addEventListener("blur", () => {
        if (input.value !== activeLink.href) {
            commitLinkHref(view, activeLink, input.value);
        }
    });

    wrapper.append(closeLabel, input, closeHref);
    return wrapper;
}

function handleMarkdownHrefEditorEvent(_view: EditorView, event: Event) {
    return (
        event.target instanceof Element &&
        Boolean(event.target.closest(LINK_MARKDOWN_EDITOR_SELECTOR))
    );
}

function sizeHrefInput(input: HTMLInputElement) {
    input.style.width = `${Math.min(Math.max(input.value.length + 1, 8), 64)}ch`;
}

function commitLinkHref(view: EditorView, activeLink: ActiveLink, nextHref: string) {
    const href = nextHref.trim();
    const linkType = view.state.schema.marks.link;
    let transaction = view.state.tr.removeMark(
        activeLink.from,
        activeLink.to,
        linkType,
    );

    if (href) {
        transaction = transaction.addMark(
            activeLink.from,
            activeLink.to,
            linkType.create({
                href,
                title: activeLink.title,
            }),
        );
    }

    view.dispatch(transaction);
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

function findActiveLink(state: EditorState): ActiveLink | null {
    const { empty, from, to } = state.selection;
    if (!empty) {
        return null;
    }

    const linkType = state.schema.marks.link;
    const $from = state.doc.resolve(from);
    const parent = $from.parent;
    const parentStart = from - $from.parentOffset;
    const linkMark =
        $from.marks().find((mark) => mark.type === linkType) ??
        ($from.parentOffset > 0
            ? parent.childAfter($from.parentOffset - 1).node?.marks.find(
                  (mark) => mark.type === linkType,
              )
            : undefined);

    if (!linkMark) {
        return null;
    }

    let rangeFrom = from;
    let rangeTo = to;
    let offset = 0;

    parent.forEach((node, nodeOffset) => {
        if (!node.isText) {
            return;
        }

        if (!node.marks.some((mark) => mark.eq(linkMark))) {
            return;
        }

        const nodeFrom = parentStart + nodeOffset;
        const nodeTo = nodeFrom + node.nodeSize;
        if (from < nodeFrom || from > nodeTo) {
            return;
        }

        rangeFrom = nodeFrom;
        rangeTo = nodeTo;
        offset = nodeOffset;
    });

    while (offset > 0) {
        const previous = parent.childBefore(offset);
        if (
            !previous.node?.isText ||
            !previous.node.marks.some((mark) => mark.eq(linkMark))
        ) {
            break;
        }

        offset = previous.offset;
        rangeFrom = parentStart + previous.offset;
    }

    offset = rangeTo - parentStart;
    while (offset < parent.content.size) {
        const next = parent.childAfter(offset);
        if (
            !next.node?.isText ||
            !next.node.marks.some((mark) => mark.eq(linkMark))
        ) {
            break;
        }

        rangeTo = parentStart + next.offset + next.node.nodeSize;
        offset = next.offset + next.node.nodeSize;
    }

    const href = String(linkMark.attrs.href ?? "");
    if (href.startsWith("mdx-wikilink:")) {
        return null;
    }

    return {
        from: rangeFrom,
        href,
        title: linkMark.attrs.title ?? null,
        to: rangeTo,
    };
}
