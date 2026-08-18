// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TabStrip } from "./tab-strip";
import type { WorkspaceTab } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
    return {
        tabId: "tab-1",
        path: "/tmp/ws/notes/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Note",
        ...overrides,
    };
}

describe("TabStrip", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    function render(overrides: Partial<Parameters<typeof TabStrip>[0]> = {}) {
        const props = {
            tabs: [tab(), tab({ tabId: "tab-2", title: "other.md" })],
            activeTabId: "tab-1" as string | null,
            dispatch: vi.fn(),
            onCloseTab: vi.fn(async () => undefined),
            onRevealTab: vi.fn(),
            onCopyTabPath: vi.fn(),
            onCloseOtherTabs: vi.fn(),
            onCloseAllTabs: vi.fn(),
            ...overrides,
        };

        act(() => {
            root.render(<TabStrip {...props} />);
        });

        return props;
    }

    function rightClickTab(index: number) {
        const tabs = host.querySelectorAll<HTMLDivElement>(
            "[data-mdx-workspace-tab]",
        );
        const target = tabs[index];
        if (!target) throw new Error(`no tab at ${index}`);

        act(() => {
            target.dispatchEvent(
                new MouseEvent("contextmenu", {
                    bubbles: true,
                    clientX: 40,
                    clientY: 60,
                }),
            );
        });
    }

    /** Presses and clicks, the way a mouse does. */
    function press(item: HTMLButtonElement) {
        act(() => {
            item.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true }),
            );
        });
        act(() => item.click());
    }

    function menuItem(label: string) {
        const item = Array.from(
            host.querySelectorAll<HTMLButtonElement>(
                "[data-mdx-context-menu] button",
            ),
        ).find((button) => button.textContent === label);
        if (!item) throw new Error(`no menu item “${label}”`);

        return item;
    }

    it("opens no menu until a tab is right-clicked", () => {
        render();

        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();

        rightClickTab(0);

        expect(host.querySelector("[data-mdx-context-menu]")).not.toBeNull();
    });

    it("shows the file where it lives, for the tab that was clicked", () => {
        const props = render();
        rightClickTab(1);

        press(menuItem("在 Finder 中显示"));

        expect(props.onRevealTab).toHaveBeenCalledTimes(1);
        expect(props.onRevealTab.mock.calls[0]?.[0]?.tabId).toBe("tab-2");
        // The menu closes once it has been used.
        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();
    });

    it("copies the path, closes the tab, and closes the others", () => {
        const props = render();

        rightClickTab(0);
        press(menuItem("复制路径"));
        expect(props.onCopyTabPath.mock.calls[0]?.[0]?.tabId).toBe("tab-1");

        rightClickTab(0);
        press(menuItem("关闭"));
        expect(props.onCloseTab).toHaveBeenCalledWith("tab-1");

        rightClickTab(0);
        press(menuItem("关闭其他标签页"));
        expect(props.onCloseOtherTabs).toHaveBeenCalledWith("tab-1");
    });

    it("offers no closing of others when this is the only tab", () => {
        render({ tabs: [tab()] });
        rightClickTab(0);

        expect(menuItem("关闭其他标签页").disabled).toBe(true);
    });

    it("closes the menu when something else is clicked", () => {
        render();
        rightClickTab(0);

        act(() => {
            window.dispatchEvent(new PointerEvent("pointerdown"));
        });

        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();
    });
});
