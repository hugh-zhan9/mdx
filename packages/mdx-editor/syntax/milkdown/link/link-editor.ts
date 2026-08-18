import { Plugin } from "@milkdown/kit/prose/state";
import { $ctx, $prose } from "@milkdown/kit/utils";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Mark, MarkType } from "@milkdown/kit/prose/model";

import { linkClickCtx } from "./activation";

/** The style hooks the product's stylesheet paints this through. */
const LINK_EDITOR_ATTR = "data-mdx-link-editor";
const LINK_ADDRESS_ATTR = "data-mdx-link-editor-address";
const LINK_OPEN_ATTR = "data-mdx-link-editor-open";
const LINK_REMOVE_ATTR = "data-mdx-link-editor-remove";

/** How far below the link's own line the editor sits, in pixels. */
const LINK_EDITOR_OFFSET = 6;

/** How close to the viewport's left edge the editor may be placed. */
const LINK_EDITOR_MARGIN = 8;

/** What this editor's parts are called, in the product's language. */
export interface LinkEditorLabels {
    /** The accessible name for the address field. */
    address: string;
    /** Opens the link, wherever the product opens links. */
    open: string;
    /** Takes the link off its label, leaving the words behind. */
    remove: string;
}

/**
 * The names, or null while nobody has supplied any.
 *
 * This package holds no human-language text of its own, so everything this
 * editor puts into words comes from whoever mounted it. Null means the actions
 * are not offered at all rather than offered under a name in a language the
 * product does not speak: a button nobody can read is not a button.
 */
export const linkEditorLabelsCtx = $ctx<
    LinkEditorLabels | null,
    "mdxLinkEditorLabels"
>(null, "mdxLinkEditorLabels");

export function linkEditorLabelsPlugin(
    labels: LinkEditorLabels,
): MilkdownPlugin {
    return (ctx: Ctx) => () => {
        ctx.set(linkEditorLabelsCtx.key, labels);
    };
}

/** A link the caret is sitting in, as document positions. */
export interface LinkAtCaret {
    from: number;
    to: number;
    mark: Mark;
}

/**
 * The link the caret is inside, or null.
 *
 * Only a caret — a collapsed selection — counts. A selection dragged across a
 * link is on its way somewhere else, and answering it would put an address field
 * under text the user is in the middle of choosing.
 *
 * The range is grown across every neighbouring piece carrying the same mark,
 * because a link whose label holds emphasis or an image is several text nodes
 * and its address belongs to all of them at once.
 */
export function linkAtCaret(state: EditorState): LinkAtCaret | null {
    const type: MarkType | undefined = state.schema.marks.link;

    if (!type || !state.selection.empty) {
        return null;
    }

    const $pos = state.selection.$from;
    const parent = $pos.parent;
    const start = parent.childAfter($pos.parentOffset);

    if (!start.node) {
        return null;
    }

    const mark = type.isInSet(start.node.marks);

    if (!mark) {
        return null;
    }

    let startIndex = start.index;
    let from = $pos.start() + start.offset;
    let endIndex = startIndex + 1;
    let to = from + start.node.nodeSize;

    while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
        startIndex -= 1;
        from -= parent.child(startIndex).nodeSize;
    }

    while (
        endIndex < parent.childCount &&
        mark.isInSet(parent.child(endIndex).marks)
    ) {
        to += parent.child(endIndex).nodeSize;
        endIndex += 1;
    }

    return { from, to, mark };
}

/**
 * The address field that appears while the caret is inside a link.
 *
 * A rendered link shows its label and hides its address, so in the visual
 * surface the half of `[label](address)` that Markdown spells second has nowhere
 * to be edited at all. This is that place. The label needs nothing: it is text
 * in the document, and typing in it already works.
 *
 * It never takes focus when it appears — the caret that opened it is usually
 * there to edit the label, and stealing focus would make that impossible.
 *
 * Beside the address sit the two acts that are not edits to it: opening the
 * link, and taking the link off the words it was wrapped around.
 */
