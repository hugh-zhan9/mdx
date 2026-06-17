"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
    insertImageMarkdown,
    insertPlainTextMarkdown,
} from "../commands/editor-commands";
import { selectionSnapshotFromMarkdownOffsets } from "../core/selection";
import type { SelectionState } from "../core/types";
import { MdxEditorContext } from "./mdx-editor-context";

export interface MdxEditorProviderProps {
    children?: ReactNode;
    editable?: boolean;
    initialMarkdown: string;
    placeholder?: string;
    imageLoader?: (src: string) => Promise<string>;
    codeTokenizer?: (code: string, lang?: string) => unknown[];
    onMarkdownChange?: (markdown: string) => void;
}

export function MdxEditorProvider({
    children,
    initialMarkdown,
    onMarkdownChange,
}: MdxEditorProviderProps) {
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const [selection, setSelection] = useState<SelectionState>(() =>
        createCollapsedSelection(initialMarkdown, initialMarkdown.length),
    );
    const rootRef = useRef<HTMLDivElement | null>(null);
    const cursorRef = useRef(initialMarkdown.length);

    const updateMarkdown = useCallback(
        (next: string) => {
            setMarkdown(next);
            onMarkdownChange?.(next);
        },
        [onMarkdownChange],
    );

    const value = useMemo(
        () => ({
            currentMarkdown: markdown,
            selection,
            focus: () => rootRef.current?.focus(),
            resetMarkdown: (nextMarkdown: string) => {
                cursorRef.current = nextMarkdown.length;
                setSelection(
                    createCollapsedSelection(nextMarkdown, cursorRef.current),
                );
                updateMarkdown(nextMarkdown);
            },
            insertText: (text: string) => {
                const next = insertPlainTextMarkdown(
                    markdown,
                    cursorRef.current,
                    text,
                );

                cursorRef.current += text.length;
                setSelection(createCollapsedSelection(next, cursorRef.current));
                updateMarkdown(next);
            },
            insertImage: (url: string, altText = "") => {
                const next = insertImageMarkdown(
                    markdown,
                    cursorRef.current,
                    url,
                    altText,
                );

                cursorRef.current += next.length - markdown.length;
                setSelection(createCollapsedSelection(next, cursorRef.current));
                updateMarkdown(next);
            },
            getSelectionSnapshot: (contextChars?: number) =>
                selectionSnapshotFromMarkdownOffsets(
                    markdown,
                    cursorRef.current,
                    cursorRef.current,
                    contextChars,
                ),
        }),
        [markdown, selection, updateMarkdown],
    );

    return (
        <MdxEditorContext.Provider value={value}>
            <div
                ref={rootRef}
                data-mdx-editor-root
                data-mdx-node-type="doc"
                tabIndex={0}
            >
                {children}
            </div>
        </MdxEditorContext.Provider>
    );
}

function createCollapsedSelection(
    markdown: string,
    offset: number,
    contextChars?: number,
): SelectionState {
    return selectionSnapshotFromMarkdownOffsets(
        markdown,
        offset,
        offset,
        contextChars,
    );
}
