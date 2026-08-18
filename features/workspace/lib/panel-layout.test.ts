import { describe, expect, it } from "vitest";
import {
    calculateWorkspacePanelLayout,
    DEFAULT_LIST_WIDTH,
    MAX_RAIL_WIDTH,
    MIN_NAVIGATOR_LIST_WIDTH,
    MIN_RAIL_WIDTH,
    NAVIGATOR_RAIL_WIDTH,
} from "./panel-layout";

describe("calculateWorkspacePanelLayout", () => {
    it("keeps both columns at the widths they were dragged to", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1440,
            navigatorCollapsed: false,
            railWidth: 240,
            listWidth: 320,
        });

        expect(layout.railWidth).toBe(240);
        expect(layout.listWidth).toBe(320);
        expect(layout.navigatorWidth).toBe(560);
        expect(layout.editorWidth).toBe(880);
    });

    it("widens the navigator when the folder tree widens", () => {
        const narrow = calculateWorkspacePanelLayout({
            containerWidth: 1440,
            navigatorCollapsed: false,
            railWidth: NAVIGATOR_RAIL_WIDTH,
            listWidth: DEFAULT_LIST_WIDTH,
        });
        const wider = calculateWorkspacePanelLayout({
            containerWidth: 1440,
            navigatorCollapsed: false,
            railWidth: NAVIGATOR_RAIL_WIDTH + 80,
            listWidth: DEFAULT_LIST_WIDTH,
        });

        // The list is untouched; the editor is what gives up the room. Dragging
        // a tree's edge asks for a wider tree, not a narrower note list.
        expect(wider.listWidth).toBe(narrow.listWidth);
        expect(wider.navigatorWidth).toBe(narrow.navigatorWidth + 80);
        expect(wider.editorWidth).toBe(narrow.editorWidth - 80);
    });

    it("takes room from the list first when the window runs out", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1200,
            navigatorCollapsed: false,
            railWidth: 300,
            listWidth: 400,
        });

        // 1200 less the editor's 560 leaves 640 for the two columns, which is
        // 60 short: the list gives it up and the tree is untouched.
        expect(layout.railWidth).toBe(300);
        expect(layout.listWidth).toBe(340);
        expect(layout.editorWidth).toBe(560);
    });

    it("takes from the tree only once the list is at its minimum", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 800,
            navigatorCollapsed: false,
            railWidth: 300,
            listWidth: 400,
        });

        expect(layout.listWidth).toBe(MIN_NAVIGATOR_LIST_WIDTH);
        expect(layout.railWidth).toBeLessThan(300);
        expect(layout.railWidth).toBeGreaterThanOrEqual(MIN_RAIL_WIDTH);
    });

    it("holds each column inside its own limits", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 2000,
            navigatorCollapsed: false,
            railWidth: 9_000,
            listWidth: 10,
        });

        expect(layout.railWidth).toBe(MAX_RAIL_WIDTH);
        expect(layout.listWidth).toBe(MIN_NAVIGATOR_LIST_WIDTH);
    });

    it("gives the window to the editor when the navigator is collapsed", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 1440,
            navigatorCollapsed: true,
            railWidth: NAVIGATOR_RAIL_WIDTH,
            listWidth: DEFAULT_LIST_WIDTH,
        });

        expect(layout.navigatorWidth).toBe(0);
        expect(layout.railWidth).toBe(0);
        expect(layout.listWidth).toBe(0);
        expect(layout.editorWidth).toBe(1440);
    });

    it("does not go negative in a window with no room at all", () => {
        const layout = calculateWorkspacePanelLayout({
            containerWidth: 0,
            navigatorCollapsed: false,
            railWidth: NAVIGATOR_RAIL_WIDTH,
            listWidth: DEFAULT_LIST_WIDTH,
        });

        expect(layout.editorWidth).toBe(0);
        expect(layout.railWidth).toBe(MIN_RAIL_WIDTH);
        expect(layout.listWidth).toBe(MIN_NAVIGATOR_LIST_WIDTH);
    });
});
