"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    getSelectionState,
    getDocumentSelectionRange,
    insertImage,
    insertText,
    replaceRange,
    resetMD,
    setSelectionRange,
    toMarkdown,
    useEditor,
    useEditorStoreApi,
    useRenderData,
} from "../components/editor-kernel-adapter";
import type { EditorBridgeState } from "../lib/editor-types";
import type {
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
    MdxEditorLayoutSource,
} from "../../../packages/mdx-editor";
import {
    renderWikilinksForEditor,
    restoreWikilinksFromEditor,
} from "../lib/wikilink-markdown";

export interface UseEditorBridgeOptions {
    tabId: string;
    markdown?: string;
    onMarkdownChange: (tabId: string, markdown: string) => void;
}

export interface EditorBridge {
    editor: ReturnType<typeof useEditor>;
    editorStore: ReturnType<typeof useEditorStoreApi>;
    currentMarkdown: string;
    selection: EditorBridgeState["selection"];
    focus: () => void;
    getDocumentSelectionRange: () => DocumentSelectionRange | null;
    getLayoutSource: () => MdxEditorLayoutSource | null;
    insertText: (
        text: string,
        selectionOffsets?: MarkdownSelectionOffsets | null,
    ) => void;
    replaceRange: (input: { from: number; to: number; text: string }) => void;
    setSelectionRange: (range: DocumentSelectionRange) => void;
    insertImage: (
        url: string,
        altText?: string,
        selectionRange?: DocumentSelectionRange | null,
    ) => void;
}

export function useEditorBridge({
    tabId,
    markdown,
    onMarkdownChange,
}: UseEditorBridgeOptions): EditorBridge {
    const editor = useEditor();
    const editorStore = useEditorStoreApi();
    const renderData = useRenderData();
    const [selection, setSelection] = useState<EditorBridgeState["selection"]>(
        null,
    );
    const loadedMarkdownRef = useRef<string | null>(null);
    const emittedMarkdownRef = useRef<string>("");
    const skipNextMarkdownEmissionRef = useRef(false);
    const disposedRef = useRef(false);

    useEffect(() => {
        disposedRef.current = false;

        return () => {
            disposedRef.current = true;
        };
    }, []);

    useEffect(() => {
        if (!editorStore || markdown === undefined) {
            return;
        }

        if (
            loadedMarkdownRef.current === markdown ||
            emittedMarkdownRef.current === markdown
        ) {
            loadedMarkdownRef.current = markdown;
            return;
        }

        resetMD(editorStore, renderWikilinksForEditor(markdown));
        loadedMarkdownRef.current = markdown;
        emittedMarkdownRef.current = markdown;
        skipNextMarkdownEmissionRef.current = true;
        queueMicrotask(() => {
            if (!disposedRef.current) {
                setSelection(getSelectionState(editorStore));
            }
        });
    }, [editorStore, markdown, tabId]);

    useEffect(() => {
        if (!editorStore) {
            return;
        }

        const syncSelection = () => {
            setSelection(getSelectionState(editorStore));
        };

        syncSelection();

        return editorStore.subscribe(() => {
            syncSelection();
        });
    }, [editorStore]);

    const rawMarkdown = toMarkdown(renderData) ?? "";
    const currentMarkdown = useMemo(
        () => restoreWikilinksFromEditor(rawMarkdown),
        [rawMarkdown],
    );

    useEffect(() => {
        if (!editorStore) {
            return;
        }

        if (currentMarkdown === emittedMarkdownRef.current) {
            skipNextMarkdownEmissionRef.current = false;
            return;
        }

        if (skipNextMarkdownEmissionRef.current) {
            skipNextMarkdownEmissionRef.current = false;
            emittedMarkdownRef.current = currentMarkdown;
            return;
        }

        emittedMarkdownRef.current = currentMarkdown;
        onMarkdownChange(tabId, currentMarkdown);
    }, [currentMarkdown, editorStore, onMarkdownChange, tabId]);

    const focus = useCallback(() => {
        editor?.focus();
    }, [editor]);

    const insertPlainText = useCallback(
        (text: string, selectionOffsets?: MarkdownSelectionOffsets | null) => {
            insertText(editorStore, text, selectionOffsets);
        },
        [editorStore],
    );

    const replacePlainTextRange = useCallback(
        (input: { from: number; to: number; text: string }) => {
            replaceRange(editorStore, input);
        },
        [editorStore],
    );
    const setDocumentSelectionRange = useCallback(
        (range: DocumentSelectionRange) => {
            setSelectionRange(editorStore, range);
        },
        [editorStore],
    );

    const insertImageAtCursor = useCallback(
        (
            url: string,
            altText?: string,
            selectionRange?: DocumentSelectionRange | null,
        ) => {
            insertImage(editorStore, url, altText, selectionRange);
        },
        [editorStore],
    );

    const getCurrentDocumentSelectionRange = useCallback(
        () => getDocumentSelectionRange(editorStore),
        [editorStore],
    );
    const getLayoutSource = useCallback(
        () => editorStore?.getLayoutSource() ?? null,
        [editorStore],
    );

    return {
        editor,
        editorStore,
        currentMarkdown,
        selection,
        focus,
        getDocumentSelectionRange: getCurrentDocumentSelectionRange,
        getLayoutSource,
        insertText: insertPlainText,
        replaceRange: replacePlainTextRange,
        setSelectionRange: setDocumentSelectionRange,
        insertImage: insertImageAtCursor,
    };
}
