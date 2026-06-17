"use client";

import { createContext, useContext } from "react";
import type { SelectionState } from "../core/types";

export interface MdxEditorContextValue {
    currentMarkdown: string;
    selection: SelectionState | null;
    focus: () => void;
    resetMarkdown: (markdown: string) => void;
    insertText: (text: string) => void;
    insertImage: (url: string, altText?: string, title?: string) => void;
    getSelectionSnapshot: (contextChars?: number) => SelectionState | null;
    registerRoot: (root: HTMLDivElement | null) => void;
}

const noopContext: MdxEditorContextValue = {
    currentMarkdown: "",
    selection: null,
    focus: () => {},
    resetMarkdown: () => {},
    insertText: () => {},
    insertImage: () => {},
    getSelectionSnapshot: () => null,
    registerRoot: () => {},
};

export const MdxEditorContext = createContext<MdxEditorContextValue>(noopContext);

export function useMdxEditor(): MdxEditorContextValue {
    return useContext(MdxEditorContext);
}
