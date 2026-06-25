import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ParsedMarkdownDocument, SelectionState } from "../core/types";

export interface LayoutViewport {
    width: number;
    height: number;
    devicePixelRatio: number;
}

export interface LayoutStyleContext {
    defaultFontSize: number;
    defaultFontFamily: string;
    defaultLineHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
}

export interface LayoutInlineStyle {
    bold: boolean;
    italic: boolean;
    code: boolean;
}

export interface LayoutInlineRun {
    text: string;
    kind: "text" | "math_inline";
    from: number;
    to: number;
    style: LayoutInlineStyle;
}

export interface LayoutBlockStyle {
    fontSize: number;
    fontFamily: string;
    lineHeight: number;
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    mathDisplay?: "inline" | "block";
}

export interface LayoutBlock {
    blockId: string;
    kind:
        | "paragraph"
        | "heading"
        | "list"
        | "table"
        | "code"
        | "image"
        | "mermaid"
        | "html"
        | "math_block"
        | "fallback";
    pmFrom: number;
    pmTo: number;
    depth: number;
    inlines: LayoutInlineRun[];
    style: LayoutBlockStyle;
}

export interface LayoutDocument {
    documentId: string;
    revision: number;
    blocks: LayoutBlock[];
    styleContext: LayoutStyleContext;
}

export interface LayoutNormalizationSource {
    markdown: string;
    parsed?: ParsedMarkdownDocument;
    selection?: SelectionState | null;
    proseMirrorNode?: ProseMirrorNode;
}
