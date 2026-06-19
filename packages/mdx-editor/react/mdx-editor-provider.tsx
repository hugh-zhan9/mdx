"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
    insertImageMarkdown,
} from "../commands/editor-commands";
import { selectionSnapshotFromMarkdownOffsets } from "../core/selection";
import type { SelectionState } from "../core/types";
import { parseMarkdown } from "../parser/parse-markdown";
import { createMdxEditorPlugins } from "../plugins/editor-plugins";
import { mdxEditorSchema } from "../schema/schema";
import { serializeMarkdown } from "../serializer/serialize-markdown";
import { MdxEditorContext } from "./mdx-editor-context";
import { createMdxNodeViews, hydrateRenderedImages } from "./node-views";

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
    editable = true,
    initialMarkdown,
    placeholder,
    imageLoader,
    onMarkdownChange,
}: MdxEditorProviderProps) {
    const initialParsed = useMemo(
        () => parseMarkdown(initialMarkdown),
        [initialMarkdown],
    );
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const [selection, setSelection] = useState<SelectionState>(() =>
        createSelectionSnapshot(
            initialParsed.doc,
            Selection.atEnd(initialParsed.doc),
        ),
    );
    const [rootNode, setRootNode] = useState<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const parsedRef = useRef(initialParsed);
    const markdownRef = useRef(initialMarkdown);
    const imageLoaderRef = useRef(imageLoader);
    const onMarkdownChangeRef = useRef(onMarkdownChange);
    const selectionOffsetsRef = useRef(
        selectionOffsetsFromDocSelection(
            initialParsed.doc,
            Selection.atEnd(initialParsed.doc),
        ),
    );

    useEffect(() => {
        parsedRef.current = initialParsed;
        markdownRef.current = initialMarkdown;
        selectionOffsetsRef.current = selectionOffsetsFromDocSelection(
            initialParsed.doc,
            Selection.atEnd(initialParsed.doc),
        );
    }, [initialMarkdown, initialParsed]);

    useEffect(() => {
        onMarkdownChangeRef.current = onMarkdownChange;
    }, [onMarkdownChange]);

    useEffect(() => {
        imageLoaderRef.current = imageLoader;

        if (viewRef.current) {
            void hydrateRenderedImages(viewRef.current.dom, imageLoader);
        }
    }, [imageLoader]);

    const updateMarkdown = useCallback(
        (next: string, emitChange = true) => {
            markdownRef.current = next;
            setMarkdown(next);
            if (emitChange) {
                onMarkdownChangeRef.current?.(next);
            }
        },
        [],
    );

    const registerRoot = useCallback((root: HTMLDivElement | null) => {
        rootRef.current = root;
        setRootNode(root);
    }, []);

    const updateSelectionFromState = useCallback(
        (state: EditorState, contextChars?: number) => {
            selectionOffsetsRef.current = selectionOffsetsFromDocSelection(
                state.doc,
                state.selection,
            );
            setSelection(
                createSelectionSnapshot(
                    state.doc,
                    state.selection,
                    contextChars,
                ),
            );
        },
        [],
    );

    const rebuildEditorFromMarkdown = useCallback(
        (nextMarkdown: string, emitChange = true) => {
        const parsed = parseMarkdown(nextMarkdown);
        parsedRef.current = parsed;
        updateMarkdown(nextMarkdown, emitChange);
        selectionOffsetsRef.current = selectionOffsetsFromDocSelection(
            parsed.doc,
            Selection.atEnd(parsed.doc),
        );

        if (viewRef.current) {
            let nextState = createEditorState(parsed.doc);
                nextState = nextState.apply(
                    nextState.tr.setSelection(Selection.atEnd(nextState.doc)),
                );
                viewRef.current.updateState(nextState);
                updateSelectionFromState(nextState);
            } else {
                setSelection(
                    createSelectionSnapshot(
                        parsed.doc,
                        Selection.atEnd(parsed.doc),
                    ),
                );
            }
        },
        [updateMarkdown, updateSelectionFromState],
    );

    useEffect(() => {
        if (!rootNode) {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
            return;
        }

        const parsed = parseMarkdown(markdownRef.current);
        parsedRef.current = parsed;
        let initialState = createEditorState(parsed.doc);
        initialState = initialState.apply(
            initialState.tr.setSelection(Selection.atEnd(initialState.doc)),
        );
        const view = new EditorView(rootNode, {
            state: initialState,
            editable: () => editable,
            nodeViews: createMdxNodeViews(),
            dispatchTransaction(transaction) {
                const nextState = view.state.apply(transaction);
                view.updateState(nextState);

                const nextMarkdown = serializeMarkdown({
                    ...parsedRef.current,
                    doc: nextState.doc,
                });
                parsedRef.current = {
                    ...parsedRef.current,
                    doc: nextState.doc,
                };

                updateMarkdown(nextMarkdown);
                updateSelectionFromState(nextState);
                void hydrateRenderedImages(view.dom, imageLoaderRef.current);
            },
        });

        viewRef.current = view;
        updateSelectionFromState(view.state);
        void hydrateRenderedImages(view.dom, imageLoaderRef.current);

        return () => {
            view.destroy();
            if (viewRef.current === view) {
                viewRef.current = null;
            }
        };
    }, [editable, rootNode, updateMarkdown, updateSelectionFromState]);

    useEffect(() => {
        if (!rootNode) {
            return;
        }

        if (placeholder && markdownRef.current.trim().length === 0) {
            rootNode.setAttribute("data-mdx-placeholder", placeholder);
            rootNode.setAttribute("data-mdx-empty", "true");
            return;
        }

        rootNode.removeAttribute("data-mdx-placeholder");
        rootNode.removeAttribute("data-mdx-empty");
    }, [placeholder, rootNode, markdown]);

    const value = useMemo(
        () => ({
            currentMarkdown: markdown,
            selection,
            focus: () => viewRef.current?.focus() ?? rootRef.current?.focus(),
            resetMarkdown: (nextMarkdown: string) => {
                rebuildEditorFromMarkdown(nextMarkdown, false);
            },
            insertText: (text: string) => {
                rebuildEditorFromMarkdown(
                    replaceMarkdownRange(
                        markdownRef.current,
                        selectionOffsetsRef.current.anchor,
                        selectionOffsetsRef.current.head,
                        text,
                    ),
                );
            },
            insertImage: (url: string, altText = "", title?: string) => {
                const imageMarkdown = insertImageMarkdown(
                    "",
                    0,
                    title
                        ? `${url} "${title.replaceAll('"', '\\"')}"`
                        : url,
                    altText,
                );

                rebuildEditorFromMarkdown(
                    replaceMarkdownRange(
                        markdownRef.current,
                        selectionOffsetsRef.current.anchor,
                        selectionOffsetsRef.current.head,
                        imageMarkdown,
                    ),
                );
            },
            getSelectionSnapshot: (contextChars?: number) =>
                viewRef.current
                    ? createSelectionSnapshot(
                          viewRef.current.state.doc,
                          viewRef.current.state.selection,
                          contextChars,
                      )
                    : selection,
            registerRoot,
        }),
        [markdown, rebuildEditorFromMarkdown, registerRoot, selection],
    );

    return (
        <MdxEditorContext.Provider value={value}>{children}</MdxEditorContext.Provider>
    );
}

