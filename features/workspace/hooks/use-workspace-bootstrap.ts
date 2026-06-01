"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import { buildFileTree } from "../lib/file-tree";
import type {
    FileTreeNode,
    PersistedAppState,
    PersistedWindowSize,
    PersistedWorkspaceState,
    PersistedWorkspaceTab,
    WorkspaceAction,
    WorkspacePanelState,
    WorkspaceState,
    WorkspaceTab,
} from "../lib/types";
import {
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "../lib/path";
import {
    DEFAULT_WINDOW_SIZE,
    normalizePersistedWindowSize,
} from "../lib/window-size";
import { findPersistedWorkspaceForRoot } from "../lib/persisted-workspace";

type BootstrapStatus = "loading" | "ready" | "empty" | "error";

interface ScanWorkspaceResult {
    rootPath: string;
    nodes: FileTreeNode[];
    truncated: boolean;
    entryCount: number;
    warnings: string[];
}

interface BootstrapWorkspaceResult {
    workspace: WorkspaceState;
    appState: PersistedAppState;
}

const STATE_VERSION = 1;
const DEFAULT_PANEL_STATE: WorkspacePanelState = {
    leftCollapsed: false,
    leftWidth: 280,
    rightCollapsed: false,
    rightWidth: 240,
};

export function useWorkspaceBootstrap() {
    const [status, setStatus] = useState<BootstrapStatus>("loading");
    const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [isTauri, setIsTauri] = useState(false);
    const appStateRef = useRef<PersistedAppState>(createDefaultAppState());
    const workspaceRef = useRef<WorkspaceState | null>(null);
    const openWorkspaceRef =
        useRef<(rootPath: string) => Promise<void>>(async () => {});
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const windowResizeSaveTimerRef =
        useRef<ReturnType<typeof setTimeout> | null>(null);

    const dispatch = useCallback((action: WorkspaceAction) => {
        setWorkspace((current) =>
            current === null ? current : workspaceReducer(current, action),
        );
    }, []);

    const openWorkspace = useCallback(async (rootPath: string) => {
        const normalizedRootPath = normalizeWorkspacePath(rootPath);

        if (!normalizedRootPath) {
            setStatus("empty");
            setMessage("Choose a folder to open a workspace.");
            setWorkspace(null);
            return;
        }

        setStatus("loading");
        setMessage(null);

        try {
            const result = await bootstrapWorkspace(
                normalizedRootPath,
                appStateRef.current,
            );
            appStateRef.current = result.appState;
            setWorkspace(result.workspace);
            setStatus("ready");
        } catch (error) {
            setWorkspace(null);
            setStatus("error");
            setMessage(formatError(error, "Failed to restore workspace."));
        }
    }, []);

    const chooseWorkspace = useCallback(async () => {
        if (!isTauriRuntime()) {
            setStatus("empty");
            setMessage("Folder selection is available in the desktop app.");
            return;
        }

        try {
            const selectedRoot = await chooseWorkspaceRoot();

            if (!selectedRoot) {
                setStatus((current) => (workspace ? current : "empty"));
                setMessage(
                    workspace
                        ? null
                        : "Choose a folder to open a workspace.",
                );
                return;
            }

            await openWorkspace(selectedRoot);
        } catch (error) {
            setStatus(workspace ? "ready" : "error");
            setMessage(formatError(error, "Failed to choose workspace."));
        }
    }, [openWorkspace, workspace]);

    useEffect(() => {
        openWorkspaceRef.current = openWorkspace;
    }, [openWorkspace]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            await Promise.resolve();

            const tauriRuntime = isTauriRuntime();

            if (cancelled) {
                return;
            }

            setIsTauri(tauriRuntime);

            if (!tauriRuntime) {
                setStatus("empty");
                setMessage("Open the desktop app to choose and restore a folder.");
                return;
            }

            try {
                const appState = await loadAppState();

                if (cancelled) {
                    return;
                }

                await restoreTauriWindowSize(appState.windowSize);

                if (cancelled) {
                    return;
                }

                appStateRef.current = appState;

                if (appStateRef.current.recentWorkspaceRoot) {
                    await openWorkspaceRef.current(
                        appStateRef.current.recentWorkspaceRoot,
                    );
                    return;
                }

                const selectedRoot = await chooseWorkspaceRoot();

                if (cancelled) {
                    return;
                }

                if (selectedRoot) {
                    await openWorkspaceRef.current(selectedRoot);
                    return;
                }

                setStatus("empty");
                setMessage("Choose a folder to open a workspace.");
            } catch (error) {
                if (cancelled) {
                    return;
                }

                appStateRef.current = createDefaultAppState();
                setStatus("error");
                setMessage(formatError(error, "Failed to load app state."));
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        workspaceRef.current = workspace;
    }, [workspace]);

    useEffect(() => {
        if (!workspace || !isTauri) {
            return;
        }

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
            const nextAppState = upsertWorkspaceState(
                appStateRef.current,
                workspace,
                getCurrentWindowSize(appStateRef.current.windowSize),
            );
            appStateRef.current = nextAppState;
            void saveAppState(nextAppState).catch((error) => {
                setMessage(formatError(error, "Failed to save app state."));
            });
            saveTimerRef.current = null;
        }, 350);

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [isTauri, workspace]);

    useEffect(() => {
        if (!isTauri) {
            return;
        }

        let disposed = false;
        let unlisten: (() => void) | null = null;

        const clearResizeTimer = () => {
            if (windowResizeSaveTimerRef.current) {
                clearTimeout(windowResizeSaveTimerRef.current);
                windowResizeSaveTimerRef.current = null;
            }
        };

        const persistWindowSize = (windowSize: PersistedWindowSize) => {
            const nextAppState = withWindowSize(
                appStateRef.current,
                workspaceRef.current,
                windowSize,
            );
            appStateRef.current = nextAppState;
            void saveAppState(nextAppState).catch((error) => {
                setMessage(formatError(error, "Failed to save app state."));
            });
        };

        const scheduleWindowSizeSave = (windowSize: PersistedWindowSize) => {
            clearResizeTimer();
            windowResizeSaveTimerRef.current = setTimeout(() => {
                persistWindowSize(windowSize);
                windowResizeSaveTimerRef.current = null;
            }, 350);
        };

        const onBrowserResize = () => {
            scheduleWindowSizeSave(
                getCurrentWindowSize(appStateRef.current.windowSize),
            );
        };

        async function subscribeToWindowResize() {
            try {
                const { getCurrentWindow } = await import(
                    "@tauri-apps/api/window"
                );
                const currentWindow = getCurrentWindow();
                const nextUnlisten = await currentWindow.onResized(
                    ({ payload }) => {
                        scheduleWindowSizeSave({
                            width: payload.width,
                            height: payload.height,
                        });
                    },
                );

                if (disposed) {
                    nextUnlisten();
                    return;
                }

                unlisten = nextUnlisten;
            } catch (error) {
                console.warn(
                    "Failed to subscribe to Tauri window resize; using browser resize events.",
                    error,
                );

                if (!disposed) {
                    window.addEventListener("resize", onBrowserResize);
                }
            }
        }

        void subscribeToWindowResize();

        return () => {
            disposed = true;
            clearResizeTimer();

            if (unlisten) {
                unlisten();
            }

            window.removeEventListener("resize", onBrowserResize);
        };
    }, [isTauri]);

    return useMemo(
        () => ({
            status,
            workspace,
            dispatch,
            chooseWorkspace,
            isTauri,
            canChooseWorkspace: isTauri,
            message,
        }),
        [chooseWorkspace, dispatch, isTauri, message, status, workspace],
    );
}

