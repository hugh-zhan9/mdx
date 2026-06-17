"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { loadImage } from "../../../common/lib/image-storage";
import { tokenize } from "../../../common/lib/prism";
import type {
    PendingCliEditorCommand,
    WorkspaceTab,
} from "../../workspace/lib/types";
import { findWikilinkAtTextOffset } from "../../workspace/lib/wikilink";
import {
    DOMD,
    DOMDProvider,
} from "./editor-kernel-adapter";
import { EditorFindBar } from "./editor-find-bar";
import { EditorMermaidPreviewLayer } from "./editor-mermaid-preview-layer";
import { useEditorBridge } from "../hooks/use-editor-bridge";
import { useEditorFindReplace } from "../hooks/use-editor-find-replace";
import { MDX_EDITOR_ROOT_SELECTOR } from "../lib/editor-dom-contract";
import {
    elementFromNode,
    isSelectAllShortcut,
    resolveScopedSelectAllTarget,
    selectElementContents,
} from "../lib/keyboard-selection-scope";
import { scrollMarkdownLineIntoView } from "../lib/markdown-line-scroll";
import { wikilinkTargetFromEditorHref } from "../lib/wikilink-markdown";
import { SourceModeEditor } from "../../../packages/mdx-editor/react";

interface EditorPaneProps {
    rootPath: string | null;
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    storeImage?: (file: File) => Promise<{ url: string; altText: string }>;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand?: PendingCliEditorCommand | null;
    onPendingCliCommandHandled?: (commandId: string) => void;
    onOpenWikilink?: (target: string, sourcePath: string) => void;
    onSelectionChange?: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}

export interface EditorShortcutLike {
    altKey: boolean;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
}

export function isEditorFindShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyF"
    );
}

export function isEditorReplaceShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyR"
    );
}

export function resolveEditorRootFromContent(
    contentRoot: HTMLElement | null,
): HTMLElement | null {
    return (
        contentRoot?.querySelector<HTMLElement>(MDX_EDITOR_ROOT_SELECTOR) ??
        contentRoot
    );
}

export function assignEditorViewportRef(
    editorViewportRef: RefObject<HTMLDivElement | null> | undefined,
    node: HTMLDivElement | null,
) {
    if (editorViewportRef) {
        editorViewportRef.current = node;
    }
}

export function EditorPane({
    rootPath,
    tab,
    onMarkdownChange,
    storeImage,
    editorViewportRef,
    pendingCliCommand = null,
    onPendingCliCommandHandled,
    onOpenWikilink,
    onSelectionChange,
}: EditorPaneProps) {
    const initMd = tab.markdown ?? "";

    return (
        <DOMDProvider
            key={tab.tabId}
            editable
            initMd={initMd}
            placeholder="开始编写 Markdown"
            imageLoader={(src) =>
                loadImage(src, {
                    rootPath,
                    currentFilePath: tab.path,
                })
            }
            codeTokenizer={(code, lang) => tokenize(code, lang)}
        >
            <EditorPaneInner
                tab={tab}
                onMarkdownChange={onMarkdownChange}
                storeImage={storeImage}
                editorViewportRef={editorViewportRef}
                pendingCliCommand={pendingCliCommand}
                onPendingCliCommandHandled={onPendingCliCommandHandled}
                onOpenWikilink={onOpenWikilink}
                onSelectionChange={onSelectionChange}
            />
        </DOMDProvider>
    );
}

