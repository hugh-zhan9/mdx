import type { Node as ProseMirrorNode } from "prosemirror-model";

const RESOLVED_SOURCE_ATTRIBUTE = "data-mdx-resolved-src";

export interface NodeViewProps {
    node: ProseMirrorNode;
    updateAttrs: (attrs: Record<string, unknown>) => void;
    selected?: boolean;
    getPos?: () => number;
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
