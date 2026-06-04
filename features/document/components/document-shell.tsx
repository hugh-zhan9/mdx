"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storeImageForDocument } from "@/common/lib/image-storage";
import { tauriCore, tauriWindow } from "@/common/lib/tauri";
import { TextControlButton } from "@/common/components/ui-controls";
import type { AppWindowSession } from "@/features/app/lib/app-session";
import { EditorPane } from "@/features/editor/components/editor-pane";
import { useAppDialogs } from "@/features/workspace/components/app-dialogs";
import { OutlinePanel } from "@/features/workspace/components/outline-panel";
import { parseMarkdownOutline } from "@/features/workspace/lib/outline";
import { scrollRenderedHeadingIntoView } from "@/features/workspace/lib/outline-scroll";
import {
    isWorkspacePathDirty,
    overwriteDocumentFile,
    readDocumentFile,
    saveDocumentFile,
} from "../lib/document-client";
import {
    canCloseDocumentWithoutPrompt,
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
    const [workspaceDirty, setWorkspaceDirty] = useState(
        session.workspaceDirty === true,
    );
    const stateRef = useRef<LoadedDocumentState | null>(null);
    const saveRef = useRef<() => Promise<boolean>>(async () => false);
    const closePromptInFlightRef = useRef(false);
    const confirmedCloseRef = useRef(false);
    const workspaceDirtyWarningShownRef = useRef(false);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

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
        setWorkspaceDirty(session.workspaceDirty === true);

        if (!isTauriRuntime()) {
            return;
        }

        let cancelled = false;
        void isWorkspacePathDirty(session.realPath)
            .then((dirty) => {
                if (!cancelled && dirty) {
                    setWorkspaceDirty(true);
                }
            })
            .catch((dirtyCheckError) => {
                console.warn(
                    "Failed to check workspace dirty state.",
                    dirtyCheckError,
                );
            });

        return () => {
            cancelled = true;
        };
    }, [session.realPath, session.workspaceDirty]);

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

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    useEffect(() => {
        if (
            !workspaceDirty ||
            workspaceDirtyWarningShownRef.current
        ) {
            return;
        }

        workspaceDirtyWarningShownRef.current = true;
        void dialogs.alert({
            title: "工作区中有未保存版本",
            message:
                "这个文件已在工作区标签页中打开且有未保存修改。单文档窗口不会自动同步该内容。",
        });
    }, [dialogs, workspaceDirty]);

    const closeDocumentWindow = useCallback(async () => {
        confirmedCloseRef.current = true;
        try {
            const { getCurrentWindow } = await tauriWindow();
            await getCurrentWindow().close();
        } catch (closeError) {
            confirmedCloseRef.current = false;
            throw closeError;
        }
    }, []);

    const requestDocumentWindowClose = useCallback(async () => {
        const { getCurrentWindow } = await tauriWindow();
        await getCurrentWindow().close();
    }, []);

    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let disposed = false;
        let unlisten: (() => void) | null = null;

        const subscribe = async () => {
            const { getCurrentWindow } = await tauriWindow();
            const currentWindow = getCurrentWindow();
            const nextUnlisten = await currentWindow.onCloseRequested(
                (event) => {
                    const current = stateRef.current;

                    if (confirmedCloseRef.current) {
                        return;
                    }

                    if (
                        !current ||
                        canCloseDocumentWithoutPrompt(current)
                    ) {
                        return;
                    }

                    event.preventDefault();
                    if (closePromptInFlightRef.current) {
                        return;
                    }

                    closePromptInFlightRef.current = true;
                    void dialogs.choice({
                        title: "关闭文档",
                        message: "当前文档有未保存更改。请选择如何处理。",
                        choices: [
                            { label: "保存", value: "save" },
                            {
                                label: "丢弃",
                                value: "discard",
                                destructive: true,
                            },
                        ],
                        cancelLabel: "取消",
                    }).then(async (choice) => {
                        if (choice === "save") {
                            const saved = await saveRef.current();
                            if (saved) {
                                await closeDocumentWindow();
                                return;
                            }

                            closePromptInFlightRef.current = false;
                            return;
                        }

                        if (choice === "discard") {
                            await closeDocumentWindow();
                            return;
                        }

                        closePromptInFlightRef.current = false;
                    }).catch((closeError) => {
                        closePromptInFlightRef.current = false;
                        console.warn(
                            "Failed to handle document close request.",
                            closeError,
                        );
                    });
                },
            );

            if (disposed) {
                nextUnlisten();
                return;
            }

            unlisten = nextUnlisten;
        };

        void subscribe().catch((subscribeError) => {
            console.warn(
                "Failed to subscribe to document close requests.",
                subscribeError,
            );
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [closeDocumentWindow, dialogs]);

    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let disposed = false;
        const unlisteners: Array<() => void> = [];

        const subscribe = async () => {
            const { getCurrentWindow } = await tauriWindow();
            const currentWindow = getCurrentWindow();

            const nextUnlisteners = await Promise.all([
                currentWindow.listen("mdx-menu-save", () => {
                    void saveRef.current().catch((saveError) => {
                        console.warn(
                            "Failed to run document save menu action.",
                            saveError,
                        );
                    });
                }),
                currentWindow.listen("mdx-menu-open-folder", () => {
                    void focusOrCreateWorkspaceWindow().catch((openError) => {
                        console.warn(
                            "Failed to open workspace window.",
                            openError,
                        );
                    });
                }),
                currentWindow.listen("mdx-menu-close-document", () => {
                    void requestDocumentWindowClose().catch((closeError) => {
                        console.warn(
                            "Failed to close document window.",
                            closeError,
                        );
                    });
                }),
            ]);
            unlisteners.push(...nextUnlisteners);

            if (disposed) {
                unlisteners.forEach((unlisten) => unlisten());
            }
        };

        void subscribe().catch((subscribeError) => {
            console.warn(
                "Failed to subscribe to document menu events.",
                subscribeError,
            );
        });

        return () => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [requestDocumentWindowClose]);

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
                        storeImage={(file) =>
                            storeImageForDocument(file, {
                                documentPath: state.realPath,
                            })
                        }
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

async function focusOrCreateWorkspaceWindow() {
    const { invoke } = await tauriCore();
    await invoke("focus_or_create_workspace_window");
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}
