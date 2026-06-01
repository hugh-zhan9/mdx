export { WorkspaceApp } from "./components/workspace-app";
export { parseMarkdownOutline } from "./lib/outline";
export {
    isMarkdownFilePath,
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./lib/path";
export { filterTreeByName } from "./lib/tree-filter";
export { createWorkspaceState, workspaceReducer } from "./lib/workspace-reducer";
export type {
    FileTreeNode,
    FilteredFileTreeNode,
    HighlightSegment,
    MarkdownOutlineHeading,
    WorkspaceAction,
    WorkspacePanelSide,
    WorkspacePanelState,
    WorkspaceSearchState,
    WorkspaceState,
    WorkspaceTab,
} from "./lib/types";
