"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    getSelectionState,
    getDocumentSelectionRange,
    insertImage,
    insertText,
    resetMD,
    toMarkdown,
    useEditor,
    useEditorStoreApi,
    useRenderData,
} from "../components/editor-kernel-adapter";
import type { EditorBridgeState } from "../lib/editor-types";
import type {
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
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

export function useEditorBridge({
    tabId,
    markdown,
    onMarkdownChange,
}: UseEditorBridgeOptions) {
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

    return {
        editor,
        editorStore,
        currentMarkdown,
        selection,
        focus,
        getDocumentSelectionRange: getCurrentDocumentSelectionRange,
        insertText: insertPlainText,
        insertImage: insertImageAtCursor,
    };
}
