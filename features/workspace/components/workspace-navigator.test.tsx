// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceNavigator } from "./workspace-navigator";
import type { NoteCard } from "../lib/note-index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse("2026-08-18T12:00:00Z");

function rowsOf(count: number): NoteCard[] {
    return Array.from({ length: count }, (_, index) => ({
        path: `/tmp/ws/note-${index}.md`,
        title: `笔记 ${index}`,
        excerpt: "开头一句。",
        modifiedMs: now - index * 60_000,
    }));
}

describe("WorkspaceNavigator", () => {
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

    function render(
        overrides: Partial<Parameters<typeof WorkspaceNavigator>[0]> = {},
    ) {
        const props = {
            rows: rowsOf(3),
            counts: { all: 27446, recent: 6, unfiled: 6 },
            matched: 27446,
            hasMore: true,
            onLoadMore: vi.fn(),
            notesLoading: false,
            notesError: null as string | null,
            group: "all" as const,
            onGroupChange: vi.fn(),
            query: "",
            onQueryChange: vi.fn(),
            activePath: null as string | null,
            onOpenNote: vi.fn(),
            nowMs: now,
            tab: "notes" as const,
            onTabChange: vi.fn(),
            headings: [],
            onHeadingClick: vi.fn(),
            tree: <div data-testid="tree" />,
            resizeHandleProps: {},
            railWidth: 208,
            railResizeHandleProps: { "data-testid": "rail-handle" },
            ...overrides,
        };

        act(() => {
            root.render(<WorkspaceNavigator {...props} />);
        });

        return props;
    }

    /** The list's scroller, with the geometry jsdom does not compute. */
    function scrollList({
        scrollTop,
        scrollHeight,
        clientHeight,
    }: {
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
    }) {
        const list = host.querySelector<HTMLDivElement>(
            "[data-mdx-note-list]",
        )?.parentElement;
        if (!list) throw new Error("no note list scroller");

        for (const [name, value] of [
            ["scrollTop", scrollTop],
            ["scrollHeight", scrollHeight],
            ["clientHeight", clientHeight],
        ] as const) {
            Object.defineProperty(list, name, {
                configurable: true,
                value,
            });
        }

        act(() => {
            list.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
    }

    it("counts what each group holds, not what is on screen", () => {
        render();

        const rail = host.querySelector("[aria-label='笔记分组']");
        expect(rail?.textContent).toContain("27446");
        expect(rail?.textContent).toContain("6");
        // The list says how many notes match, while showing three of them.
        expect(host.textContent).toContain("27446 篇");
        expect(host.querySelectorAll("[data-mdx-note-card]")).toHaveLength(3);
    });

    it("asks for another page when the list is scrolled near its end", () => {
        const props = render();

        scrollList({ scrollTop: 2_000, scrollHeight: 2_400, clientHeight: 300 });

        expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("does not ask while there is still list left to read", () => {
        const props = render();

        scrollList({ scrollTop: 0, scrollHeight: 2_400, clientHeight: 300 });

        expect(props.onLoadMore).not.toHaveBeenCalled();
    });

    it("does not ask when there is nothing more, or a page is already coming", () => {
        const noMore = render({ hasMore: false });
        scrollList({ scrollTop: 2_000, scrollHeight: 2_400, clientHeight: 300 });
        expect(noMore.onLoadMore).not.toHaveBeenCalled();

        const loading = render({ notesLoading: true });
        scrollList({ scrollTop: 2_000, scrollHeight: 2_400, clientHeight: 300 });
        expect(loading.onLoadMore).not.toHaveBeenCalled();
    });

    it("draws the rail at the width it was given, with its own handle", () => {
        render({ railWidth: 260 });

        const rail = host.querySelector<HTMLElement>("[aria-label='笔记分组']")
            ?.parentElement;
        expect(rail?.style.width).toBe("260px");
        expect(
            host.querySelector("[data-testid='rail-handle']"),
        ).not.toBeNull();
    });

    it("shows the outline in place of the list when that tab is chosen", () => {
        render({
            tab: "outline",
            headings: [
                {
                    id: "one",
                    level: 1,
                    text: "标题一",
                    line: 0,
                    range: { anchor: 2, head: 5 },
                },
            ],
        });

        expect(host.querySelector("[data-mdx-note-list]")).toBeNull();
        expect(host.textContent).toContain("标题一");
    });

    it("says why the list is empty when reading it failed", () => {
        render({ rows: [], notesError: "读取笔记列表失败。" });

        expect(host.textContent).toContain("读取笔记列表失败。");
    });
});
