"use client";

import { useEffect, useMemo } from "react";
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
            placeholder="Start writing markdown"
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
    const statusText = tab.dirty ? "Unsaved changes" : "Saved";
    const selectionText = useMemo(() => {
        if (!bridge.selection) {
            return "No selection";
        }

        return bridge.selection.has_selection
            ? `${bridge.selection.selected_text.length} chars selected`
            : "Cursor ready";
    }, [bridge.selection]);

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
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-base-300 px-3 text-xs text-base-content/55">
                <div className="truncate">{statusText}</div>
                <div className="truncate">{selectionText}</div>
            </div>
            <div
                ref={editorViewportRef}
                className="min-h-0 flex-1 overflow-auto bg-base-100"
            >
                <DOMD />
            </div>
        </div>
    );
}
