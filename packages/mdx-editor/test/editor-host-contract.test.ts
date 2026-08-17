// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

interface MountResult {
    host: MilkdownEditorHost;
    root: HTMLElement;
    changes: string[];
    selectionChanges: number;
}

async function mount(
    markdown: string,
    editable = true,
    scheduleChangeEmission?: (emit: () => void) => void,
): Promise<MountResult> {
    const root = document.createElement("div");
    document.body.append(root);
    const result: MountResult = {
        host: null as unknown as MilkdownEditorHost,
        root,
        changes: [],
        selectionChanges: 0,
    };
    result.host = await createMilkdownEditorHost({
        root,
        markdown,
        editable,
        scheduleChangeEmission,
        onMarkdownChange: (next) => {
            result.changes.push(next);
        },
        onSelectionChange: () => {
            result.selectionChanges += 1;
        },
    });
    mounted.push(result.host);
    return result;
}

describe("editor host — document lifecycle", () => {
    it("accepts an empty document and reports a zero-width selection", async () => {
        const { host, root } = await mount("");
        expect(root.querySelector(".ProseMirror")).not.toBeNull();
        expect(host.getMarkdown()).toBe("");
        const selection = host.setSelection({ anchor: 0, head: 0 });
        expect(selection).toBe(true);
        expect(host.getSelection()).toEqual({ anchor: 0, head: 0 });
    });

    it("survives repeated mount and unmount without leaking a view", async () => {
        for (let round = 0; round < 3; round += 1) {
            const { host, root } = await mount(`# Round ${round}\n`);
            expect(root.querySelectorAll(".ProseMirror")).toHaveLength(1);
            await host.destroy();
            expect(host.isDestroyed()).toBe(true);
        }
        expect(document.querySelectorAll(".ProseMirror")).toHaveLength(0);
    });

    it("is idempotent when destroyed twice", async () => {
        const { host } = await mount("x\n");
        await host.destroy();
        await expect(host.destroy()).resolves.toBeUndefined();
    });

    it("rebuilds identical content from canonical markdown alone", async () => {
        // The document is edited first, so the string compared is the
        // serializer's own output rather than the input string echoed back.
        const first = await mount("# Title\n\nBody text with *emphasis*.\n");
        first.host.replaceSourceRange({ anchor: 8, head: 8 }, "Extra. ");
        const canonical = first.host.getMarkdown();
        expect(canonical).toContain("Extra.");

        const second = await mount(canonical);
        expect(second.host.getMarkdown()).toBe(canonical);
        expect(second.root.textContent).toBe(first.root.textContent);
    });

    it("does not emit a change callback for an external replace", async () => {
        const result = await mount("one\n");
        result.host.replaceMarkdown("two\n");
        expect(result.host.getMarkdown()).toBe("two\n");
        expect(result.changes).toEqual([]);
    });

    it("ignores an external replace that matches current content", async () => {
        const result = await mount("same\n");
        result.host.replaceMarkdown("same\n");
        expect(result.changes).toEqual([]);
    });
});

describe("editor host — source offset selection", () => {
    it("maps a caret in body text to its markdown offset", async () => {
        const markdown = "# Title\n\nHello world.\n";
        const { host } = await mount(markdown);
        const helloOffset = markdown.indexOf("Hello");
        host.setSelection({ anchor: helloOffset, head: helloOffset });
        expect(host.getSelection()).toEqual({
            anchor: helloOffset,
            head: helloOffset,
        });
    });

    it("round-trips a selection that spans inline syntax", async () => {
        const markdown = "Plain *emphasis* tail.\n";
        const { host } = await mount(markdown);
        const start = markdown.indexOf("emphasis");
        const end = start + "emphasis".length;
        host.setSelection({ anchor: start, head: end });
        expect(host.getSelection()).toEqual({ anchor: start, head: end });
    });

    it("preserves selection direction", async () => {
        const markdown = "abcdef\n";
        const { host } = await mount(markdown);
        host.setSelection({ anchor: 5, head: 1 });
        const selection = host.getSelection();
        expect(selection).not.toBeNull();
        expect(selection!.anchor).toBeGreaterThan(selection!.head);
    });

    it("keeps offsets in UTF-16 units across emoji and combining marks", async () => {
        const markdown = "a😀b́c\n";
        const { host } = await mount(markdown);
        // "a"=0, surrogate pair=1..2, "b"=3, combining acute=4, "c"=5.
        const afterEmoji = 3;
        host.setSelection({ anchor: afterEmoji, head: afterEmoji });
        expect(host.getSelection()).toEqual({
            anchor: afterEmoji,
            head: afterEmoji,
        });
    });

    it("never reports an offset that splits a surrogate pair", async () => {
        const markdown = "x😀y\n";
        const { host } = await mount(markdown);
        for (let offset = 0; offset <= markdown.length; offset += 1) {
            host.setSelection({ anchor: offset, head: offset });
            const selection = host.getSelection();
            expect(selection).not.toBeNull();
            const code = markdown.charCodeAt(selection!.anchor - 1);
            const next = markdown.charCodeAt(selection!.anchor);
            const splitsPair =
                code >= 0xd800 &&
                code <= 0xdbff &&
                next >= 0xdc00 &&
                next <= 0xdfff;
            expect(splitsPair).toBe(false);
        }
    });

    it("reports monotonically increasing offsets across blocks", async () => {
        const markdown = "# One\n\nTwo\n\n- Three\n- Four\n";
        const { host } = await mount(markdown);
        const probes = ["One", "Two", "Three", "Four"].map((word) =>
            markdown.indexOf(word),
        );
        const mapped = probes.map((offset) => {
            host.setSelection({ anchor: offset, head: offset });
            return host.getSelection()!.anchor;
        });
        const sorted = [...mapped].sort((a, b) => a - b);
        expect(mapped).toEqual(sorted);
    });

    it("clamps an offset past the end onto the document's last text position", async () => {
        const markdown = "short\n";
        const { host } = await mount(markdown);
        expect(host.setSelection({ anchor: 9999, head: 9999 })).toBe(true);
        expect(host.getSelection()).toEqual({ anchor: 5, head: 5 });
    });

    it("resolves the very end of the markdown to a text position", async () => {
        const markdown = "short\n";
        const { host } = await mount(markdown);
        expect(host.setSelection({ anchor: markdown.length, head: markdown.length })).toBe(
            true,
        );
        expect(host.getSelection()).toEqual({ anchor: 5, head: 5 });
    });
});

