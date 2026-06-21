import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const EDITABLE_LINK_SELECTOR =
    'a[data-mdx-node-type="link"],a[data-mdx-node-type="wikilink"]';

const activeLinkEditors = new WeakMap<EditorView, LinkHoverEditor>();

export function createEditableLinkPlugin() {
    return new Plugin({
        view(view) {
            const editor = new LinkHoverEditor(view);
            activeLinkEditors.set(view, editor);

            return {
                destroy() {
                    activeLinkEditors.delete(view);
                    editor.destroy();
                },
            };
        },
        props: {
            handleDOMEvents: {
                click: suppressEditableLinkNavigation,
                auxclick: suppressEditableLinkNavigation,
                mouseover: showEditableLinkEditor,
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

function showEditableLinkEditor(view: EditorView, event: MouseEvent) {
    const link = getEditableLinkFromEvent(view, event);
    if (!link) {
        return false;
    }

    activeLinkEditors.get(view)?.show(link);
    return false;
}

function getEditableLinkFromEvent(view: EditorView, event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return null;
    }

    const link = target.closest(EDITABLE_LINK_SELECTOR);
    if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) {
        return null;
    }

    return link;
}

type LinkRange = {
    from: number;
    href: string;
    title: string | null;
    to: number;
};

class LinkHoverEditor {
    private activeRange: LinkRange | null = null;
    private readonly container: HTMLDivElement;
    private readonly input: HTMLInputElement;

    constructor(private readonly view: EditorView) {
        this.container = document.createElement("div");
        this.container.dataset.mdxLinkEditor = "true";
        this.container.hidden = true;

        this.input = document.createElement("input");
        this.input.dataset.mdxLinkEditorInput = "true";
        this.input.type = "text";
        this.input.setAttribute("aria-label", "Link URL");

        this.container.append(this.input);
        document.body.append(this.container);

        this.input.addEventListener("keydown", this.handleInputKeyDown);
        document.addEventListener("mousedown", this.handleDocumentMouseDown, true);
    }

    show(link: HTMLAnchorElement) {
        const range = findLinkRange(this.view, link);
        if (!range) {
            this.hide();
            return;
        }

        this.activeRange = range;
        this.input.value = range.href;
        this.positionNear(link);
        this.container.hidden = false;
    }

    destroy() {
        this.input.removeEventListener("keydown", this.handleInputKeyDown);
        document.removeEventListener(
            "mousedown",
            this.handleDocumentMouseDown,
            true,
        );
        this.container.remove();
    }

    private applyHref() {
        const range = this.activeRange;
        if (!range) {
            return;
        }

        const href = this.input.value.trim();
        const linkType = this.view.state.schema.marks.link;
        let transaction = this.view.state.tr.removeMark(
            range.from,
            range.to,
            linkType,
        );

        if (href) {
            transaction = transaction.addMark(
                range.from,
                range.to,
                linkType.create({
                    href,
                    title: range.title,
                }),
            );
        }

        this.view.dispatch(transaction);
        this.hide();
        this.view.focus();
    }

    private hide() {
        this.activeRange = null;
        this.container.hidden = true;
    }

    private positionNear(link: HTMLAnchorElement) {
        const rect = link.getBoundingClientRect();
        const top = Math.max(8, rect.bottom + 6);
        const left = Math.max(8, rect.left);

        this.container.style.left = `${left}px`;
        this.container.style.top = `${top}px`;
    }

    private readonly handleDocumentMouseDown = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (
            this.container.contains(target) ||
            this.view.dom.contains(target)
        ) {
            return;
        }

        this.hide();
    };

    private readonly handleInputKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault();
            this.applyHref();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            this.hide();
            this.view.focus();
        }
    };
}

function findLinkRange(view: EditorView, link: HTMLAnchorElement): LinkRange | null {
    const domRange = getLinkDomRange(view, link);
    if (!domRange) {
        return null;
    }

    const linkType = view.state.schema.marks.link;
    const href = link.getAttribute("href") ?? "";
    const ranges: LinkRange[] = [];

    view.state.doc.nodesBetween(domRange.from, domRange.to, (node, position) => {
        if (!node.isText) {
            return;
        }

        const mark = node.marks.find(
            (candidate) =>
                candidate.type === linkType && candidate.attrs.href === href,
        );
        if (!mark) {
            return;
        }

        const nodeFrom = position;
        const nodeTo = position + node.nodeSize;
        ranges.push({
            from: nodeFrom,
            href: mark.attrs.href,
            title: mark.attrs.title ?? null,
            to: nodeTo,
        });
    });

    if (ranges.length === 0) {
        return null;
    }

    return ranges.reduce((range, next) => ({
        from: Math.min(range.from, next.from),
        href: next.href,
        title: next.title,
        to: Math.max(range.to, next.to),
    }));
}

function getLinkDomRange(view: EditorView, link: HTMLAnchorElement) {
    try {
        const from = view.posAtDOM(link, 0);
        const to = view.posAtDOM(link, link.childNodes.length);

        if (from >= to) {
            return null;
        }

        return { from, to };
    } catch {
        return null;
    }
}
