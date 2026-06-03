"use client";

import { useCallback, useEffect } from "react";
import type { RefObject } from "react";
import { loadImage } from "@/common/lib/image-storage";
import { tokenize } from "@/common/lib/prism";
import type {
    PendingCliEditorCommand,
    WorkspaceTab,
} from "@/features/workspace/lib/types";
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
    rootPath: string;
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand: PendingCliEditorCommand | null;
    onPendingCliCommandHandled: (commandId: string) => void;
    onSelectionChange: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}

export function EditorPane({
    rootPath,
    tab,
    onMarkdownChange,
    editorViewportRef,
    pendingCliCommand,
    onPendingCliCommandHandled,
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
    onSelectionChange,
}: {
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand: PendingCliEditorCommand | null;
    onPendingCliCommandHandled: (commandId: string) => void;
    onSelectionChange: (
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

    useEffect(() => {
        onSelectionChange(
            tab.tabId,
            (bridge.selection as Record<string, unknown> | null) ?? null,
        );
    }, [bridge.selection, onSelectionChange, tab.tabId]);

    useEffect(() => {
        if (!pendingCliCommand || pendingCliCommand.tabId !== tab.tabId) {
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
                    onKeyDownCapture={handleEditorKeyDownCapture}
                >
                    <DOMD />
                </div>
            </div>
        </div>
    );
}
