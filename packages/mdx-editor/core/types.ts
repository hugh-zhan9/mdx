import type { Node as ProseMirrorNode } from "prosemirror-model";

export interface SourceRange {
    start: number;
    end: number;
}

export interface SourceSlice {
    id: string;
    range: SourceRange;
    text: string;
}

export interface EditorDiagnostic {
    code: string;
    message: string;
    range?: SourceRange;
}

export interface ParsedMarkdownDocument {
    doc: ProseMirrorNode;
    originalMarkdown: string;
    sourceSlices: SourceSlice[];
    diagnostics: EditorDiagnostic[];
}

export interface SelectionState {
    has_selection: boolean;
    selected_text: string;
    before: string;
    after: string;
    before_truncated: boolean;
    after_truncated: boolean;
}

export interface MdxEditorSnapshot {
    markdown: string;
    selection: SelectionState | null;
}
