import type { WorkspaceState } from "./types";

export function dirtyWorkspacePaths(workspace: WorkspaceState): string[] {
    return workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .filter((tab) => tab?.dirty && !tab.needsRenameOnFirstSave)
        .map((tab) => tab.path);
}
