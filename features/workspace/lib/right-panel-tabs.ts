export type RightPanelTabId = "outline" | "llmWiki";

export interface RightPanelTab {
  id: RightPanelTabId;
  label: string;
}

export function buildRightPanelTabs(): RightPanelTab[] {
  return [
    { id: "outline", label: "目录" },
    { id: "llmWiki", label: "LLM Wiki" },
  ];
}
