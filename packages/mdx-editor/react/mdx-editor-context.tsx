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
}

export const MdxEditorContext = createContext<MdxEditorContextValue | null>(
    null,
);

export function useMdxEditor(): MdxEditorContextValue {
    const value = useContext(MdxEditorContext);

    if (!value) {
        throw new Error("useMdxEditor must be used inside MdxEditorProvider");
    }

    return value;
}
