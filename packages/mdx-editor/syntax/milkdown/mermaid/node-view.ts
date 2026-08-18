import { TextSelection } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
    ViewMutationRecord,
} from "prosemirror-view";

import type { MermaidRenderResult, MermaidRenderer } from "./renderer";
import {
    MDX_SEARCH_ATTRIBUTE,
    MDX_SEARCH_EXCLUDE,
    MERMAID_DOM_MARKER,
    MERMAID_ERROR_MARKER,
    MERMAID_PREVIEW_MARKER,
    MERMAID_RENDERED_MARKER,
    MERMAID_SOURCE_MARKER,
} from "./syntax";

/**
 * How long the source must stay still before a render starts. Rendering is the
 * expensive half of this NodeView and every keystroke changes the source.
 */
export const MERMAID_RENDER_DELAY_MS = 50;

let nextDiagramId = 0;

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Turns rendered SVG markup into a detached element, or `null` when the markup
 * is not a single SVG root.
 *
 * Parsed through `DOMParser` rather than assigned as `innerHTML`: a document
 * built that way has scripting disabled, so any `script` that survived the
 * renderer's own sanitizer arrives already marked as non-executable.
 */
function parseRenderedSvg(markup: string): Element | null {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    const root = parsed.body.firstElementChild;
    if (!root || root.tagName.toLowerCase() !== "svg") return null;
    return document.importNode(root, true);
}

/**
 * Editing surface for a Mermaid diagram.
 *
 * The fence source is the node's content and stays editable. The rendered
 * diagram and the failure report live outside `contentDOM`, so they are not
 * part of the node's text, never reach the serializer, and carry the
 * search-exclusion attribute that keeps them out of semantic scans.
 *
 * A successful render is announced on the block, which is what lets a stylesheet
 * put the source away: the picture already says what the fence says. Pressing
 * the diagram brings the caret back into that source, and is the only way in
 * once it is out of sight.
 */
class MermaidNodeView implements NodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly renderer: () => MermaidRenderer;
    private readonly preview: HTMLElement;
    private readonly error: HTMLElement;
    private readonly diagramId: string;

    private timer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Bumped by every new render and by teardown. A render whose generation is
     * stale when it resolves writes nothing, which is what makes an in-flight
     * render cancellable.
     */
    private generation = 0;
    private destroyed = false;

    constructor(
        node: ProseMirrorNode,
        renderer: () => MermaidRenderer,
        private readonly view: EditorView,
        private readonly getPos: () => number | undefined,
    ) {
        this.node = node;
        this.renderer = renderer;
        nextDiagramId += 1;
        this.diagramId = `mdx-mermaid-${nextDiagramId}`;

        this.dom = document.createElement("div");
        this.dom.className = "mdx-mermaid";
        this.dom.setAttribute(MERMAID_DOM_MARKER, "");

        const source = document.createElement("pre");
        source.className = "mdx-mermaid-source";
        source.setAttribute(MERMAID_SOURCE_MARKER, "");
        this.contentDOM = document.createElement("code");
        this.contentDOM.setAttribute("spellcheck", "false");
        source.append(this.contentDOM);

        this.preview = document.createElement("div");
        this.preview.className = "mdx-mermaid-preview";
        this.preview.setAttribute(MERMAID_PREVIEW_MARKER, "");
        this.preview.setAttribute(MDX_SEARCH_ATTRIBUTE, MDX_SEARCH_EXCLUDE);
        this.preview.setAttribute("contenteditable", "false");
        this.preview.addEventListener("mousedown", this.onPreviewPress);

        this.error = document.createElement("div");
        this.error.className = "mdx-mermaid-error";
        this.error.setAttribute(MERMAID_ERROR_MARKER, "");
        this.error.setAttribute(MDX_SEARCH_ATTRIBUTE, MDX_SEARCH_EXCLUDE);
        this.error.setAttribute("contenteditable", "false");
        this.error.setAttribute("role", "status");
        this.error.hidden = true;

        this.dom.append(source, this.preview, this.error);
        this.schedule();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        const changed = node.textContent !== this.node.textContent;
        this.node = node;
        if (changed) this.schedule();
        return true;
    }

    ignoreMutation(mutation: ViewMutationRecord): boolean {
        return !this.contentDOM.contains(mutation.target);
    }

    destroy(): void {
        this.preview.removeEventListener("mousedown", this.onPreviewPress);
        this.destroyed = true;
        this.generation += 1;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Puts the caret into the source the diagram was drawn from.
     *
     * The press is answered rather than the click, and answered instead of the
     * editor's own handling: a press on a region that cannot be edited would
     * otherwise select the whole block, and what the reader is asking for is to
     * change the diagram, which means being in its text.
     */
    private onPreviewPress = (event: MouseEvent) => {
        if (!this.view.editable || event.button !== 0) {
            return;
        }

        const pos = this.getPos();

        if (pos === undefined) {
            return;
        }

        event.preventDefault();
        this.view.dispatch(
            this.view.state.tr.setSelection(
                TextSelection.near(this.view.state.doc.resolve(pos + 1)),
            ),
        );
        this.view.focus();
    };

    private schedule(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.run();
        }, MERMAID_RENDER_DELAY_MS);
    }

    private async run(): Promise<void> {
        const generation = this.generation + 1;
        this.generation = generation;
        const code = this.node.textContent;
        let result: MermaidRenderResult;
        try {
            result = await this.renderer()({ code, id: this.diagramId });
        } catch (error) {
            // A renderer that throws is a failed diagram, not a failed editor.
            result = { ok: false, error: describe(error) };
        }
        if (this.destroyed || generation !== this.generation) return;
        this.apply(result);
    }

    private apply(result: MermaidRenderResult): void {
        if (!result.ok) {
            this.showError(result.error);
            return;
        }
        const svg = parseRenderedSvg(result.svg);
        if (!svg) {
            this.showError("the diagram renderer did not return an SVG");
            return;
        }
        this.preview.replaceChildren(svg);
        this.dom.setAttribute(MERMAID_RENDERED_MARKER, "");
        this.error.hidden = true;
        this.error.textContent = "";
    }

    private showError(message: string): void {
        // Off, not just empty: a fence whose diagram could not be drawn has to
        // speak for itself, and it is the only thing left that can.
        this.dom.removeAttribute(MERMAID_RENDERED_MARKER);
        this.preview.replaceChildren();
        this.error.textContent = message;
        this.error.hidden = false;
    }
}

export function createMermaidNodeView(
    renderer: () => MermaidRenderer,
): NodeViewConstructor {
    return (node, view, getPos) =>
        new MermaidNodeView(node, renderer, view, getPos);
}
