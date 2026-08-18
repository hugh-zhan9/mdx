// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteList } from "./note-list";
import type { NoteCard } from "../lib/note-index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse("2026-08-18T12:00:00Z");

const notes: NoteCard[] = [
    {
        path: "/tmp/ws/two.md",
        title: "Two Sum",
        excerpt: "行内公式。独立公式：",
        modifiedMs: now - 41 * 60_000,
    },
    {
        path: "/tmp/ws/notes/empty.md",
        title: "empty",
        excerpt: "",
        modifiedMs: null,
    },
];

describe("NoteList", () => {
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

    function render(overrides: Partial<Parameters<typeof NoteList>[0]> = {}) {
        const props = {
            notes,
            activePath: null as string | null,
            nowMs: now,
            onOpenNote: vi.fn(),
            emptyTitle: "还没有笔记",
            emptyDescription: "新建一篇。",
            ...overrides,
        };

        act(() => {
            root.render(<NoteList {...props} />);
        });

        return props;
    }

    it("says what each note is: its title, its opening prose and its age", () => {
        render();

        expect(host.textContent).toContain("Two Sum");
        expect(host.textContent).toContain("行内公式。独立公式：");
        expect(host.textContent).toContain("41分钟前");
    });

    it("keeps a row for a note with no prose and no known time", () => {
        render();

        const rows = host.querySelectorAll("[data-mdx-note-card]");
        expect(rows).toHaveLength(2);
        expect(rows[1]?.textContent).toContain("empty");
    });

    it("marks the note being edited", () => {
        render({ activePath: "/tmp/ws/two.md" });

        const rows = Array.from(host.querySelectorAll("[data-mdx-note-card]"));
        expect(rows[0]?.getAttribute("data-active")).toBe("true");
        expect(rows[1]?.getAttribute("data-active")).toBeNull();
    });

    it("opens the note it was asked for, by path", () => {
        const props = render();

        act(() => {
            host
                .querySelectorAll<HTMLButtonElement>("[data-mdx-note-card]")[1]
                ?.click();
        });

        expect(props.onOpenNote).toHaveBeenCalledWith("/tmp/ws/notes/empty.md");
    });

    /** Right-clicks a row and returns the menu item with that label. */
    function menuItem(rowIndex: number, label: string) {
        const rows = host.querySelectorAll<HTMLLIElement>(
            "[data-mdx-note-list] > li",
        );
        const row = rows[rowIndex];
        if (!row) throw new Error(`no row at ${rowIndex}`);

        act(() => {
            row.dispatchEvent(
                new MouseEvent("contextmenu", {
                    bubbles: true,
                    clientX: 30,
                    clientY: 40,
                }),
            );
        });

        const item = Array.from(
            host.querySelectorAll<HTMLButtonElement>(
                "[data-mdx-context-menu] button",
            ),
        ).find((button) => button.textContent === label);
        if (!item) throw new Error(`no menu item “${label}”`);

        return item;
    }

    /**
     * Presses and clicks, the way a mouse does.
     *
     * The press matters: the menu closes on a press outside itself, and closing
     * on any press at all unmounted the item before its click arrived.
     */
    function press(item: HTMLButtonElement) {
        act(() => {
            item.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true }),
            );
        });
        act(() => item.click());
    }

    it("offers a note's actions on a right-click, not as buttons in the row", () => {
        const onDeleteNote = vi.fn();
        const onRevealNote = vi.fn();
        const onCopyNotePath = vi.fn();
        render({ onDeleteNote, onRevealNote, onCopyNotePath });

        // The row itself carries no controls; the menu is where they live.
        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();
        expect(
            host.querySelectorAll("[data-mdx-note-card]")[0]?.querySelectorAll(
                "button",
            ),
        ).toHaveLength(0);

        press(menuItem(0, "移到废纸篓"));

        expect(onDeleteNote).toHaveBeenCalledWith("/tmp/ws/two.md", "Two Sum");
        // Using the menu closes it.
        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();

        press(menuItem(1, "在 Finder 中显示"));
        expect(onRevealNote).toHaveBeenCalledWith("/tmp/ws/notes/empty.md");

        press(menuItem(1, "复制路径"));
        expect(onCopyNotePath).toHaveBeenCalledWith("/tmp/ws/notes/empty.md");
    });

    it("opens no menu at all when the workspace offers nothing to do", () => {
        render();

        const rows = host.querySelectorAll<HTMLLIElement>(
            "[data-mdx-note-list] > li",
        );
        act(() => {
            rows[0]?.dispatchEvent(
                new MouseEvent("contextmenu", { bubbles: true }),
            );
        });

        expect(host.querySelector("[data-mdx-context-menu]")).toBeNull();
    });

    it("says why the list is empty rather than showing nothing", () => {
        render({ notes: [] });

        expect(host.querySelector("[data-mdx-note-list]")).toBeNull();
        expect(host.textContent).toContain("还没有笔记");
        expect(host.textContent).toContain("新建一篇。");
    });
});
