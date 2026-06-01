export { WorkspaceApp } from "./components/workspace-app";
export { EditorStage } from "./components/editor-stage";
export { FileTreePanel } from "./components/file-tree-panel";
export { OutlinePanel } from "./components/outline-panel";
export { TabStrip } from "./components/tab-strip";
export { WorkspaceShell } from "./components/workspace-shell";
export { usePanelResize } from "./hooks/use-panel-resize";
export { useWorkspaceBootstrap } from "./hooks/use-workspace-bootstrap";
export { parseMarkdownOutline } from "./lib/outline";
export {
    isMarkdownFilePath,
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./lib/path";
export { filterTreeByName } from "./lib/tree-filter";
export { findPersistedWorkspaceForRoot } from "./lib/persisted-workspace";
export {
    DEFAULT_WINDOW_SIZE,
    MIN_WINDOW_SIZE,
    normalizePersistedWindowSize,
} from "./lib/window-size";
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
