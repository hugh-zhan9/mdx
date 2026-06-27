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

export type LayoutInlineKind =
    | "text"
    | "math_inline"
    | "hard_break"
    | "image_inline"
    | "html_inline"
    | "unsupported_inline";

export interface LayoutInlineMark {
    type: "bold" | "italic" | "code" | "link" | "strike" | "underline";
    href?: string;
}

export interface LayoutInlineRun {
    id: string;
    text: string;
    kind: LayoutInlineKind;
    attrs?: Record<string, string>;
    marks: LayoutInlineMark[];
    sourceFrom: number;
    sourceTo: number;
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
    viewport: { width: number; height: number };
    blocks: LayoutBlock[];
    styleContext: LayoutStyleContext;
}

export interface LayoutNormalizationOptions {
    documentId: string;
    revision: number;
    viewport: { width: number; height: number };
}

export interface LayoutNormalizationSource {
    markdown: string;
    parsed?: ParsedMarkdownDocument;
    selection?: SelectionState | null;
    proseMirrorNode?: ProseMirrorNode;
}
