import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
    ViewMutationRecord,
} from "prosemirror-view";

import { sanitizeCalloutKind, sanitizeCalloutTitle } from "./marker";

/**
 * Editing surface for a callout.
 *
 * The type and the title live in attributes rather than in the document, so the
 * header is drawn outside the editable content as two inputs that write back
 * through `setNodeMarkup`. The body is ordinary block content, which is what
 * lets it carry inline marks, lists, code fences and nested callouts.
 */
class CalloutNodeView implements NodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly view: EditorView;
    private readonly getPos: () => number | undefined;
    private readonly header: HTMLElement;
    private readonly kindInput: HTMLInputElement;
    private readonly titleInput: HTMLInputElement;

    constructor(
        node: ProseMirrorNode,
        view: EditorView,
        getPos: () => number | undefined,
    ) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;

        this.dom = document.createElement("div");
        this.dom.className = "mdx-callout";
        this.dom.setAttribute("data-callout", "");

        this.header = document.createElement("div");
        this.header.className = "mdx-callout-header";
        this.header.setAttribute("contenteditable", "false");

        this.kindInput = document.createElement("input");
        this.kindInput.className = "mdx-callout-kind";
        this.kindInput.setAttribute("aria-label", "Callout type");
        this.kindInput.addEventListener("input", () => {
            const kind = sanitizeCalloutKind(this.kindInput.value);
            if (this.kindInput.value !== kind) this.kindInput.value = kind;
            this.writeAttributes({ kind });
        });

        this.titleInput = document.createElement("input");
        this.titleInput.className = "mdx-callout-title";
        this.titleInput.setAttribute("aria-label", "Callout title");
        this.titleInput.addEventListener("input", () => {
            const title = sanitizeCalloutTitle(this.titleInput.value);
            if (this.titleInput.value !== title) this.titleInput.value = title;
            this.writeAttributes({ title });
        });

        this.header.append(this.kindInput, this.titleInput);

        this.contentDOM = document.createElement("div");
        this.contentDOM.className = "mdx-callout-body";
        this.contentDOM.setAttribute("data-callout-body", "");

        this.dom.append(this.header, this.contentDOM);
        this.syncAttributes();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.syncAttributes();
        return true;
    }

    stopEvent(event: Event): boolean {
        const target = event.target;
        return target instanceof Node && this.header.contains(target);
    }

    ignoreMutation(mutation: ViewMutationRecord): boolean {
        return !this.contentDOM.contains(mutation.target);
    }

    private syncAttributes(): void {
        const kind = String(this.node.attrs.kind ?? "");
        const title = String(this.node.attrs.title ?? "");
        // Writing an unchanged value would reset the caret mid-typing.
        if (this.kindInput.value !== kind) this.kindInput.value = kind;
        if (this.titleInput.value !== title) this.titleInput.value = title;
        this.dom.setAttribute("data-callout-kind", kind);
        this.dom.setAttribute("data-callout-title", title);
        this.dom.setAttribute(
            "data-callout-spaced",
            this.node.attrs.spaced === true ? "true" : "false",
        );
    }

    private writeAttributes(patch: { kind?: string; title?: string }): void {
        const pos = this.getPos();
        if (pos === undefined) return;
        const { tr } = this.view.state;
        this.view.dispatch(
            tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch }),
        );
    }
}

export function createCalloutNodeView(): NodeViewConstructor {
    return (node, view, getPos) => new CalloutNodeView(node, view, getPos);
}
