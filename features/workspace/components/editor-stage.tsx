"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { EditorPane } from "@/features/editor/components/editor-pane";
import type {
  PendingCliEditorCommand,
  WorkspaceAction,
  WorkspaceTab,
} from "../lib/types";

interface EditorStageProps {
  rootPath: string;
  activeTab: WorkspaceTab | null;
  dispatch: (action: WorkspaceAction) => void;
  editorViewportRef?: RefObject<HTMLDivElement | null>;
  pendingCliCommand: PendingCliEditorCommand | null;
  onPendingCliCommandHandled: (commandId: string) => void;
  onSelectionChange: (
    tabId: string,
    selection: Record<string, unknown> | null,
  ) => void;
}

export function EditorStage({
  rootPath,
  activeTab,
  dispatch,
  editorViewportRef,
  pendingCliCommand,
  onPendingCliCommandHandled,
  onSelectionChange,
}: EditorStageProps) {
  const [loadError, setLoadError] = useState<{
    tabId: string;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!activeTab || activeTab.markdown !== undefined) {
      return;
    }

    let cancelled = false;
    const loadingTab = activeTab;

    async function loadMarkdown() {
      try {
        const { invoke } = await tauriCore();
        const markdown = await invoke<string>("read_markdown_file", {
          rootPath,
          path: loadingTab.path,
        });

        if (cancelled) {
          return;
        }

        dispatch({
          type: "tab/saved",
          tabId: loadingTab.tabId,
          markdown,
        });
        setLoadError((current) =>
          current?.tabId === loadingTab.tabId ? null : current,
        );
      } catch (error) {
        if (!cancelled) {
          setLoadError({
            tabId: loadingTab.tabId,
            text: formatError(error, "加载文件失败。"),
          });
        }
      }
    }

    void loadMarkdown();

    return () => {
      cancelled = true;
    };
  }, [activeTab, dispatch, rootPath]);

  const handleMarkdownChange = useCallback(
    (tabId: string, markdown: string) => {
      dispatch({
        type: "tab/contentChanged",
        tabId,
        markdown,
      });
    },
    [dispatch],
  );

  if (!activeTab) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-base-100 px-6 text-sm text-base-content/50">
        选择一个 Markdown 文件开始编辑。
      </section>
    );
  }

  const activeLoadError =
    loadError?.tabId === activeTab.tabId ? loadError.text : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base-100">
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.markdown === undefined ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/50">
            {activeLoadError ?? "正在加载文件..."}
          </div>
        ) : (
          <EditorPane
            rootPath={rootPath}
            tab={activeTab}
            onMarkdownChange={handleMarkdownChange}
            editorViewportRef={editorViewportRef}
            pendingCliCommand={pendingCliCommand}
            onPendingCliCommandHandled={onPendingCliCommandHandled}
            onSelectionChange={onSelectionChange}
          />
        )}
      </div>
    </section>
  );
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  if (typeof error === "string" && error.length > 0) {
    return `${fallback} ${error}`;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}
