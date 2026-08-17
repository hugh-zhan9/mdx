import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
    ViewMutationRecord,
} from "prosemirror-view";

import { paintWhenVisible } from "../paint-when-visible";
import { renderMath } from "./render";
import { MATH_BLOCK_NODE_NAME, MATH_INLINE_NODE_NAME } from "./syntax";

/**
 * Fills `preview` with a rendering of `latex`, or with the source and the
 * reason it could not be rendered.
 *
 * The preview lives outside the node's content on purpose: it is chrome, it is
 * never serialized, and it never becomes part of the node's text.
 */
function paintPreview(
    preview: HTMLElement,
    latex: string,
    displayMode: boolean,
): void {
    const { html, error } = renderMath(latex, displayMode);
    preview.replaceChildren();
    preview.toggleAttribute("data-mdx-math-invalid", error !== "");
    if (!error) {
        preview.innerHTML = html;
        return;
    }
    const fallback = document.createElement("code");
    fallback.className = "mdx-math-source-fallback";
    fallback.textContent = latex;
    const message = document.createElement("span");
    message.className = "mdx-math-error";
    message.textContent = error;
    preview.append(fallback, message);
}

/**
 * Editing surface for an inline formula.
 *
 * The LaTeX is an attribute rather than document text, so it is edited through
 * an input that writes back with `setNodeMarkup`. The input is only mounted
 * while editing so a paragraph of formulas reads as formulas.
 */
class MathInlineNodeView implements NodeView {
    readonly dom: HTMLElement;

    private node: ProseMirrorNode;
    private readonly view: EditorView;
    private readonly getPos: () => number | undefined;
    private readonly preview: HTMLElement;
    private readonly source: HTMLInputElement;
    private editing = false;
    /** Whether KaTeX has drawn this formula yet. */
    private painted = false;
    private stopWaiting: (() => void) | null = null;

    constructor(
        node: ProseMirrorNode,
        view: EditorView,
        getPos: () => number | undefined,
    ) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;

        this.dom = document.createElement("span");
        this.dom.className = "mdx-math mdx-math-inline";
        this.dom.setAttribute("data-mdx-node-type", MATH_INLINE_NODE_NAME);
        this.dom.contentEditable = "false";

        this.preview = document.createElement("span");
        this.preview.className = "mdx-math-preview";
        this.preview.addEventListener("click", this.onPreviewClick);

        this.source = document.createElement("input");
        this.source.className = "mdx-math-source";
        this.source.type = "text";
        this.source.setAttribute("aria-label", "Inline math source");
        this.source.addEventListener("input", this.onSourceInput);
        this.source.addEventListener("blur", this.onSourceBlur);

        this.dom.append(this.preview);
        this.render();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    stopEvent(event: Event): boolean {
        const target = event.target;
        return target instanceof Node && this.dom.contains(target);
    }

    // Every child is painted from the node's attributes, so no mutation inside
    // this view is ever a document edit.
    ignoreMutation(): boolean {
        return true;
    }

    destroy(): void {
        this.stopWaiting?.();
        this.preview.removeEventListener("click", this.onPreviewClick);
        this.source.removeEventListener("input", this.onSourceInput);
        this.source.removeEventListener("blur", this.onSourceBlur);
    }

    private readonly onPreviewClick = (): void => {
        this.setEditing(true);
    };

    private readonly onSourceInput = (): void => {
        const pos = this.getPos();
        if (pos === undefined) return;
        const { tr } = this.view.state;
        this.view.dispatch(
            tr.setNodeMarkup(pos, undefined, {
                ...this.node.attrs,
                latex: this.source.value,
            }),
        );
    };

    private readonly onSourceBlur = (): void => {
        this.setEditing(false);
    };

    private setEditing(editing: boolean): void {
        if (this.editing === editing) return;
        this.editing = editing;
        if (editing) {
            this.dom.append(this.source);
            this.source.focus();
        } else {
            this.source.remove();
        }
        this.dom.setAttribute("data-mdx-editing", editing ? "true" : "false");
    }

    private render(): void {
        const latex = String(this.node.attrs.latex ?? "");
        this.dom.setAttribute("data-mdx-latex", latex);
        this.dom.setAttribute(
            "data-mdx-editing",
            this.editing ? "true" : "false",
        );
        // Writing an unchanged value would reset the caret mid-typing.
        if (this.source.value !== latex) this.source.value = latex;

        if (this.painted) {
            // Already on screen once: an edit has to show immediately, and
            // waiting to be seen again would leave the old formula standing.
            paintPreview(this.preview, latex, false);
            return;
        }
        // Until KaTeX runs, the formula reads as what the author wrote. It is
        // the same text the error path shows, so an unpainted formula and an
        // unrenderable one look alike rather than the first looking broken.
        this.preview.textContent = latex;
        this.stopWaiting?.();
        this.stopWaiting = paintWhenVisible(this.dom, () => {
            this.painted = true;
            paintPreview(
                this.preview,
                String(this.node.attrs.latex ?? ""),
                false,
            );
        });
    }
}

/**
 * Editing surface for a display formula.
 *
 * The LaTeX is the node's own text, so it is edited in the document like any
 * code block and the preview is drawn beside it.
 */
class MathBlockNodeView implements NodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly preview: HTMLElement;
    private painted = false;
    private stopWaiting: (() => void) | null = null;

    constructor(node: ProseMirrorNode) {
        this.node = node;

        this.dom = document.createElement("div");
        this.dom.className = "mdx-math mdx-math-block";
        this.dom.setAttribute("data-mdx-node-type", MATH_BLOCK_NODE_NAME);

        this.preview = document.createElement("div");
        this.preview.className = "mdx-math-preview";
        this.preview.setAttribute("contenteditable", "false");

        const pre = document.createElement("pre");
        pre.className = "mdx-math-source";
        this.contentDOM = document.createElement("code");
        this.contentDOM.setAttribute("spellcheck", "false");
        pre.append(this.contentDOM);

        this.dom.append(this.preview, pre);
        this.render();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    ignoreMutation(mutation: ViewMutationRecord): boolean {
        return !this.contentDOM.contains(mutation.target);
    }

    destroy(): void {
        this.stopWaiting?.();
    }

    private render(): void {
        if (this.painted) {
            paintPreview(this.preview, this.node.textContent, true);
            return;
        }
        // The source is already displayed beside the preview for a block
        // formula, so an unpainted one needs no stand-in text of its own.
        this.stopWaiting?.();
        this.stopWaiting = paintWhenVisible(this.dom, () => {
            this.painted = true;
            paintPreview(this.preview, this.node.textContent, true);
        });
    }
}

export function createMathInlineNodeView(): NodeViewConstructor {
    return (node, view, getPos) => new MathInlineNodeView(node, view, getPos);
}

export function createMathBlockNodeView(): NodeViewConstructor {
    return (node) => new MathBlockNodeView(node);
}
