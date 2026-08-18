"use client";

import { FileDown, PanelRightOpen, PanelRightClose, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadImage, storeImageForDocument } from "@/common/lib/image-storage";
import { tokenize } from "@/common/lib/prism";
import { tauriCore, tauriDialog, tauriWindow } from "@/common/lib/tauri";
import { TextControlButton } from "@/common/components/ui-controls";
import type { AppWindowSession } from "@/features/app/lib/app-session";
import { MarkdownEditorSurface } from "@/features/editor/components/markdown-editor-surface";
import type { MarkdownEditorSurfaceHandle } from "@/features/editor/components/markdown-editor-surface";
import { createEditorSessionBinding } from "@/features/editor/lib/editor-session-binding";
import {
  describePublishingFailure,
  exportPublishedDocumentPdf,
} from "@/features/editor/lib/publishing-client";
import { useFileWatch } from "@/features/file-watch/hooks/use-file-watch";
import type {
  FrontendFileWatchEvent,
  WatchErrorPayload,
} from "@/features/file-watch/lib/types";
import { DiffViewer } from "@/features/recovery/components/diff-viewer";
import { RecoveryBanner } from "@/features/recovery/components/recovery-banner";
import { useDraftAutosave } from "@/features/recovery/hooks/use-draft-autosave";
import { draftDelete, draftGet } from "@/features/recovery/lib/draft-client";
import { useAppDialogs } from "@/features/workspace/components/app-dialogs";
import { OutlinePanel } from "@/features/workspace/components/outline-panel";
import { parseMarkdownOutline } from "@/features/workspace/lib/outline";
import { normalizeWorkspacePath } from "@/features/workspace/lib/path";
import {
  createDefaultAppPreferences,
  normalizeAppPreferences,
} from "@/features/workspace/lib/preferences";
import type {
  AppPreferences,
  MarkdownOutlineHeading,
  PersistedAppState,
} from "@/features/workspace/lib/types";
import {
  isWorkspacePathDirty,
  overwriteDocumentFile,
  readDocumentFile,
  saveDocumentFile,
} from "../lib/document-client";
import {
  applyExternalDocumentReload,
  applyRecoveredDraft,
  canCloseDocumentWithoutPrompt,
  createDocumentExternalConflict,
  createLoadedDocumentState,
  documentWindowTitle,
  markDocumentDeleted,
  markDocumentSaved,
  updateDocumentMarkdown,
} from "../lib/document-state";
import type { DraftRecord } from "@/features/recovery/lib/types";
import type { LoadedDocumentState } from "../lib/types";
import { stopListening } from "@/common/lib/tauri-events";

interface DocumentDraftRecovery {
  draft: DraftRecord;
  fileExists: boolean;
}

interface ExternalDocumentConflict {
  path: string;
  displayPath: string;
  diskMarkdown: string;
}