class LinkEditorView {
    private readonly element: HTMLElement;
    private readonly input: HTMLInputElement;
    private link: LinkAtCaret | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly ctx: Ctx,
    ) {
        this.element = document.createElement("div");
        this.element.setAttribute(LINK_EDITOR_ATTR, "");
        this.element.hidden = true;

        this.input = document.createElement("input");
        this.input.type = "text";
        this.input.spellcheck = false;
        this.input.autocapitalize = "off";
        this.input.setAttribute(LINK_ADDRESS_ATTR, "");

        const labels = this.ctx.get(linkEditorLabelsCtx.key);

        if (labels) {
            this.input.setAttribute("aria-label", labels.address);
        }

        this.input.addEventListener("keydown", this.onKeyDown);
        this.input.addEventListener("blur", this.onBlur);
        this.element.append(this.input);

        if (labels) {
            this.element.append(
                this.action(LINK_OPEN_ATTR, labels.open, this.open),
                this.action(LINK_REMOVE_ATTR, labels.remove, this.remove),
            );
        }

        document.body.append(this.element);

        // Capture, so a scroll in any container the editor sits in is seen: the
        // caret has not moved, so nothing else would tell us the link did.
        window.addEventListener("scroll", this.place, true);
        window.addEventListener("resize", this.place);

        this.update();
    }

    update() {
        const link = this.view.editable ? linkAtCaret(this.view.state) : null;

        if (!link) {
            this.close();
            return;
        }

        const href = String(link.mark.attrs.href ?? "");
        const sameLink =
            this.link !== null &&
            this.link.from === link.from &&
            this.link.to === link.to;

        this.link = link;

        // Only while the field is not being typed in: the document changes on
        // every keystroke in the label, and rewriting the value under the user's
        // cursor would undo what they are typing.
        if (!sameLink || document.activeElement !== this.input) {
            this.input.value = href;
        }

        this.element.hidden = false;
        this.place();
    }

    destroy() {
        window.removeEventListener("scroll", this.place, true);
        window.removeEventListener("resize", this.place);
        this.input.removeEventListener("keydown", this.onKeyDown);
        this.input.removeEventListener("blur", this.onBlur);
        this.element.remove();
    }

    /** Puts the field under the link's first line, inside the viewport. */
    private place = () => {
        if (this.link === null || this.element.hidden) {
            return;
        }

        const coords = this.view.coordsAtPos(this.link.from);
        const room = window.innerWidth - this.element.offsetWidth - LINK_EDITOR_MARGIN;

        this.element.style.left = `${Math.round(Math.max(LINK_EDITOR_MARGIN, Math.min(coords.left, room)))}px`;
        this.element.style.top = `${Math.round(coords.bottom + LINK_EDITOR_OFFSET)}px`;
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault();
            this.apply();
            this.returnFocus();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            // The address as the document has it, so what is on screen is the
            // truth again and the blur that follows has nothing to write.
            this.input.value = String(this.link?.mark.attrs.href ?? "");
            this.returnFocus();
        }
    };

    /**
     * Clicking away keeps what was typed.
     *
     * Discarding it would be the surprising half of the two: the address is a
     * value someone came here to change, and the caret leaving is not a decision
     * to abandon it. Escape is how it is abandoned, and it puts the document's
     * own address back before focus leaves, so this has nothing left to write.
     */
    private onBlur = () => {
        this.apply();
    };

    /**
     * Writes the typed address onto the link.
     *
     * An empty address is refused rather than applied: a link with no target is
     * not a link, and removing one is a different act than editing its address.
     * The title keeps its value, because `[label](address "title")` says two
     * things and only one of them was being edited.
     */
    private apply() {
        const link = this.link;

        if (link === null) {
            return;
        }

        const href = this.input.value.trim();
        const type = this.view.state.schema.marks.link;

        if (href.length === 0 || !type || href === link.mark.attrs.href) {
            return;
        }

        const tr = this.view.state.tr;
        tr.removeMark(link.from, link.to, type);
        tr.addMark(
            link.from,
            link.to,
            type.create({ ...link.mark.attrs, href }),
        );
        this.view.dispatch(tr);
    }

    /**
     * A button that acts on the link without moving the caret off it.
     *
     * The pointer press is refused rather than the click: a press that moved
     * focus would take the caret out of the document, and the caret is what says
     * which link this is about. The click still arrives.
     */
    private action(attribute: string, label: string, run: () => void) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute(attribute, "");
        button.textContent = label;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", run);

        return button;
    }

    /**
     * Opens the link, after writing whatever is in the field onto it.
     *
     * In that order, because the field is what the user is looking at: opening
     * the address it replaced would open a page they can see they are not asking
     * for. Where a link opens is the product's business — this only reports it.
     */
    private open = () => {
        this.apply();

        const href = String(this.link?.mark.attrs.href ?? "");

        if (href.length === 0) {
            return;
        }

        this.ctx.get(linkClickCtx.key)({ href });
    };

    /**
     * Takes the link off its label, leaving the words in the document.
     *
     * Deleting the text as well would be the other, larger act, and the words
     * are usually the part worth keeping — which is also why this is a button of
     * its own rather than what an emptied address means.
     */
    private remove = () => {
        const link = this.link;
        const type = this.view.state.schema.marks.link;

        if (link === null || !type) {
            return;
        }

        this.view.dispatch(
            this.view.state.tr.removeMark(link.from, link.to, type),
        );
        this.returnFocus();
    };

    private returnFocus() {
        this.view.focus();
    }

    /**
     * Takes the field away, and with it the link it was editing.
     *
     * Clearing the link is what makes a blur arriving after this — a focused
     * field inside an element that just became hidden — write nothing.
     */
    private close() {
        this.element.hidden = true;
        this.link = null;
    }
}

export const linkEditorProsePlugin = $prose(
    (ctx: Ctx) =>
        new Plugin({
            view: (view) => new LinkEditorView(view, ctx),
        }),
);
