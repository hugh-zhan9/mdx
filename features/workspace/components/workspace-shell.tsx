"use client";

import {
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { tauriCore } from "@/common/lib/tauri";
import { useFileWatch } from "@/features/file-watch/hooks/use-file-watch";
import {
  decideWorkspaceExternalChange,
  documentFingerprint,
} from "@/features/file-watch/lib/external-change";
import { LlmWikiPanel, useLlmWikiWorkspace } from "@/features/llm-wiki";
import { MemoryPanel, useMemoryWorkspace } from "@/features/memory";
import { DiffViewer } from "@/features/recovery/components/diff-viewer";
import { RecoveryBanner } from "@/features/recovery/components/recovery-banner";
import { useDraftAutosave } from "@/features/recovery/hooks/use-draft-autosave";
import {
  draftCleanupExpired,
  draftDelete,
  draftGet,
  draftListForWorkspace,
  draftSave,
} from "@/features/recovery/lib/draft-client";
import {
  IconButton,
  TextControlButton,
} from "../../../common/components/ui-controls";
import { usePanelResize } from "../hooks/use-panel-resize";
import { syncCliWorkspaceSnapshot } from "../lib/cli-sync";
import { refreshCleanOpenTabFromDisk } from "../lib/cli-file-updated";
import { parseMarkdownOutline } from "../lib/outline";
import { calculateWorkspacePanelLayout } from "../lib/panel-layout";
import { isMarkdownFilePath, normalizeWorkspacePath } from "../lib/path";
import {
  buildRightPanelTabs,
  type RightPanelTabId,
} from "../lib/right-panel-tabs";
import { scrollRenderedHeadingIntoView } from "../lib/outline-scroll";
import {
  collectDirtySearchOverrides,
  ensureWorkspaceSearchState,
  normalizeSearchQuery,
  queueWorkspaceSearchCancellation,
  shouldAcceptSearchResponse,
} from "../lib/workspace-search";
import { createTabSaveQueue, dirname } from "../lib/workspace-save";
import { dirtyWorkspacePaths } from "../lib/dirty-paths";
import { workspaceReducer } from "../lib/workspace-reducer";
import { resolveWikilinkFile } from "../lib/wikilink";
import type { DraftRecord, DraftSummary } from "@/features/recovery/lib/types";
import type {
  CliCloseEvent,
  CliFileCreatedEvent,
  CliFileUpdatedEvent,
  CliFolderCreatedEvent,
  CliInsertEvent,
  CliOpenFileEvent,
  CliPathRenamedEvent,
  CliSelectionSnapshot,
  CliTabEvent,
  FileTreeNode,
  AppPreferences,
  PendingCliEditorCommand,
  WorkspaceFileTreeActions,
  WorkspaceMenuActions,
  WorkspaceAction,
  WorkspaceSearchResponse,
  WorkspaceSearchResultItem,
  WorkspaceState,
  WorkspaceTab,
} from "../lib/types";
import type { SaveQueue } from "../lib/workspace-save";
import { EditorStage } from "./editor-stage";
import { FileTreePanel } from "./file-tree-panel";
import { useAppDialogs } from "./app-dialogs";
import { OutlinePanel } from "./outline-panel";
import { SettingsButton } from "./settings-button";
import { TabStrip } from "./tab-strip";
import type {
  FrontendFileWatchEvent,
  SelfWriteMarker,
  WatchErrorPayload,
} from "@/features/file-watch/lib/types";

interface WorkspaceShellProps {
  workspace: WorkspaceState;
  dispatch: (action: WorkspaceAction) => void;
  onChooseWorkspace: () => void;
  canChooseWorkspace: boolean;
  message?: string | null;
  preferences: AppPreferences;
  onPreferencesChange: (preferences: AppPreferences) => Promise<void>;
  onActionsChange: (actions: WorkspaceMenuActions | null) => void;
}

interface ScanWorkspaceResult {
  rootPath: string;
  nodes: FileTreeNode[];
}

interface CreateMarkdownFileResult {
  path: string;
  name: string;
  needsRenameOnFirstSave?: boolean;
}

interface ActiveDraftRecovery {
  tabId: string;
  path: string;
  draft: DraftRecord;
  fileExists: boolean;
}

interface ExternalWorkspaceConflict {
  tabId: string;
  path: string;
  diskMarkdown: string;
}

interface ExternalDeletedPrompt {
  tabId: string;
  path: string;
  dirty: boolean;
}

const RIGHT_PANEL_TABS = buildRightPanelTabs();

export function WorkspaceShell({
  workspace,
  dispatch,
  onChooseWorkspace,
  canChooseWorkspace,
  message,
  preferences,
  onPreferencesChange,
  onActionsChange,
}: WorkspaceShellProps) {
  const dialogs = useAppDialogs();
  const workspaceRef = useRef(workspace);
  const saveQueueRef = useRef<SaveQueue | null>(null);
  const workspaceRootRef = useRef<string | null>(null);
  const syncedCliWorkspaceRootRef = useRef<string | null>(null);
  const autosaveCreateFlushTaskRef = useRef<() => () => Promise<void>>(
    () => async () => {},
  );
  const draftMutationByPathRef = useRef<Record<string, Promise<void>>>({});
  const pendingSaveAsDraftByTabRef = useRef<Record<string, DraftSummary>>({});
  const editorViewportRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionByTabRef = useRef<Record<string, CliSelectionSnapshot | null>>(
    {},
  );
  const selfWriteMarkerRef = useRef<SelfWriteMarker | null>(null);
  const selfWriteMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [fileTreeActions, setFileTreeActions] =
    useState<WorkspaceFileTreeActions | null>(null);
  const [pendingCliCommand, setPendingCliCommand] =
    useState<PendingCliEditorCommand | null>(null);
  const [leftPanelMode, setLeftPanelMode] = useState<"tree" | "search">(
    "tree",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] =
    useState<RightPanelTabId>("outline");
  const [workspaceBodyWidth, setWorkspaceBodyWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [initialEditorLoadSettled, setInitialEditorLoadSettled] =
    useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [activeDraftRecovery, setActiveDraftRecovery] =
    useState<ActiveDraftRecovery | null>(null);
  const [activeDraftDetailsOpen, setActiveDraftDetailsOpen] = useState(true);
  const [activeDraftDiffOpen, setActiveDraftDiffOpen] = useState(false);
  const [externalConflict, setExternalConflict] =
    useState<ExternalWorkspaceConflict | null>(null);
  const [externalConflictDiffOpen, setExternalConflictDiffOpen] =
    useState(false);
  const [externalDeletedPrompt, setExternalDeletedPrompt] =
    useState<ExternalDeletedPrompt | null>(null);
  const externalConflictRef = useRef<ExternalWorkspaceConflict | null>(null);
  const externalDeletedPromptRef = useRef<ExternalDeletedPrompt | null>(null);
  const externalPathVersionsRef = useRef<Record<string, number>>({});
  const activeSearchRequestIdRef = useRef<string | null>(null);
  const searchCancellationRef = useRef<Promise<void>>(Promise.resolve());
  const [orphanDrafts, setOrphanDrafts] = useState<DraftSummary[]>([]);
  const [postponedOrphanDraftIds, setPostponedOrphanDraftIds] = useState<
    Set<string>
  >(() => new Set());
  const llmWiki = useLlmWikiWorkspace(workspace.rootPath, {
    canAutoProcess: initialEditorLoadSettled,
  });
  const memory = useMemoryWorkspace(workspace.rootPath);
  const handleRawFileSavedRef = useRef(llmWiki.handleRawFileSaved);
  const treeFilterQuery = workspace.treeFilterQuery ?? "";
  const fullTextSearchState = ensureWorkspaceSearchState(workspace.search);
  const tabs = workspace.tabOrder
    .map((tabId) => workspace.tabs[tabId])
    .filter((tab): tab is WorkspaceTab => Boolean(tab));
  const activeTab = workspace.activeTabId
    ? (workspace.tabs[workspace.activeTabId] ?? null)
    : null;
  const activeTabId = activeTab?.tabId ?? null;
  const activeTabPath = activeTab?.path ?? null;
  const activeTabMarkdownLoaded = activeTab?.markdown !== undefined;
  const activeHeadings = useMemo(
    () =>
      activeTab?.markdown === undefined
        ? []
        : parseMarkdownOutline(activeTab.markdown),
    [activeTab],
  );
  const activeTabIsLoadedMarkdown = Boolean(
    activeTabPath &&
    isMarkdownFilePath(activeTabPath) &&
    activeTabMarkdownLoaded,
  );
  const handleDraftAutosaveError = useCallback((error: unknown) => {
    console.warn("Failed to autosave workspace draft.", error);
  }, []);
  const draftAutosave = useDraftAutosave({
    enabled: isTauriRuntime(),
    realPath: activeTabIsLoadedMarkdown ? activeTabPath : null,
    displayPath: activeTabIsLoadedMarkdown ? activeTabPath : null,
    markdown: activeTabIsLoadedMarkdown ? (activeTab?.markdown ?? null) : null,
    dirty: activeTabIsLoadedMarkdown ? (activeTab?.dirty ?? false) : false,
    baseFingerprint: activeTabIsLoadedMarkdown
      ? (activeTab?.baseFingerprint ?? null)
      : null,
    mode: "workspace",
    onError: handleDraftAutosaveError,
  });
  const visibleOrphanDrafts = useMemo(
    () =>
      orphanDrafts.filter(
        (draft) => !postponedOrphanDraftIds.has(draft.draftId),
      ),
    [orphanDrafts, postponedOrphanDraftIds],
  );
  const activeExternalConflict =
    externalConflict?.tabId === activeTabId ? externalConflict : null;
  const activeExternalDeletedPrompt =
    externalDeletedPrompt?.tabId === activeTabId
      ? externalDeletedPrompt
      : null;

  useEffect(() => {
    externalConflictRef.current = externalConflict;
  }, [externalConflict]);

  useEffect(() => {
    externalDeletedPromptRef.current = externalDeletedPrompt;
  }, [externalDeletedPrompt]);

  useEffect(() => {
    externalPathVersionsRef.current = {};
    setInitialEditorLoadSettled(false);
    setPostponedOrphanDraftIds(new Set());
    setExternalConflict(null);
    setExternalConflictDiffOpen(false);
    setExternalDeletedPrompt(null);
  }, [workspace.rootPath]);

  useEffect(() => {
    if (
      !activeTab ||
      activeTab.markdown !== undefined ||
      !isMarkdownFilePath(activeTab.path)
    ) {
      setInitialEditorLoadSettled(true);
    }
  }, [activeTab]);

  useEffect(() => {
    autosaveCreateFlushTaskRef.current = draftAutosave.createFlushTask;
  }, [draftAutosave.createFlushTask]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    void draftCleanupExpired(30).catch((error) => {
      console.warn("Failed to clean expired drafts.", error);
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setDraftMessage(null);
      setOrphanDrafts([]);
      setPostponedOrphanDraftIds(new Set());
      return;
    }

    let cancelled = false;
    const rootPath = workspace.rootPath;

    async function loadWorkspaceDrafts() {
      try {
        const result = await draftListForWorkspace(rootPath);

        if (cancelled || workspaceRef.current.rootPath !== rootPath) {
          return;
        }

        const orphanedDrafts = result.drafts.filter(
          (draft) => !draft.fileExists,
        );
        setOrphanDrafts(orphanedDrafts);
        setDraftMessage(
          result.drafts.length > 0
            ? `发现 ${result.drafts.length} 个未保存草稿`
            : null,
        );
      } catch (error) {
        if (!cancelled && workspaceRef.current.rootPath === rootPath) {
          console.warn("Failed to list workspace drafts.", error);
          setDraftMessage(null);
          setOrphanDrafts([]);
        }
      }
    }

    void loadWorkspaceDrafts();

    return () => {
      cancelled = true;
    };
  }, [workspace.rootPath]);

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      !activeTabIsLoadedMarkdown ||
      !activeTabId ||
      !activeTabPath
    ) {
      setActiveDraftRecovery(null);
      setActiveDraftDiffOpen(false);
      return;
    }

    let cancelled = false;
    const tabId = activeTabId;
    const path = activeTabPath;
    setActiveDraftRecovery((current) =>
      current && (current.tabId !== tabId || current.path !== path)
        ? null
        : current,
    );
    setActiveDraftDiffOpen(false);

    async function loadActiveDraft() {
      try {
        const result = await draftGet(path);

        if (
          cancelled ||
          workspaceRef.current.activeTabId !== tabId ||
          workspaceRef.current.tabs[tabId]?.path !== path
        ) {
          return;
        }

        setActiveDraftRecovery((current) => {
          if (!result.draft) {
            return current?.tabId === tabId && current.path === path
              ? null
              : current;
          }

          if (
            current?.tabId === tabId &&
            current.path === path &&
            current.draft.draftId === result.draft.draftId
          ) {
            return {
              ...current,
              draft: result.draft,
              fileExists: result.fileExists,
            };
          }

          return {
            tabId,
            path,
            draft: result.draft,
            fileExists: result.fileExists,
          };
        });
        if (result.draft) {
          setActiveDraftDetailsOpen(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load active workspace draft.", error);
        }
      }
    }

    void loadActiveDraft();

    return () => {
      cancelled = true;
    };
  }, [
    activeTabId,
    activeTabIsLoadedMarkdown,
    activeTabMarkdownLoaded,
    activeTabPath,
  ]);

  useLayoutEffect(() => {
    workspaceRef.current = workspace;
    handleRawFileSavedRef.current = llmWiki.handleRawFileSaved;
    if (workspaceRootRef.current !== workspace.rootPath) {
      workspaceRootRef.current = workspace.rootPath;
      saveQueueRef.current = null;
    }
  }, [llmWiki.handleRawFileSaved, workspace]);

  useEffect(() => {
    if (
      syncedCliWorkspaceRootRef.current === workspace.rootPath ||
      !isTauriRuntime()
    ) {
      return;
    }

    syncedCliWorkspaceRootRef.current = workspace.rootPath;
    void syncCliWorkspaceSnapshot(workspace, selectionByTabRef.current).catch(
      (error) => {
        console.warn("Failed to sync CLI workspace snapshot.", error);
      },
    );
  }, [workspace]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const paths = dirtyWorkspacePaths(workspace);
    void tauriCore()
      .then(({ invoke }) => invoke("update_workspace_dirty_paths", { paths }))
      .catch((error) => {
        console.warn("Failed to update workspace dirty paths.", error);
      });
  }, [workspace]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    return () => {
      void tauriCore()
        .then(({ invoke }) =>
          invoke("update_workspace_dirty_paths", { paths: [] }),
        )
        .catch((error) => {
          console.warn("Failed to clear workspace dirty paths.", error);
        });
    };
  }, []);

  const enqueueWorkspaceDraftMutation = useCallback(
    (realPath: string, mutation: () => Promise<void>) => {
      const key = normalizeWorkspacePath(realPath);
      const previous = draftMutationByPathRef.current[key] ?? Promise.resolve();
      const next = previous.then(mutation);
      const stored = next.catch(() => undefined);

      draftMutationByPathRef.current = {
        ...draftMutationByPathRef.current,
        [key]: stored,
      };
      stored.then(() => {
        if (draftMutationByPathRef.current[key] !== stored) {
          return;
        }

        const remaining = { ...draftMutationByPathRef.current };
        delete remaining[key];
        draftMutationByPathRef.current = remaining;
      });

      return next;
    },
    [],
  );
  const deleteWorkspaceDraftForPath = useCallback(
    async (realPath: string, draftId?: string) => {
      await enqueueWorkspaceDraftMutation(realPath, async () => {
        if (draftId) {
          await draftDelete({ draftId, realPath });
          return;
        }

        await draftDelete({ realPath });
      });
    },
    [enqueueWorkspaceDraftMutation],
  );
  const flushWorkspaceDraftForTab = useCallback(
    async (tab: WorkspaceTab | undefined) => {
      if (!shouldSaveWorkspaceTabDraft(tab)) {
        return;
      }

      try {
        const flushTask =
          tab.tabId === workspaceRef.current.activeTabId
            ? autosaveCreateFlushTaskRef.current()
            : async () => {
                await draftSave({
                  realPath: tab.path,
                  displayPath: tab.path,
                  markdown: tab.markdown,
                  baseFingerprint: tab.baseFingerprint ?? null,
                  mode: "workspace",
                });
              };

        await enqueueWorkspaceDraftMutation(tab.path, flushTask);
      } catch (error) {
        console.warn("Failed to flush workspace draft.", error);
      }
    },
    [enqueueWorkspaceDraftMutation],
  );
  const deleteWorkspaceDraftForTab = useCallback(
    async (tab: WorkspaceTab | undefined) => {
      if (!isTauriRuntime() || !tab || !isMarkdownFilePath(tab.path)) {
        return;
      }

      try {
        await deleteWorkspaceDraftForPath(tab.path);
      } catch (error) {
        console.warn("Failed to delete discarded workspace draft.", error);
      }
    },
    [deleteWorkspaceDraftForPath],
  );

  const dispatchAndMirror = useCallback(
    (action: WorkspaceAction, options?: { skipDraftFlush?: boolean }) => {
      if (!options?.skipDraftFlush) {
        const tabsToFlush = draftTabsForAction(workspaceRef.current, action);
        for (const tab of tabsToFlush) {
          void flushWorkspaceDraftForTab(tab);
        }
      }

      workspaceRef.current = workspaceReducer(workspaceRef.current, action);
      dispatch(action);
      if (isTauriRuntime()) {
        void syncCliWorkspaceSnapshot(
          workspaceRef.current,
          selectionByTabRef.current,
        ).catch((error) => {
          console.warn("Failed to sync CLI workspace snapshot.", error);
        });
      }
    },
    [dispatch, flushWorkspaceDraftForTab],
  );

  const refreshCurrentTree = useCallback(async () => {
    await refreshTree(
      workspaceRef.current.rootPath,
      () => workspaceRef.current.rootPath,
      dispatchAndMirror,
      preferences,
    );
  }, [dispatchAndMirror, preferences]);

  const readWorkspaceMarkdown = useCallback(async (path: string) => {
    const { invoke } = await tauriCore();

    return invoke<string>("read_markdown_file", {
      rootPath: workspaceRef.current.rootPath,
      path,
    });
  }, []);

  const cancelWorkspaceSearchRequest = useCallback(
    async (requestId: string | null) => {
      if (!requestId || !isTauriRuntime()) {
        return;
      }

      try {
        const { invoke } = await tauriCore();
        await invoke("workspace_search_cancel", {
          requestId,
        });
      } catch (error) {
        if (!isSearchRequestNotFoundError(error)) {
          console.warn("Failed to cancel workspace search request.", error);
        }
      } finally {
        if (activeSearchRequestIdRef.current === requestId) {
          activeSearchRequestIdRef.current = null;
        }
      }
    },
    [],
  );

  const clearSelfWriteMarker = useCallback(() => {
    selfWriteMarkerRef.current = null;

    if (selfWriteMarkerTimerRef.current) {
      clearTimeout(selfWriteMarkerTimerRef.current);
      selfWriteMarkerTimerRef.current = null;
    }
  }, []);

  const rememberSelfWrite = useCallback(
    (path: string, markdown: string) => {
      clearSelfWriteMarker();
      selfWriteMarkerRef.current = {
        path,
        markdown,
        fingerprint: documentFingerprint(markdown),
      };
      selfWriteMarkerTimerRef.current = setTimeout(() => {
        selfWriteMarkerRef.current = null;
        selfWriteMarkerTimerRef.current = null;
      }, 5_000);
    },
    [clearSelfWriteMarker],
  );

  const clearSavedExternalPrompts = useCallback(
    (savedTabId: string | undefined, savedPath: string) => {
      const normalizedSavedPath = normalizeWorkspacePath(savedPath);
      const matchesSavedPath = (tabId: string, path: string) =>
        (savedTabId !== undefined && tabId === savedTabId) ||
        normalizeWorkspacePath(path) === normalizedSavedPath;

      const conflict = externalConflictRef.current;

      if (conflict && matchesSavedPath(conflict.tabId, conflict.path)) {
        externalConflictRef.current = null;
        setExternalConflict(null);
        setExternalConflictDiffOpen(false);
      }

      const deletedPrompt = externalDeletedPromptRef.current;

      if (
        deletedPrompt &&
        matchesSavedPath(deletedPrompt.tabId, deletedPrompt.path)
      ) {
        externalDeletedPromptRef.current = null;
        setExternalDeletedPrompt(null);
      }
    },
    [],
  );

  const externalPathVersion = useCallback((path: string) => {
    return externalPathVersionsRef.current[normalizeWorkspacePath(path)] ?? 0;
  }, []);

  const bumpExternalPathVersion = useCallback((path: string) => {
    const normalizedPath = normalizeWorkspacePath(path);
    const nextVersion =
      (externalPathVersionsRef.current[normalizedPath] ?? 0) + 1;

    externalPathVersionsRef.current = {
      ...externalPathVersionsRef.current,
      [normalizedPath]: nextVersion,
    };

    return nextVersion;
  }, []);

  const isCurrentExternalPathVersion = useCallback(
    (path: string, version: number) => {
      return externalPathVersion(path) === version;
    },
    [externalPathVersion],
  );

  const bumpSavedExternalPaths = useCallback(
    (path: string, previousPath?: string) => {
      bumpExternalPathVersion(path);
      if (
        previousPath &&
        normalizeWorkspacePath(previousPath) !== normalizeWorkspacePath(path)
      ) {
        bumpExternalPathVersion(previousPath);
      }
    },
    [bumpExternalPathVersion],
  );

  const clearExternalDeletedPromptForTab = useCallback((tabId: string) => {
    setExternalDeletedPrompt((prompt) =>
      prompt?.tabId === tabId ? null : prompt,
    );
  }, []);

  const clearExternalPromptsForPathPrefix = useCallback((path: string) => {
    const conflict = externalConflictRef.current;

    if (conflict && isPathUnderPrefix(conflict.path, path)) {
      externalConflictRef.current = null;
      setExternalConflict(null);
      setExternalConflictDiffOpen(false);
    }

    const deletedPrompt = externalDeletedPromptRef.current;

    if (deletedPrompt && isPathUnderPrefix(deletedPrompt.path, path)) {
      externalDeletedPromptRef.current = null;
      setExternalDeletedPrompt(null);
    }
  }, []);

  const reloadCleanWorkspaceTab = useCallback(
    async (tabId: string, path: string, pathVersion: number) => {
      try {
        const markdown = await readWorkspaceMarkdown(path);
        const current = workspaceRef.current.tabs[tabId];

        if (
          isCurrentExternalPathVersion(path, pathVersion) &&
          current &&
          !current.dirty &&
          normalizeWorkspacePath(current.path) === normalizeWorkspacePath(path)
        ) {
          dispatchAndMirror({
            type: "tab/saved",
            tabId,
            markdown,
            fingerprint: documentFingerprint(markdown),
          });
          setExternalConflict((conflict) =>
            conflict?.tabId === tabId ? null : conflict,
          );
          clearExternalDeletedPromptForTab(tabId);
        }
      } catch (error) {
        console.warn("Failed to reload externally changed file.", error);
      }
    },
    [
      clearExternalDeletedPromptForTab,
      dispatchAndMirror,
      isCurrentExternalPathVersion,
      readWorkspaceMarkdown,
    ],
  );

  const showExternalConflict = useCallback(
    async (tabId: string, path: string, pathVersion: number) => {
      try {
        const diskMarkdown = await readWorkspaceMarkdown(path);
        const current = workspaceRef.current.tabs[tabId];

        if (
          isCurrentExternalPathVersion(path, pathVersion) &&
          current &&
          current.dirty &&
          normalizeWorkspacePath(current.path) === normalizeWorkspacePath(path)
        ) {
          setExternalConflict({
            tabId,
            path: normalizeWorkspacePath(path),
            diskMarkdown,
          });
          setExternalConflictDiffOpen(true);
          clearExternalDeletedPromptForTab(tabId);
        }
      } catch (error) {
        console.warn("Failed to load externally changed file.", error);
      }
    },
    [
      clearExternalDeletedPromptForTab,
      isCurrentExternalPathVersion,
      readWorkspaceMarkdown,
    ],
  );

  const showExternalDeletedPrompt = useCallback(
    async (
      tabId: string,
      path: string,
      dirty: boolean,
      pathVersion: number,
    ) => {
      let diskMarkdown: string | null = null;

      try {
        diskMarkdown = await readWorkspaceMarkdown(path);
      } catch {
        diskMarkdown = null;
      }

      const current = workspaceRef.current.tabs[tabId];

      if (
        !isCurrentExternalPathVersion(path, pathVersion) ||
        !current ||
        normalizeWorkspacePath(current.path) !== normalizeWorkspacePath(path)
      ) {
        return;
      }

        if (diskMarkdown !== null) {
        if (current.dirty) {
          setExternalConflict({
            tabId,
            path: normalizeWorkspacePath(path),
            diskMarkdown,
          });
          setExternalConflictDiffOpen(true);
          clearExternalDeletedPromptForTab(tabId);
        } else {
          dispatchAndMirror({
            type: "tab/saved",
            tabId,
            markdown: diskMarkdown,
            fingerprint: documentFingerprint(diskMarkdown),
          });
          clearExternalDeletedPromptForTab(tabId);
        }
        return;
      }

      setExternalDeletedPrompt({
        tabId,
        path,
        dirty,
      });
      setExternalConflict((conflict) =>
        conflict?.tabId === tabId ? null : conflict,
      );
    },
    [
      clearExternalDeletedPromptForTab,
      dispatchAndMirror,
      isCurrentExternalPathVersion,
      readWorkspaceMarkdown,
    ],
  );

  const handleFileWatchEvent = useCallback(
    (event: FrontendFileWatchEvent) => {
      const pathVersion = bumpExternalPathVersion(event.path);
      if (event.kind === "renamed") {
        bumpExternalPathVersion(event.newPath);
      }
      const decision = decideWorkspaceExternalChange({
        workspace: workspaceRef.current,
        event,
        selfWrite: selfWriteMarkerRef.current,
      });

      switch (decision.kind) {
        case "ignore":
          return;
        case "refreshTree":
          void refreshCurrentTree().catch((error) => {
            console.warn("Failed to refresh workspace after file watch event.", error);
          });
          return;
        case "remapPath":
          clearExternalPromptsForPathPrefix(decision.fromPath);
          clearExternalPromptsForPathPrefix(decision.toPath);
          dispatchAndMirror({
            type: "tab/pathRemapped",
            fromPath: decision.fromPath,
            toPath: decision.toPath,
          });
          void refreshCurrentTree().catch((error) => {
            console.warn("Failed to refresh workspace after file rename.", error);
          });
          return;
        case "remapPathAndPrefix":
          clearExternalPromptsForPathPrefix(decision.fromPath);
          clearExternalPromptsForPathPrefix(decision.toPath);
          dispatchAndMirror({
            type: "tab/pathRemapped",
            fromPath: decision.fromPath,
            toPath: decision.toPath,
          });
          dispatchAndMirror({
            type: "tab/prefixRemapped",
            affectedPrefix: {
              oldPrefix: decision.oldPrefix,
              newPrefix: decision.newPrefix,
            },
          });
          void refreshCurrentTree().catch((error) => {
            console.warn("Failed to refresh workspace after file rename.", error);
          });
          return;
        case "reloadCleanTab":
          void reloadCleanWorkspaceTab(
            decision.tabId,
            decision.path,
            pathVersion,
          );
          if (event.kind === "created") {
            void refreshCurrentTree().catch((error) => {
              console.warn("Failed to refresh workspace after file creation.", error);
            });
          }
          return;
        case "showConflict":
          void showExternalConflict(
            decision.tabId,
            decision.path,
            pathVersion,
          );
          if (event.kind === "created") {
            void refreshCurrentTree().catch((error) => {
              console.warn("Failed to refresh workspace after file creation.", error);
            });
          }
          return;
        case "showDeletedPrompt":
          void showExternalDeletedPrompt(
            decision.tabId,
            decision.path,
            decision.dirty,
            pathVersion,
          );
          void refreshCurrentTree().catch((error) => {
            console.warn("Failed to refresh workspace after file deletion.", error);
          });
          return;
      }
    },
    [
      bumpExternalPathVersion,
      clearExternalPromptsForPathPrefix,
      dispatchAndMirror,
      refreshCurrentTree,
      reloadCleanWorkspaceTab,
      showExternalConflict,
      showExternalDeletedPrompt,
    ],
  );

  const handleFileWatchError = useCallback((error: WatchErrorPayload) => {
    console.warn("Workspace file watch error.", error);
  }, []);

  useFileWatch({
    mode: "workspace",
    rootPath: workspace.rootPath,
    preferences,
    onEvent: handleFileWatchEvent,
    onError: handleFileWatchError,
  });

  useEffect(() => {
    const normalizedQuery = normalizeSearchQuery(fullTextSearchState.query);
    const previousRequestId = activeSearchRequestIdRef.current;
    activeSearchRequestIdRef.current = null;

    if (!isTauriRuntime()) {
      return;
    }

    searchCancellationRef.current = queueWorkspaceSearchCancellation(
      searchCancellationRef.current,
      previousRequestId
        ? () => cancelWorkspaceSearchRequest(previousRequestId)
        : null,
    );

    if (normalizedQuery.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const requestId = nanoid(8);
      activeSearchRequestIdRef.current = requestId;
      dispatchAndMirror({
        type: "search/requestStarted",
        requestId,
      });

      void (async () => {
        await searchCancellationRef.current;

        if (activeSearchRequestIdRef.current !== requestId) {
          return;
        }

        try {
          const { invoke } = await tauriCore();

          if (activeSearchRequestIdRef.current !== requestId) {
            return;
          }

          const response = await invoke<WorkspaceSearchResponse>(
            "workspace_search",
            {
              request: {
                rootPath: workspace.rootPath,
                query: normalizedQuery,
                caseSensitive: fullTextSearchState.caseSensitive,
                maxFileBytes: preferences.searchMaxFileBytes,
                maxResults: preferences.searchMaxResults,
                maxMatchesPerFile: preferences.searchMaxMatchesPerFile,
                dirtyOverrides: collectDirtySearchOverrides(
                  workspaceRef.current,
                ),
                requestId,
              },
            },
          );

          if (
            !shouldAcceptSearchResponse(
              activeSearchRequestIdRef.current,
              response,
            )
          ) {
            return;
          }

          activeSearchRequestIdRef.current = null;
          dispatchAndMirror({
            type: "search/requestCompleted",
            requestId: response.requestId,
            results: response.results,
            summary: {
              skippedLargeFiles: response.skippedLargeFiles,
              skippedUnreadableFiles: response.skippedUnreadableFiles,
              truncated: response.truncated,
              searchedFiles: response.searchedFiles,
            },
          });
        } catch (error) {
          if (activeSearchRequestIdRef.current !== requestId) {
            return;
          }

          activeSearchRequestIdRef.current = null;
          dispatchAndMirror({
            type: "search/requestFailed",
            requestId,
            error: formatError(error, "工作区搜索失败。"),
          });
        }
      })();
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    cancelWorkspaceSearchRequest,
    dispatchAndMirror,
    preferences.searchMaxFileBytes,
    preferences.searchMaxMatchesPerFile,
    preferences.searchMaxResults,
    fullTextSearchState.caseSensitive,
    fullTextSearchState.query,
    workspace.rootPath,
  ]);

  useEffect(() => {
    return () => {
      const activeRequestId = activeSearchRequestIdRef.current;
      clearSelfWriteMarker();
      searchCancellationRef.current = queueWorkspaceSearchCancellation(
        searchCancellationRef.current,
        activeRequestId
          ? () => cancelWorkspaceSearchRequest(activeRequestId)
          : null,
      );
    };
  }, [cancelWorkspaceSearchRequest, clearSelfWriteMarker]);

  const leftPanel = usePanelResize({
    side: "left",
    panel: workspace.panel,
    dispatch: dispatchAndMirror,
  });
  const rightPanel = usePanelResize({
    side: "right",
    panel: workspace.panel,
    dispatch: dispatchAndMirror,
  });

  const removeOrphanDraft = useCallback((draftId: string) => {
    setOrphanDrafts((current) =>
      current.filter((draft) => draft.draftId !== draftId),
    );
    setPostponedOrphanDraftIds((current) => {
      if (!current.has(draftId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(draftId);
      return next;
    });
  }, []);

  const recoverActiveDraft = useCallback(() => {
    const recovery = activeDraftRecovery;

    if (!recovery) {
      return;
    }

    dispatchAndMirror({
      type: "tab/contentChanged",
      tabId: recovery.tabId,
      markdown: recovery.draft.markdown,
    });
    setActiveDraftRecovery(null);
    setActiveDraftDiffOpen(false);
  }, [activeDraftRecovery, dispatchAndMirror]);

  const keepActiveDiskVersion = useCallback(() => {
    const recovery = activeDraftRecovery;

    if (!recovery) {
      return;
    }

    setActiveDraftRecovery(null);
    setActiveDraftDiffOpen(false);
    void deleteWorkspaceDraftForPath(
      recovery.draft.realPath,
      recovery.draft.draftId,
    ).catch((error) => {
      console.warn("Failed to delete workspace draft.", error);
    });
  }, [activeDraftRecovery, deleteWorkspaceDraftForPath]);

  const postponeActiveDraftRecovery = useCallback(() => {
    setActiveDraftDetailsOpen(false);
    setActiveDraftDiffOpen(false);
  }, []);

  const saveOrphanDraftAs = useCallback(
    async (summary: DraftSummary) => {
      try {
        const result = await draftGet(summary.realPath);
        const draft = result.draft;

        if (!draft) {
          removeOrphanDraft(summary.draftId);
          return;
        }

        const { invoke } = await tauriCore();
        const parentDir = findExistingParentPath(
          workspaceRef.current.rootPath,
          summary.realPath,
          workspaceRef.current.fileTree,
        );
        const created = await invoke<CreateMarkdownFileResult>(
          "create_markdown_file",
          {
            rootPath: workspaceRef.current.rootPath,
            parentDir,
            name: null,
            temporaryUntitled: true,
          },
        );
        const tabId = nanoid(8);
        pendingSaveAsDraftByTabRef.current = {
          ...pendingSaveAsDraftByTabRef.current,
          [tabId]: summary,
        };
        dispatchAndMirror({
          type: "tab/opened",
          tab: {
            tabId,
            path: created.path,
            title: created.name,
            dirty: true,
            needsRenameOnFirstSave: created.needsRenameOnFirstSave ?? true,
            markdown: draft.markdown,
            baseFingerprint: documentFingerprint(""),
          },
        });
      } catch (error) {
        console.warn("Failed to open orphan draft for save-as.", error);
        void dialogs.alert({
          title: "恢复草稿",
          message: formatError(error, "无法另存草稿。"),
        });
      }
    },
    [dialogs, dispatchAndMirror, removeOrphanDraft],
  );

  const restoreOrphanDraftOriginalPath = useCallback(
    async (summary: DraftSummary) => {
      if (
        !parentExistsInWorkspace(
          workspaceRef.current.rootPath,
          summary.realPath,
          workspaceRef.current.fileTree,
        )
      ) {
        return;
      }

      try {
        const result = await draftGet(summary.realPath);
        const draft = result.draft;

        if (!draft) {
          removeOrphanDraft(summary.draftId);
          return;
        }

        const { invoke } = await tauriCore();
        await invoke("write_markdown_file", {
          rootPath: workspaceRef.current.rootPath,
          path: summary.realPath,
          content: draft.markdown,
        });
        await deleteWorkspaceDraftForPath(draft.realPath, draft.draftId);
        removeOrphanDraft(draft.draftId);
        dispatchAndMirror({
          type: "tab/opened",
          tab: {
            tabId: nanoid(8),
            path: summary.realPath,
            title: pathTitle(summary.realPath),
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: draft.markdown,
            baseFingerprint: documentFingerprint(draft.markdown),
          },
        });
        await refreshTree(
          workspaceRef.current.rootPath,
          () => workspaceRef.current.rootPath,
          dispatchAndMirror,
          preferences,
        );
      } catch (error) {
        console.warn("Failed to restore orphan draft original path.", error);
        void dialogs.alert({
          title: "恢复草稿",
          message: formatError(error, "无法恢复原路径。"),
        });
      }
    },
    [
      deleteWorkspaceDraftForPath,
      dialogs,
      dispatchAndMirror,
      preferences,
      removeOrphanDraft,
    ],
  );

  const deleteOrphanDraft = useCallback(
    (summary: DraftSummary) => {
      removeOrphanDraft(summary.draftId);
      void deleteWorkspaceDraftForPath(summary.realPath, summary.draftId).catch(
        (error) => {
          console.warn("Failed to delete orphan workspace draft.", error);
        },
      );
    },
    [deleteWorkspaceDraftForPath, removeOrphanDraft],
  );

  const postponeOrphanDraft = useCallback((summary: DraftSummary) => {
    setPostponedOrphanDraftIds((current) => {
      const next = new Set(current);
      next.add(summary.draftId);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const element = workspaceBodyRef.current;

    if (!element) {
      return;
    }

    const updateWidth = () => {
      setWorkspaceBodyWidth(Math.round(element.getBoundingClientRect().width));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);

      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const saveTab = useCallback(
    async (tabId: string) => {
      await flushWorkspaceDraftForTab(workspaceRef.current.tabs[tabId]);

      saveQueueRef.current ??= createTabSaveQueue({
        getWorkspace: () => workspaceRef.current,
        dispatch: dispatchAndMirror,
        invoke: async (command, args) => {
          const { invoke } = await tauriCore();
          return invoke(command, args);
        },
        promptName: async (title) =>
          dialogs.prompt({
            title: "保存文件",
            label: "文件名",
            initialValue: title,
            confirmLabel: "保存",
          }),
        alert: (text) =>
          void dialogs.alert({
            title: "保存文件",
            message: text,
          }),
        warn: (text, error) => console.warn(text, error),
        refreshTree: (rootPath) =>
          refreshTree(
            rootPath,
            () => workspaceRef.current.rootPath,
            dispatchAndMirror,
            preferences,
          ),
        afterSave: async (event) => {
          if (event.rootPath !== workspaceRef.current.rootPath) {
            return;
          }

          const savedTabId = findTabIdByPath(workspaceRef.current, event.path);
          const saveAsDraft = savedTabId
            ? pendingSaveAsDraftByTabRef.current[savedTabId]
            : undefined;
          const savedTab = savedTabId
            ? workspaceRef.current.tabs[savedTabId]
            : undefined;
          bumpSavedExternalPaths(event.path, event.previousPath);
          clearSavedExternalPrompts(savedTabId, event.path);
          if (
            event.previousPath &&
            normalizeWorkspacePath(event.previousPath) !==
              normalizeWorkspacePath(event.path)
          ) {
            clearSavedExternalPrompts(savedTabId, event.previousPath);
          }
          if (savedTab?.markdown !== undefined) {
            rememberSelfWrite(event.path, savedTab.markdown);
          }

          try {
            await deleteWorkspaceDraftForPath(event.path);
            if (
              event.previousPath &&
              normalizeWorkspacePath(event.previousPath) !==
                normalizeWorkspacePath(event.path)
            ) {
              await deleteWorkspaceDraftForPath(event.previousPath);
            }
            if (saveAsDraft) {
              await deleteWorkspaceDraftForPath(
                saveAsDraft.realPath,
                saveAsDraft.draftId,
              );
              removeOrphanDraft(saveAsDraft.draftId);
              if (savedTabId) {
                const nextPending = {
                  ...pendingSaveAsDraftByTabRef.current,
                };
                delete nextPending[savedTabId];
                pendingSaveAsDraftByTabRef.current = nextPending;
              }
            }
            setActiveDraftRecovery((current) =>
              current &&
              normalizeWorkspacePath(current.path) ===
                normalizeWorkspacePath(event.path)
                ? null
                : current,
            );
          } catch (error) {
            console.warn("Failed to delete saved workspace draft.", error);
          }

          handleRawFileSavedRef.current(event.path);
        },
      });

      return saveQueueRef.current.saveTab(tabId);
    },
    [
      dialogs,
      deleteWorkspaceDraftForPath,
      dispatchAndMirror,
      flushWorkspaceDraftForTab,
      bumpSavedExternalPaths,
      clearSavedExternalPrompts,
      rememberSelfWrite,
      preferences,
      removeOrphanDraft,
    ],
  );
  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = workspaceRef.current.tabs[tabId];

      if (!tab) {
        return;
      }

      if (!tab.dirty) {
        dispatchAndMirror({
          type: "tab/closed",
          tabId,
        });
        return;
      }

      await flushWorkspaceDraftForTab(tab);

      const choice = await dialogs.choice({
        title: "未保存更改",
        message: `“${tab.title}” 有未保存更改。请选择保存、丢弃或取消。`,
        choices: [
          { label: "保存", value: "save" },
          { label: "丢弃", value: "discard", destructive: true },
        ],
        cancelLabel: "取消",
      });

      if (choice === "discard") {
        await deleteWorkspaceDraftForTab(tab);
        dispatchAndMirror(
          {
            type: "tab/closed",
            tabId,
          },
          { skipDraftFlush: true },
        );
        return;
      }

      if (choice !== "save") {
        return;
      }

      const saved = await saveTab(tabId);

      if (saved) {
        dispatchAndMirror(
          {
            type: "tab/closed",
            tabId,
          },
          { skipDraftFlush: true },
        );
      }
    },
    [
      deleteWorkspaceDraftForTab,
      dialogs,
      dispatchAndMirror,
      flushWorkspaceDraftForTab,
      saveTab,
    ],
  );

  const keepExternalConflictEdits = useCallback(async () => {
    const conflict = externalConflict;

    if (!conflict) {
      return;
    }

    const saved = await saveTab(conflict.tabId);

    if (saved) {
      setExternalConflict(null);
      setExternalConflictDiffOpen(false);
    }
  }, [externalConflict, saveTab]);

  const reloadExternalConflictDiskVersion = useCallback(async () => {
    const conflict = externalConflict;

    if (!conflict) {
      return;
    }

    try {
      const markdown = await readWorkspaceMarkdown(conflict.path);
      const current = workspaceRef.current.tabs[conflict.tabId];

      if (
        current &&
        normalizeWorkspacePath(current.path) === normalizeWorkspacePath(conflict.path)
      ) {
        dispatchAndMirror(
          {
            type: "tab/saved",
            tabId: conflict.tabId,
            markdown,
            fingerprint: documentFingerprint(markdown),
          },
          { skipDraftFlush: true },
        );
        await deleteWorkspaceDraftForPath(conflict.path);
      }
      setExternalConflict(null);
      setExternalConflictDiffOpen(false);
    } catch (error) {
      void dialogs.alert({
        title: "重新加载失败",
        message: formatError(error, "无法重新加载磁盘版本。"),
      });
    }
  }, [deleteWorkspaceDraftForPath, dialogs, dispatchAndMirror, externalConflict, readWorkspaceMarkdown]);

  const postponeExternalConflict = useCallback(() => {
    setExternalConflictDiffOpen(false);
  }, []);

  const copyExternalConflictMarkdown = useCallback(() => {
    const conflict = externalConflict;
    const markdown = conflict
      ? (workspaceRef.current.tabs[conflict.tabId]?.markdown ?? "")
      : "";
    setExternalConflictDiffOpen(false);

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(markdown).catch((error) => {
        console.warn("Failed to copy current workspace markdown.", error);
      });
    }
  }, [externalConflict]);

  const closeDeletedWorkspaceTab = useCallback(
    async (tabId: string, options?: { discardDirty?: boolean }) => {
      const tab = workspaceRef.current.tabs[tabId];

      if (options?.discardDirty) {
        await deleteWorkspaceDraftForTab(tab);
        dispatchAndMirror(
          {
            type: "tab/closed",
            tabId,
          },
          { skipDraftFlush: true },
        );
        setExternalDeletedPrompt((prompt) =>
          prompt?.tabId === tabId ? null : prompt,
        );
        return;
      }

      await closeTab(tabId);
      setExternalDeletedPrompt((prompt) =>
        prompt?.tabId === tabId && !workspaceRef.current.tabs[tabId]
          ? null
          : prompt,
      );
    },
    [closeTab, deleteWorkspaceDraftForTab, dispatchAndMirror],
  );

  const openDeletedWorkspaceTabSaveAs = useCallback(
    async (prompt: ExternalDeletedPrompt) => {
      const tab = workspaceRef.current.tabs[prompt.tabId];

      if (!tab) {
        setExternalDeletedPrompt((current) =>
          current?.tabId === prompt.tabId ? null : current,
        );
        return;
      }

      try {
        const { invoke } = await tauriCore();
        const parentDir = findExistingParentPath(
          workspaceRef.current.rootPath,
          prompt.path,
          workspaceRef.current.fileTree,
        );
        const created = await invoke<CreateMarkdownFileResult>(
          "create_markdown_file",
          {
            rootPath: workspaceRef.current.rootPath,
            parentDir,
            name: null,
            temporaryUntitled: true,
          },
        );
        dispatchAndMirror({
          type: "tab/opened",
          tab: {
            tabId: nanoid(8),
            path: created.path,
            title: created.name,
            dirty: true,
            needsRenameOnFirstSave: created.needsRenameOnFirstSave ?? true,
            markdown: tab.markdown ?? "",
            baseFingerprint: documentFingerprint(""),
          },
        });
        await deleteWorkspaceDraftForTab(tab);
        dispatchAndMirror(
          {
            type: "tab/closed",
            tabId: prompt.tabId,
          },
          { skipDraftFlush: true },
        );
        setExternalDeletedPrompt((current) =>
          current?.tabId === prompt.tabId ? null : current,
        );
        await refreshCurrentTree();
      } catch (error) {
        void dialogs.alert({
          title: "另存为",
          message: formatError(error, "无法创建另存文件。"),
        });
      }
    },
    [deleteWorkspaceDraftForTab, dialogs, dispatchAndMirror, refreshCurrentTree],
  );

  const restoreDeletedWorkspaceTabOriginalPath = useCallback(
    async (prompt: ExternalDeletedPrompt) => {
      const tab = workspaceRef.current.tabs[prompt.tabId];

      if (!tab || tab.markdown === undefined) {
        return;
      }

      try {
        const { invoke } = await tauriCore();
        await invoke("write_markdown_file", {
          rootPath: workspaceRef.current.rootPath,
          path: prompt.path,
          content: tab.markdown,
          expectedFingerprint: null,
        });
        rememberSelfWrite(prompt.path, tab.markdown);
        dispatchAndMirror(
          {
            type: "tab/saved",
            tabId: prompt.tabId,
            markdown: tab.markdown,
            fingerprint: documentFingerprint(tab.markdown),
          },
          { skipDraftFlush: true },
        );
        await deleteWorkspaceDraftForTab(tab);
        setExternalDeletedPrompt((current) =>
          current?.tabId === prompt.tabId ? null : current,
        );
        await refreshCurrentTree();
      } catch (error) {
        void dialogs.alert({
          title: "恢复原路径",
          message: formatError(error, "无法恢复原路径。"),
        });
      }
    },
    [
      deleteWorkspaceDraftForTab,
      dialogs,
      dispatchAndMirror,
      refreshCurrentTree,
      rememberSelfWrite,
    ],
  );
  const saveActiveTab = useCallback(async () => {
    const tabId = workspaceRef.current.activeTabId;

    if (tabId) {
      await saveTab(tabId);
    }
  }, [saveTab]);
  const closeActiveTab = useCallback(async () => {
    const tabId = workspaceRef.current.activeTabId;

    if (tabId) {
      await closeTab(tabId);
    }
  }, [closeTab]);
  const workspaceActions = useMemo<WorkspaceMenuActions | null>(() => {
    if (!fileTreeActions) {
      return null;
    }

    return {
      ...fileTreeActions,
      saveActiveTab,
      closeActiveTab,
    };
  }, [closeActiveTab, fileTreeActions, saveActiveTab]);

  useEffect(() => {
    onActionsChange(workspaceActions);

    return () => onActionsChange(null);
  }, [onActionsChange, workspaceActions]);
  const handleSelectionChange = useCallback(
    (tabId: string, selection: Record<string, unknown> | null) => {
      selectionByTabRef.current = {
        ...selectionByTabRef.current,
        [tabId]: selection as CliSelectionSnapshot | null,
      };
      if (isTauriRuntime()) {
        void syncCliWorkspaceSnapshot(
          workspaceRef.current,
          selectionByTabRef.current,
        ).catch((error) => {
          console.warn("Failed to sync CLI workspace snapshot.", error);
        });
      }
    },
    [],
  );
  const handlePendingCliCommandHandled = useCallback((commandId: string) => {
    setPendingCliCommand((current) =>
      current?.id === commandId ? null : current,
    );
  }, []);
  const queuePendingCliCommand = useCallback(
    (command: PendingCliEditorCommand) => {
      setPendingCliCommand(command);
    },
    [],
  );
  const openWorkspacePathTab = useCallback(
    (path: string) => {
      const currentWorkspace = workspaceRef.current;
      const existingTabId = findTabIdByPath(currentWorkspace, path);

      if (existingTabId) {
        dispatchAndMirror({
          type: "tab/activated",
          tabId: existingTabId,
        });
        return existingTabId;
      }

      const tabId = nanoid(8);
      dispatchAndMirror({
        type: "tab/opened",
        tab: {
          tabId,
          path,
          title: pathTitle(path),
          dirty: false,
          needsRenameOnFirstSave: false,
          baseFingerprint: null,
        },
      });
      return tabId;
    },
    [dispatchAndMirror],
  );
  const handleWorkspaceSearchResultClick = useCallback(
    (result: WorkspaceSearchResultItem) => {
      const tabId = openWorkspacePathTab(result.path);
      queuePendingCliCommand({
        id: nanoid(8),
        kind: "scrollToLine",
        tabId,
        lineNumber: result.lineNumber,
      });
    },
    [openWorkspacePathTab, queuePendingCliCommand],
  );
  const openWikilink = useCallback(
    (target: string, sourcePath: string) => {
      const currentWorkspace = workspaceRef.current;
      const resolvedPath = resolveWikilinkFile(
        currentWorkspace.rootPath,
        sourcePath,
        currentWorkspace.fileTree,
        target,
      );

      if (!resolvedPath) {
        console.warn(`Unable to resolve wikilink: ${target}`);
        return;
      }

      openWorkspacePathTab(resolvedPath);
    },
    [openWorkspacePathTab],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const nextUnlisteners = await Promise.all([
        listen<CliOpenFileEvent>("cli-open-file", (event) => {
          void handleCliOpenFile(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            queuePendingCliCommand,
          );
        }),
        listen<CliInsertEvent>("cli-insert", (event) => {
          handleCliInsert(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            queuePendingCliCommand,
          );
        }),
        listen<CliTabEvent>("cli-focus-tab", (event) => {
          handleCliFocusTab(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            queuePendingCliCommand,
          );
        }),
        listen<CliCloseEvent>("cli-close-tab", (event) => {
          handleCliCloseTab(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
          );
        }),
        listen<CliTabEvent>("cli-save-tab", (event) => {
          void handleCliSaveTab(event.payload, workspaceRef.current, saveTab);
        }),
        listen<CliFileCreatedEvent>("cli-file-created", (event) => {
          void handleCliFileCreated(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            queuePendingCliCommand,
            preferences,
          );
        }),
        listen<CliFileUpdatedEvent>("cli-file-updated", (event) => {
          void handleCliFileUpdated(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
          );
        }),
        listen<CliFolderCreatedEvent>("cli-folder-created", (event) => {
          void handleCliFolderCreated(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            preferences,
          );
        }),
        listen<CliPathRenamedEvent>("cli-path-renamed", (event) => {
          void handleCliPathRenamed(
            event.payload,
            workspaceRef.current,
            dispatchAndMirror,
            preferences,
          );
        }),
      ]);
      unlisteners.push(...nextUnlisteners);

      if (disposed) {
        unlisteners.forEach((unlisten) => unlisten());
      }
    };

    void subscribe().catch((error) => {
      console.warn("Failed to subscribe to CLI events.", error);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [dispatchAndMirror, preferences, queuePendingCliCommand, saveTab]);

  const scrollToHeading = useCallback((_: unknown, index: number) => {
    scrollRenderedHeadingIntoView(editorViewportRef.current, index);
  }, []);
  const panelLayout = calculateWorkspacePanelLayout({
    containerWidth: workspaceBodyWidth,
    leftCollapsed: leftPanel.isCollapsed,
    leftWidth: leftPanel.width,
    rightCollapsed: rightPanel.isCollapsed,
    rightWidth: rightPanel.width,
  });
  const gridTemplateColumns = [
    `${panelLayout.leftWidth}px`,
    "minmax(0, 1fr)",
    `${panelLayout.rightWidth}px`,
  ].join(" ");

  return (
    <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)]">
      <header className="flex min-w-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            onClick={leftPanel.toggleCollapsed}
            label={leftPanel.isCollapsed ? "展开文件树" : "收起文件树"}
            title={leftPanel.isCollapsed ? "展开文件树" : "收起文件树"}
            icon={
              leftPanel.isCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />
            }
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {message ? (
            <div className="max-w-80 truncate text-xs text-warning">
              {message}
            </div>
          ) : null}
          <TextControlButton
            onClick={onChooseWorkspace}
            disabled={!canChooseWorkspace}
          >
            <FolderOpen aria-hidden="true" />
            打开文件夹
          </TextControlButton>
          <SettingsButton
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            workspaceRoot={workspace.rootPath}
            preferences={preferences}
            onPreferencesChange={onPreferencesChange}
            onLlmConfigSaved={llmWiki.refresh}
          />
          <IconButton
            label={rightPanel.isCollapsed ? "展开目录" : "收起目录"}
            icon={
              rightPanel.isCollapsed ? <PanelRightOpen /> : <PanelRightClose />
            }
            onClick={rightPanel.toggleCollapsed}
          />
        </div>
      </header>

      <div
        ref={workspaceBodyRef}
        className="grid min-h-0"
        style={{ gridTemplateColumns }}
      >
        <div className="min-h-0 overflow-hidden" style={{ gridColumn: 1 }}>
          <FileTreePanel
            rootPath={workspace.rootPath}
            fileTree={workspace.fileTree}
            treeFilterQuery={treeFilterQuery}
            mode={leftPanelMode}
            searchState={fullTextSearchState}
            collapsed={leftPanel.isCollapsed}
            dispatch={dispatchAndMirror}
            preferences={preferences}
            activeTabPath={activeTab?.path ?? null}
            onActionsChange={setFileTreeActions}
            onModeChange={setLeftPanelMode}
            onSearchQueryChange={(query) =>
              dispatchAndMirror({
                type: "search/queryChanged",
                query,
              })
            }
            onSearchCaseSensitiveToggle={() =>
              dispatchAndMirror({
                type: "search/caseSensitivityToggled",
              })
            }
            onSearchResultClick={handleWorkspaceSearchResultClick}
            resizeHandleProps={leftPanel.resizeHandleProps}
          />
        </div>

        <main
          className="flex min-h-0 min-w-0 flex-col bg-base-100"
          style={{ gridColumn: 2 }}
        >
          <TabStrip
            tabs={tabs}
            activeTabId={workspace.activeTabId}
            dispatch={dispatchAndMirror}
            onCloseTab={closeTab}
          />
          {draftMessage ? (
            <div className="border-b border-base-300 bg-base-200/60 px-3 py-1.5 text-xs text-base-content/70">
              {draftMessage}
            </div>
          ) : null}
          {activeDraftRecovery ? (
            <RecoveryBanner
              title="发现未保存草稿"
              message={
                activeDraftDetailsOpen
                  ? `${displayPath(activeDraftRecovery.draft)} 有一个自动保存的草稿。`
                  : "自动保存的草稿仍可恢复。"
              }
              priority={activeDraftRecovery.fileExists ? "normal" : "high"}
              actions={[
                {
                  label: "恢复草稿",
                  primary: true,
                  onClick: recoverActiveDraft,
                },
                {
                  label: "查看差异",
                  onClick: () => setActiveDraftDiffOpen(true),
                },
                {
                  label: "保留磁盘版本",
                  onClick: keepActiveDiskVersion,
                },
                {
                  label: "稍后",
                  onClick: postponeActiveDraftRecovery,
                },
              ]}
            />
          ) : null}
          {visibleOrphanDrafts.map((draft) => {
            const canRestoreOriginal = parentExistsInWorkspace(
              workspace.rootPath,
              draft.realPath,
              workspace.fileTree,
            );

            return (
              <RecoveryBanner
                key={draft.draftId}
                title="发现孤立草稿"
                message={
                  canRestoreOriginal
                    ? `${displayPath(draft)} 的原文件不存在，可以恢复到原路径或另存为新文件。`
                    : `${displayPath(draft)} 的原文件不存在，原路径父文件夹也不存在。`
                }
                priority="high"
                actions={[
                  {
                    label: "另存为",
                    primary: true,
                    onClick: () => void saveOrphanDraftAs(draft),
                  },
                  {
                    label: canRestoreOriginal
                      ? "恢复原路径"
                      : "恢复原路径不可用",
                    disabled: !canRestoreOriginal,
                    onClick: () => void restoreOrphanDraftOriginalPath(draft),
                  },
                  {
                    label: "删除",
                    destructive: true,
                    onClick: () => deleteOrphanDraft(draft),
                  },
                  {
                    label: "稍后",
                    onClick: () => postponeOrphanDraft(draft),
                  },
                ]}
              />
            );
          })}
          {activeExternalConflict ? (
            <RecoveryBanner
              title="文件已被外部修改"
              message={`${activeExternalConflict.path} 的磁盘内容已变化，请选择保留当前编辑或重新加载磁盘版本。`}
              priority="high"
              actions={[
                {
                  label: "查看差异",
                  primary: true,
                  onClick: () => setExternalConflictDiffOpen(true),
                },
                {
                  label: "保留我的编辑",
                  onClick: () => void keepExternalConflictEdits(),
                },
                {
                  label: "重新加载磁盘",
                  destructive: true,
                  onClick: () => void reloadExternalConflictDiskVersion(),
                },
                {
                  label: "稍后",
                  onClick: postponeExternalConflict,
                },
              ]}
            />
          ) : null}
          {activeExternalDeletedPrompt ? (
            <RecoveryBanner
              title="文件已被外部删除"
              message={
                activeExternalDeletedPrompt.dirty
                  ? `${activeExternalDeletedPrompt.path} 已从磁盘删除，当前标签页还有未保存编辑。`
                  : `${activeExternalDeletedPrompt.path} 已从磁盘删除。`
              }
              priority={activeExternalDeletedPrompt.dirty ? "high" : "normal"}
              actions={
                activeExternalDeletedPrompt.dirty
                  ? [
                      {
                        label: "另存为",
                        primary: true,
                        onClick: () =>
                          void openDeletedWorkspaceTabSaveAs(
                            activeExternalDeletedPrompt,
                          ),
                      },
                      {
                        label: "恢复原路径",
                        onClick: () =>
                          void restoreDeletedWorkspaceTabOriginalPath(
                            activeExternalDeletedPrompt,
                          ),
                      },
                      {
                        label: "不保存并关闭",
                        destructive: true,
                        onClick: () =>
                          void closeDeletedWorkspaceTab(
                            activeExternalDeletedPrompt.tabId,
                            { discardDirty: true },
                          ),
                      },
                    ]
                  : [
                      {
                        label: "关闭",
                        primary: true,
                        onClick: () =>
                          void closeDeletedWorkspaceTab(
                            activeExternalDeletedPrompt.tabId,
                          ),
                      },
                      {
                        label: "另存为",
                        onClick: () =>
                          void openDeletedWorkspaceTabSaveAs(
                            activeExternalDeletedPrompt,
                          ),
                      },
                    ]
              }
            />
          ) : null}
          <EditorStage
            rootPath={workspace.rootPath}
            activeTab={activeTab}
            dispatch={dispatchAndMirror}
            editorViewportRef={editorViewportRef}
            pendingCliCommand={pendingCliCommand}
            onOpenWikilink={openWikilink}
            onCreateMarkdownFile={fileTreeActions?.createMarkdownFile}
            onInitialMarkdownLoadSettled={() =>
              setInitialEditorLoadSettled(true)
            }
            onPendingCliCommandHandled={handlePendingCliCommandHandled}
            onSelectionChange={handleSelectionChange}
          />
        </main>

        <div
          className="relative min-h-0 overflow-hidden"
          style={{ gridColumn: 3 }}
        >
          {rightPanel.isCollapsed ? null : (
            <aside className="h-full min-h-0 overflow-hidden border-l border-base-300 bg-base-100">
              <div className="flex h-full min-h-0 flex-col">
                <div className="grid grid-cols-3 gap-1 border-b border-base-300 bg-base-200 p-1">
                  {RIGHT_PANEL_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={[
                        "h-7 truncate px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        rightPanelTab === tab.id
                          ? "bg-base-100 text-base-content shadow-sm"
                          : "text-base-content/70 hover:text-base-content",
                      ].join(" ")}
                      onClick={() => setRightPanelTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden [&>aside]:h-full [&>aside]:border-l-0 [&>aside]:border-t-0 [&>aside>div:last-child]:hidden">
                  {rightPanelTab === "outline" ? (
                    <OutlinePanel
                      headings={activeHeadings}
                      collapsed={false}
                      onHeadingClick={scrollToHeading}
                      resizeHandleProps={{}}
                    />
                  ) : rightPanelTab === "llmWiki" ? (
                    <LlmWikiPanel
                      llmWiki={llmWiki}
                      onConfigureLlm={() => setSettingsOpen(true)}
                    />
                  ) : (
                    <MemoryPanel memory={memory} />
                  )}
                </div>
              </div>
              <div
                {...rightPanel.resizeHandleProps}
                className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40"
              />
            </aside>
          )}
        </div>
      </div>
      {externalConflictDiffOpen && activeExternalConflict ? (
        <DiffViewer
          open={externalConflictDiffOpen}
          title="文件已被外部修改"
          leftTitle="磁盘版本"
          rightTitle="我的编辑"
          leftText={activeExternalConflict.diskMarkdown}
          rightText={activeTab?.markdown ?? ""}
          primaryAction={{
            label: "保留我的编辑",
            onClick: () => void keepExternalConflictEdits(),
          }}
          secondaryActions={[
            {
              label: "重新加载磁盘",
              destructive: true,
              onClick: () => void reloadExternalConflictDiskVersion(),
            },
            {
              label: "复制当前内容",
              onClick: copyExternalConflictMarkdown,
            },
            {
              label: "稍后",
              onClick: postponeExternalConflict,
            },
          ]}
          onClose={postponeExternalConflict}
        />
      ) : null}
      {activeDraftRecovery && activeTab ? (
        <DiffViewer
          open={activeDraftDiffOpen}
          title="草稿差异"
          leftTitle="磁盘版本"
          rightTitle="草稿"
          leftText={activeTab.markdown ?? ""}
          rightText={activeDraftRecovery.draft.markdown}
          primaryAction={{
            label: "恢复草稿",
            onClick: recoverActiveDraft,
          }}
          secondaryActions={[
            {
              label: "保留磁盘版本",
              onClick: keepActiveDiskVersion,
            },
            {
              label: "稍后",
              onClick: postponeActiveDraftRecovery,
            },
          ]}
          onClose={postponeActiveDraftRecovery}
        />
      ) : null}
    </div>
  );
}

async function refreshTree(
  rootPath: string,
  getCurrentRootPath: () => string,
  dispatch: (action: WorkspaceAction) => void,
  preferences: AppPreferences,
) {
  const { invoke } = await tauriCore();
  const scanned = await invoke<ScanWorkspaceResult>("scan_workspace", {
    rootPath,
    options: {
      excludeDirs: preferences.fileTreeExcludeDirs,
    },
  });

  if (getCurrentRootPath() !== rootPath) {
    return;
  }

  dispatch({
    type: "tree/loaded",
    fileTree: scanned.nodes,
  });
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function draftTabsForAction(
  workspace: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceTab[] {
  const activeTab = workspace.activeTabId
    ? workspace.tabs[workspace.activeTabId]
    : undefined;

  switch (action.type) {
    case "tab/activated":
      return action.tabId !== workspace.activeTabId &&
        shouldSaveWorkspaceTabDraft(activeTab)
        ? [activeTab]
        : [];
    case "tab/opened":
      return action.tab.tabId !== workspace.activeTabId &&
        shouldSaveWorkspaceTabDraft(activeTab)
        ? [activeTab]
        : [];
    case "tab/closed":
      return filterDraftTabs([workspace.tabs[action.tabId]]);
    case "tab/closedByPath": {
      const path = normalizeWorkspacePath(action.path);

      return filterDraftTabs(
        workspace.tabOrder
          .map((tabId) => workspace.tabs[tabId])
          .filter(
            (tab): tab is WorkspaceTab =>
              Boolean(tab) && normalizeWorkspacePath(tab.path) === path,
          ),
      );
    }
    case "tab/closedByPrefix": {
      return filterDraftTabs(
        workspace.tabOrder
          .map((tabId) => workspace.tabs[tabId])
          .filter(
            (tab): tab is WorkspaceTab =>
              Boolean(tab) && isPathUnderPrefix(tab.path, action.prefix),
          ),
      );
    }
    default:
      return [];
  }
}

function filterDraftTabs(tabs: Array<WorkspaceTab | undefined>) {
  return tabs.filter(shouldSaveWorkspaceTabDraft);
}

function shouldSaveWorkspaceTabDraft(
  tab: WorkspaceTab | undefined,
): tab is WorkspaceTab & { markdown: string } {
  return Boolean(
    isTauriRuntime() &&
    tab?.dirty &&
    isMarkdownFilePath(tab.path) &&
    tab.markdown !== undefined,
  );
}

function findTabIdByPath(workspace: WorkspaceState, path: string) {
  const normalizedPath = normalizeWorkspacePath(path);

  return workspace.tabOrder.find(
    (tabId) =>
      workspace.tabs[tabId] &&
      normalizeWorkspacePath(workspace.tabs[tabId].path) === normalizedPath,
  );
}

function displayPath(draft: Pick<DraftRecord, "displayPath" | "realPath">) {
  return draft.displayPath?.trim() || draft.realPath;
}

function pathTitle(path: string) {
  const normalizedPath = normalizeWorkspacePath(path);

  return normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
}

function findExistingParentPath(
  rootPath: string,
  path: string,
  fileTree: FileTreeNode[],
) {
  let candidate = dirname(path);
  const normalizedRootPath = normalizeWorkspacePath(rootPath);

  while (candidate && isPathUnderPrefix(candidate, normalizedRootPath)) {
    if (candidate === normalizedRootPath || folderExists(fileTree, candidate)) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }

  return normalizedRootPath;
}

function parentExistsInWorkspace(
  rootPath: string,
  path: string,
  fileTree: FileTreeNode[],
) {
  const parent = dirname(path);
  const normalizedRootPath = normalizeWorkspacePath(rootPath);

  return (
    parent === normalizedRootPath ||
    (isPathUnderPrefix(parent, normalizedRootPath) &&
      folderExists(fileTree, parent))
  );
}

function folderExists(nodes: FileTreeNode[], path: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);

  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }

    if (normalizeWorkspacePath(node.path) === normalizedPath) {
      return true;
    }

    if (folderExists(node.children, normalizedPath)) {
      return true;
    }
  }

  return false;
}

function isPathUnderPrefix(path: string, prefix: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedPrefix = normalizeWorkspacePath(prefix);

  if (!normalizedPath || !normalizedPrefix) {
    return false;
  }

  if (normalizedPath === normalizedPrefix) {
    return true;
  }

  const prefixWithSlash = normalizedPrefix.endsWith("/")
    ? normalizedPrefix
    : `${normalizedPrefix}/`;

  return normalizedPath.startsWith(prefixWithSlash);
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

function isSearchRequestNotFoundError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    error.errorCode === "search_request_not_found"
  ) {
    return true;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message.includes("search_request_not_found");
  }

  return false;
}

async function handleCliOpenFile(
  payload: CliOpenFileEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  queuePendingCommand: (command: PendingCliEditorCommand) => void,
) {
  const normalizedPath = payload.path;
  const existingTab = workspace.tabOrder
    .map((tabId) => workspace.tabs[tabId])
    .find((tab) => tab?.path === normalizedPath);

  if (existingTab) {
    dispatch({
      type: "tab/activated",
      tabId: existingTab.tabId,
    });
    queuePendingCommand({
      id: nanoid(8),
      kind: "focus",
      tabId: existingTab.tabId,
    });
    return;
  }

  const tabId = nanoid(8);
  const title = normalizedPath.split("/").pop() ?? normalizedPath;
  dispatch({
    type: "tab/opened",
    tab: {
      tabId,
      path: normalizedPath,
      title,
      dirty: false,
      needsRenameOnFirstSave: false,
    },
  });
  queuePendingCommand({
    id: nanoid(8),
    kind: "focus",
    tabId,
  });
}

function handleCliInsert(
  payload: CliInsertEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  queuePendingCommand: (command: PendingCliEditorCommand) => void,
) {
  const tabId = payload.tabId ?? workspace.activeTabId ?? null;

  if (!tabId || !workspace.tabs[tabId]) {
    return;
  }

  if (workspace.activeTabId !== tabId) {
    dispatch({
      type: "tab/activated",
      tabId,
    });
  }

  queuePendingCommand({
    id: nanoid(8),
    kind: "insert",
    tabId,
    text: payload.text,
  });
}

function handleCliFocusTab(
  payload: CliTabEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  queuePendingCommand: (command: PendingCliEditorCommand) => void,
) {
  const tabId =
    payload.tabId ?? workspace.activeTabId ?? workspace.tabOrder[0] ?? null;

  if (!tabId) {
    return;
  }

  if (workspace.tabs[tabId]) {
    dispatch({
      type: "tab/activated",
      tabId,
    });
    queuePendingCommand({
      id: nanoid(8),
      kind: "focus",
      tabId,
    });
  }
}

function handleCliCloseTab(
  payload: CliCloseEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
) {
  const tabId = payload.tabId ?? workspace.activeTabId ?? null;

  if (!tabId || !workspace.tabs[tabId]) {
    return;
  }

  dispatch({
    type: "tab/closed",
    tabId,
  });
}

async function handleCliSaveTab(
  payload: CliTabEvent,
  workspace: WorkspaceState,
  saveTab: (tabId: string) => Promise<boolean>,
) {
  const tabId = payload.tabId ?? workspace.activeTabId ?? null;

  if (!tabId || !workspace.tabs[tabId]) {
    return;
  }

  await saveTab(tabId);
}

async function handleCliFileCreated(
  payload: CliFileCreatedEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  queuePendingCommand: (command: PendingCliEditorCommand) => void,
  preferences: AppPreferences,
) {
  const tabId = nanoid(8);
  dispatch({
    type: "tab/opened",
    tab: {
      tabId,
      path: payload.path,
      title: payload.name,
      dirty: false,
      needsRenameOnFirstSave: payload.needsRenameOnFirstSave,
    },
  });

  queuePendingCommand({
    id: nanoid(8),
    kind: "focus",
    tabId,
  });

  await refreshTree(
    workspace.rootPath,
    () => workspace.rootPath,
    dispatch,
    preferences,
  );
}

async function handleCliFileUpdated(
  payload: CliFileUpdatedEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
) {
  await refreshCleanOpenTabFromDisk({
    payload,
    workspace,
    dispatch,
    invoke: async (command, args) => {
      const { invoke } = await tauriCore();
      return invoke(command, args);
    },
  });
}

async function handleCliFolderCreated(
  _payload: CliFolderCreatedEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  preferences: AppPreferences,
) {
  await refreshTree(
    workspace.rootPath,
    () => workspace.rootPath,
    dispatch,
    preferences,
  );
}

async function handleCliPathRenamed(
  payload: CliPathRenamedEvent,
  workspace: WorkspaceState,
  dispatch: (action: WorkspaceAction) => void,
  preferences: AppPreferences,
) {
  dispatch(
    payload.affectedPrefix
      ? {
          type: "tab/prefixRemapped",
          affectedPrefix: payload.affectedPrefix,
        }
      : {
          type: "tab/pathRemapped",
          fromPath: payload.oldPath,
          toPath: payload.newPath,
        },
  );

  await refreshTree(
    workspace.rootPath,
    () => workspace.rootPath,
    dispatch,
    preferences,
  );
}