async function bootstrapWorkspace(
    rootPath: string,
    appState: PersistedAppState,
): Promise<BootstrapWorkspaceResult> {
    const scanned = await scanWorkspace(rootPath);
    const builtTree = buildFileTree(scanned.nodes);

    if (!builtTree.ok) {
        throw new Error(builtTree.error.message);
    }

    const restoredRootPath = normalizeWorkspacePath(scanned.rootPath || rootPath);
    const persistedWorkspace = findPersistedWorkspaceForRoot(
        appState,
        rootPath,
        restoredRootPath,
    );
    const normalizedScan = {
        ...scanned,
        nodes: builtTree.nodes,
    };
    const workspace = applyPersistedWorkspace(
        createWorkspaceState(restoredRootPath, builtTree.nodes),
        persistedWorkspace,
        normalizedScan,
    );
    const nextAppState = upsertWorkspaceState(
        appState,
        workspace,
        appState.windowSize,
    );

    return {
        workspace,
        appState: nextAppState,
    };
}

function applyPersistedWorkspace(
    workspace: WorkspaceState,
    persistedWorkspace: PersistedWorkspaceState | undefined,
    scanned: ScanWorkspaceResult,
): WorkspaceState {
    if (!persistedWorkspace) {
        return workspace;
    }

    const knownFilePaths = scanned.truncated
        ? null
        : collectFilePaths(scanned.nodes);
    const tabs = persistedWorkspace.tabs
        .filter((tab) => shouldRestoreTab(workspace.rootPath, tab, knownFilePaths))
        .map((tab): WorkspaceTab => ({ ...tab }));
    const tabMap = Object.fromEntries(tabs.map((tab) => [tab.tabId, tab]));
    const tabOrder = tabs.map((tab) => tab.tabId);
    const activeTabId =
        persistedWorkspace.activeTabId && tabMap[persistedWorkspace.activeTabId]
            ? persistedWorkspace.activeTabId
            : tabOrder[0] ?? null;

    return {
        ...workspace,
        panel: normalizePanelState(persistedWorkspace.panels),
        tabs: tabMap,
        tabOrder,
        activeTabId,
    };
}

