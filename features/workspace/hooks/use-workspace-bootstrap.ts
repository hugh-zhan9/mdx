"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
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
const DEFAULT_WINDOW_SIZE: PersistedWindowSize = {
    width: 900,
    height: 700,
};
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
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasBootstrappedRef = useRef(false);

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
        if (hasBootstrappedRef.current) {
            return;
        }

        hasBootstrappedRef.current = true;
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

                appStateRef.current = normalizeAppState(appState);

                if (appStateRef.current.recentWorkspaceRoot) {
                    await openWorkspace(appStateRef.current.recentWorkspaceRoot);
                    return;
                }

                await chooseWorkspace();
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
    }, [chooseWorkspace, openWorkspace]);

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
        }, 350);

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, [isTauri, workspace]);

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
    const persistedWorkspace = findPersistedWorkspace(appState, rootPath);
    const scanned = await scanWorkspace(rootPath);
    const restoredRootPath = normalizeWorkspacePath(scanned.rootPath || rootPath);
    const workspace = applyPersistedWorkspace(
        createWorkspaceState(restoredRootPath, scanned.nodes),
        persistedWorkspace,
        scanned,
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

function findPersistedWorkspace(
    appState: PersistedAppState,
    rootPath: string,
) {
    const normalizedRootPath = normalizeWorkspacePath(rootPath);

    return appState.workspaces.find(
        (workspace) =>
            normalizeWorkspacePath(workspace.rootPath) === normalizedRootPath,
    );
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
        windowSize: normalizeWindowSize(state.windowSize),
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

function normalizeWindowSize(
    windowSize: PersistedWindowSize | undefined,
): PersistedWindowSize {
    if (
        !windowSize ||
        !Number.isFinite(windowSize.width) ||
        !Number.isFinite(windowSize.height)
    ) {
        return DEFAULT_WINDOW_SIZE;
    }

    return windowSize;
}

function getCurrentWindowSize(fallback: PersistedWindowSize) {
    if (typeof window === "undefined") {
        return fallback;
    }

    return {
        width: window.innerWidth || fallback.width,
        height: window.innerHeight || fallback.height,
    };
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
