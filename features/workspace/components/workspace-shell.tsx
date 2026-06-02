"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { tauriCore } from "@/common/lib/tauri";
import { usePanelResize } from "../hooks/use-panel-resize";
import { syncCliWorkspaceSnapshot } from "../lib/cli-sync";
import { buildFileTree } from "../lib/file-tree";
import { parseMarkdownOutline } from "../lib/outline";
import { scrollRenderedHeadingIntoView } from "../lib/outline-scroll";
import { createTabSaveQueue } from "../lib/workspace-save";
import { workspaceReducer } from "../lib/workspace-reducer";
import type {
    CliCloseEvent,
    CliFileCreatedEvent,
    CliFolderCreatedEvent,
    CliInsertEvent,
    CliOpenFileEvent,
    CliPathRenamedEvent,
    CliSelectionSnapshot,
    CliTabEvent,
    FileTreeNode,
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
import { TabStrip } from "./tab-strip";
import { ThemeToggleButton } from "./theme-toggle-button";

interface WorkspaceShellProps {
    workspace: WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    onChooseWorkspace: () => void;
    canChooseWorkspace: boolean;
    message?: string | null;
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
    onActionsChange,
}: WorkspaceShellProps) {
    const dialogs = useAppDialogs();
    const workspaceRef = useRef(workspace);
    const saveQueueRef = useRef<SaveQueue | null>(null);
    const workspaceRootRef = useRef<string | null>(null);
    const editorViewportRef = useRef<HTMLDivElement | null>(null);
    const selectionByTabRef = useRef<Record<string, CliSelectionSnapshot | null>>({});
    const [fileTreeActions, setFileTreeActions] =
        useState<WorkspaceFileTreeActions | null>(null);
    const [pendingCliCommand, setPendingCliCommand] =
        useState<PendingCliEditorCommand | null>(null);
    const tabs = workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const activeTab = workspace.activeTabId
        ? workspace.tabs[workspace.activeTabId] ?? null
        : null;
    const activeHeadings = useMemo(
        () =>
            activeTab?.markdown === undefined
                ? []
                : parseMarkdownOutline(activeTab.markdown),
        [activeTab?.markdown],
    );

    useEffect(() => {
        workspaceRef.current = workspace;
        if (workspaceRootRef.current !== workspace.rootPath) {
            workspaceRootRef.current = workspace.rootPath;
            saveQueueRef.current = null;
            if (isTauriRuntime()) {
                void syncCliWorkspaceSnapshot(
                    workspace,
                    selectionByTabRef.current,
                ).catch((error) => {
                    console.warn("Failed to sync CLI workspace snapshot.", error);
                });
            }
        }
    }, [workspace]);

    const dispatchAndMirror = useCallback(
        (action: WorkspaceAction) => {
            workspaceRef.current = workspaceReducer(
                workspaceRef.current,
                action,
            );
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
                    ),
            });

            return saveQueueRef.current.saveTab(tabId);
        },
        [dialogs, dispatchAndMirror],
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
                message:
                    `“${tab.title}” 有未保存更改。请选择保存、丢弃或取消。`,
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
                    void handleCliSaveTab(
                        event.payload,
                        workspaceRef.current,
                        saveTab,
                    );
                }),
                listen<CliFileCreatedEvent>("cli-file-created", (event) => {
                    void handleCliFileCreated(
                        event.payload,
                        workspaceRef.current,
                        dispatchAndMirror,
                        queuePendingCliCommand,
                    );
                }),
                listen<CliFolderCreatedEvent>("cli-folder-created", (event) => {
                    void handleCliFolderCreated(
                        event.payload,
                        workspaceRef.current,
                        dispatchAndMirror,
                    );
                }),
                listen<CliPathRenamedEvent>("cli-path-renamed", (event) => {
                    void handleCliPathRenamed(
                        event.payload,
                        workspaceRef.current,
                        dispatchAndMirror,
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
    }, [dispatchAndMirror, queuePendingCliCommand, saveTab]);

    const scrollToHeading = useCallback((_: unknown, index: number) => {
        scrollRenderedHeadingIntoView(editorViewportRef.current, index);
    }, []);
    const gridTemplateColumns = [
        leftPanel.isCollapsed ? "0px" : `${leftPanel.width}px`,
        "minmax(0, 1fr)",
        rightPanel.isCollapsed ? "0px" : `${rightPanel.width}px`,
    ].join(" ");

    return (
        <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)]">
            <header className="flex min-w-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300 disabled:text-base-content/30"
                        onClick={leftPanel.toggleCollapsed}
                        aria-label={
                            leftPanel.isCollapsed
                                ? "展开文件树"
                                : "收起文件树"
                        }
                        title={
                            leftPanel.isCollapsed
                                ? "展开文件树"
                                : "收起文件树"
                        }
                    >
                        文件树
                    </button>
                    <div className="min-w-0 truncate text-sm font-semibold">
                        MDX
                    </div>
                    <div className="min-w-0 truncate text-xs text-base-content/50">
                        {workspace.rootPath}
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {message ? (
                        <div className="max-w-80 truncate text-xs text-warning">
                            {message}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300 disabled:text-base-content/30"
                        onClick={onChooseWorkspace}
                        disabled={!canChooseWorkspace}
                    >
                        打开文件夹
                    </button>
                    <ThemeToggleButton />
                    <button
                        type="button"
                        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300"
                        onClick={rightPanel.toggleCollapsed}
                        aria-label={
                            rightPanel.isCollapsed
                                ? "展开目录"
                                : "收起目录"
                        }
                        title={
                            rightPanel.isCollapsed
                                ? "展开目录"
                                : "收起目录"
                        }
                    >
                        目录
                    </button>
                </div>
            </header>

            <div
                className="grid min-h-0"
                style={{ gridTemplateColumns }}
            >
                <div
                    className="min-h-0 overflow-hidden"
                    style={{ gridColumn: 1 }}
                >
                    <FileTreePanel
                        rootPath={workspace.rootPath}
                        fileTree={workspace.fileTree}
                        searchQuery={workspace.search.query}
                        collapsed={leftPanel.isCollapsed}
                        canChooseWorkspace={canChooseWorkspace}
                        dispatch={dispatchAndMirror}
                        onChooseWorkspace={onChooseWorkspace}
                        onToggleCollapsed={leftPanel.toggleCollapsed}
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
                        onSaveTab={saveTab}
                        editorViewportRef={editorViewportRef}
                        pendingCliCommand={pendingCliCommand}
                        onPendingCliCommandHandled={
                            handlePendingCliCommandHandled
                        }
                        onSelectionChange={handleSelectionChange}
                    />
                </main>

                <div
                    className="min-h-0 overflow-hidden"
                    style={{ gridColumn: 3 }}
                >
                    <OutlinePanel
                        headings={activeHeadings}
                        collapsed={rightPanel.isCollapsed}
                        onToggleCollapsed={rightPanel.toggleCollapsed}
                        onHeadingClick={scrollToHeading}
                        resizeHandleProps={rightPanel.resizeHandleProps}
                    />
                </div>
            </div>
        </div>
    );
}

async function refreshTree(
    rootPath: string,
    getCurrentRootPath: () => string,
    dispatch: (action: WorkspaceAction) => void,
) {
    const { invoke } = await tauriCore();
    const scanned = await invoke<ScanWorkspaceResult>("scan_workspace", {
        rootPath,
    });
    const built = buildFileTree(scanned.nodes);

    if (!built.ok) {
        throw new Error(built.error.message);
    }

    if (getCurrentRootPath() !== rootPath) {
        return;
    }

    dispatch({
        type: "tree/loaded",
        fileTree: built.nodes,
    });
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
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

    await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch);
}

async function handleCliFolderCreated(
    _payload: CliFolderCreatedEvent,
    workspace: WorkspaceState,
    dispatch: (action: WorkspaceAction) => void,
) {
    await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch);
}

async function handleCliPathRenamed(
    payload: CliPathRenamedEvent,
    workspace: WorkspaceState,
    dispatch: (action: WorkspaceAction) => void,
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

    await refreshTree(workspace.rootPath, () => workspace.rootPath, dispatch);
}
