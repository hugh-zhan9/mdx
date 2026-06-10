import {
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./path";
import {
    createEmptySearchSummary,
    createEmptyWorkspaceSearchState,
    ensureWorkspaceSearchState,
    normalizeSearchQuery,
} from "./workspace-search";
import type {
    AffectedPrefix,
    FileTreeNode,
    WorkspaceAction,
    WorkspacePanelSide,
    WorkspaceState,
    WorkspaceTab,
} from "./types";

const DEFAULT_PANEL_STATE = {
    leftCollapsed: false,
    leftWidth: 300,
    rightCollapsed: false,
    rightWidth: 300,
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
        treeFilterQuery: "",
        search: createEmptyWorkspaceSearchState(),
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
        case "tab/pathRemapped":
            return remapTabPath(state, action.fromPath, action.toPath);
        case "tab/prefixRemapped":
            return remapTabPrefix(state, action.affectedPrefix);
        case "tab/closedByPath":
            return closeTabsByPath(state, action.path);
        case "tab/closedByPrefix":
            return closeTabsByPrefix(state, action.prefix);
        case "tab/contentChanged":
            return changeTabContent(state, action.tabId, action.markdown);
        case "tab/saved":
            return updateTab(state, action.tabId, {
                dirty: false,
                ...(action.markdown === undefined
                    ? {}
                    : { markdown: action.markdown }),
            });
        case "tab/savedIfUnchanged":
            return saveTabIfUnchanged(state, action.tabId, action.markdown);
        case "tab/renamed":
            return renameTab(state, action);
        case "panel/resized":
            return resizePanel(state, action.side, action.width);
        case "panel/collapsedChanged":
            return collapsePanel(state, action.side, action.collapsed);
        case "treeFilter/queryChanged":
            return {
                ...state,
                treeFilterQuery: action.query,
            };
        case "search/queryChanged":
            return updateSearchState(state, {
                query: action.query,
                requestId: null,
                error: null,
                status:
                    normalizeSearchQuery(action.query).length > 0
                        ? "typing"
                        : "idle",
                results: [],
                summary: createEmptySearchSummary(),
            });
        case "search/caseSensitivityToggled":
            return updateSearchState(state, {
                caseSensitive: !state.search.caseSensitive,
                requestId: null,
                error: null,
                status:
                    normalizeSearchQuery(state.search.query).length > 0
                        ? "typing"
                        : "idle",
                results: [],
                summary: createEmptySearchSummary(),
            });
        case "search/requestStarted":
            return updateSearchState(state, {
                status: "searching",
                requestId: action.requestId,
                error: null,
            });
        case "search/requestCompleted":
            return updateSearchState(state, {
                status: "complete",
                requestId: action.requestId,
                results: action.results,
                summary: action.summary,
                error: null,
            });
        case "search/requestFailed":
            return updateSearchState(state, {
                status: "error",
                requestId: action.requestId,
                results: [],
                summary: createEmptySearchSummary(),
                error: action.error,
            });
        default:
            return state;
    }
}

