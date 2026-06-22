import type { Schema } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";
import { parseMarkdownBlocks } from "./block-markdown";

export function parseMarkdown(
    markdown: string,
    schema: Schema = mdxEditorSchema,
): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseMarkdownBlocks(markdown, sourceSlices, schema);
    const doc = schema.nodes.doc.create(
        null,
        nodes.length > 0
            ? nodes
            : [schema.nodes.paragraph.create({ sourceId: null })],
    );

    return {
        doc,
        originalMarkdown: markdown,
        sourceSlices,
        diagnostics: [],
    };
}