export function DocumentShell({
  session,
}: {
  session: Extract<AppWindowSession, { kind: "document" }>;
}) {
  const dialogs = useAppDialogs();
  // Reaches the adapter surface for source-range navigation. It carries no
  // editing capability: the only thing this window can ask of it is that a
  // Markdown range be revealed.
  const editorSurfaceRef = useRef<MarkdownEditorSurfaceHandle | null>(null);
  // The document session owns the editor revision for the file it holds. The
  // binding stamps snapshots and judges incoming changes; it touches no file
  // state of its own.
  const [editorSession] = useState(createEditorSessionBinding);
  const [state, setState] = useState<LoadedDocumentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(
    session.workspaceDirty === true,
  );
  const [draftRecovery, setDraftRecovery] =
    useState<DocumentDraftRecovery | null>(null);
  const [draftDetailsOpen, setDraftDetailsOpen] = useState(true);
  const [draftDiffOpen, setDraftDiffOpen] = useState(false);
  const [externalConflict, setExternalConflict] =
    useState<ExternalDocumentConflict | null>(null);
  const [conflictDiffOpen, setConflictDiffOpen] = useState(false);
  const [copyMarkdownOpen, setCopyMarkdownOpen] = useState(false);
  const [fileWatchPreferences, setFileWatchPreferences] =
    useState<AppPreferences>(() => createDefaultAppPreferences());
  const [fileWatchPreferencesReady, setFileWatchPreferencesReady] =
    useState(false);
  const stateRef = useRef<LoadedDocumentState | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const draftFlushRef = useRef<() => Promise<void>>(async () => {});
  const closePromptInFlightRef = useRef(false);
  const confirmedCloseRef = useRef(false);
  const workspaceDirtyWarningShownRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
    // Only the file the window currently holds is a live document. Anything
    // else the binding still remembers belongs to a file this window moved on
    // from, and a change carrying its id has nowhere to land.
    editorSession.retain(state ? [state.realPath] : []);
  }, [editorSession, state]);

  useEffect(() => {
    let cancelled = false;

    setState(null);
    setError(null);
    setDraftRecovery(null);
    setDraftDetailsOpen(true);
    setDraftDiffOpen(false);
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
    let cancelled = false;

    if (!isTauriRuntime()) {
      setFileWatchPreferences(createDefaultAppPreferences());
      setFileWatchPreferencesReady(true);
      return;
    }

    setFileWatchPreferencesReady(false);
    void loadDocumentAppPreferences()
      .then((preferences) => {
        if (cancelled) {
          return;
        }

        setFileWatchPreferences(preferences);
        setFileWatchPreferencesReady(true);
      })
      .catch((preferencesError) => {
        if (cancelled) {
          return;
        }

        console.warn(
          "Failed to load document file watch preferences.",
          preferencesError,
        );
        setFileWatchPreferences(createDefaultAppPreferences());
        setFileWatchPreferencesReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        const conflict = createDocumentExternalConflict(
          saveSnapshot,
          diskFile,
        );
        setExternalConflict({
          path: conflict.path,
          diskMarkdown: conflict.diskMarkdown,
          displayPath: diskFile.displayPath,
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

  /**
   * Publishes the revision on screen as a PDF.
   *
   * The revision is captured from the session binding before the file dialog
   * opens, so the output corresponds to what the user was looking at when they
   * asked, not to whatever the document became while they picked a path. A
   * failure is reported and nothing else happens: this path cannot save, clear
   * dirty state or touch a draft.
   */
  const exportPdf = useCallback(async () => {
    const current = stateRef.current;

    if (!current || exporting) {
      return;
    }

    const snapshot = editorSession.snapshotFor({
      documentId: current.realPath,
      markdown: current.markdown,
    });
    // A document window has no workspace root; the file's own folder is what
    // its relative asset paths are written against.
    const rootPath = parentDirectoryForPath(current.realPath);

    if (!rootPath) {
      void dialogs.alert({
        title: "导出 PDF",
        message: "文档路径没有可用的父文件夹。",
      });
      return;
    }

    setExporting(true);
    try {
      const outputPath = await choosePdfExportPath(current.realPath);

      if (!outputPath) {
        return;
      }

      const outcome = await exportPublishedDocumentPdf({
        snapshot,
        rootPath,
        outputPath,
      });

      if (!outcome.ok) {
        void dialogs.alert({
          title: "导出 PDF",
          message: describePublishingFailure(outcome),
        });
        return;
      }

      // A warning means the file was written but something in it is not what
      // the document says — a character with no glyph in the embedded font
      // comes out blank. Staying silent about that hands over a PDF with holes
      // in it and calls the export a success.
      if (outcome.warnings.length > 0) {
        void dialogs.alert({
          title: "导出 PDF",
          message: `已导出，但有以下情况：\n${outcome.warnings.join("\n")}`,
        });
      }
    } catch (exportError) {
      void dialogs.alert({
        title: "导出 PDF",
        message: formatError(exportError, "导出 PDF 失败。"),
      });
    } finally {
      setExporting(false);
    }
  }, [dialogs, editorSession, exporting]);

  const recoverDraft = useCallback(() => {
    const recovery = draftRecovery;

    if (!recovery) {
      return;
    }

    editorSession.declareReplace({
      documentId: recovery.draft.realPath,
      markdown: recovery.draft.markdown,
      reason: "restore",
    });
    setState((current) =>
      current ? applyRecoveredDraft(current, recovery.draft.markdown) : current,
    );
    setDraftRecovery(null);
    setDraftDiffOpen(false);
  }, [draftRecovery, editorSession]);

  const keepDiskVersion = useCallback(() => {
    const recovery = draftRecovery;

    if (!recovery) {
      return;
    }

    setDraftRecovery(null);
    setDraftDiffOpen(false);
    void deleteDocumentDraft(
      recovery.draft.realPath,
      recovery.draft.draftId,
    ).catch((deleteError) => {
      console.warn("Failed to delete document draft.", deleteError);
    });
  }, [draftRecovery]);

  const postponeDraftRecovery = useCallback(() => {
    setDraftDetailsOpen(false);
    setDraftDiffOpen(false);
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
        conflict.path,
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
      const file = await readDocumentFile(conflict.path);
      editorSession.declareReplace({
        documentId: file.realPath,
        markdown: file.content,
        reason: "conflict-resolution",
      });
      setState((current) =>
        current ? applyExternalDocumentReload(current, file) : current,
      );
      setExternalConflict(null);
      setConflictDiffOpen(false);
      await deleteDocumentDraft(file.realPath);
    } catch (reloadError) {
      void dialogs.alert({
        title: "重新加载失败",
        message: formatError(reloadError, "无法重新加载磁盘版本。"),
      });
    }
  }, [dialogs, editorSession, externalConflict]);

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

  const reloadCleanExternalDocument = useCallback(async () => {
    const snapshot = stateRef.current;

    if (!snapshot || snapshot.dirty) {
      return;
    }

    try {
      const file = await readDocumentFile(snapshot.realPath);
      const latest = stateRef.current;

      if (
        !latest ||
        latest.dirty ||
        !sameDocumentPath(latest.realPath, snapshot.realPath)
      ) {
        return;
      }

      editorSession.declareReplace({
        documentId: latest.realPath,
        markdown: file.content,
        reason: "clean-reload",
      });
      setState((current) => {
        if (
          !current ||
          current.dirty ||
          !sameDocumentPath(current.realPath, snapshot.realPath)
        ) {
          return current;
        }

        return applyExternalDocumentReload(current, file);
      });
      setExternalConflict(null);
      setConflictDiffOpen(false);
    } catch (reloadError) {
      console.warn("Failed to reload externally changed document.", reloadError);
    }
  }, [editorSession]);

  const showExternalDocumentConflict = useCallback(async () => {
    const snapshot = stateRef.current;

    if (!snapshot || !snapshot.dirty) {
      return;
    }

    try {
      const file = await readDocumentFile(snapshot.realPath);
      const latest = stateRef.current;

      if (
        !latest ||
        !latest.dirty ||
        !sameDocumentPath(latest.realPath, snapshot.realPath)
      ) {
        return;
      }

      const conflict = createDocumentExternalConflict(latest, file);
      setState((current) =>
        current && sameDocumentPath(current.realPath, snapshot.realPath)
          ? { ...current, deletedOnDisk: false }
          : current,
      );
      setExternalConflict({
        path: conflict.path,
        diskMarkdown: conflict.diskMarkdown,
        displayPath: file.displayPath,
      });
      setConflictDiffOpen(true);
    } catch (conflictError) {
      console.warn("Failed to load externally changed document.", conflictError);
    }
  }, []);

  const handleDocumentFileWatchEvent = useCallback(
    (event: FrontendFileWatchEvent) => {
      const current = stateRef.current;

      if (!current) {
        return;
      }

      const eventPathMatchesCurrent = sameDocumentPath(
        event.path,
        current.realPath,
      );
      const newPathMatchesCurrent =
        event.kind === "renamed" &&
        sameDocumentPath(event.newPath, current.realPath);

      if (!eventPathMatchesCurrent && !newPathMatchesCurrent) {
        return;
      }

      if (event.kind === "deleted" || event.kind === "renamed") {
        if (eventPathMatchesCurrent && !newPathMatchesCurrent) {
          setState((latest) =>
            latest && sameDocumentPath(latest.realPath, current.realPath)
              ? markDocumentDeleted(latest)
              : latest,
          );
          setExternalConflict(null);
          setConflictDiffOpen(false);
          return;
        }
      }

      if (current.dirty) {
        void showExternalDocumentConflict();
        return;
      }

      void reloadCleanExternalDocument();
    },
    [reloadCleanExternalDocument, showExternalDocumentConflict],
  );

  const handleDocumentFileWatchError = useCallback(
    (watchError: WatchErrorPayload) => {
      console.warn("Document file watch error.", watchError);
    },
    [],
  );

  useFileWatch({
    mode: "document",
    path: state?.realPath ?? null,
    preferences: {
      fileWatchEnabled:
        fileWatchPreferencesReady && fileWatchPreferences.fileWatchEnabled,
    },
    onEvent: handleDocumentFileWatchEvent,
    onError: handleDocumentFileWatchError,
  });

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
      await getCurrentWindow().destroy();
    } catch (closeError) {
      confirmedCloseRef.current = false;
      throw closeError;
    }
  }, []);

  const requestDocumentWindowClose = useCallback(async () => {
    const { getCurrentWindow } = await tauriWindow();
    await getCurrentWindow().close();
  }, []);

  const closeDeletedDocument = useCallback(async () => {
    await closeDocumentWindow();
  }, [closeDocumentWindow]);

  const closeDeletedDocumentWithoutSaving = useCallback(async () => {
    const current = stateRef.current;

    if (current) {
      await deleteDocumentDraft(current.realPath).catch((deleteError) => {
        console.warn(
          "Failed to delete document draft before closing.",
          deleteError,
        );
      });
    }

    await closeDocumentWindow();
  }, [closeDocumentWindow]);

  const saveDeletedDocumentAs = useCallback(async () => {
    const current = stateRef.current;

    if (!current || saving) {
      return;
    }

    const saveSnapshot = current;

    try {
      const selectedPath = await chooseDocumentSavePath(saveSnapshot.realPath);

      if (!selectedPath) {
        return;
      }

      setSaving(true);
      await draftFlushRef.current();
      await writeDocumentMarkdownPath(selectedPath, saveSnapshot.markdown);
      const file = await readDocumentFile(selectedPath);
      const savedStillCurrent = isCurrentDocumentSnapshot(
        stateRef.current,
        saveSnapshot,
      );

      if (!savedStillCurrent) {
        await draftFlushRef.current();
        return;
      }

      setState((latest) =>
        latest && isCurrentDocumentSnapshot(latest, saveSnapshot)
          ? {
              ...createLoadedDocumentState(file),
              outlineCollapsed: latest.outlineCollapsed,
            }
          : latest,
      );
      setExternalConflict(null);
      setConflictDiffOpen(false);
      await deleteDocumentDraft(saveSnapshot.realPath);
    } catch (saveAsError) {
      void dialogs.alert({
        title: "另存为",
        message: formatError(saveAsError, "无法另存文档。"),
      });
    } finally {
      setSaving(false);
    }
  }, [dialogs, saving]);

  const restoreDeletedDocumentOriginalPath = useCallback(async () => {
    const current = stateRef.current;

    if (!current || saving) {
      return;
    }

    const restoreSnapshot = current;

    setSaving(true);
    try {
      await draftFlushRef.current();
      await writeDocumentMarkdownPath(
        restoreSnapshot.realPath,
        restoreSnapshot.markdown,
      );
      const file = await readDocumentFile(restoreSnapshot.realPath);
      const restoredStillCurrent = isCurrentDocumentSnapshot(
        stateRef.current,
        restoreSnapshot,
      );

      if (!restoredStillCurrent) {
        setState((latest) =>
          latest && sameDocumentPath(latest.realPath, restoreSnapshot.realPath)
            ? markDocumentSaved(
                latest,
                file.fingerprint,
                restoreSnapshot.markdown,
              )
            : latest,
        );
        await draftFlushRef.current();
        return;
      }

      setState((latest) =>
        latest && isCurrentDocumentSnapshot(latest, restoreSnapshot)
          ? {
              ...createLoadedDocumentState(file),
              outlineCollapsed: latest.outlineCollapsed,
            }
          : latest,
      );
      setExternalConflict(null);
      setConflictDiffOpen(false);
      await deleteDocumentDraft(restoreSnapshot.realPath);
    } catch (restoreError) {
      void dialogs.alert({
        title: "恢复原路径",
        message: formatError(restoreError, "无法恢复原路径。"),
      });
    } finally {
      setSaving(false);
    }
  }, [dialogs, saving]);

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
          event.preventDefault();
          void closeDocumentWindow().catch((closeError) => {
            console.warn("Failed to close clean document window.", closeError);
          });
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
        stopListening(nextUnlisten);
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
      stopListening(unlisten);
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
        unlisteners.forEach(stopListening);
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
      unlisteners.forEach(stopListening);
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

  const handleEditorSurfaceChange = useCallback(
    (documentId: string, markdown: string) => {
      setState((current) =>
        // A change reported for a file this window is no longer showing must
        // not be written into the file it is showing now.
        current && current.realPath === documentId
          ? updateDocumentMarkdown(current, markdown)
          : current,
      );
    },
    [],
  );

  // The editing surface is navigated by the heading's own Markdown source
  // range, so nothing here reads rendered output to find a heading.
  const scrollToHeading = useCallback((heading: MarkdownOutlineHeading) => {
    void editorSurfaceRef.current?.reveal(heading.range);
  }, []);

  if (error) {
    return (
      <main className="flex h-dvh items-center justify-center bg-base-100 px-6 text-sm text-error">
        {error}
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex h-dvh items-center justify-center bg-base-100 text-sm text-base-content/70">
        正在加载文档...
      </main>
    );
  }

  return (
    <main
      data-mdx-document-shell=""
      className="grid h-dvh min-h-0 overflow-hidden grid-rows-[var(--mdx-window-toolbar-height)_minmax(0,1fr)] bg-[var(--mdx-content-bg)] text-base-content"
    >
      <header
        data-mdx-document-toolbar=""
        // Drags the window, as in the workspace: the title bar is an overlay,
        // so an unmarked toolbar is a window that cannot be moved.
        data-tauri-drag-region
        className="flex min-w-0 items-center justify-between border-b border-[var(--mdx-separator)] bg-[var(--mdx-chrome-bg)] px-3"
      >
        <div
          data-tauri-drag-region
          className="min-w-0 flex-1 truncate pl-[var(--mdx-traffic-light-inset)] text-sm font-medium"
          title={state.displayPath}
        >
          {state.dirty ? "● " : ""}
          {state.fileName}
        </div>

        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center gap-2"
        >
          <TextControlButton onClick={() => void save()} disabled={saving}>
            <Save aria-hidden="true" />
            {saving ? "保存中" : "保存"}
          </TextControlButton>
          <TextControlButton
            onClick={() => void exportPdf()}
            disabled={exporting}
          >
            <FileDown aria-hidden="true" />
            {exporting ? "导出中" : "导出 PDF"}
          </TextControlButton>
          <TextControlButton onClick={toggleOutline}>
            {state.outlineCollapsed ? (
              <PanelRightOpen aria-hidden="true" />
            ) : (
              <PanelRightClose aria-hidden="true" />
            )}
            {state.outlineCollapsed ? "展开目录" : "收起目录"}
          </TextControlButton>
        </div>
      </header>

      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mdx-content-bg)]"
        data-document-editor-body=""
      >
        <div className="relative z-10 shrink-0">
          {draftRecovery ? (
            <RecoveryBanner
              title="发现未保存草稿"
              path={draftDetailsOpen ? displayPath(draftRecovery.draft) : null}
              message={
                draftDetailsOpen
                  ? "这个文件有一个自动保存的草稿。"
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
                  label: "查看差异",
                  onClick: () => setDraftDiffOpen(true),
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
          {externalConflict && !state.deletedOnDisk ? (
            <RecoveryBanner
              title="文件已被外部修改"
              path={externalConflict.displayPath}
              message="磁盘内容已变化。"
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
          {state.deletedOnDisk ? (
            <RecoveryBanner
              title="文件已被外部删除"
              path={state.displayPath}
              message={
                state.dirty
                  ? "已从磁盘删除，当前文档还有未保存编辑。"
                  : "已从磁盘删除。"
              }
              priority={state.dirty ? "high" : "normal"}
              actions={
                state.dirty
                  ? [
                      {
                        label: "另存为",
                        primary: true,
                        onClick: () => void saveDeletedDocumentAs(),
                      },
                      {
                        label: "恢复原路径",
                        onClick: () =>
                          void restoreDeletedDocumentOriginalPath(),
                      },
                      {
                        label: "关闭且不保存",
                        destructive: true,
                        onClick: () =>
                          void closeDeletedDocumentWithoutSaving(),
                      },
                    ]
                  : [
                      {
                        label: "关闭",
                        primary: true,
                        onClick: () => void closeDeletedDocument(),
                      },
                      {
                        label: "另存为",
                        onClick: () => void saveDeletedDocumentAs(),
                      },
                    ]
              }
            />
          ) : null}
        </div>

        <div
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
          data-document-editor-grid=""
          style={{
            gridTemplateColumns: state.outlineCollapsed
              ? "minmax(0,1fr) 0px"
              : "minmax(0,1fr) 280px",
          }}
        >
          <section
            className="flex min-h-0 min-w-0 overflow-hidden"
            data-document-editor-stage=""
          >
            <MarkdownEditorSurface
              ref={editorSurfaceRef}
              session={editorSession}
              documentId={state.realPath}
              markdown={state.markdown}
              onMarkdownChange={handleEditorSurfaceChange}
              storeImage={(file) =>
                // A document window has no workspace root, so an asset is
                // stored beside the file being edited.
                storeImageForDocument(file, {
                  documentPath: state.realPath,
                })
              }
              services={{
                // A document window has no workspace root; a relative asset
                // is relative to the file being edited.
                imageLoader: (src) =>
                  loadImage(src, {
                    rootPath: null,
                    currentFilePath: state.realPath,
                  }),
                codeTokenizer: tokenize,
              }}
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
      {externalConflict && !state.deletedOnDisk ? (
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
      {draftRecovery ? (
        <DiffViewer
          open={draftDiffOpen}
          title="草稿差异"
          leftTitle="磁盘版本"
          rightTitle="草稿"
          leftText={state.markdown}
          rightText={draftRecovery.draft.markdown}
          primaryAction={{
            label: "恢复草稿",
            onClick: recoverDraft,
          }}
          secondaryActions={[
            {
              label: "保留磁盘版本",
              onClick: keepDiskVersion,
            },
            {
              label: "稍后",
              onClick: postponeDraftRecovery,
            },
          ]}
          onClose={postponeDraftRecovery}
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
        className="flex max-h-[88vh] w-full max-w-3xl min-w-0 flex-col rounded-xl bg-base-100 text-base-content shadow-[var(--mdx-panel-shadow)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--mdx-separator)] px-4 py-3">
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

function sameDocumentPath(left: string, right: string) {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

async function loadDocumentAppPreferences() {
  const { invoke } = await tauriCore();
  const state = await invoke<PersistedAppState>("load_app_state");

  return normalizeAppPreferences(state.preferences);
}

async function chooseDocumentSavePath(defaultPath: string) {
  if (!isTauriRuntime()) {
    throw new Error("文件另存为仅在桌面版中可用。");
  }

  const { save } = await tauriDialog();
  const selectedPath = await save({
    title: "另存为",
    defaultPath,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown"],
      },
    ],
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

async function choosePdfExportPath(documentPath: string) {
  if (!isTauriRuntime()) {
    throw new Error("导出 PDF 仅在桌面版中可用。");
  }

  const { save } = await tauriDialog();
  const selectedPath = await save({
    title: "导出 PDF",
    defaultPath: documentPath.replace(/\.(md|markdown)$/i, "") + ".pdf",
    filters: [
      {
        name: "PDF",
        extensions: ["pdf"],
      },
    ],
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

async function writeDocumentMarkdownPath(path: string, content: string) {
  const rootPath = parentDirectoryForPath(path);

  if (!rootPath) {
    throw new Error("文档路径没有可用的父文件夹。");
  }

  const { invoke } = await tauriCore();
  await invoke("write_markdown_file", {
    rootPath,
    path,
    content,
    expectedFingerprint: null,
  });
}

function parentDirectoryForPath(path: string) {
  const normalizedPath = normalizeWorkspacePath(path);

  if (
    normalizedPath.length === 0 ||
    normalizedPath === "/" ||
    /^[A-Za-z]:\/?$/.test(normalizedPath)
  ) {
    return null;
  }

  if (/^[A-Za-z]:\/[^/]+$/.test(normalizedPath)) {
    return normalizedPath.slice(0, 3);
  }

  const separatorIndex = normalizedPath.lastIndexOf("/");

  if (separatorIndex < 0) {
    return null;
  }

  if (separatorIndex === 0) {
    return "/";
  }

  return normalizedPath.slice(0, separatorIndex);
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
