export type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;

export interface FileTreeFileNode {
    kind: "file";
    name: string;
    path: string;
}

export interface FileTreeFolderNode {
    kind: "folder";
    name: string;
    path: string;
    children: FileTreeNode[];
}

export interface HighlightSegment {
    text: string;
    highlighted: boolean;
}

export type FilteredFileTreeNode =
    | (FileTreeFileNode & {
          nameSegments?: HighlightSegment[];
      })
    | (Omit<FileTreeFolderNode, "children"> & {
          children: FilteredFileTreeNode[];
          nameSegments?: HighlightSegment[];
      });

export interface MarkdownOutlineHeading {
    id: string;
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
    line: number;
}

export interface WorkspaceTab {
    tabId: string;
    path: string;
    title: string;
    dirty: boolean;
    needsRenameOnFirstSave: boolean;
    markdown?: string;
}

export interface CliSelectionSnapshot {
    has_selection: boolean;
    selected_text: string;
    before: string;
    after: string;
    before_truncated: boolean;
    after_truncated: boolean;
}

export interface CliWorkspaceTabSnapshot {
    tab_id: string;
    path: string;
    title: string;
    dirty: boolean;
}

export interface CliWorkspaceSnapshot {
    root_path: string | null;
    active_tab_id: string | null;
    tabs: CliWorkspaceTabSnapshot[];
}

export interface CliWorkspaceSyncPayload {
    workspace: CliWorkspaceSnapshot;
    tab_contents: Record<string, string>;
    tab_selections: Record<string, CliSelectionSnapshot | null>;
}

export interface CliEditorSnapshot {
    tabId: string;
    markdown: string;
    selection: CliSelectionSnapshot | null;
}

export interface PendingCliEditorCommand {
    id: string;
    kind: "focus" | "insert" | "scrollToLine";
    tabId: string;
    text?: string;
    lineNumber?: number;
}

export interface CliOpenFileEvent {
    path: string;
}

export interface CliTabEvent {
    tabId?: string;
}

export interface CliInsertEvent {
    tabId?: string;
    text: string;
}

export interface CliCloseEvent {
    tabId?: string;
    force: boolean;
}

export interface CliFileCreatedEvent {
    path: string;
    name: string;
    needsRenameOnFirstSave: boolean;
}

export interface CliFolderCreatedEvent {
    path: string;
    name: string;
}

export interface CliFileUpdatedEvent {
    path: string;
}

export interface CliPathRenamedEvent {
    oldPath: string;
    newPath: string;
    affectedPrefix?: AffectedPrefix | null;
}

export interface AffectedPrefix {
    oldPrefix: string;
    newPrefix: string;
}

export interface PathChangeResult {
    oldPath: string;
    newPath: string;
    affectedPrefix?: AffectedPrefix | null;
}

export interface WorkspacePanelState {
    leftCollapsed: boolean;
    leftWidth: number;
    rightCollapsed: boolean;
    rightWidth: number;
}

export interface WorkspaceFileTreeActions {
    createFolder: () => Promise<void>;
    createMarkdownFile: () => Promise<void>;
    renameSelection: () => Promise<void>;
    deleteSelection: () => Promise<void>;
    refreshTree: () => Promise<void>;
}

export interface WorkspaceMenuActions extends WorkspaceFileTreeActions {
    saveActiveTab: () => Promise<void>;
    closeActiveTab: () => Promise<void>;
}

export type WorkspaceSearchStatus =
    | "idle"
    | "typing"
    | "searching"
    | "complete"
    | "error";

export interface WorkspaceSearchResultItem {
    path: string;
    lineNumber: number;
    columnStart: number;
    columnEnd: number;
    line: string;
    before?: string | null;
    after?: string | null;
    dirty: boolean;
}

export interface WorkspaceSearchSummary {
    skippedLargeFiles: number;
    skippedUnreadableFiles: number;
    truncated: boolean;
    searchedFiles: number;
}

