import { describe, expect, it } from "vitest";
import { buildMemoryPanelTabs } from "./memory-panel-state";

describe("buildMemoryPanelTabs", () => {
    it("offers four tabs, one per question a person is asking", () => {
        // Six tabs used to mirror the backend: overview, material, conclusions,
        // context, integrations, diagnostics. These three mirror what a person
        // does — the daily work, the check that it reached an agent, the setup.
        expect(buildMemoryPanelTabs({ enabled: true }).map((tab) => tab.id)).toEqual([
            "workbench",
            "graph",
            "context",
            "setup",
        ]);
    });

    it("keeps setup reachable when memory is off", () => {
        const tabs = buildMemoryPanelTabs({ enabled: false });

        // It is where a user finds out why it is off and turns it on, so it is
        // the one tab that is never disabled.
        expect(tabs.filter((tab) => !tab.disabled).map((tab) => tab.id)).toEqual([
            "setup",
        ]);
    });

    it("has no tab for the abandoned concepts", () => {
        const ids = buildMemoryPanelTabs({ enabled: true }).map((tab) => tab.id);

        for (const gone of ["pending", "working", "sessions", "longTerm"]) {
            expect(ids).not.toContain(gone);
        }
    });
});
