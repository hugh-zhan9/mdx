import type { SelectionState } from "../components/editor-kernel-adapter";
import type { WorkspaceTab } from "@/features/workspace/lib/types";

export interface EditorBridgeState {
    currentMarkdown: string;
    selection: SelectionState | null;
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