export interface WorkspaceSearchResponse {
    requestId: string;
    results: WorkspaceSearchResultItem[];
    skippedLargeFiles: number;
    skippedUnreadableFiles: number;
    truncated: boolean;
    searchedFiles: number;
}

export interface DirtySearchOverride {
    path: string;
    markdown: string;
}

export interface WorkspaceSearchState {
    query: string;
    caseSensitive?: boolean;
    status?: WorkspaceSearchStatus;
    requestId?: string | null;
    results?: WorkspaceSearchResultItem[];
    summary?: WorkspaceSearchSummary;
    error?: string | null;
}

export interface WorkspaceFullTextSearchState extends WorkspaceSearchState {
    caseSensitive: boolean;
    status: WorkspaceSearchStatus;
    requestId: string | null;
    results: WorkspaceSearchResultItem[];
    summary: WorkspaceSearchSummary;
    error: string | null;
}

export interface WorkspaceState {
    rootPath: string;
    fileTree: FileTreeNode[];
    tabs: Record<string, WorkspaceTab>;
    tabOrder: string[];
    activeTabId: string | null;
    panel: WorkspacePanelState;
    treeFilterQuery?: string;
    search: WorkspaceSearchState;
}

export type WorkspacePanelSide = "left" | "right";

export interface PersistedAppState {
    stateVersion: number;
    recentWorkspaceRoot: string | null;
    preferences: AppPreferences;
    workspaces: PersistedWorkspaceState[];
    windowSize: PersistedWindowSize;
}

export interface AppPreferences {
    fileTreeExcludeDirs: string[];
    fileWatchEnabled: boolean;
    searchMaxFileBytes: number;
    searchMaxResults: number;
    searchMaxMatchesPerFile: number;
}

export interface PersistedWorkspaceState {
    rootPath: string;
    tabs: PersistedWorkspaceTab[];
    activeTabId: string | null;
    panels: WorkspacePanelState;
}

export interface PersistedWorkspaceTab {
    tabId: string;
    path: string;
    title: string;
    dirty: boolean;
    needsRenameOnFirstSave: boolean;
}

export interface PersistedWindowSize {
    width: number;
    height: number;
}

export type WorkspaceAction =
    | {
          type: "workspace/rootChanged";
          rootPath: string;
          fileTree?: FileTreeNode[];
      }
    | {
          type: "tree/loaded";
          fileTree: FileTreeNode[];
      }
    | {
          type: "tab/opened";
          tab: WorkspaceTab;
      }
    | {
          type: "tab/activated";
          tabId: string | null;
      }
    | {
          type: "tab/closed";
          tabId: string;
      }
    | {
          type: "tab/pathRemapped";
          fromPath: string;
          toPath: string;
      }
    | {
          type: "tab/prefixRemapped";
          affectedPrefix: AffectedPrefix;
      }
    | {
          type: "tab/closedByPath";
          path: string;
      }
    | {
          type: "tab/closedByPrefix";
          prefix: string;
      }
    | {
          type: "tab/contentChanged";
          tabId: string;
          markdown: string;
      }
    | {
          type: "tab/saved";
          tabId: string;
          markdown?: string;
      }
    | {
          type: "tab/savedIfUnchanged";
          tabId: string;
          markdown: string;
      }
    | {
          type: "tab/renamed";
          tabId: string;
          path: string;
          title?: string;
          needsRenameOnFirstSave?: boolean;
      }
    | {
          type: "panel/resized";
          side: WorkspacePanelSide;
          width: number;
      }
    | {
          type: "panel/collapsedChanged";
          side: WorkspacePanelSide;
          collapsed: boolean;
      }
    | {
          type: "treeFilter/queryChanged";
          query: string;
      }
    | {
          type: "search/queryChanged";
          query: string;
      }
    | {
          type: "search/caseSensitivityToggled";
      }
    | {
          type: "search/requestStarted";
          requestId: string;
      }
    | {
          type: "search/requestCompleted";
          requestId: string;
          results: WorkspaceSearchResultItem[];
          summary: WorkspaceSearchSummary;
      }
    | {
          type: "search/requestFailed";
          requestId: string;
          error: string;
      };
