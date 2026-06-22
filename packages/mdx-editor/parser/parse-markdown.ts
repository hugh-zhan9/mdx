import type { Schema } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import type { BlockParserContribution } from "../kernel/types";
import { mdxEditorSchema } from "../schema/schema";
import { codeBlockParsers } from "../syntax/code/parse";
import { mermaidBlockParsers } from "../syntax/mermaid/parse";
import { parseMarkdownBlocks } from "./block-markdown";

export function parseMarkdown(
    markdown: string,
    schema: Schema = mdxEditorSchema,
    blockParsers: BlockParserContribution[] = defaultBlockParsers(),
): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseMarkdownBlocks(
        markdown,
        sourceSlices,
        schema,
        blockParsers,
    );
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

function defaultBlockParsers() {
    return [...mermaidBlockParsers, ...codeBlockParsers].sort(
        (a, b) => b.priority - a.priority,
    );
}
