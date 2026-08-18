export type MemoryPanelTabId =
  | "overview"
  | "material"
  | "conclusions"
  | "context"
  | "integrations"
  | "diagnostics";

export interface MemoryPanelTab {
  id: MemoryPanelTabId;
  label: string;
  disabled: boolean;
}

/**
 * The panel's tabs, in the order the work flows.
 *
 * Material comes in, conclusions are drawn from it, and the context tab shows
 * what an agent would actually be handed. The old "待确认" tab is gone: nothing
 * waits outside the library any more, and a conclusion nobody has adopted is
 * simply a conclusion with that status.
 */
export function buildMemoryPanelTabs(status: {
  enabled: boolean;
}): MemoryPanelTab[] {
  return [
    { id: "overview", label: "概览", disabled: false },
    { id: "material", label: "素材", disabled: !status.enabled },
    { id: "conclusions", label: "结论", disabled: !status.enabled },
    { id: "context", label: "本次上下文", disabled: !status.enabled },
    { id: "integrations", label: "Agent 集成", disabled: !status.enabled },
    { id: "diagnostics", label: "诊断", disabled: false },
  ];
}
