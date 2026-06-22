"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
    insertImageNode,
    insertImageMarkdown,
} from "../commands/editor-commands";
import { selectionSnapshotFromMarkdownOffsets } from "../core/selection";
import type {
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
    SelectionState,
} from "../core/types";
import {
    createMdxEditorKernel,
    type MdxEditorKernel,
} from "../kernel";
import type { CodeTokenizer } from "../plugins/editor-code-highlight";
import { defaultMarkdownSyntax } from "../syntax/default";
import { MdxEditorContext } from "./mdx-editor-context";
import { hydrateRenderedImages } from "./node-views";

export interface MdxEditorProviderProps {
    children?: ReactNode;
    editable?: boolean;
    initialMarkdown: string;
    placeholder?: string;
    imageLoader?: (src: string) => Promise<string>;
    codeTokenizer?: (code: string, lang?: string) => unknown[];
    kernel?: MdxEditorKernel;
    onMarkdownChange?: (markdown: string) => void;
    onSelectionChange?: (selection: DocumentSelectionRange | null) => void;
}

export function MdxEditorProvider({
    children,
    editable = true,
    initialMarkdown,
    placeholder,
    imageLoader,
    codeTokenizer,
    kernel,
    onMarkdownChange,
    onSelectionChange,
}: MdxEditorProviderProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const imageLoaderRef = useRef(imageLoader);
    const codeTokenizerRef = useRef(codeTokenizer);
    const onMarkdownChangeRef = useRef(onMarkdownChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const appliedInitialMarkdownRef = useRef(initialMarkdown);
    const tokenizeCode = useCallback<CodeTokenizer>((code, lang) => {
        return codeTokenizerRef.current?.(code, lang) ?? [];
    }, []);
    const hasImageLoader = imageLoader !== undefined;
    const resolveImageSource = useCallback((src: string) => {
        const currentImageLoader = imageLoaderRef.current;

        if (!currentImageLoader) {
            return Promise.reject(new Error("Image loader unavailable"));
        }

        return currentImageLoader(src);
    }, []);
    const runtimeKernel = useMemo(
        () =>
            kernel ??
            createMdxEditorKernel({
                syntax: defaultMarkdownSyntax(),
                services: {
                    codeTokenizer: tokenizeCode,
                    ...(hasImageLoader
                        ? { imageLoader: resolveImageSource }
                        : {}),
                },
            }),
        [hasImageLoader, kernel, resolveImageSource, tokenizeCode],
    );
    const initialDocument = useMemo(
        () => runtimeKernel.parseMarkdown(initialMarkdown),
        [initialMarkdown, runtimeKernel],
    );
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const [selection, setSelection] = useState<SelectionState>(() =>
        createSelectionSnapshot(initialDocument.doc, Selection.atEnd(initialDocument.doc)),
    );
    const [rootNode, setRootNode] = useState<HTMLDivElement | null>(null);
    const parsedRef = useRef(initialDocument);
    const markdownRef = useRef(initialMarkdown);
    const selectionOffsetsRef = useRef(
        selectionOffsetsFromDocSelection(
            initialDocument.doc,
            Selection.atEnd(initialDocument.doc),
        ),
    );

    useEffect(() => {
        onMarkdownChangeRef.current = onMarkdownChange;
    }, [onMarkdownChange]);

    useEffect(() => {
        onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);

    useEffect(() => {
        imageLoaderRef.current = imageLoader;

        if (viewRef.current) {
            void hydrateRenderedImages(
                viewRef.current.dom,
                runtimeKernel.resolveImageSource,
            );
        }
    }, [imageLoader, runtimeKernel]);

    useEffect(() => {
        codeTokenizerRef.current = codeTokenizer;
        viewRef.current?.dispatch(viewRef.current.state.tr);
    }, [codeTokenizer]);

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
            onSelectionChangeRef.current?.(
                documentSelectionRangeFromSelection(state.selection),
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
            const parsed = runtimeKernel.parseMarkdown(nextMarkdown);
            parsedRef.current = parsed;
            updateMarkdown(nextMarkdown, emitChange);
            selectionOffsetsRef.current = selectionOffsetsFromDocSelection(
                parsed.doc,
                Selection.atEnd(parsed.doc),
            );

            if (viewRef.current) {
                let nextState = createEditorState(parsed.doc, runtimeKernel);
                nextState = nextState.apply(
                    nextState.tr.setSelection(Selection.atEnd(nextState.doc)),
                );
                viewRef.current.updateState(nextState);
                updateSelectionFromState(nextState);
            } else {
                onSelectionChangeRef.current?.(
                    documentSelectionRangeFromSelection(
                        Selection.atEnd(parsed.doc),
                    ),
                );
                setSelection(
                    createSelectionSnapshot(
                        parsed.doc,
                        Selection.atEnd(parsed.doc),
                    ),
                );
            }
        },
        [runtimeKernel, updateMarkdown, updateSelectionFromState],
    );

    useEffect(() => {
        if (initialMarkdown === appliedInitialMarkdownRef.current) {
            return;
        }

        appliedInitialMarkdownRef.current = initialMarkdown;
        rebuildEditorFromMarkdown(initialMarkdown, false);
    }, [initialMarkdown, rebuildEditorFromMarkdown]);

    useEffect(() => {
        if (!rootNode) {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
            return;
        }

        const parsed = runtimeKernel.parseMarkdown(markdownRef.current);
        parsedRef.current = parsed;
        let initialState = createEditorState(parsed.doc, runtimeKernel);
        initialState = initialState.apply(
            initialState.tr.setSelection(Selection.atEnd(initialState.doc)),
        );
        const view = new EditorView(rootNode, {
            state: initialState,
            editable: () => editable,
            nodeViews: runtimeKernel.createNodeViews(),
            dispatchTransaction(transaction) {
                const nextState = view.state.apply(transaction);
                view.updateState(nextState);

                const serializedMarkdown = runtimeKernel.serializeMarkdown({
                    ...parsedRef.current,
                    doc: nextState.doc,
                });
                const nextMarkdown = alignTerminalNewline(
                    markdownRef.current,
                    serializedMarkdown,
                );
                parsedRef.current = {
                    ...parsedRef.current,
                    doc: nextState.doc,
                };

                updateMarkdown(nextMarkdown);
                updateSelectionFromState(nextState);
                void hydrateRenderedImages(
                    view.dom,
                    runtimeKernel.resolveImageSource,
                );
            },
        });

        viewRef.current = view;
        updateSelectionFromState(view.state);
        void hydrateRenderedImages(view.dom, runtimeKernel.resolveImageSource);

        return () => {
            view.destroy();
            if (viewRef.current === view) {
                viewRef.current = null;
            }
        };
    }, [editable, rootNode, runtimeKernel, updateMarkdown, updateSelectionFromState]);

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
            insertText: (
                text: string,
                selectionOffsets?: MarkdownSelectionOffsets | null,
            ) => {
                const targetSelection =
                    selectionOffsets ?? selectionOffsetsRef.current;
                rebuildEditorFromMarkdown(
                    replaceMarkdownRange(
                        markdownRef.current,
                        targetSelection.anchor,
                        targetSelection.head,
                        text,
                    ),
                );
            },
            insertImage: (
                url: string,
                altText = "",
                title?: string,
                selectionRange?: DocumentSelectionRange | null,
            ) => {
                if (viewRef.current) {
                    insertImageNode(url, altText, title, selectionRange)(
                        viewRef.current.state,
                        viewRef.current.dispatch,
                        viewRef.current,
                    );
                    return;
                }

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
            getDocumentSelectionRange: () =>
                viewRef.current
                    ? documentSelectionRangeFromSelection(
                          viewRef.current.state.selection,
                      )
                    : null,
            registerRoot,
        }),
        [markdown, rebuildEditorFromMarkdown, registerRoot, selection],
    );

    return (
        <MdxEditorContext.Provider value={value}>{children}</MdxEditorContext.Provider>
    );
}

function documentSelectionRangeFromSelection(selection: Selection) {
    return {
        anchor: selection.anchor,
        head: selection.head,
    };
}

function alignTerminalNewline(previousMarkdown: string, nextMarkdown: string) {
    if (!previousMarkdown.endsWith("\n") && nextMarkdown.endsWith("\n")) {
        return nextMarkdown.slice(0, -1);
    }

    return nextMarkdown;
}

function createEditorState(
    doc: EditorState["doc"],
    runtimeKernel: MdxEditorKernel,
) {
    return EditorState.create({
        schema: runtimeKernel.schema,
        doc,
        plugins: runtimeKernel.createEditorPlugins(),
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
    if (node.type.name === "math_inline") {
        return `$${String(node.attrs.latex ?? "")
            .replaceAll("\\", "\\\\")
            .replaceAll("$", "\\$")}$`;
    }

    if (node.type.name === "footnote_ref") {
        return `[^${String(node.attrs.label ?? "")
            .replaceAll("\\", "\\\\")
            .replaceAll("[", "\\[")
            .replaceAll("]", "\\]")}]`;
    }

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
