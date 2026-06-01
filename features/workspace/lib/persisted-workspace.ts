import { normalizeWorkspacePath } from "./path";
import type { PersistedAppState, PersistedWorkspaceState } from "./types";

export function findPersistedWorkspaceForRoot(
    appState: PersistedAppState,
    requestedRootPath: string,
    canonicalRootPath: string,
): PersistedWorkspaceState | undefined {
    const canonicalWorkspace = findPersistedWorkspace(
        appState,
        canonicalRootPath,
    );

    if (canonicalWorkspace) {
        return canonicalWorkspace;
    }

    return findPersistedWorkspace(appState, requestedRootPath);
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
