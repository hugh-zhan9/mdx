"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextControlButton } from "@/common/components/ui-controls";
import type { AppWindowSession } from "@/features/app/lib/app-session";
import { EditorPane } from "@/features/editor/components/editor-pane";
import { useAppDialogs } from "@/features/workspace/components/app-dialogs";
import { OutlinePanel } from "@/features/workspace/components/outline-panel";
import { parseMarkdownOutline } from "@/features/workspace/lib/outline";
import { scrollRenderedHeadingIntoView } from "@/features/workspace/lib/outline-scroll";
import {
    overwriteDocumentFile,
    readDocumentFile,
    saveDocumentFile,
} from "../lib/document-client";
import {
    createLoadedDocumentState,
    documentWindowTitle,
    markDocumentSaved,
    updateDocumentMarkdown,
} from "../lib/document-state";
import type { LoadedDocumentState } from "../lib/types";

export function DocumentShell({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "document" }>;
}) {
    const dialogs = useAppDialogs();
    const editorViewportRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<LoadedDocumentState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;

        setState(null);
        setError(null);
        void readDocumentFile(session.realPath)
            .then((file) => {
                if (cancelled) {
                    return;
                }

                setState(createLoadedDocumentState(file));
            })
            .catch((readError) => {
                if (cancelled) {
                    return;
                }

                setError(formatError(readError, "加载文档失败。"));
            });

        return () => {
            cancelled = true;
        };
    }, [session.realPath]);

    useEffect(() => {
        if (!state || typeof document === "undefined") {
            return;
        }

        document.title = documentWindowTitle(state);
    }, [state]);

    const headings = useMemo(
        () => (state ? parseMarkdownOutline(state.markdown) : []),
        [state],
    );

    const save = useCallback(async () => {
        if (!state || saving) {
            return false;
        }

        const saveSnapshot = state;
        setSaving(true);

        try {
            const result = await saveDocumentFile(
                saveSnapshot.realPath,
                saveSnapshot.markdown,
                saveSnapshot.fingerprint,
            );
            setState((current) =>
                current
                    ? markDocumentSaved(
                          current,
                          result.fingerprint,
                          saveSnapshot.markdown,
                      )
                    : current,
            );
            return true;
        } catch (saveError) {
            if (!isExternalModifiedError(saveError)) {
                void dialogs.alert({
                    title: "保存失败",
                    message: formatError(saveError, "保存文档失败。"),
                });
                return false;
            }

            const overwrite = await dialogs.confirm({
                title: "文件已被外部修改",
                message: "磁盘上的文件已变化。是否用当前编辑内容覆盖保存？",
                confirmLabel: "覆盖保存",
                cancelLabel: "取消",
                destructive: true,
            });

            if (!overwrite) {
                return false;
            }

            try {
                const result = await overwriteDocumentFile(
                    saveSnapshot.realPath,
                    saveSnapshot.markdown,
                );
                setState((current) =>
                    current
                        ? markDocumentSaved(
                              current,
                              result.fingerprint,
                              saveSnapshot.markdown,
                          )
                        : current,
                );
                return true;
            } catch (overwriteError) {
                void dialogs.alert({
                    title: "保存失败",
                    message: formatError(overwriteError, "覆盖保存失败。"),
                });
                return false;
            }
        } finally {
            setSaving(false);
        }
    }, [dialogs, saving, state]);

    const toggleOutline = useCallback(() => {
        setState((current) =>
            current
                ? {
                      ...current,
                      outlineCollapsed: !current.outlineCollapsed,
                  }
                : current,
        );
    }, []);

    const handleMarkdownChange = useCallback((_: string, markdown: string) => {
        setState((current) =>
            current ? updateDocumentMarkdown(current, markdown) : current,
        );
    }, []);

    const scrollToHeading = useCallback((_: unknown, index: number) => {
        scrollRenderedHeadingIntoView(editorViewportRef.current, index);
    }, []);

    if (error) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 px-6 text-sm text-error">
                {error}
            </main>
        );
    }

    if (!state) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 text-sm text-base-content/70">
                正在加载文档...
            </main>
        );
    }

    return (
        <main className="grid h-screen min-h-0 grid-rows-[44px_minmax(0,1fr)] bg-base-100 text-base-content">
            <header className="flex min-w-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div
                    className="min-w-0 truncate text-sm font-medium"
                    title={state.displayPath}
                >
                    {state.dirty ? "● " : ""}
                    {state.fileName}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <TextControlButton
                        onClick={() => void save()}
                        disabled={saving}
                    >
                        {saving ? "保存中" : "保存"}
                    </TextControlButton>
                    <TextControlButton onClick={toggleOutline}>
                        {state.outlineCollapsed ? "展开目录" : "收起目录"}
                    </TextControlButton>
                </div>
            </header>

            <div
                className="grid min-h-0"
                style={{
                    gridTemplateColumns: state.outlineCollapsed
                        ? "minmax(0,1fr) 0px"
                        : "minmax(0,1fr) 280px",
                }}
            >
                <section className="min-h-0 overflow-hidden">
                    <EditorPane
                        rootPath={null}
                        tab={{
                            tabId: "document",
                            path: state.realPath,
                            title: state.fileName,
                            dirty: state.dirty,
                            needsRenameOnFirstSave: false,
                            markdown: state.markdown,
                        }}
                        onMarkdownChange={handleMarkdownChange}
                        editorViewportRef={editorViewportRef}
                    />
                </section>

                <OutlinePanel
                    headings={headings}
                    collapsed={state.outlineCollapsed}
                    onHeadingClick={scrollToHeading}
                    resizeHandleProps={{}}
                />
            </div>
        </main>
    );
}

function isExternalModifiedError(error: unknown) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const record = error as Record<string, unknown>;
    return (
        record.errorCode === "external_modified" ||
        record.error_code === "external_modified"
    );
}

function formatError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return `${fallback} ${error.message}`;
    }

    if (typeof error === "string" && error.length > 0) {
        return `${fallback} ${error}`;
    }

    if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        if (typeof record.message === "string" && record.message.length > 0) {
            return `${fallback} ${record.message}`;
        }
    }

    return fallback;
}
