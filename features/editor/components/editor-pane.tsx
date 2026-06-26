"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { normalizeLayoutDocument } from "../../../packages/mdx-editor/layout-ir/normalizer";
import type { DocumentSelectionRange } from "../../../packages/mdx-editor";
import { useMdxEditor } from "../../../packages/mdx-editor";
import { HybridEditorHost } from "../../../packages/mdx-editor/react/hybrid-editor-host";
import type { LayoutSnapshot } from "../../../packages/mdx-editor/react/wasm-layout-bridge";
import { loadImage } from "../../../common/lib/image-storage";
import { tokenize } from "../../../common/lib/prism";
import type {
    PendingCliEditorCommand,
    WorkspaceTab,
} from "../../workspace/lib/types";
import { findWikilinkAtTextOffset } from "../../workspace/lib/wikilink";
import { EditorKernelProvider } from "./editor-kernel-adapter";
import { EditorFindBar } from "./editor-find-bar";
import { useEditorBridge } from "../hooks/use-editor-bridge";
import { useEditorFindReplace } from "../hooks/use-editor-find-replace";
import { MDX_EDITOR_ROOT_SELECTOR } from "../lib/editor-dom-contract";
import {
    elementFromNode,
    isSelectAllShortcut,
    resolveScopedSelectAllTarget,
    selectElementContents,
    shouldUseNativeSelectAllTarget,
} from "../lib/keyboard-selection-scope";
import { scrollMarkdownLineIntoView } from "../lib/markdown-line-scroll";
import { wikilinkTargetFromEditorHref } from "../lib/wikilink-markdown";

const EMPTY_LAYOUT_SNAPSHOT: LayoutSnapshot = {
    revision: 0,
    lines: [],
    canvasDrawOps: [],
    hitTestEntries: [],
    caretAnchors: [],
    selectionGeometries: [],
    mirrorBlocks: [],
};

type SnapshotData = { [key: string]: boolean | number | string | null | SnapshotData };

export function snapshotFromMarkdown(markdown: string): LayoutSnapshot {
    const document = normalizeLayoutDocument(markdown, {
        width: 800,
        height: 600,
        devicePixelRatio: 1,
    });
    let y = 0;
    const canvasDrawOps: LayoutSnapshot["canvasDrawOps"] = [];
    const mirrorBlocks: LayoutSnapshot["mirrorBlocks"] = [];
    const lines = document.blocks.map((block, index) => {
        let left = 0;
        if (block.kind === "mermaid") {
            const code = block.inlines.map((inline) => inline.text).join("");
            const semanticCode = `${code}\n`;
            const width = Math.max(
                Math.max(...code.split("\n").map((line) => line.length), 1) *
                    (block.style.fontSize * 0.6),
                1,
            );
            const lineCount = Math.max(code.split("\n").length, 1);
            const height =
                block.style.fontSize * block.style.lineHeight * lineCount;

            canvasDrawOps.push({
                blockId: block.blockId,
                kind: "mermaid",
                x: 0,
                y,
                width,
                height,
                data: {
                    code,
                    ariaHiddenText: true,
                },
            });
            mirrorBlocks.push({
                blockId: block.blockId,
                pmFrom: block.pmFrom,
                pmTo: block.pmTo,
                semanticText: semanticCode,
                ariaLabel: `mermaid ${code}`,
            });

            const line = {
                id: `line-${index}`,
                blockId: block.blockId,
                y,
                baseline: y + block.style.fontSize,
                height,
                textRuns: [],
            };
            y += line.height;
            return line;
        }

        if (block.kind === "image") {
            const markdown = block.inlines.map((inline) => inline.text).join("");
            const image = parseImageBlockMarkdown(markdown);
            const width = 240;
            const height = 160;

            canvasDrawOps.push({
                blockId: block.blockId,
                kind: "image",
                x: 0,
                y,
                width,
                height,
                data: {
                    src: image.src,
                    alt: image.alt,
                    title: image.title,
                },
            });

            const line = {
                id: `line-${index}`,
                blockId: block.blockId,
                y,
                baseline: y + block.style.fontSize,
                height,
                textRuns: [],
            };
            y += line.height;
            return line;
        }

        if (block.kind === "fallback" || block.kind === "html") {
            const markdown = block.inlines.map((inline) => inline.text).join("");
            const width = Math.max(markdown.length * (block.style.fontSize * 0.6), 1);
            const height = block.style.fontSize * block.style.lineHeight;

            const data: SnapshotData =
                block.kind === "html" ? { markdown, html: markdown } : { markdown };

            canvasDrawOps.push({
                blockId: block.blockId,
                kind: block.kind,
                x: 0,
                y,
                width,
                height,
                data,
            });

            const line = {
                id: `line-${index}`,
                blockId: block.blockId,
                y,
                baseline: y + block.style.fontSize,
                height,
                textRuns: [],
            };
            y += line.height;
            return line;
        }

        const textRuns = block.inlines.flatMap((inline) => {
            const width = Math.max(
                inline.text.length * (block.style.fontSize * 0.6),
                1,
            );

            if (inline.kind === "math_inline") {
                const mirrorBlockId = `${block.blockId}-math-${inline.from}-${inline.to}`;
                const pmFrom = block.pmFrom + inline.from;
                const pmTo = block.pmFrom + inline.to;
                canvasDrawOps.push({
                    blockId: mirrorBlockId,
                    kind: "math",
                    x: left,
                    y,
                    width,
                    height: block.style.fontSize * block.style.lineHeight,
                    data: {
                        content: inline.text,
                        latex: inline.text,
                    },
                });
                mirrorBlocks.push({
                    blockId: mirrorBlockId,
                    pmFrom,
                    pmTo,
                    semanticText: inline.text,
                    ariaLabel: `math ${inline.text}`,
                });
                left += width;
                return [];
            }

            const run = {
                blockId: block.blockId,
                pmFrom: block.pmFrom + inline.from,
                pmTo: block.pmFrom + inline.to,
                left,
                baseline: y + block.style.fontSize,
                width,
                height: block.style.fontSize * block.style.lineHeight,
                fontFamily: block.style.fontFamily,
                fontSize: block.style.fontSize,
                text: inline.text,
            };
            left += width;
            return [run];
        });
        const line = {
            id: `line-${index}`,
            blockId: block.blockId,
            y,
            baseline: y + block.style.fontSize,
            height: block.style.fontSize * block.style.lineHeight,
            textRuns,
        };
        y += line.height;
        return line;
    });

    return {
        revision: document.revision,
        lines,
        canvasDrawOps,
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks,
    };
}

