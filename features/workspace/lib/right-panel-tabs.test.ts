import { describe, expect, it } from "vitest";
import { buildRightPanelTabs } from "./right-panel-tabs";

describe("buildRightPanelTabs", () => {
  it("orders outline and LLM Wiki tabs", () => {
    expect(buildRightPanelTabs().map((tab) => tab.id)).toEqual([
      "outline",
      "llmWiki",
    ]);
  });
});
