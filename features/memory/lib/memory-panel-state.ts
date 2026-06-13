export type MemoryPanelTabId =
  | "recall"
  | "working"
  | "memories"
  | "inbox"
  | "threads"
  | "settings";

export interface MemoryPanelTab {
  id: MemoryPanelTabId;
  label: string;
  disabled: boolean;
}

export function buildMemoryPanelTabs(status: {
  hasMemory: boolean;
}): MemoryPanelTab[] {
  return [
    { id: "recall", label: "Recall", disabled: !status.hasMemory },
    { id: "working", label: "Working", disabled: !status.hasMemory },
    { id: "memories", label: "Memories", disabled: !status.hasMemory },
    { id: "inbox", label: "Inbox", disabled: !status.hasMemory },
    { id: "threads", label: "Threads", disabled: !status.hasMemory },
    { id: "settings", label: "Settings", disabled: false },
  ];
}
