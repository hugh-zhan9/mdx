import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import type { ParsedMarkdownDocument } from "../core/types";
import type { CodeTokenizer } from "../plugins/editor-code-highlight";
import { createMdxEditorPlugins } from "../plugins/editor-plugins";
import { parseMarkdown as parseMarkdownWithSchema } from "../parser/parse-markdown";
import { createMdxNodeViews } from "../react/node-views";
import { serializeMarkdown as serializeParsedMarkdown } from "../serializer/serialize-markdown";
import { createSyntaxRegistry } from "./registry";
import { buildSchemaFromRegistry } from "./schema";
import type { SyntaxPlugin, SyntaxRegistry } from "./types";

export interface MdxEditorKernelServices {
    codeTokenizer?: CodeTokenizer;
    imageLoader?: (src: string) => Promise<string>;
}

export interface MdxEditorKernelOptions {
    syntax: SyntaxPlugin[];
    services?: MdxEditorKernelServices;
}

export interface MdxEditorKernel {
    schema: Schema;
    registry: SyntaxRegistry;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    createNodeViews(): Record<string, NodeViewConstructor>;
    createEditorPlugins(): Plugin[];
    clipboard: {
        serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    };
}

export function createMdxEditorKernel(
    options: MdxEditorKernelOptions,
): MdxEditorKernel {
    const registry = createSyntaxRegistry(options.syntax);
    const schema = buildSchemaFromRegistry(registry);

    const parseMarkdown = (markdown: string) =>
        parseMarkdownWithSchema(markdown, schema);
    const serializeMarkdown = (doc: ProseMirrorNode | ParsedMarkdownDocument) =>
        serializeParsedMarkdown(isParsedDocument(doc) ? doc : emptyParsedDocument(doc), {
            parseMarkdown,
        });

    return {
        schema,
        registry,
        parseMarkdown,
        serializeMarkdown,
        createNodeViews: () => ({
            ...registry.nodeViews,
            image: createMdxNodeViews({
                imageLoader: options.services?.imageLoader,
            }).image,
        }),
        createEditorPlugins: () =>
            createMdxEditorPlugins({
                schema,
                codeTokenizer: options.services?.codeTokenizer,
            }),
        clipboard: {
            serializeMarkdown,
        },
    };
}

function isParsedDocument(
    candidate: ProseMirrorNode | ParsedMarkdownDocument,
): candidate is ParsedMarkdownDocument {
    return "doc" in candidate && "sourceSlices" in candidate;
}

function emptyParsedDocument(doc: ProseMirrorNode): ParsedMarkdownDocument {
    return {
        doc,
        originalMarkdown: "",
        sourceSlices: [],
        diagnostics: [],
    };
}
