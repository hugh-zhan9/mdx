import { describe, expect, it } from "vitest";
import { buildMemoryPanelTabs } from "./memory-panel-state";

describe("buildMemoryPanelTabs", () => {
  it("disables data tabs until memory is initialized", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: false });
    expect(tabs.find((tab) => tab.id === "sessions")?.disabled).toBe(true);
    expect(tabs.find((tab) => tab.id === "overview")?.disabled).toBe(false);
    expect(tabs.find((tab) => tab.id === "diagnostics")?.disabled).toBe(false);
  });

  it("builds the agent backend console tabs with Chinese labels", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: true });
    expect(tabs.filter((tab) => tab.disabled)).toEqual([]);
    expect(tabs.map((tab) => tab.id)).toEqual([
      "overview",
      "integrations",
      "sessions",
      "longTerm",
      "pending",
      "working",
      "diagnostics",
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual([
      "概览",
      "Agent 集成",
      "会话",
      "长期记忆",
      "待确认",
      "工作上下文",
      "诊断",
    ]);
  });
});