function shouldRestoreTab(
    rootPath: string,
    tab: PersistedWorkspaceTab,
    knownFilePaths: Set<string> | null,
) {
    const tabPath = normalizeWorkspacePath(tab.path);

    if (!isPathInsideRoot(rootPath, tabPath)) {
        return false;
    }

    return knownFilePaths === null || knownFilePaths.has(tabPath);
}

function collectFilePaths(nodes: FileTreeNode[]) {
    const paths = new Set<string>();

    for (const node of nodes) {
        if (node.kind === "file") {
            paths.add(normalizeWorkspacePath(node.path));
            continue;
        }

        for (const childPath of collectFilePaths(node.children)) {
            paths.add(childPath);
        }
    }

    return paths;
}

function upsertWorkspaceState(
    appState: PersistedAppState,
    workspace: WorkspaceState,
    windowSize: PersistedWindowSize,
): PersistedAppState {
    const persistedWorkspace = toPersistedWorkspace(workspace);
    const otherWorkspaces = appState.workspaces.filter(
        (candidate) =>
            normalizeWorkspacePath(candidate.rootPath) !== workspace.rootPath,
    );

    return {
        stateVersion: appState.stateVersion || STATE_VERSION,
        recentWorkspaceRoot: workspace.rootPath,
        workspaces: [persistedWorkspace, ...otherWorkspaces],
        windowSize,
    };
}

function withWindowSize(
    appState: PersistedAppState,
    workspace: WorkspaceState | null,
    windowSize: PersistedWindowSize,
): PersistedAppState {
    const normalizedWindowSize = normalizePersistedWindowSize(windowSize);

    if (workspace) {
        return upsertWorkspaceState(
            appState,
            workspace,
            normalizedWindowSize,
        );
    }

    return {
        ...appState,
        stateVersion: appState.stateVersion || STATE_VERSION,
        windowSize: normalizedWindowSize,
    };
}

function toPersistedWorkspace(
    workspace: WorkspaceState,
): PersistedWorkspaceState {
    return {
        rootPath: workspace.rootPath,
        tabs: workspace.tabOrder
            .map((tabId) => workspace.tabs[tabId])
            .filter((tab): tab is WorkspaceTab => Boolean(tab))
            .map(
                ({
                    tabId,
                    path,
                    title,
                    dirty,
                    needsRenameOnFirstSave,
                }): PersistedWorkspaceTab => ({
                    tabId,
                    path,
                    title,
                    dirty,
                    needsRenameOnFirstSave,
                }),
            ),
        activeTabId: workspace.activeTabId,
        panels: workspace.panel,
    };
}

