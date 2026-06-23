import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import type { ParsedMarkdownDocument } from "../core/types";
import type { CodeTokenizer } from "../plugins/editor-code-highlight";
import { createEditorPluginsForKernel } from "../plugins/editor-plugins";
import { parseMarkdown as parseMarkdownWithSchema } from "../parser/parse-markdown";
import { createMdxNodeViews } from "../react/node-views";
import { serializeBlockNode } from "../serializer/block-serializer";
import { serializeInlineContent } from "../serializer/inline-serializer";
import { serializeMarkdown as serializeParsedMarkdown } from "../serializer/serialize-markdown";
import { createKernelClipboard, type KernelClipboard } from "./clipboard";
import { createSyntaxRegistry } from "./registry";
import { buildSchemaFromRegistry } from "./schema";
import type {
    SerializerContext,
    SyntaxPlugin,
    SyntaxRegistry,
} from "./types";

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
    resolveImageSource?: (src: string) => Promise<string>;
    createNodeViews(): Record<string, NodeViewConstructor>;
    createEditorPlugins(): Plugin[];
    clipboard: KernelClipboard;
}

export function createMdxEditorKernel(
    options: MdxEditorKernelOptions,
): MdxEditorKernel {
    const registry = createSyntaxRegistry(options.syntax);
    const schema = buildSchemaFromRegistry(registry);
    let nodeSerializers: Record<string, (node: ProseMirrorNode) => string> = {};
    const serializerContext: SerializerContext = {
        serializeInline: (node) =>
            serializeInlineContent(node, {
                nodeSerializers,
            }),
        serializeNode: (node) =>
            serializeBlockNode(node, {
                nodeSerializers,
                serializeInline: serializerContext.serializeInline,
                serializeNode: serializerContext.serializeNode,
            }),
    };
    nodeSerializers = mergeNodeSerializers(registry, serializerContext);

    const parseMarkdown = (markdown: string) =>
        parseMarkdownWithSchema(markdown, schema, registry.blockParsers);
    const serializeNode = serializerContext.serializeNode;
    const serializeMarkdown = (doc: ProseMirrorNode | ParsedMarkdownDocument) =>
        serializeParsedMarkdown(
            isParsedDocument(doc) ? doc : emptyParsedDocument(doc),
            {
                parseMarkdown,
                serializeNode,
            },
        );
    const clipboard = createKernelClipboard({
        schema,
        registry,
        parseMarkdown,
        serializeMarkdown,
    });

    return {
        schema,
        registry,
        parseMarkdown,
        serializeMarkdown,
        resolveImageSource: options.services?.imageLoader,
        createNodeViews: () => ({
            ...registry.nodeViews,
            image: createMdxNodeViews({
                imageLoader: options.services?.imageLoader,
            }).image,
        }),
        createEditorPlugins: () =>
            createEditorPluginsForKernel({
                schema,
                codeTokenizer: options.services?.codeTokenizer,
                parseMarkdown,
                serializeMarkdown,
                clipboard,
            }),
        clipboard,
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

function mergeNodeSerializers(
    registry: SyntaxRegistry,
    context: SerializerContext,
) {
    const nodeSerializers: Record<string, (node: ProseMirrorNode) => string> = {};

    for (const contribution of registry.serializers) {
        for (const [name, serializer] of Object.entries(
            contribution.nodeSerializers ?? {},
        )) {
            nodeSerializers[name] = (node) => serializer(node, context);
        }
    }

    return nodeSerializers;
}
