import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { NodeView, NodeViewConstructor } from "prosemirror-view";

import type { EditorImageLoader } from "../../../adapter/types";
import { IMAGE_DOM_MARKER, IMAGE_RESOLVED_SOURCE_MARKER } from "./syntax";

/**
 * Whether the browser can fetch `src` on its own.
 *
 * A document is written with the paths its author uses — `assets/pic.png` is
 * relative to a file, which the browser knows nothing about — but it may also
 * name a URL that needs no help. Those are answered directly rather than sent
 * through the product: a loader would hand back what it was given, one round
 * trip later.
 */
export function isDirectImageSource(src: string): boolean {
    return src.startsWith("//") || /^(https?:|data:|blob:)/i.test(src);
}

function attribute(node: ProseMirrorNode, name: string): string {
    const value = node.attrs[name];
    return typeof value === "string" ? value : "";
}

/**
 * Draws one image, resolving what the document wrote into something loadable.
 *
 * The resolved URL is display state and nothing more. It is written onto the
 * rendered element and never onto the node, so the Markdown keeps the path its
 * author typed no matter what the product resolved it to — and an image that
 * cannot be resolved at all stays exactly as written, because a picture that
 * does not draw is a rendering failure and not a reason to edit a document.
 */
class ImageNodeView implements NodeView {
    readonly dom: HTMLImageElement;

    private node: ProseMirrorNode;
    private readonly readLoader: () => EditorImageLoader | undefined;
    /**
     * Bumped by every resolution and by teardown. A resolution whose generation
     * has moved on by the time it settles writes nothing, which is what keeps a
     * slow answer for a source the node no longer has — or for a node that is
     * gone — off the screen.
     */
    private generation = 0;

    constructor(
        node: ProseMirrorNode,
        readLoader: () => EditorImageLoader | undefined,
    ) {
        this.node = node;
        this.readLoader = readLoader;
        this.dom = document.createElement("img");
        this.dom.setAttribute(IMAGE_DOM_MARKER, "");
        this.showAuthoredSource();
        this.showDescription();
        void this.resolve();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        const moved = attribute(node, "src") !== attribute(this.node, "src");
        this.node = node;
        this.showDescription();
        // Whatever is displayed still answers for a source that did not change,
        // so re-resolving it would refetch the same asset and, for a loader
        // that mints a blob URL per call, leak the one already on screen.
        if (!moved) return true;
        this.showAuthoredSource();
        void this.resolve();
        return true;
    }

    destroy(): void {
        this.generation += 1;
    }

    /**
     * Displays the reference the document holds.
     *
     * It is what a direct URL needs and all an unresolvable one will ever get,
     * and showing it before resolving means the element is never momentarily
     * pointed at the asset the node used to name.
     */
    private showAuthoredSource(): void {
        this.dom.setAttribute("src", attribute(this.node, "src"));
        this.dom.removeAttribute(IMAGE_RESOLVED_SOURCE_MARKER);
    }

    /**
     * Everything about the picture that is not where it lives.
     *
     * Written unconditionally, empty values included, because the rendering
     * this view replaced put every one of the node's attributes on the element
     * and a value that is cleared has to come off again.
     */
    private showDescription(): void {
        this.dom.setAttribute("alt", attribute(this.node, "alt"));
        this.dom.setAttribute("title", attribute(this.node, "title"));
    }

    private async resolve(): Promise<void> {
        const generation = this.generation + 1;
        this.generation = generation;

        const src = attribute(this.node, "src");
        if (!src || isDirectImageSource(src)) return;
        // Read per resolution rather than captured: the file a relative path is
        // resolved against changes when the document is renamed, which does not
        // rebuild this view.
        const load = this.readLoader();
        if (!load) return;

        let resolved: string;
        try {
            resolved = await load(src);
        } catch {
            // The product could not find the asset. The reference stays as
            // written and the document is untouched.
            return;
        }
        if (generation !== this.generation) return;
        this.dom.setAttribute("src", resolved);
        this.dom.setAttribute(IMAGE_RESOLVED_SOURCE_MARKER, src);
    }
}

export function createImageNodeView(
    readLoader: () => EditorImageLoader | undefined,
): NodeViewConstructor {
    return (node) => new ImageNodeView(node, readLoader);
}
