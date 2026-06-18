import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";
import { parseMarkdownBlocks } from "./block-markdown";

export function parseMarkdown(markdown: string): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseMarkdownBlocks(markdown, sourceSlices);
    const doc = mdxEditorSchema.nodes.doc.create(
        null,
        nodes.length > 0
            ? nodes
            : [mdxEditorSchema.nodes.paragraph.create({ sourceId: null })],
    );

    return {
        doc,
        originalMarkdown: markdown,
        sourceSlices,
        diagnostics: [],
    };
}