async function loadAppState() {
    const { invoke } = await import("@tauri-apps/api/core");
    const state = await invoke<PersistedAppState>("load_app_state");

    return normalizeAppState(state);
}

async function saveAppState(state: PersistedAppState) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_app_state", { state });
}

async function scanWorkspace(rootPath: string) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ScanWorkspaceResult>("scan_workspace", { rootPath });
}

async function chooseWorkspaceRoot() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Workspace",
    });

    if (Array.isArray(selected)) {
        return selected[0] ?? null;
    }

    return selected;
}

async function restoreTauriWindowSize(windowSize: PersistedWindowSize) {
    const restoredSize = normalizePersistedWindowSize(windowSize);

    try {
        await setTauriWindowSize(restoredSize);
    } catch (error) {
        console.warn("Failed to restore persisted window size.", error);

        try {
            await setTauriWindowSize(DEFAULT_WINDOW_SIZE);
        } catch (fallbackError) {
            console.warn(
                "Failed to apply default window size fallback.",
                fallbackError,
            );
        }
    }
}

async function setTauriWindowSize(windowSize: PersistedWindowSize) {
    const { getCurrentWindow, PhysicalSize } = await import(
        "@tauri-apps/api/window"
    );
    const normalizedWindowSize = normalizePersistedWindowSize(windowSize);

    await getCurrentWindow().setSize(
        new PhysicalSize(
            normalizedWindowSize.width,
            normalizedWindowSize.height,
        ),
    );
}

function normalizeAppState(state: PersistedAppState | null): PersistedAppState {
    if (!state) {
        return createDefaultAppState();
    }

    return {
        stateVersion: state.stateVersion || STATE_VERSION,
        recentWorkspaceRoot: state.recentWorkspaceRoot
            ? normalizeWorkspacePath(state.recentWorkspaceRoot)
            : null,
        workspaces: Array.isArray(state.workspaces)
            ? state.workspaces
                  .filter((workspace) => workspace.rootPath)
                  .map((workspace) => ({
                      rootPath: normalizeWorkspacePath(workspace.rootPath),
                      tabs: Array.isArray(workspace.tabs)
                          ? workspace.tabs
                          : [],
                      activeTabId: workspace.activeTabId ?? null,
                      panels: normalizePanelState(workspace.panels),
                  }))
            : [],
        windowSize: normalizePersistedWindowSize(state.windowSize),
    };
}

function createDefaultAppState(): PersistedAppState {
    return {
        stateVersion: STATE_VERSION,
        recentWorkspaceRoot: null,
        workspaces: [],
        windowSize: DEFAULT_WINDOW_SIZE,
    };
}

function normalizePanelState(
    panel: WorkspacePanelState | undefined,
): WorkspacePanelState {
    return {
        leftCollapsed: panel?.leftCollapsed ?? DEFAULT_PANEL_STATE.leftCollapsed,
        leftWidth: normalizePanelWidth(
            panel?.leftWidth,
            DEFAULT_PANEL_STATE.leftWidth,
        ),
        rightCollapsed:
            panel?.rightCollapsed ?? DEFAULT_PANEL_STATE.rightCollapsed,
        rightWidth: normalizePanelWidth(
            panel?.rightWidth,
            DEFAULT_PANEL_STATE.rightWidth,
        ),
    };
}

function normalizePanelWidth(width: number | undefined, fallback: number) {
    if (typeof width !== "number" || !Number.isFinite(width)) {
        return fallback;
    }

    return Math.min(Math.max(width, 160), 640);
}

function getCurrentWindowSize(fallback: PersistedWindowSize) {
    if (typeof window === "undefined") {
        return normalizePersistedWindowSize(fallback);
    }

    return normalizePersistedWindowSize({
        width: window.innerWidth || fallback.width,
        height: window.innerHeight || fallback.height,
    });
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}

function formatError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === "string" && error.length > 0) {
        return error;
    }

    return fallback;
}
