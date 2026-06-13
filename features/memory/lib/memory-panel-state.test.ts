import { describe, expect, it } from "vitest";
import { buildMemoryPanelTabs } from "./memory-panel-state";

describe("buildMemoryPanelTabs", () => {
  it("disables data tabs until memory is initialized", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: false });
    expect(tabs.find((tab) => tab.id === "recall")?.disabled).toBe(true);
    expect(tabs.find((tab) => tab.id === "settings")?.disabled).toBe(false);
  });

  it("enables recall, working, memories, inbox, and threads when ready", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: true });
    expect(tabs.filter((tab) => tab.disabled)).toEqual([]);
  });
});
