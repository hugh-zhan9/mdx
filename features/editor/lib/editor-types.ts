import type { SelectionState } from "@do-md/react";
import type { WorkspaceTab } from "@/features/workspace/lib/types";

export interface EditorBridgeState {
    markdown: string;
    selection: SelectionState | null;
    isReady: boolean;
}

export interface EditorPaneProps {
    rootPath: string;
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
}

export interface SaveResult {
    ok: boolean;
    message?: string;
}
