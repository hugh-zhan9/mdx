import { normalizeWorkspacePath } from "./path";
import type { CliFileUpdatedEvent, WorkspaceAction, WorkspaceState } from "./types";

type Invoke = <T = unknown>(
    command: string,
    args: Record<string, unknown>,
) => Promise<T>;

interface RefreshCleanOpenTabOptions {
    payload: CliFileUpdatedEvent;
    workspace: WorkspaceState;
    dispatch: (action: WorkspaceAction) => void;
    invoke: Invoke;
}

export async function refreshCleanOpenTabFromDisk({
    payload,
    workspace,
    dispatch,
    invoke,
}: RefreshCleanOpenTabOptions): Promise<boolean> {
    const updatedPath = normalizeWorkspacePath(payload.path);
    const tab = workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .find((candidate) => {
            return (
                candidate &&
                normalizeWorkspacePath(candidate.path) === updatedPath
            );
        });

    if (!tab || tab.dirty) {
        return false;
    }

    const markdown = await invoke<string>("read_markdown_file", {
        rootPath: workspace.rootPath,
        path: tab.path,
    });

    dispatch({
        type: "tab/saved",
        tabId: tab.tabId,
        markdown,
    });
    return true;
}
