import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
import { normalizeProseMirrorLayoutDocument } from "./from-prosemirror";
import type { LayoutDocument, LayoutViewport } from "./types";

export function normalizeLayoutDocument(
    markdown: string,
    viewport: LayoutViewport,
): LayoutDocument {
    const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
    const parsed = kernel.parseMarkdown(markdown);
    const document = normalizeProseMirrorLayoutDocument(parsed.doc, {
        documentId: "active-document",
        revision: 1,
        viewport: {
            width: viewport.width,
            height: viewport.height,
        },
    });

    return {
        ...document,
        styleContext: {
            ...document.styleContext,
            devicePixelRatio: viewport.devicePixelRatio,
        },
    };
}
