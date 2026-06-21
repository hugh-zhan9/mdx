"use client";

import { useEffect, useMemo, useRef } from "react";
import {
    MdxEditorProvider,
    MdxEditorView,
    useMdxEditor,
} from "../../../packages/mdx-editor/react";
import type {
    MdxEditorContextValue,
    MdxEditorProviderProps,
} from "../../../packages/mdx-editor/react";
import type {
    MarkdownSelectionOffsets,
    SelectionState,
} from "../../../packages/mdx-editor";

type StoreListener = (newState: unknown, prevState: unknown) => void;

export interface DOMDProviderProps
    extends Pick<
        MdxEditorProviderProps,
        "children" | "editable" | "placeholder" | "imageLoader" | "codeTokenizer"
    > {
    initMd?: string;
}

export interface Editor {
    focus(): void;
}

export interface EditorStoreApi {
    resetMD(markdown: string): void;
    insertText(
        text: string,
        selectionOffsets?: MarkdownSelectionOffsets | null,
    ): void;
    insertImage(
        url: string,
        altText?: string,
        selectionOffsets?: MarkdownSelectionOffsets | null,
    ): void;
    getTitle(): string;
    getSelectionState(contextChars?: number): SelectionState | null;
    getMarkdownSelectionOffsets(): MarkdownSelectionOffsets | null;
    subscribe(listener: StoreListener): () => void;
}

export interface RenderData {
    currentMarkdown: string;
    selection: SelectionState | null;
}

export function DOMDProvider({
    children,
    editable = true,
    initMd = "",
    placeholder,
    imageLoader,
    codeTokenizer,
}: DOMDProviderProps) {
    return (
        <MdxEditorProvider
            editable={editable}
            initialMarkdown={initMd}
            placeholder={placeholder}
            imageLoader={imageLoader}
            codeTokenizer={codeTokenizer}
        >
            {children}
        </MdxEditorProvider>
    );
}

export const DOMD = MdxEditorView;

export function useEditor(): Editor | null {
    const { focus } = useMdxEditor();

    return useMemo(() => ({ focus }), [focus]);
}

export function useEditorStoreApi(): EditorStoreApi | null {
    return useCompatStoreApi();
}

export function useRenderData(): RenderData {
    const { currentMarkdown, selection } = useMdxEditor();

    return useMemo(
        () => ({
            currentMarkdown,
            selection,
        }),
        [currentMarkdown, selection],
    );
}

export function toMarkdown(data: RenderData): string | null {
    return data.currentMarkdown;
}

export function resetMD(store: EditorStoreApi | null, markdown: string) {
    store?.resetMD(markdown);
}

export function insertText(
    store: EditorStoreApi | null,
    text: string,
    selectionOffsets?: MarkdownSelectionOffsets | null,
) {
    store?.insertText(text, selectionOffsets);
}

export function insertImage(
    store: EditorStoreApi | null,
    url: string,
    altText?: string,
    selectionOffsets?: MarkdownSelectionOffsets | null,
) {
    store?.insertImage(url, altText, selectionOffsets);
}

export function getSelectionState(
    store: EditorStoreApi | null,
    contextChars?: number,
): SelectionState | null {
    return store?.getSelectionState(contextChars) ?? null;
}

export function getMarkdownSelectionOffsets(
    store: EditorStoreApi | null,
): MarkdownSelectionOffsets | null {
    return store?.getMarkdownSelectionOffsets() ?? null;
}

function useCompatStoreApi(): EditorStoreApi {
    const editor = useMdxEditor();
    const editorRef = useRef<MdxEditorContextValue>(editor);
    const listenersRef = useRef(new Set<StoreListener>());
    const stateRef = useRef<RenderData>({
        currentMarkdown: editor.currentMarkdown,
        selection: editor.selection,
    });

    useEffect(() => {
        editorRef.current = editor;
    }, [editor]);

    useEffect(() => {
        const previousState = stateRef.current;
        const nextState: RenderData = {
            currentMarkdown: editor.currentMarkdown,
            selection: editor.selection,
        };

        stateRef.current = nextState;

        if (
            previousState.currentMarkdown === nextState.currentMarkdown &&
            previousState.selection === nextState.selection
        ) {
            return;
        }

        for (const listener of listenersRef.current) {
            listener(nextState, previousState);
        }
    }, [editor.currentMarkdown, editor.selection]);

    return useMemo(
        () => ({
            resetMD(markdown: string) {
                editorRef.current.resetMarkdown(markdown);
            },
            insertText(
                text: string,
                selectionOffsets?: MarkdownSelectionOffsets | null,
            ) {
                editorRef.current.insertText(text, selectionOffsets);
            },
            insertImage(
                url: string,
                altText?: string,
                selectionOffsets?: MarkdownSelectionOffsets | null,
            ) {
                editorRef.current.insertImage(
                    url,
                    altText,
                    undefined,
                    selectionOffsets,
                );
            },
            getTitle() {
                return titleFromMarkdown(editorRef.current.currentMarkdown);
            },
            getSelectionState(contextChars?: number) {
                return editorRef.current.getSelectionSnapshot(contextChars);
            },
            getMarkdownSelectionOffsets() {
                return editorRef.current.getMarkdownSelectionOffsets();
            },
            subscribe(listener: StoreListener) {
                listenersRef.current.add(listener);

                return () => {
                    listenersRef.current.delete(listener);
                };
            },
        }),
        [],
    );
}

function titleFromMarkdown(markdown: string) {
    const firstLine =
        markdown
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";

    return firstLine.replace(/^#+\s*/u, "");
}

export type { SelectionState };
