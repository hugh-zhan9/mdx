import {
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./path";
import type {
    FileTreeNode,
    WorkspaceAction,
    WorkspacePanelSide,
    WorkspaceState,
    WorkspaceTab,
} from "./types";

const DEFAULT_PANEL_STATE = {
    leftCollapsed: false,
    leftWidth: 280,
    rightCollapsed: false,
    rightWidth: 240,
};
const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 640;

export function createWorkspaceState(
    rootPath: string,
    fileTree: FileTreeNode[] = [],
): WorkspaceState {
    return {
        rootPath: normalizeWorkspacePath(rootPath),
        fileTree,
        tabs: {},
        tabOrder: [],
        activeTabId: null,
        panel: { ...DEFAULT_PANEL_STATE },
        search: {
            query: "",
        },
    };
}

export function workspaceReducer(
    state: WorkspaceState,
    action: WorkspaceAction,
): WorkspaceState {
    switch (action.type) {
        case "workspace/rootChanged":
            return createWorkspaceState(action.rootPath, action.fileTree ?? []);
        case "tree/loaded":
            return {
                ...state,
                fileTree: action.fileTree,
            };
        case "tab/opened":
            return openTab(state, action.tab);
        case "tab/activated":
            return activateTab(state, action.tabId);
        case "tab/closed":
            return closeTab(state, action.tabId);
        case "tab/contentChanged":
            return updateTab(state, action.tabId, {
                dirty: true,
                markdown: action.markdown,
            });
        case "tab/saved":
            return updateTab(state, action.tabId, {
                dirty: false,
                ...(action.markdown === undefined
                    ? {}
                    : { markdown: action.markdown }),
            });
        case "tab/renamed":
            return renameTab(state, action);
        case "panel/resized":
            return resizePanel(state, action.side, action.width);
        case "panel/collapsedChanged":
            return collapsePanel(state, action.side, action.collapsed);
        case "search/queryChanged":
            return {
                ...state,
                search: {
                    query: action.query,
                },
            };
        default:
            return state;
    }
}

function openTab(state: WorkspaceState, tab: WorkspaceTab): WorkspaceState {
    const nextTab = normalizeTab(tab);
    const existingTabId = findTabIdByPath(state, nextTab.path);

    if (existingTabId && existingTabId !== nextTab.tabId) {
        return {
            ...state,
            activeTabId: existingTabId,
        };
    }

    if (!isPathInsideRoot(state.rootPath, nextTab.path)) {
        return state;
    }

    return {
        ...state,
        tabs: {
            ...state.tabs,
            [nextTab.tabId]: nextTab,
        },
        tabOrder: ensureSingleTabOrderEntry(state.tabOrder, nextTab.tabId),
        activeTabId: nextTab.tabId,
    };
}

function activateTab(
    state: WorkspaceState,
    tabId: string | null,
): WorkspaceState {
    if (tabId === null) {
        return {
            ...state,
            activeTabId: null,
        };
    }

    if (!state.tabs[tabId]) {
        return state;
    }

    return {
        ...state,
        activeTabId: tabId,
    };
}

function closeTab(state: WorkspaceState, tabId: string): WorkspaceState {
    if (!state.tabs[tabId]) {
        return state;
    }

    const tabIndex = state.tabOrder.indexOf(tabId);
    const nextTabs = { ...state.tabs };
    const nextTabOrder = state.tabOrder.filter((id) => id !== tabId);
    delete nextTabs[tabId];

    const nextActiveTabId =
        state.activeTabId === tabId
            ? nextTabOrder[Math.min(tabIndex, nextTabOrder.length - 1)] ?? null
            : state.activeTabId;

    return {
        ...state,
        tabs: nextTabs,
        tabOrder: nextTabOrder,
        activeTabId: nextActiveTabId,
    };
}

function updateTab(
    state: WorkspaceState,
    tabId: string,
    patch: Partial<WorkspaceTab>,
): WorkspaceState {
    const tab = state.tabs[tabId];

    if (!tab) {
        return state;
    }

    return {
        ...state,
        tabs: {
            ...state.tabs,
            [tabId]: {
                ...tab,
                ...patch,
            },
        },
    };
}

function renameTab(
    state: WorkspaceState,
    action: Extract<WorkspaceAction, { type: "tab/renamed" }>,
): WorkspaceState {
    const path = normalizeWorkspacePath(action.path);
    const sourceTab = state.tabs[action.tabId];

    if (!sourceTab || !isPathInsideRoot(state.rootPath, path)) {
        return state;
    }

    const targetTabId = findTabIdByPath(state, path);

    if (targetTabId && targetTabId !== action.tabId) {
        const nextTabs = { ...state.tabs };
        delete nextTabs[action.tabId];

        return {
            ...state,
            tabs: nextTabs,
            tabOrder: state.tabOrder.filter((tabId) => tabId !== action.tabId),
            activeTabId: targetTabId,
        };
    }

    return updateTab(state, action.tabId, {
        path,
        ...(action.title === undefined ? {} : { title: action.title }),
        ...(action.needsRenameOnFirstSave === undefined
            ? {}
            : { needsRenameOnFirstSave: action.needsRenameOnFirstSave }),
    });
}

function resizePanel(
    state: WorkspaceState,
    side: WorkspacePanelSide,
    width: number,
): WorkspaceState {
    const nextWidth = normalizePanelWidth(width);

    if (nextWidth === null) {
        return state;
    }

    const key = side === "left" ? "leftWidth" : "rightWidth";

    return {
        ...state,
        panel: {
            ...state.panel,
            [key]: nextWidth,
        },
    };
}

function collapsePanel(
    state: WorkspaceState,
    side: WorkspacePanelSide,
    collapsed: boolean,
): WorkspaceState {
    const key = side === "left" ? "leftCollapsed" : "rightCollapsed";

    return {
        ...state,
        panel: {
            ...state.panel,
            [key]: collapsed,
        },
    };
}

function normalizeTab(tab: WorkspaceTab): WorkspaceTab {
    return {
        ...tab,
        path: normalizeWorkspacePath(tab.path),
    };
}

function findTabIdByPath(state: WorkspaceState, path: string) {
    const normalizedPath = normalizeWorkspacePath(path);

    return state.tabOrder.find(
        (tabId) =>
            state.tabs[tabId] &&
            normalizeWorkspacePath(state.tabs[tabId].path) === normalizedPath,
    );
}

function ensureSingleTabOrderEntry(tabOrder: string[], tabId: string) {
    const nextTabOrder: string[] = [];
    let found = false;

    for (const existingTabId of tabOrder) {
        if (existingTabId !== tabId) {
            nextTabOrder.push(existingTabId);
            continue;
        }

        if (!found) {
            nextTabOrder.push(existingTabId);
            found = true;
        }
    }

    if (!found) {
        nextTabOrder.push(tabId);
    }

    return nextTabOrder;
}

function normalizePanelWidth(width: number) {
    if (!Number.isFinite(width) || width < 0) {
        return null;
    }

    return Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);
}
