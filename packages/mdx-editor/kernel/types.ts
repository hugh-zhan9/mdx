import type {
    MarkSpec,
    Node as ProseMirrorNode,
    NodeSpec,
    Schema,
} from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";

export type SyntaxPhase = "block" | "inline" | "fallback" | "clipboard";

export type SyntaxPriority = number;

export interface ParserNotMatched {
    status: "notMatched";
}

export interface ParserMatched {
    status: "matched";
    node: ProseMirrorNode;
    nextIndex: number;
}

export interface ParserFallback {
    status: "fallback";
    start: number;
    end: number;
    reason: string;
}

export type ParserResult = ParserMatched | ParserNotMatched | ParserFallback;

export interface BlockParserContribution {
    phase: SyntaxPhase;
    priority: SyntaxPriority;
    parse: (context: MarkdownParseContext, index: number) => ParserResult;
}

export interface InlineParserContribution {
    phase: SyntaxPhase;
    priority: SyntaxPriority;
    parse: (context: InlineParseContext, index: number) => ParserResult;
}

export interface MarkdownParseContext {
    readonly markdown: string;
    readonly schema: Schema;
    readonly sourceSlices: SourceSlice[];
    allocateSourceSlice(start: number, end: number): string;
    parseInline(text: string): ProseMirrorNode[];
    emitFallback(start: number, end: number, reason: string): ProseMirrorNode;
}

export interface InlineParseContext {
    readonly text: string;
    readonly schema: Schema;
}

export interface SerializerContribution {
    nodeSerializers?: Record<
        string,
        (node: ProseMirrorNode, context: SerializerContext) => string
    >;
    markSerializers?: Record<string, MarkSerializer>;
}

export interface MarkSerializer {
    open: string | ((attrs: Record<string, unknown>) => string);
    close: string | ((attrs: Record<string, unknown>) => string);
}

export interface SerializerContext {
    serializeNode(node: ProseMirrorNode): string;
    serializeInline(node: ProseMirrorNode): string;
}

export interface ClipboardContribution {
    toClipboardHtml?: Record<
        string,
        (node: ProseMirrorNode, context: ClipboardContext) => string
    >;
    parseClipboardHtml?: Array<
        (element: Element, context: ClipboardContext) => ProseMirrorNode[] | null
    >;
}

export interface ClipboardContext {
    readonly schema: Schema;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode): string;
}

export interface SyntaxPlugin {
    id: string;
    nodes?: Record<string, NodeSpec>;
    marks?: Record<string, MarkSpec>;
    blockParsers?: BlockParserContribution[];
    inlineParsers?: InlineParserContribution[];
    serializers?: SerializerContribution;
    nodeViews?: Record<string, NodeViewConstructor>;
    editorPlugins?: Array<(schema: Schema) => Plugin>;
    clipboard?: ClipboardContribution;
}

export interface RegisteredBlockParser extends BlockParserContribution {
    pluginId: string;
}

export interface RegisteredInlineParser extends InlineParserContribution {
    pluginId: string;
}

export interface SyntaxRegistry {
    plugins: SyntaxPlugin[];
    nodes: Record<string, NodeSpec>;
    marks: Record<string, MarkSpec>;
    blockParsers: RegisteredBlockParser[];
    inlineParsers: RegisteredInlineParser[];
    serializers: SerializerContribution[];
    nodeViews: Record<string, NodeViewConstructor>;
    editorPlugins: Array<(schema: Schema) => Plugin>;
    clipboard: ClipboardContribution[];
}
