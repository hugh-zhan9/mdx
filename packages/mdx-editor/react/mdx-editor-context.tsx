"use client";

import { createContext, useContext } from "react";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
    SelectionState,
} from "../core/types";

export interface MdxEditorLayoutSource {
    doc: ProseMirrorNode;
    revision: number;
}

export interface MdxEditorContextValue {
    currentMarkdown: string;
    selection: SelectionState | null;
    focus: () => void;
    resetMarkdown: (markdown: string) => void;
    insertText: (
        text: string,
        selectionOffsets?: MarkdownSelectionOffsets | null,
    ) => void;
    replaceRange: (input: {
        from: number;
        to: number;
        text: string;
    }) => void;
    setSelectionRange: (range: DocumentSelectionRange) => void;
    insertImage: (
        url: string,
        altText?: string,
        title?: string,
        selectionRange?: DocumentSelectionRange | null,
    ) => void;
    getSelectionSnapshot: (contextChars?: number) => SelectionState | null;
    getDocumentSelectionRange: () => DocumentSelectionRange | null;
    getLayoutSource: () => MdxEditorLayoutSource | null;
    registerRoot: (root: HTMLDivElement | null) => void;
}

const noopContext: MdxEditorContextValue = {
    currentMarkdown: "",
    selection: null,
    focus: () => {},
    resetMarkdown: () => {},
    insertText: () => {},
    replaceRange: () => {},
    setSelectionRange: () => {},
    insertImage: () => {},
    getSelectionSnapshot: () => null,
    getDocumentSelectionRange: () => null,
    getLayoutSource: () => null,
    registerRoot: () => {},
};

export const MdxEditorContext = createContext<MdxEditorContextValue>(noopContext);

export function useMdxEditor(): MdxEditorContextValue {
    return useContext(MdxEditorContext);
}
