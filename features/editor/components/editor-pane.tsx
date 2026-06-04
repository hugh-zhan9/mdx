"use client";

import { useCallback, useEffect } from "react";
import type { RefObject } from "react";
import { loadImage } from "@/common/lib/image-storage";
import { tokenize } from "@/common/lib/prism";
import type {
    PendingCliEditorCommand,
    WorkspaceTab,
} from "@/features/workspace/lib/types";
import { findWikilinkAtTextOffset } from "@/features/workspace/lib/wikilink";
import {
    DOMD,
    DOMDProvider,
} from "./editor-kernel-adapter";
import { useEditorBridge } from "../hooks/use-editor-bridge";
import {
    elementFromNode,
    isSelectAllShortcut,
    resolveScopedSelectAllTarget,
    selectElementContents,
} from "../lib/keyboard-selection-scope";

interface EditorPaneProps {
    rootPath: string | null;
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand?: PendingCliEditorCommand | null;
    onPendingCliCommandHandled?: (commandId: string) => void;
    onOpenWikilink?: (target: string, sourcePath: string) => void;
    onSelectionChange?: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}

export function EditorPane({
    rootPath,
    tab,
    onMarkdownChange,
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
    editorViewportRef,
    pendingCliCommand,
    onPendingCliCommandHandled,
    onOpenWikilink,
    onSelectionChange,
}: {
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
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
    const { focus, insertText } = bridge;
    const handleEditorKeyDownCapture = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        [],
    );
    const handleEditorClickCapture = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!onOpenWikilink || event.button !== 0) {
                return;
            }

            const target = event.target instanceof Element ? event.target : null;

            if (
                target?.closest(
                    "a, button, input, textarea, select, pre, code",
                )
            ) {
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

        onPendingCliCommandHandled(pendingCliCommand.id);
    }, [
        focus,
        insertText,
        onPendingCliCommandHandled,
        pendingCliCommand,
        tab.tabId,
    ]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div
                ref={editorViewportRef}
                className="min-h-0 flex-1 overflow-auto bg-base-100"
            >
                <div
                    className="mx-auto min-h-full w-full max-w-4xl px-6 py-6 sm:px-8 sm:py-8"
                    onClickCapture={handleEditorClickCapture}
                    onKeyDownCapture={handleEditorKeyDownCapture}
                >
                    <DOMD />
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