function createEditorState(doc: EditorState["doc"]) {
    return EditorState.create({
        schema: mdxEditorSchema,
        doc,
        plugins: createMdxEditorPlugins(),
    });
}

function selectionOffsetsFromDocSelection(
    doc: EditorState["doc"],
    selection: Selection,
) {
    return {
        anchor: doc.textBetween(0, selection.anchor, "\n", markdownLeafText).length,
        head: doc.textBetween(0, selection.head, "\n", markdownLeafText).length,
    };
}

function createSelectionSnapshot(
    doc: EditorState["doc"],
    selection: EditorState["selection"],
    contextChars?: number,
): SelectionState {
    const text = doc.textBetween(0, doc.content.size, "\n", markdownLeafText);
    const { anchor, head } = selectionOffsetsFromDocSelection(doc, selection);

    return selectionSnapshotFromMarkdownOffsets(
        text,
        anchor,
        head,
        contextChars,
    );
}

function markdownLeafText(node: EditorState["doc"]) {
    if (node.type.name !== "image") {
        return "";
    }

    const alt = String(node.attrs.alt ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
    const src = String(node.attrs.src ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll(")", "\\)");
    const title =
        typeof node.attrs.title === "string" && node.attrs.title.length > 0
            ? ` "${node.attrs.title.replaceAll('"', '\\"')}"`
            : "";

    return `![${alt}](${src}${title})`;
}

function replaceMarkdownRange(
    markdown: string,
    anchor: number,
    head: number,
    replacement: string,
) {
    const start = Math.max(0, Math.min(anchor, head));
    const end = Math.max(start, Math.max(anchor, head));

    return `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`;
}