describe("editor host — editing and history", () => {
    it("emits a markdown change when the source range is replaced", async () => {
        const markdown = "Hello world.\n";
        const result = await mount(markdown);
        const start = markdown.indexOf("world");
        result.host.replaceSourceRange(
            { anchor: start, head: start + "world".length },
            "there",
        );
        expect(result.host.getMarkdown()).toContain("there");
        expect(result.changes.length).toBeGreaterThan(0);
    });

    it("reports edits in transaction order", async () => {
        const neverRuns = () => {};
        const result = await mount("a\n", true, neverRuns);
        result.host.replaceSourceRange({ anchor: 1, head: 1 }, "b");
        result.host.replaceSourceRange({ anchor: 2, head: 2 }, "c");
        result.host.flush();
        expect(result.changes).toHaveLength(2);
        expect(result.changes[0]).toContain("ab");
        expect(result.changes[1]).toContain("abc");
    });

    it("defers emission until the scheduler runs", async () => {
        // Serialization is kept off the input path, so an edit is not reported
        // synchronously; it waits for the scheduled emission or an explicit
        // flush. This is what keeps a keystroke from paying for a full
        // re-serialization before the frame is painted.
        let scheduled: (() => void) | null = null;
        const result = await mount("a\n", true, (emit) => {
            scheduled = emit;
        });

        result.host.replaceSourceRange({ anchor: 1, head: 1 }, "b");

        expect(result.changes).toEqual([]);
        expect(scheduled).not.toBeNull();
        scheduled!();
        expect(result.changes).toEqual(["ab\n"]);
    });

    it("delivers a pending edit before the surface is destroyed", async () => {
        // A never-running scheduler stands in for a tab switch that happens
        // before the coalescing window closes. Milkdown's own listener plugin
        // debounces by 200 ms and cancels on destroy, which would drop this
        // edit; destroy() must drain it instead.
        const neverRuns = () => {};
        const result = await mount("keep\n", true, neverRuns);
        result.host.replaceSourceRange({ anchor: 4, head: 4 }, " me");
        expect(result.changes).toEqual([]);

        await result.host.destroy();

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toContain("keep me");
    });

    it("does not re-emit an already flushed edit on destroy", async () => {
        const neverRuns = () => {};
        const result = await mount("once\n", true, neverRuns);
        result.host.replaceSourceRange({ anchor: 4, head: 4 }, "!");
        result.host.flush();
        expect(result.changes).toHaveLength(1);
        await result.host.destroy();
        expect(result.changes).toHaveLength(1);
    });

    it("refuses edits after destroy", async () => {
        const result = await mount("a\n");
        await result.host.destroy();
        expect(result.host.replaceSourceRange({ anchor: 0, head: 1 }, "z")).toBe(
            false,
        );
        expect(result.host.getSelection()).toBeNull();
    });
});

describe("editor host — editable flag", () => {
    it("mounts a read-only surface when editable is false", async () => {
        const { root } = await mount("read only\n", false);
        const surface = root.querySelector<HTMLElement>(".ProseMirror");
        expect(surface).not.toBeNull();
        expect(surface!.getAttribute("contenteditable")).toBe("false");
    });

    it("flips editability without rebuilding the document", async () => {
        const { host, root } = await mount("toggle\n", false);
        host.setEditable(true);
        const surface = root.querySelector<HTMLElement>(".ProseMirror");
        expect(surface!.getAttribute("contenteditable")).toBe("true");
        expect(host.getMarkdown()).toBe("toggle\n");
    });
});
