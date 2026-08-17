import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
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

    constructor(node: ProseMirrorNode, renderer: () => MermaidRenderer) {
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
        this.destroyed = true;
        this.generation += 1;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

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
        this.error.hidden = true;
        this.error.textContent = "";
    }

    private showError(message: string): void {
        this.preview.replaceChildren();
        this.error.textContent = message;
        this.error.hidden = false;
    }
}

export function createMermaidNodeView(
    renderer: () => MermaidRenderer,
): NodeViewConstructor {
    return (node) => new MermaidNodeView(node, renderer);
}
