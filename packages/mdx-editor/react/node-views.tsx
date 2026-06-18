import type { Node as ProseMirrorNode } from "prosemirror-model";
import { createRoot } from "react-dom/client";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
} from "prosemirror-view";
import { SourceFallbackNodeView } from "./source-fallback-node-view";

const RESOLVED_SOURCE_ATTRIBUTE = "data-mdx-resolved-src";

export interface NodeViewProps {
    node: ProseMirrorNode;
    updateAttrs: (attrs: Record<string, unknown>) => void;
    selected?: boolean;
    getPos?: () => number;
}

export function createMdxNodeViews(): Record<string, NodeViewConstructor> {
    return {
        source_fallback: createSourceFallbackNodeView,
    };
}

function createSourceFallbackNodeView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
): NodeView {
    const dom = document.createElement("div");
    const root = createRoot(dom);
    let currentNode = node;
    let selected = false;

    const updateAttrs = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

        view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                ...attrs,
            }),
        );
    };

    const render = () => {
        root.render(
            <SourceFallbackNodeView
                node={currentNode}
                updateAttrs={updateAttrs}
                selected={selected}
                getPos={getPosForProps(getPos)}
            />,
        );
    };

    render();

    return {
        dom,
        update(nextNode) {
            if (nextNode.type.name !== "source_fallback") {
                return false;
            }

            currentNode = nextNode;
            render();

            return true;
        },
        selectNode() {
            selected = true;
            render();
        },
        deselectNode() {
            selected = false;
            render();
        },
        stopEvent(event) {
            return event.target instanceof HTMLTextAreaElement;
        },
        ignoreMutation() {
            return true;
        },
        destroy() {
            root.unmount();
        },
    };
}

function getPosForProps(getPos: () => number | undefined) {
    return () => getPos() ?? 0;
}

export async function hydrateRenderedImages(
    root: ParentNode,
    imageLoader?: (src: string) => Promise<string>,
) {
    if (!imageLoader) {
        return;
    }

    const images = root.querySelectorAll<HTMLImageElement>(
        "img[data-mdx-node-type='image']",
    );

    await Promise.all(
        Array.from(images).map(async (image) => {
            const source = image.getAttribute("src");
            if (!source || image.getAttribute(RESOLVED_SOURCE_ATTRIBUTE) === source) {
                return;
            }

            try {
                const resolved = await imageLoader(source);
                image.src = resolved;
                image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, source);
            } catch {
                image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, source);
            }
        }),
    );
}

export function nodeViewPlaceholder() {
    return null;
}
