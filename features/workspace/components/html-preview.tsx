"use client";

import { useEffect, useState } from "react";
import { TextControlButton } from "@/common/components/ui-controls";
import { tauriCore } from "@/common/lib/tauri";
import {
  HTML_PREVIEW_IFRAME_SANDBOX,
  createSafePreviewHtml,
} from "../lib/html-preview-security";
import { parseMhtmlArchive } from "../lib/mhtml-archive";
import { isMhtmlFilePath } from "../lib/path";

interface HtmlPreviewProps {
  rootPath: string;
  path: string;
}

type HtmlPreviewState =
  | { status: "loading" }
  | { status: "ready"; source: string }
  | { status: "error"; message: string; rawText?: string };

export function HtmlPreview({ rootPath, path }: HtmlPreviewProps) {
  const [state, setState] = useState<HtmlPreviewState>({ status: "loading" });
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadHtmlPreview() {
      setState({ status: "loading" });
      setShowSource(false);

      let rawText: string | undefined;

      try {
        const { invoke } = await tauriCore();
        rawText = await invoke<string>("read_preview_text_file", {
          rootPath,
          path,
        });

        if (cancelled) {
          return;
        }

        const previewHtml = createPreviewHtml(path, rawText);

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(
          new Blob([previewHtml], { type: "text/html" }),
        );
        setState({ status: "ready", source: objectUrl });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState({
          status: "error",
          message: formatError(
            error,
            isMhtmlFilePath(path) && rawText !== undefined
              ? "解析 MHTML 失败。"
              : "加载 HTML 失败。",
          ),
          rawText,
        });
      }
    }

    void loadHtmlPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, rootPath]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/70">
        正在加载 HTML 预览...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-base-100">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--mdx-separator)] px-4 py-3 text-sm text-base-content/70">
          <div className="min-w-0 flex-1 break-words">{state.message}</div>
          {state.rawText !== undefined ? (
            <TextControlButton
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? "隐藏源码" : "显示源码"}
            </TextControlButton>
          ) : null}
        </div>
        {showSource && state.rawText !== undefined ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-base-100 p-5 font-mono text-sm leading-relaxed text-base-content">
            {state.rawText}
          </pre>
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </div>
    );
  }

  return (
    <iframe
      title="HTML 预览"
      src={state.source}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
      className="h-full w-full border-0 bg-base-100"
    />
  );
}

function createPreviewHtml(path: string, rawText: string) {
  if (isMhtmlFilePath(path)) {
    const parsed = parseMhtmlArchive(rawText);

    return createSafePreviewHtml(parsed.html, {
      resourceUrls: parsed.resourceUrls,
    });
  }

  return createSafePreviewHtml(rawText);
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