function updateSearchState(
    state: WorkspaceState,
    patch: Partial<WorkspaceState["search"]>,
): WorkspaceState {
    return {
        ...state,
        search: {
            ...ensureWorkspaceSearchState(state.search),
            ...patch,
        },
    };
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

function changeTabContent(
    state: WorkspaceState,
    tabId: string,
    markdown: string,
): WorkspaceState {
    const tab = state.tabs[tabId];

    if (!tab || tab.markdown === markdown) {
        return state;
    }

    return updateTab(state, tabId, {
        dirty: true,
        markdown,
    });
}

function saveTabIfUnchanged(
    state: WorkspaceState,
    tabId: string,
    markdown: string,
): WorkspaceState {
    const tab = state.tabs[tabId];

    if (!tab || tab.markdown !== markdown) {
        return state;
    }

    return updateTab(state, tabId, {
        dirty: false,
    });
}

function remapTabPath(
    state: WorkspaceState,
    fromPath: string,
    toPath: string,
): WorkspaceState {
    const normalizedFromPath = normalizeWorkspacePath(fromPath);
    const normalizedToPath = normalizeWorkspacePath(toPath);
    const nextTabs = { ...state.tabs };
    let changed = false;

    for (const tabId of state.tabOrder) {
        const tab = nextTabs[tabId];

        if (!tab || normalizeWorkspacePath(tab.path) !== normalizedFromPath) {
            continue;
        }

        nextTabs[tabId] = {
            ...tab,
            path: normalizedToPath,
            title: pathTitle(normalizedToPath),
        };
        changed = true;
    }

    return changed ? { ...state, tabs: nextTabs } : state;
}

function remapTabPrefix(
    state: WorkspaceState,
    affectedPrefix: AffectedPrefix,
): WorkspaceState {
    const normalizedOldPrefix = normalizeWorkspacePath(affectedPrefix.oldPrefix);
    const normalizedNewPrefix = normalizeWorkspacePath(affectedPrefix.newPrefix);
    const nextTabs = { ...state.tabs };
    let changed = false;

    for (const tabId of state.tabOrder) {
        const tab = nextTabs[tabId];

        if (!tab) {
            continue;
        }

        const nextPath = remapPathPrefix(
            tab.path,
            normalizedOldPrefix,
            normalizedNewPrefix,
        );

        if (nextPath === null) {
            continue;
        }

        nextTabs[tabId] = {
            ...tab,
            path: nextPath,
        };
        changed = true;
    }

    return changed ? { ...state, tabs: nextTabs } : state;
}

function closeTabsByPath(state: WorkspaceState, path: string): WorkspaceState {
    const normalizedPath = normalizeWorkspacePath(path);

    return closeTabsByPredicate(state, (tab) => tab.path === normalizedPath);
}

function closeTabsByPrefix(
    state: WorkspaceState,
    prefix: string,
): WorkspaceState {
    const normalizedPrefix = normalizeWorkspacePath(prefix);

    return closeTabsByPredicate(state, (tab) =>
        isPathUnderPrefix(tab.path, normalizedPrefix),
    );
}

function closeTabsByPredicate(
    state: WorkspaceState,
    predicate: (tab: WorkspaceTab) => boolean,
): WorkspaceState {
    const closedTabIds = new Set<string>();

    for (const tabId of state.tabOrder) {
        const tab = state.tabs[tabId];

        if (tab && predicate(tab)) {
            closedTabIds.add(tabId);
        }
    }

    if (closedTabIds.size === 0) {
        return state;
    }

    const nextTabs = { ...state.tabs };
    const nextTabOrder = state.tabOrder.filter((tabId) => {
        if (!closedTabIds.has(tabId)) {
            return true;
        }

        delete nextTabs[tabId];
        return false;
    });

    const nextActiveTabId =
        state.activeTabId && closedTabIds.has(state.activeTabId)
            ? findFallbackActiveTabId(state.tabOrder, closedTabIds, state.activeTabId)
            : state.activeTabId;

    return {
        ...state,
        tabs: nextTabs,
        tabOrder: nextTabOrder,
        activeTabId: nextActiveTabId,
    };
}

function findFallbackActiveTabId(
    tabOrder: string[],
    closedTabIds: Set<string>,
    activeTabId: string,
) {
    const activeIndex = tabOrder.indexOf(activeTabId);

    if (activeIndex === -1) {
        return tabOrder.find((tabId) => !closedTabIds.has(tabId)) ?? null;
    }

    for (let index = activeIndex + 1; index < tabOrder.length; index += 1) {
        const tabId = tabOrder[index];

        if (!closedTabIds.has(tabId)) {
            return tabId;
        }
    }

    for (let index = activeIndex - 1; index >= 0; index -= 1) {
        const tabId = tabOrder[index];

        if (!closedTabIds.has(tabId)) {
            return tabId;
        }
    }

    return null;
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

function remapPathPrefix(
    path: string,
    oldPrefix: string,
    newPrefix: string,
): string | null {
    const normalizedPath = normalizeWorkspacePath(path);

    if (!isPathUnderPrefix(normalizedPath, oldPrefix)) {
        return null;
    }

    if (normalizedPath === oldPrefix) {
        return newPrefix;
    }

    return `${newPrefix}${normalizedPath.slice(oldPrefix.length)}`;
}

function isPathUnderPrefix(path: string, prefix: string) {
    const normalizedPath = normalizeWorkspacePath(path);
    const normalizedPrefix = normalizeWorkspacePath(prefix);

    if (normalizedPath === normalizedPrefix) {
        return true;
    }

    if (normalizedPrefix.length === 0) {
        return false;
    }

    const prefixWithSeparator = normalizedPrefix.endsWith("/")
        ? normalizedPrefix
        : `${normalizedPrefix}/`;

    return normalizedPath.startsWith(prefixWithSeparator);
}

function pathTitle(path: string) {
    const normalizedPath = normalizeWorkspacePath(path);

    return normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
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

    return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH));
}
