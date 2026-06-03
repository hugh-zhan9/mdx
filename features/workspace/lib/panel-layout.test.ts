import { describe, expect, it } from "vitest";
import { calculateWorkspacePanelLayout } from "./panel-layout";

describe("calculateWorkspacePanelLayout", () => {
    it("shrinks restored side panels to preserve editor width", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1100,
            leftCollapsed: false,
            leftWidth: 640,
            rightCollapsed: false,
            rightWidth: 640,
        });

        expect(layout.centerWidth).toBeGreaterThanOrEqual(560);
        expect(layout.leftWidth).toBe(380);
        expect(layout.rightWidth).toBe(160);
    });

    it("keeps collapsed panels at zero width", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1100,
            leftCollapsed: true,
            leftWidth: 640,
            rightCollapsed: false,
            rightWidth: 640,
        });

        expect(layout.leftWidth).toBe(0);
        expect(layout.rightWidth).toBe(540);
        expect(layout.centerWidth).toBe(560);
    });

    it("preserves user widths when there is enough space", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1440,
            leftCollapsed: false,
            leftWidth: 300,
            rightCollapsed: false,
            rightWidth: 300,
        });

        expect(layout.leftWidth).toBe(300);
        expect(layout.rightWidth).toBe(300);
        expect(layout.centerWidth).toBe(840);
    });
});
