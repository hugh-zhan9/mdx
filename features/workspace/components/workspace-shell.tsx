"use client";

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
import { LlmWikiPanel, useLlmWikiWorkspace } from "@/features/llm-wiki";
import { IconButton, TextControlButton } from "../../../common/components/ui-controls";
import { usePanelResize } from "../hooks/use-panel-resize";
import { syncCliWorkspaceSnapshot } from "../lib/cli-sync";
import { refreshCleanOpenTabFromDisk } from "../lib/cli-file-updated";
import { parseMarkdownOutline } from "../lib/outline";
import { calculateWorkspacePanelLayout } from "../lib/panel-layout";
import { isMarkdownFilePath } from "../lib/path";
import { scrollRenderedHeadingIntoView } from "../lib/outline-scroll";
import { createTabSaveQueue } from "../lib/workspace-save";
import { dirtyWorkspacePaths } from "../lib/dirty-paths";
import { workspaceReducer } from "../lib/workspace-reducer";
import { resolveWikilinkFile } from "../lib/wikilink";
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
  const editorViewportRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionByTabRef = useRef<Record<string, CliSelectionSnapshot | null>>(
    {},
  );
  const [fileTreeActions, setFileTreeActions] =
    useState<WorkspaceFileTreeActions | null>(null);
  const [pendingCliCommand, setPendingCliCommand] =
    useState<PendingCliEditorCommand | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] =
    useState<"outline" | "llmWiki">("outline");
  const [workspaceBodyWidth, setWorkspaceBodyWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [initialEditorLoadSettled, setInitialEditorLoadSettled] =
    useState(false);
  const llmWiki = useLlmWikiWorkspace(workspace.rootPath, {
    canAutoProcess: initialEditorLoadSettled,
  });
  const handleRawFileSavedRef = useRef(llmWiki.handleRawFileSaved);
  const tabs = workspace.tabOrder
    .map((tabId) => workspace.tabs[tabId])
    .filter((tab): tab is WorkspaceTab => Boolean(tab));
  const activeTab = workspace.activeTabId
    ? (workspace.tabs[workspace.activeTabId] ?? null)
    : null;
  const activeHeadings = useMemo(
    () =>
      activeTab?.markdown === undefined
        ? []
        : parseMarkdownOutline(activeTab.markdown),
    [activeTab],
  );

  useEffect(() => {
    setInitialEditorLoadSettled(false);
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

  const dispatchAndMirror = useCallback(
    (action: WorkspaceAction) => {
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
    [dispatch],
  );

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
    (tabId: string) => {
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
        afterSave: (event) => {
          if (event.rootPath !== workspaceRef.current.rootPath) {
            return;
          }

          handleRawFileSavedRef.current(event.path);
        },
      });

      return saveQueueRef.current.saveTab(tabId);
    },
    [dialogs, dispatchAndMirror, preferences],
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
        dispatchAndMirror({
          type: "tab/closed",
          tabId,
        });
        return;
      }

      if (choice !== "save") {
        return;
      }

      const saved = await saveTab(tabId);

      if (saved) {
        dispatchAndMirror({
          type: "tab/closed",
          tabId,
        });
      }
    },
    [dialogs, dispatchAndMirror, saveTab],
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

      const existingTab = currentWorkspace.tabOrder
        .map((tabId) => currentWorkspace.tabs[tabId])
        .find((tab) => tab?.path === resolvedPath);

      if (existingTab) {
        dispatchAndMirror({
          type: "tab/activated",
          tabId: existingTab.tabId,
        });
        return;
      }

      dispatchAndMirror({
        type: "tab/opened",
        tab: {
          tabId: nanoid(8),
          path: resolvedPath,
          title: resolvedPath.split("/").pop() ?? resolvedPath,
          dirty: false,
          needsRenameOnFirstSave: false,
        },
      });
    },
    [dispatchAndMirror],
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
            icon="☰"
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
            icon="☰"
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
            searchQuery={workspace.search.query}
            collapsed={leftPanel.isCollapsed}
            dispatch={dispatchAndMirror}
            preferences={preferences}
            activeTabPath={activeTab?.path ?? null}
            onActionsChange={setFileTreeActions}
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
                <div className="grid grid-cols-2 gap-1 border-b border-base-300 bg-base-200 p-1">
                  <button
                    type="button"
                    className={[
                      "h-7 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                      rightPanelTab === "outline"
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/70 hover:text-base-content",
                    ].join(" ")}
                    onClick={() => setRightPanelTab("outline")}
                  >
                    目录
                  </button>
                  <button
                    type="button"
                    className={[
                      "h-7 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                      rightPanelTab === "llmWiki"
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/70 hover:text-base-content",
                    ].join(" ")}
                    onClick={() => setRightPanelTab("llmWiki")}
                  >
                    LLM Wiki
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden [&>aside]:h-full [&>aside]:border-l-0 [&>aside]:border-t-0 [&>aside>div:last-child]:hidden">
                  {rightPanelTab === "outline" ? (
                  <OutlinePanel
                    headings={activeHeadings}
                    collapsed={false}
                    onHeadingClick={scrollToHeading}
                    resizeHandleProps={{}}
                  />
                  ) : (
                    <LlmWikiPanel
                      llmWiki={llmWiki}
                      onConfigureLlm={() => setSettingsOpen(true)}
                    />
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

  await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch, preferences);
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
  await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch, preferences);
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

  await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch, preferences);
}
