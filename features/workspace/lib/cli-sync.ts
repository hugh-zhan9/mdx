import { tauriCore } from "@/common/lib/tauri";
import type {
    CliFrontendHeartbeatPayload,
    CliSelectionSnapshot,
    CliWorkspaceSyncPayload,
    WorkspaceState,
    WorkspaceTab,
} from "./types";

export function buildCliWorkspaceSyncPayload(
    workspace: WorkspaceState | null,
    selections: Record<string, CliSelectionSnapshot | null> = {},
): CliWorkspaceSyncPayload {
    if (!workspace) {
        return {
            workspace: {
                root_path: null,
                active_tab_id: null,
                tabs: [],
            },
            tab_contents: {},
            tab_selections: {},
        };
    }

    const tabs = workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .filter((tab): tab is WorkspaceTab => Boolean(tab));

    return {
        workspace: {
            root_path: workspace.rootPath,
            active_tab_id: workspace.activeTabId,
            tabs: tabs.map((tab) => ({
                tab_id: tab.tabId,
                path: tab.path,
                title: tab.title,
                dirty: tab.dirty,
            })),
        },
        tab_contents: Object.fromEntries(
            tabs
                .filter((tab) => tab.markdown !== undefined)
                .map((tab) => [tab.tabId, tab.markdown ?? ""]),
        ),
        tab_selections: Object.fromEntries(
            tabs
                .map((tab) => [tab.tabId, selections[tab.tabId] ?? null])
                .filter(([, selection]) => selection !== null),
        ),
    };
}

export async function syncCliWorkspaceSnapshot(
    workspace: WorkspaceState | null,
    selections: Record<string, CliSelectionSnapshot | null> = {},
) {
    const { invoke } = await tauriCore();
    await invoke("cli_update_workspace_snapshot", {
        payload: buildCliWorkspaceSyncPayload(workspace, selections),
    });
}

export function buildCliFrontendHeartbeatPayload(
    workspace: WorkspaceState | null,
): CliFrontendHeartbeatPayload {
    return {
        root_path: workspace?.rootPath ?? null,
        has_workspace: Boolean(workspace),
        root_present:
            typeof document !== "undefined" &&
            document.querySelector("[data-mdx-root]") !== null,
        visibility_state:
            typeof document !== "undefined" ? document.visibilityState : null,
        location_href:
            typeof window !== "undefined" ? window.location.href : null,
    };
}

export async function syncCliFrontendHeartbeat(
    workspace: WorkspaceState | null,
) {
    const { invoke } = await tauriCore();
    await invoke("cli_frontend_heartbeat", {
        payload: buildCliFrontendHeartbeatPayload(workspace),
    });
}
