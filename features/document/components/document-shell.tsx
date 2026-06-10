"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storeImageForDocument } from "@/common/lib/image-storage";
import { tauriCore, tauriWindow } from "@/common/lib/tauri";
import { TextControlButton } from "@/common/components/ui-controls";
import type { AppWindowSession } from "@/features/app/lib/app-session";
import { EditorPane } from "@/features/editor/components/editor-pane";
import { DiffViewer } from "@/features/recovery/components/diff-viewer";
import { RecoveryBanner } from "@/features/recovery/components/recovery-banner";
import { useDraftAutosave } from "@/features/recovery/hooks/use-draft-autosave";
import { draftDelete, draftGet } from "@/features/recovery/lib/draft-client";
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
  applyRecoveredDraft,
  canCloseDocumentWithoutPrompt,
  createLoadedDocumentState,
  documentWindowTitle,
  markDocumentSaved,
  updateDocumentMarkdown,
} from "../lib/document-state";
import type { DraftRecord } from "@/features/recovery/lib/types";
import type { LoadedDocumentState } from "../lib/types";

interface DocumentDraftRecovery {
  draft: DraftRecord;
  fileExists: boolean;
}

interface ExternalDocumentConflict {
  realPath: string;
  displayPath: string;
  diskMarkdown: string;
}

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
  const [draftRecovery, setDraftRecovery] =
    useState<DocumentDraftRecovery | null>(null);
  const [draftDetailsOpen, setDraftDetailsOpen] = useState(true);
  const [externalConflict, setExternalConflict] =
    useState<ExternalDocumentConflict | null>(null);
  const [conflictDiffOpen, setConflictDiffOpen] = useState(false);
  const [copyMarkdownOpen, setCopyMarkdownOpen] = useState(false);
  const stateRef = useRef<LoadedDocumentState | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const draftFlushRef = useRef<() => Promise<void>>(async () => {});
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
    setDraftRecovery(null);
    setDraftDetailsOpen(true);
    setExternalConflict(null);
    setConflictDiffOpen(false);
    setCopyMarkdownOpen(false);
    void readDocumentFile(session.realPath)
      .then(async (file) => {
        if (cancelled) {
          return;
        }

        setState(createLoadedDocumentState(file));

        if (!isTauriRuntime()) {
          return;
        }

        try {
          const result = await draftGet(file.realPath);

          if (cancelled) {
            return;
          }

          setDraftRecovery(
            result.draft
              ? {
                  draft: result.draft,
                  fileExists: result.fileExists,
                }
              : null,
          );
          if (result.draft) {
            setDraftDetailsOpen(true);
          }
        } catch (draftError) {
          if (!cancelled) {
            console.warn("Failed to load document draft.", draftError);
          }
        }
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
        console.warn("Failed to check workspace dirty state.", dirtyCheckError);
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
  const handleDraftAutosaveError = useCallback((autosaveError: unknown) => {
    console.warn("Failed to autosave document draft.", autosaveError);
  }, []);
  const draftAutosave = useDraftAutosave({
    enabled: isTauriRuntime() && Boolean(state),
    realPath: state?.realPath ?? null,
    displayPath: state?.displayPath ?? null,
    markdown: state?.markdown ?? null,
    dirty: state?.dirty ?? false,
    baseFingerprint: state?.fingerprint ?? null,
    mode: "document",
    onError: handleDraftAutosaveError,
  });

  useEffect(() => {
    draftFlushRef.current = draftAutosave.flush;
  }, [draftAutosave.flush]);

  const finalizeSavedDocumentSnapshot = useCallback(
    async (
      snapshot: Pick<LoadedDocumentState, "realPath" | "markdown">,
      wasCurrentAfterWrite: boolean,
    ) => {
      if (
        wasCurrentAfterWrite &&
        isCurrentDocumentSnapshot(stateRef.current, snapshot)
      ) {
        await deleteDocumentDraft(snapshot.realPath);
      }

      if (isCurrentDocumentSnapshot(stateRef.current, snapshot)) {
        return true;
      }

      await draftFlushRef.current();
      return false;
    },
    [],
  );

  const save = useCallback(async () => {
    if (!state || saving) {
      return false;
    }

    const saveSnapshot = state;
    setSaving(true);

    try {
      await draftFlushRef.current();
      const result = await saveDocumentFile(
        saveSnapshot.realPath,
        saveSnapshot.markdown,
        saveSnapshot.fingerprint,
      );
      const savedStillCurrent = isCurrentDocumentSnapshot(
        stateRef.current,
        saveSnapshot,
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
      setExternalConflict(null);
      return finalizeSavedDocumentSnapshot(saveSnapshot, savedStillCurrent);
    } catch (saveError) {
      if (!isExternalModifiedError(saveError)) {
        void dialogs.alert({
          title: "保存失败",
          message: formatError(saveError, "保存文档失败。"),
        });
        return false;
      }

      try {
        const diskFile = await readDocumentFile(saveSnapshot.realPath);
        setExternalConflict({
          realPath: diskFile.realPath,
          displayPath: diskFile.displayPath,
          diskMarkdown: diskFile.content,
        });
        setConflictDiffOpen(true);
      } catch (readConflictError) {
        void dialogs.alert({
          title: "保存失败",
          message: formatError(
            readConflictError,
            "磁盘文件已变化，且无法读取最新内容。",
          ),
        });
      }

      return false;
    } finally {
      setSaving(false);
    }
  }, [dialogs, finalizeSavedDocumentSnapshot, saving, state]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const recoverDraft = useCallback(() => {
    const recovery = draftRecovery;

    if (!recovery) {
      return;
    }

    setState((current) =>
      current ? applyRecoveredDraft(current, recovery.draft.markdown) : current,
    );
    setDraftRecovery(null);
  }, [draftRecovery]);

  const keepDiskVersion = useCallback(() => {
    const recovery = draftRecovery;

    if (!recovery) {
      return;
    }

    setDraftRecovery(null);
    void deleteDocumentDraft(
      recovery.draft.realPath,
      recovery.draft.draftId,
    ).catch((deleteError) => {
      console.warn("Failed to delete document draft.", deleteError);
    });
  }, [draftRecovery]);

  const postponeDraftRecovery = useCallback(() => {
    setDraftDetailsOpen(false);
  }, []);

  const overwriteWithMyEdits = useCallback(async () => {
    const conflict = externalConflict;
    const current = stateRef.current;

    if (!conflict || !current || saving) {
      return;
    }

    setSaving(true);
    try {
      await draftFlushRef.current();
      const result = await overwriteDocumentFile(
        conflict.realPath,
        current.markdown,
      );
      const savedStillCurrent = isCurrentDocumentSnapshot(
        stateRef.current,
        current,
      );
      setState((latest) =>
        latest
          ? markDocumentSaved(latest, result.fingerprint, current.markdown)
          : latest,
      );
      setExternalConflict(null);
      setConflictDiffOpen(false);
      await finalizeSavedDocumentSnapshot(current, savedStillCurrent);
    } catch (overwriteError) {
      void dialogs.alert({
        title: "保存失败",
        message: formatError(overwriteError, "覆盖保存失败。"),
      });
    } finally {
      setSaving(false);
    }
  }, [dialogs, externalConflict, finalizeSavedDocumentSnapshot, saving]);

  const reloadDiskVersion = useCallback(async () => {
    const conflict = externalConflict;

    if (!conflict) {
      return;
    }

    try {
      const file = await readDocumentFile(conflict.realPath);
      setState(createLoadedDocumentState(file));
      setExternalConflict(null);
      setConflictDiffOpen(false);
      await deleteDocumentDraft(file.realPath);
    } catch (reloadError) {
      void dialogs.alert({
        title: "重新加载失败",
        message: formatError(reloadError, "无法重新加载磁盘版本。"),
      });
    }
  }, [dialogs, externalConflict]);

  const postponeExternalConflict = useCallback(() => {
    setConflictDiffOpen(false);
  }, []);

  const copyCurrentMarkdown = useCallback(() => {
    setConflictDiffOpen(false);
    setCopyMarkdownOpen(true);
    const markdown = stateRef.current?.markdown ?? "";

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(markdown).catch((copyError) => {
        console.warn("Failed to copy current document markdown.", copyError);
      });
    }
  }, []);

  useEffect(() => {
    if (!workspaceDirty || workspaceDirtyWarningShownRef.current) {
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
      const nextUnlisten = await currentWindow.onCloseRequested((event) => {
        const current = stateRef.current;

        if (confirmedCloseRef.current) {
          return;
        }

        if (!current || canCloseDocumentWithoutPrompt(current)) {
          return;
        }

        event.preventDefault();
        if (closePromptInFlightRef.current) {
          return;
        }

        closePromptInFlightRef.current = true;
        void draftFlushRef
          .current()
          .then(() =>
            dialogs.choice({
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
            }),
          )
          .then(async (choice) => {
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
              await deleteDocumentDraft(current.realPath);
              await closeDocumentWindow();
              return;
            }

            closePromptInFlightRef.current = false;
          })
          .catch((closeError) => {
            closePromptInFlightRef.current = false;
            console.warn(
              "Failed to handle document close request.",
              closeError,
            );
          });
      });

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
            console.warn("Failed to run document save menu action.", saveError);
          });
        }),
        currentWindow.listen("mdx-menu-open-folder", () => {
          void focusOrCreateWorkspaceWindow().catch((openError) => {
            console.warn("Failed to open workspace window.", openError);
          });
        }),
        currentWindow.listen("mdx-menu-close-document", () => {
          void requestDocumentWindowClose().catch((closeError) => {
            console.warn("Failed to close document window.", closeError);
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
          <TextControlButton onClick={() => void save()} disabled={saving}>
            {saving ? "保存中" : "保存"}
          </TextControlButton>
          <TextControlButton onClick={toggleOutline}>
            {state.outlineCollapsed ? "展开目录" : "收起目录"}
          </TextControlButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-col">
        <div className="shrink-0">
          {draftRecovery ? (
            <RecoveryBanner
              title="发现未保存草稿"
              message={
                draftDetailsOpen
                  ? `${displayPath(draftRecovery.draft)} 有一个自动保存的草稿。`
                  : "自动保存的草稿仍可恢复。"
              }
              priority={draftRecovery.fileExists ? "normal" : "high"}
              actions={[
                {
                  label: "恢复草稿",
                  primary: true,
                  onClick: recoverDraft,
                },
                {
                  label: "保留磁盘版本",
                  onClick: keepDiskVersion,
                },
                {
                  label: "稍后",
                  onClick: postponeDraftRecovery,
                },
              ]}
            />
          ) : null}
          {externalConflict ? (
            <RecoveryBanner
              title="文件已被外部修改"
              message={`${externalConflict.displayPath} 的磁盘内容已变化。`}
              priority="high"
              actions={[
                {
                  label: "查看差异",
                  primary: true,
                  onClick: () => setConflictDiffOpen(true),
                },
                {
                  label: "保留我的编辑",
                  onClick: () => void overwriteWithMyEdits(),
                },
                {
                  label: "重新加载磁盘",
                  destructive: true,
                  onClick: () => void reloadDiskVersion(),
                },
                {
                  label: "复制当前内容",
                  onClick: copyCurrentMarkdown,
                },
                {
                  label: "稍后",
                  onClick: postponeExternalConflict,
                },
              ]}
            />
          ) : null}
        </div>

        <div
          className="grid min-h-0 flex-1"
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
      </div>
      {externalConflict ? (
        <DiffViewer
          open={conflictDiffOpen}
          title="文件已被外部修改"
          leftTitle="磁盘版本"
          rightTitle="我的编辑"
          leftText={externalConflict.diskMarkdown}
          rightText={state.markdown}
          primaryAction={{
            label: "保留我的编辑",
            onClick: () => void overwriteWithMyEdits(),
          }}
          secondaryActions={[
            {
              label: "重新加载磁盘",
              destructive: true,
              onClick: () => void reloadDiskVersion(),
            },
            {
              label: "复制当前内容",
              onClick: copyCurrentMarkdown,
            },
            {
              label: "稍后",
              onClick: postponeExternalConflict,
            },
          ]}
          onClose={postponeExternalConflict}
        />
      ) : null}
      {copyMarkdownOpen ? (
        <CopyMarkdownDialog
          markdown={state.markdown}
          onClose={() => setCopyMarkdownOpen(false)}
        />
      ) : null}
    </main>
  );
}

function CopyMarkdownDialog({
  markdown,
  onClose,
}: {
  markdown: string;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex min-w-0 items-center justify-center bg-black/35 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdx-copy-markdown-title"
        className="flex max-h-[88vh] w-full max-w-3xl min-w-0 flex-col border border-base-300 bg-base-100 text-base-content shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <h2 id="mdx-copy-markdown-title" className="text-sm font-semibold">
            复制当前内容
          </h2>
          <button
            type="button"
            className="h-8 px-3 text-sm text-base-content/70 hover:bg-base-200"
            onClick={onClose}
          >
            关闭
          </button>
        </header>
        <textarea
          ref={textareaRef}
          readOnly
          value={markdown}
          className="min-h-0 flex-1 resize-none border-0 bg-base-100 p-4 font-mono text-xs leading-relaxed text-base-content outline-none"
        />
      </section>
    </div>
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

function displayPath(draft: Pick<DraftRecord, "displayPath" | "realPath">) {
  return draft.displayPath?.trim() || draft.realPath;
}

function isCurrentDocumentSnapshot(
  current: LoadedDocumentState | null,
  snapshot: Pick<LoadedDocumentState, "realPath" | "markdown">,
) {
  return (
    current !== null &&
    current.realPath === snapshot.realPath &&
    current.markdown === snapshot.markdown
  );
}

async function deleteDocumentDraft(realPath: string, draftId?: string) {
  if (!isTauriRuntime()) {
    return;
  }

  if (draftId) {
    await draftDelete({ draftId, realPath });
    return;
  }

  await draftDelete({ realPath });
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
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