function parseImageBlockMarkdown(markdown: string) {
    const match = markdown.match(/^!\[([^\]]*)\]\((\S+)(?:\s+"([^"]*)")?\)$/u);

    return {
        alt: match?.[1] ?? "",
        src: match?.[2] ?? "",
        title: match?.[3] ?? "",
    };
}

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

function CurrentProductEditorRoot() {
    const { registerRoot } = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        registerRoot(rootRef.current);

        return () => {
            registerRoot(null);
        };
    }, [registerRoot]);

    return (
        <div
            ref={rootRef}
            data-mdx-editor-root
            aria-hidden="true"
            className="absolute inset-0 z-10 opacity-0 caret-transparent"
            tabIndex={-1}
        />
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
    const handleImageLoad = useCallback(
        (src: string) =>
            loadImage(src, {
                rootPath,
                currentFilePath: tab.path,
            }),
        [rootPath, tab.path],
    );
    const handleCodeTokenize = useCallback(
        (code: string, lang?: string) => tokenize(code, lang),
        [],
    );

    return (
        <EditorKernelProvider
            key={tab.tabId}
            editable
            initMd={initMd}
            placeholder="开始编写 Markdown"
            imageLoader={handleImageLoad}
            codeTokenizer={handleCodeTokenize}
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
        </EditorKernelProvider>
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
    const { focus, getDocumentSelectionRange, insertImage, insertText } = bridge;
    const contentRootRef = useRef<HTMLDivElement | null>(null);
    const [contentRootNode, setContentRootNode] =
        useState<HTMLDivElement | null>(null);
    const [editorDomRevision, setEditorDomRevision] = useState(0);
    const findReplace = useEditorFindReplace({
        editorRoot: contentRootNode,
        focusEditor: focus,
        markdown: bridge.currentMarkdown,
        replaceSelectedText: insertText,
        visibilityRevision: editorDomRevision,
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
        },
        [],
    );
    const storeAndInsertImages = useCallback(
        async (files: File[]) => {
            if (!storeImage || files.length === 0) {
                return;
            }

            let insertionSelection = getDocumentSelectionRange();
            for (const file of files) {
                const stored = await storeImage(file);
                insertImage(stored.url, stored.altText, insertionSelection);
                insertionSelection =
                    nextImageInsertionSelection(insertionSelection);
            }
        },
        [getDocumentSelectionRange, insertImage, storeImage],
    );
    const handleEditorKeyDownCapture = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
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

            if (
                findReplace.state.isOpen &&
                event.key === "Enter" &&
                !(event.nativeEvent as KeyboardEvent & { isComposing?: boolean })
                    .isComposing
            ) {
                event.preventDefault();
                event.stopPropagation();
                if (event.shiftKey) {
                    goPrevious();
                    return;
                }

                goNext();
                return;
            }

            if (!isSelectAllShortcut(event.nativeEvent)) {
                return;
            }

            const eventTarget =
                event.target instanceof HTMLElement ? event.target : null;
            if (shouldUseNativeSelectAllTarget(eventTarget)) {
                return;
            }

            const selectTarget = resolveScopedSelectAllTarget(
                eventTarget,
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
        [findReplace.state.isOpen, goNext, goPrevious, openFind, openReplace],
    );
    const handleEditorClickCapture = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
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
        [onOpenWikilink, tab.path],
    );
    const handlePasteCapture = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            if (!storeImage) {
                return;
            }

            const imageFiles = imageFilesFromDataTransfer(event.clipboardData);
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
    const handleCopyCapture = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            const selection = window.getSelection?.();
            if (!selection || selection.rangeCount === 0) {
                return;
            }

            const anchorNode = selection.anchorNode;
            const anchorElement =
                anchorNode instanceof Element
                    ? anchorNode
                    : anchorNode?.parentElement ?? null;
            if (
                !anchorElement?.closest("[data-layout-light-mirror]") ||
                !event.clipboardData
            ) {
                return;
            }

            const text = selection.toString();
            if (text.length === 0) {
                return;
            }

            event.preventDefault();
            event.clipboardData.setData("text/plain", text);
        },
        [],
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

            const imageFiles = imageFilesFromDataTransfer(event.dataTransfer);
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
        if (!contentRootNode) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            if (mutations.some(isSearchRelevantContentMutation)) {
                setEditorDomRevision((revision) => revision + 1);
            }
        });

        observer.observe(contentRootNode, {
            childList: true,
            subtree: true,
        });

        return () => {
            observer.disconnect();
        };
    }, [contentRootNode]);

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

    const layoutSnapshot =
        bridge.currentMarkdown.trim().length > 0
            ? snapshotFromMarkdown(bridge.currentMarkdown)
            : EMPTY_LAYOUT_SNAPSHOT;

    return (
        <div className="flex h-full min-h-0 flex-col">
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
                data-mdx-editor-shell=""
                ref={handleViewportRef}
                className="flex min-h-0 flex-1 justify-center overflow-auto bg-[var(--mdx-content-bg)]"
            >
                <div
                    data-mdx-editor-column=""
                    ref={handleEditorContentRef}
                    className="min-h-full w-full max-w-[var(--mdx-editor-max-width)] px-6 pb-[35vh] pt-7 sm:px-8 sm:pb-[35vh] sm:pt-10"
                    onClickCapture={handleEditorClickCapture}
                    onCopyCapture={handleCopyCapture}
                    onDragOverCapture={handleDragOverCapture}
                    onDropCapture={handleDropCapture}
                    onKeyDownCapture={handleEditorKeyDownCapture}
                    onPasteCapture={handlePasteCapture}
                >
                    <div className="relative h-full w-full">
                        <HybridEditorHost snapshot={layoutSnapshot} />
                        <CurrentProductEditorRoot />
                    </div>
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
    const container = parent?.closest("[data-mdx-node-type]") ?? parent;

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

export function imageFilesFromDataTransfer(dataTransfer: DataTransfer) {
    const files = imageFilesFromList(dataTransfer.files);
    if (files.length > 0) {
        return files;
    }

    return Array.from(dataTransfer.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
}

function imageFilesFromList(files: FileList) {
    return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function dataTransferHasImage(dataTransfer: DataTransfer) {
    return (
        imageFilesFromList(dataTransfer.files).length > 0 ||
        Array.from(dataTransfer.items).some(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
    );
}

function nextImageInsertionSelection(
    selection: DocumentSelectionRange | null,
): DocumentSelectionRange | null {
    if (!selection) {
        return null;
    }

    const start = Math.min(selection.anchor, selection.head);
    const nextOffset = start + 1;

    return {
        anchor: nextOffset,
        head: nextOffset,
    };
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

function isSearchRelevantContentMutation(mutation: MutationRecord) {
    return !mutationNodesAreInsideHybridHost(mutation);
}

function mutationNodesAreInsideHybridHost(mutation: MutationRecord) {
    const changedNodes = [
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes),
    ];

    if (changedNodes.length > 0) {
        return changedNodes.every((node) => isNodeInsideHybridHost(node));
    }

    return isNodeInsideHybridHost(mutation.target);
}

function isNodeInsideHybridHost(node: Node) {
    return node instanceof HTMLElement
        ? Boolean(node.closest("[data-hybrid-editor-host]"))
        : Boolean(node.parentElement?.closest("[data-hybrid-editor-host]"));
}
