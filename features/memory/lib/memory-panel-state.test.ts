import { describe, expect, it } from "vitest";
import { buildMemoryPanelTabs } from "./memory-panel-state";

describe("buildMemoryPanelTabs", () => {
    it("offers the six surfaces of the two-layer model", () => {
        expect(buildMemoryPanelTabs({ enabled: true }).map((tab) => tab.id)).toEqual([
            "overview",
            "material",
            "conclusions",
            "context",
            "integrations",
            "diagnostics",
        ]);
    });

    it("keeps overview and diagnostics reachable when memory is off", () => {
        const tabs = buildMemoryPanelTabs({ enabled: false });

        // Those two are how a user finds out why it is off and turns it on.
        expect(tabs.filter((tab) => !tab.disabled).map((tab) => tab.id)).toEqual([
            "overview",
            "diagnostics",
        ]);
    });

    it("has no tab for the abandoned concepts", () => {
        const ids = buildMemoryPanelTabs({ enabled: true }).map((tab) => tab.id);

        for (const gone of ["pending", "working", "sessions", "longTerm"]) {
            expect(ids).not.toContain(gone);
        }
    });
});
