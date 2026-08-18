import { describe, expect, it } from "vitest";

import { formatRelativeTime, noteCard } from "./note-index";
import type { NoteIndexEntry } from "./note-index";

function entry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
    return {
        path: "/tmp/ws/note.md",
        modifiedMs: 1_700_000_000_000,
        head: "",
        headTruncated: false,
        ...overrides,
    };
}

describe("noteCard", () => {
    it("takes the title the front matter declares", () => {
        const card = noteCard(
            entry({
                path: "/tmp/ws/two.md",
                head: "---\ntitle: Two Sum\ntags: [leetcode]\n---\n\n# 别的标题\n",
            }),
        );

        expect(card.title).toBe("Two Sum");
    });

    it("unquotes a declared title", () => {
        expect(
            noteCard(entry({ head: '---\ntitle: "Two Sum"\n---\n' })).title,
        ).toBe("Two Sum");
    });

    it("falls back to the first heading", () => {
        const card = noteCard(
            entry({ path: "/tmp/ws/two.md", head: "# Two Sum\n\n行内公式。\n" }),
        );

        expect(card.title).toBe("Two Sum");
    });

    it("reads a heading as text, not as Markdown", () => {
        expect(noteCard(entry({ head: "# **Two** `Sum`\n" })).title).toBe(
            "Two Sum",
        );
    });

    it("falls back to the file name, without its extension", () => {
        expect(
            noteCard(entry({ path: "/tmp/ws/notes/log.md", head: "正文。\n" }))
                .title,
        ).toBe("log");
        expect(
            noteCard(entry({ path: "/tmp/ws/a.markdown", head: "" })).title,
        ).toBe("a");
    });

    it("excerpts the prose and leaves the markup out", () => {
        const card = noteCard(
            entry({
                head: "# 测试\n\n代码块：\n\n```python\ndef main():\n    print(1)\n```\n",
            }),
        );

        expect(card.title).toBe("测试");
        expect(card.excerpt).toBe("代码块：");
    });

    it("does not spend the excerpt repeating the title", () => {
        const card = noteCard(entry({ head: "# Two Sum\n\n行内公式。\n" }));

        expect(card.excerpt).toBe("行内公式。");
    });

    it("has no excerpt for a note with nothing in it yet", () => {
        expect(noteCard(entry({ head: "" })).excerpt).toBe("");
        expect(noteCard(entry({ head: "# 标题\n" })).excerpt).toBe("");
    });

    it("counts the excerpt in characters, not code units", () => {
        const card = noteCard(entry({ head: `# t\n\n${"写".repeat(300)}` }));

        expect([...card.excerpt].length).toBe(140);
    });
});

describe("formatRelativeTime", () => {
    const now = Date.parse("2026-08-18T12:00:00Z");

    it("says just now for the last minute, and for a clock that disagrees", () => {
        expect(formatRelativeTime(now, now)).toBe("刚刚");
        expect(formatRelativeTime(now - 59_000, now)).toBe("刚刚");
        expect(formatRelativeTime(now + 60_000, now)).toBe("刚刚");
    });

    it("counts minutes, then hours", () => {
        expect(formatRelativeTime(now - 41 * 60_000, now)).toBe("41分钟前");
        expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1小时前");
        expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3小时前");
    });

    it("counts days up to a week", () => {
        expect(formatRelativeTime(now - 25 * 3_600_000, now)).toBe("昨天");
        expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3天前");
        expect(formatRelativeTime(now - 6 * 86_400_000, now)).toBe("6天前");
    });

    it("gives a date once it is more than a week ago", () => {
        const sameYear = Date.parse("2026-05-19T09:00:00Z");
        expect(formatRelativeTime(sameYear, now)).toMatch(/^0?5\/19$/);
    });

    it("keeps the year once it is not this one", () => {
        const lastYear = Date.parse("2025-12-31T09:00:00Z");
        expect(formatRelativeTime(lastYear, now)).toMatch(/^2025\/12\/3[01]$/);
    });

    it("says nothing when there is no time to report", () => {
        expect(formatRelativeTime(null, now)).toBe("");
    });
});

