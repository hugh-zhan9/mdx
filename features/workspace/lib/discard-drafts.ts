import { isMarkdownFilePath, normalizeWorkspacePath } from "./path";
import type { WorkspaceState } from "./types";

export interface DraftDeleteInput {
    realPath: string;
}

export type DeleteDraft = (input: DraftDeleteInput) => Promise<unknown>;

export function collectDiscardedWorkspaceDraftPaths(
    workspace: WorkspaceState,
): string[] {
    const uniquePaths = new Set<string>();

    for (const tabId of workspace.tabOrder) {
        const tab = workspace.tabs[tabId];

        if (
            !tab?.dirty ||
            !isMarkdownFilePath(tab.path) ||
            tab.markdown === undefined
        ) {
            continue;
        }

        uniquePaths.add(normalizeWorkspacePath(tab.path));
    }

    return [...uniquePaths];
}

export async function deleteDiscardedWorkspaceDrafts(
    workspace: WorkspaceState,
    deleteDraft: DeleteDraft,
) {
    for (const realPath of collectDiscardedWorkspaceDraftPaths(workspace)) {
        await deleteDraft({ realPath });
    }
}
