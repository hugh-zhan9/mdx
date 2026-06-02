"use client";

import {
    DOMD as KernelDOMD,
    DOMDProvider as KernelDOMDProvider,
    toMarkdown as kernelToMarkdown,
    useEditor as kernelUseEditor,
    useEditorStoreApi as kernelUseEditorStoreApi,
    useRenderData as kernelUseRenderData,
} from "@do-md/react";
import "@do-md/react/style.css";
import type {
    DOMDProviderProps,
    Editor,
    EditorStoreApi,
    RenderData,
    SelectionState,
} from "@do-md/react";

export const DOMDProvider = KernelDOMDProvider;
export const DOMD = KernelDOMD;
export const toMarkdown = kernelToMarkdown;
export const useEditor = kernelUseEditor;
export const useEditorStoreApi = kernelUseEditorStoreApi;
export const useRenderData = kernelUseRenderData;

export function resetMD(store: EditorStoreApi | null, markdown: string) {
    store?.resetMD(markdown);
}

export function insertText(store: EditorStoreApi | null, text: string) {
    store?.insertText(text);
}

export function insertImage(
    store: EditorStoreApi | null,
    url: string,
    altText?: string,
) {
    store?.insertImage(url, altText);
}

export function getSelectionState(
    store: EditorStoreApi | null,
    contextChars?: number,
): SelectionState | null {
    return store?.getSelectionState(contextChars) ?? null;
}

export type {
    DOMDProviderProps,
    Editor,
    EditorStoreApi,
    RenderData,
    SelectionState,
};
