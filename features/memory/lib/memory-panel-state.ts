export type MemoryPanelTabId =
  | "overview"
  | "integrations"
  | "sessions"
  | "longTerm"
  | "pending"
  | "working"
  | "diagnostics";

export interface MemoryPanelTab {
  id: MemoryPanelTabId;
  label: string;
  disabled: boolean;
}

export function buildMemoryPanelTabs(status: {
  hasMemory: boolean;
}): MemoryPanelTab[] {
  return [
    { id: "overview", label: "概览", disabled: false },
    { id: "integrations", label: "Agent 集成", disabled: !status.hasMemory },
    { id: "sessions", label: "会话", disabled: !status.hasMemory },
    { id: "longTerm", label: "长期记忆", disabled: !status.hasMemory },
    { id: "pending", label: "待确认", disabled: !status.hasMemory },
    { id: "working", label: "工作上下文", disabled: !status.hasMemory },
    { id: "diagnostics", label: "诊断", disabled: false },
  ];
}
