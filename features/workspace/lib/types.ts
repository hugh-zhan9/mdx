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
          nameSegments: HighlightSegment[];
      })
    | (FileTreeFolderNode & {
          children: FilteredFileTreeNode[];
          nameSegments: HighlightSegment[];
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

export interface WorkspacePanelState {
    leftCollapsed: boolean;
    leftWidth: number;
    rightCollapsed: boolean;
    rightWidth: number;
}

export interface WorkspaceSearchState {
    query: string;
}

export interface WorkspaceState {
    rootPath: string;
    fileTree: FileTreeNode[];
    tabs: Record<string, WorkspaceTab>;
    tabOrder: string[];
    activeTabId: string | null;
    panel: WorkspacePanelState;
    search: WorkspaceSearchState;
}

export type WorkspacePanelSide = "left" | "right";

export interface PersistedAppState {
    stateVersion: number;
    recentWorkspaceRoot: string | null;
    workspaces: PersistedWorkspaceState[];
    windowSize: PersistedWindowSize;
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
          type: "search/queryChanged";
          query: string;
      };