function EditorPaneInner({
    tab,
    onMarkdownChange,
    storeImage,
    editorViewportRef,
    pendingCliCommand,
    onPendingCliCommandHandled,
    onOpenWikilink,
    onSelectionChange,
}: {
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    storeImage?: (file: File) => Promise<{ url: string; altText: string }>;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand?: PendingCliEditorCommand | null;
    onPendingCliCommandHandled?: (commandId: string) => void;
    onOpenWikilink?: (target: string, sourcePath: string) => void;
    onSelectionChange?: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}) {
    const bridge = useEditorBridge({
        tabId: tab.tabId,
        markdown: tab.markdown,
        onMarkdownChange,
    });
    const { focus, insertImage, insertText } = bridge;
    const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");
    const [sourceMarkdown, setSourceMarkdown] = useState(bridge.currentMarkdown);
    const contentRootRef = useRef<HTMLDivElement | null>(null);
    const [contentRootNode, setContentRootNode] =
        useState<HTMLDivElement | null>(null);
    const [editorRoot, setEditorRoot] = useState<HTMLElement | null>(null);
    const [mermaidVisibilityRevision, setMermaidVisibilityRevision] =
        useState(0);
    const handleMermaidVisibilityChange = useCallback(() => {
        setMermaidVisibilityRevision((revision) => revision + 1);
    }, []);
    const findReplace = useEditorFindReplace({
        editorRoot,
        focusEditor: focus,
        markdown: bridge.currentMarkdown,
        replaceSelectedText: insertText,
        visibilityRevision: mermaidVisibilityRevision,
    });
    const {
        close,
        goNext,
        goPrevious,
        openFind,
        openReplace,
        replaceAll,
        replaceCurrent,
        setQuery,
        setReplacement,
        toggleCaseSensitive,
        toggleReplaceExpanded,
    } = findReplace.actions;
    const refreshEditorRoot = useCallback(() => {
        const nextRoot = resolveEditorRootFromContent(contentRootRef.current);

        setEditorRoot((currentRoot) =>
            currentRoot === nextRoot ? currentRoot : nextRoot,
        );
    }, []);
    const handleViewportRef = useCallback(
        (node: HTMLDivElement | null) => {
            assignEditorViewportRef(editorViewportRef, node);
        },
        [editorViewportRef],
    );
    const handleEditorContentRef = useCallback(
        (node: HTMLDivElement | null) => {
            contentRootRef.current = node;
            setContentRootNode((currentNode) =>
                currentNode === node ? currentNode : node,
            );
            refreshEditorRoot();
        },
        [refreshEditorRoot],
    );
    const storeAndInsertImages = useCallback(
        async (files: File[]) => {
            if (!storeImage || files.length === 0) {
                return;
            }

            for (const file of files) {
                const stored = await storeImage(file);
                insertImage(stored.url, stored.altText);
            }
        },
        [insertImage, storeImage],
    );
    const handleEditorKeyDownCapture = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (mode === "source") {
                return;
            }

            if (isEditorFindShortcut(event.nativeEvent)) {
                event.preventDefault();
                event.stopPropagation();
                openFind();
                return;
            }

            if (isEditorReplaceShortcut(event.nativeEvent)) {
                event.preventDefault();
                event.stopPropagation();
                openReplace();
                return;
            }

            if (!isSelectAllShortcut(event.nativeEvent)) {
                return;
            }

            const selectTarget = resolveScopedSelectAllTarget(
                event.target instanceof HTMLElement ? event.target : null,
                event.currentTarget,
                elementFromNode(window.getSelection()?.anchorNode ?? null),
            );
            if (!selectTarget) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            selectElementContents(selectTarget as HTMLElement);
        },
        [mode, openFind, openReplace],
    );
    const handleEditorClickCapture = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (mode === "source") {
                return;
            }

            if (!onOpenWikilink || event.button !== 0) {
                return;
            }

            const target = event.target instanceof Element ? event.target : null;

            const anchor = target?.closest<HTMLAnchorElement>("a[href]");
            const editorWikilink = anchor
                ? wikilinkTargetFromEditorHref(anchor.getAttribute("href") ?? "")
                : null;

            if (editorWikilink) {
                event.preventDefault();
                event.stopPropagation();
                onOpenWikilink(editorWikilink, tab.path);
                return;
            }

            if (target?.closest("a, button, input, textarea, select, pre, code")) {
                return;
            }

            const wikilink = findClickedWikilink(event.nativeEvent);

            if (!wikilink) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onOpenWikilink(wikilink, tab.path);
        },
        [mode, onOpenWikilink, tab.path],
    );
    const handlePasteCapture = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            if (!storeImage) {
                return;
            }

            const imageFiles = imageFilesFromList(event.clipboardData.files);
            if (imageFiles.length === 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void storeAndInsertImages(imageFiles).catch((error) => {
                console.warn("Failed to store pasted image.", error);
            });
        },
        [storeAndInsertImages, storeImage],
    );
    const handleDragOverCapture = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            if (!storeImage || !dataTransferHasImage(event.dataTransfer)) {
                return;
            }

            event.preventDefault();
        },
        [storeImage],
    );
    const handleDropCapture = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            if (!storeImage) {
                return;
            }

            const imageFiles = imageFilesFromList(event.dataTransfer.files);
            if (imageFiles.length === 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void storeAndInsertImages(imageFiles).catch((error) => {
                console.warn("Failed to store dropped image.", error);
            });
        },
        [storeAndInsertImages, storeImage],
    );

    useEffect(() => {
        refreshEditorRoot();
    }, [bridge.currentMarkdown, contentRootNode, refreshEditorRoot]);

    useEffect(() => {
        if (!contentRootNode) {
            return;
        }

        const observer = new MutationObserver(() => {
            refreshEditorRoot();
        });

        observer.observe(contentRootNode, {
            childList: true,
            subtree: true,
        });

        refreshEditorRoot();

        return () => {
            observer.disconnect();
        };
    }, [contentRootNode, refreshEditorRoot]);

    useEffect(() => {
        if (!onSelectionChange) {
            return;
        }

        onSelectionChange(
            tab.tabId,
            (bridge.selection as Record<string, unknown> | null) ?? null,
        );
    }, [bridge.selection, onSelectionChange, tab.tabId]);

    useEffect(() => {
        if (
            !pendingCliCommand ||
            !onPendingCliCommandHandled ||
            pendingCliCommand.tabId !== tab.tabId
        ) {
            return;
        }

        focus();

        if (pendingCliCommand.kind === "insert" && pendingCliCommand.text) {
            insertText(pendingCliCommand.text);
        }

        if (
            pendingCliCommand.kind === "scrollToLine" &&
            pendingCliCommand.lineNumber !== undefined
        ) {
            scrollMarkdownLineIntoView(
                editorViewportRef?.current ?? null,
                bridge.currentMarkdown,
                pendingCliCommand.lineNumber,
            );
        }

        onPendingCliCommandHandled(pendingCliCommand.id);
    }, [
        bridge.currentMarkdown,
        editorViewportRef,
        focus,
        insertText,
        onPendingCliCommandHandled,
        pendingCliCommand,
        tab.tabId,
    ]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-9 items-center justify-end border-b border-base-300 bg-base-100 px-2">
                <div className="join" role="group" aria-label="编辑模式">
                    <button
                        type="button"
                        className={`btn btn-xs join-item ${mode === "wysiwyg" ? "btn-active" : ""}`}
                        aria-pressed={mode === "wysiwyg"}
                        onClick={() => {
                            setMode("wysiwyg");
                            close();
                        }}
                    >
                        所见即所得
                    </button>
                    <button
                        type="button"
                        className={`btn btn-xs join-item ${mode === "source" ? "btn-active" : ""}`}
                        aria-pressed={mode === "source"}
                        onClick={() => {
                            setSourceMarkdown(bridge.currentMarkdown);
                            setMode("source");
                            close();
                        }}
                    >
                        源码
                    </button>
                </div>
            </div>
            {findReplace.state.isOpen ? (
                <EditorFindBar
                    caseSensitive={findReplace.state.caseSensitive}
                    countLabel={findReplace.countLabel}
                    isReplaceExpanded={findReplace.state.isReplaceExpanded}
                    matchCount={findReplace.matchCount}
                    query={findReplace.state.query}
                    replacement={findReplace.state.replacement}
                    onCaseSensitiveToggle={toggleCaseSensitive}
                    onClose={close}
                    onNext={goNext}
                    onPrevious={goPrevious}
                    onQueryChange={setQuery}
                    onReplaceAll={replaceAll}
                    onReplaceCurrent={replaceCurrent}
                    onReplacementChange={setReplacement}
                    onReplaceToggle={toggleReplaceExpanded}
                />
            ) : null}
            <div
                ref={handleViewportRef}
                className="min-h-0 flex-1 overflow-auto bg-base-100"
            >
                <div
                    ref={handleEditorContentRef}
                    className="mx-auto min-h-full w-full max-w-4xl px-6 py-6 sm:px-8 sm:py-8"
                    onClickCapture={handleEditorClickCapture}
                    onDragOverCapture={handleDragOverCapture}
                    onDropCapture={handleDropCapture}
                    onKeyDownCapture={handleEditorKeyDownCapture}
                    onPasteCapture={handlePasteCapture}
                >
                    {mode === "source" ? (
                        <SourceModeEditor
                            markdown={sourceMarkdown}
                            onMarkdownChange={(markdown) => {
                                setSourceMarkdown(markdown);
                                onMarkdownChange(tab.tabId, markdown);
                            }}
                        />
                    ) : (
                        <>
                            <DOMD />
                            <EditorMermaidPreviewLayer
                                editorRoot={editorRoot}
                                markdown={bridge.currentMarkdown}
                                onVisibilityChange={handleMermaidVisibilityChange}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function findClickedWikilink(event: MouseEvent) {
    const caret = caretAtPoint(event.clientX, event.clientY);

    if (!caret) {
        return null;
    }

    const parent =
        caret.node instanceof Element
            ? caret.node
            : caret.node.parentElement;
    const container = parent?.closest("[data-render-id]") ?? parent;

    if (!container) {
        return null;
    }

    const text = container.textContent ?? "";
    const offset = textOffsetWithin(container, caret.node, caret.offset);

    if (offset === null) {
        return null;
    }

    return findWikilinkAtTextOffset(text, offset);
}

function caretAtPoint(x: number, y: number) {
    const documentWithCaret = document as Document & {
        caretPositionFromPoint?: (
            x: number,
            y: number,
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    const position = documentWithCaret.caretPositionFromPoint?.(x, y);

    if (position) {
        return {
            node: position.offsetNode,
            offset: position.offset,
        };
    }

    const range = documentWithCaret.caretRangeFromPoint?.(x, y);

    if (range) {
        return {
            node: range.startContainer,
            offset: range.startOffset,
        };
    }

    return null;
}

function imageFilesFromList(files: FileList) {
    return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function dataTransferHasImage(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.items).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
}

function textOffsetWithin(
    container: Element,
    targetNode: Node,
    targetOffset: number,
) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let current = walker.nextNode();

    while (current) {
        const textLength = current.textContent?.length ?? 0;

        if (current === targetNode) {
            return offset + Math.max(0, Math.min(targetOffset, textLength));
        }

        offset += textLength;
        current = walker.nextNode();
    }

    return null;
}
