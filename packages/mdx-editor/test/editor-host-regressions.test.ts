// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createDocumentRevisionGuard } from "../adapter/document-revision";
import type { DocumentSelectionRange } from "../adapter/types";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

interface Harness {
    host: MilkdownEditorHost;
    root: HTMLElement;
    changes: string[];
    selections: Array<DocumentSelectionRange | null>;
}

async function mount(
    markdown: string,
    scheduleChangeEmission?: (emit: () => void) => void,
): Promise<Harness> {
    const root = document.createElement("div");
    document.body.append(root);
    const harness: Harness = {
        host: null as unknown as MilkdownEditorHost,
        root,
        changes: [],
        selections: [],
    };
    harness.host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        scheduleChangeEmission,
        onMarkdownChange: (next) => harness.changes.push(next),
        onSelectionChange: () => harness.selections.push(harness.host.getSelection()),
    });
    mounted.push(harness.host);
    return harness;
}

describe("regression: an external replace must not be undoable", () => {
    it("undoes an ordinary edit", async () => {
        // Pins that undo really steps history, so the external-replace test
        // below cannot pass by undoing nothing at all.
        const harness = await mount("keep this\n");
        harness.host.replaceSourceRange({ anchor: 9, head: 9 }, " and that");
        harness.host.flush();
        expect(harness.host.getMarkdown()).toContain("and that");

        expect(harness.host.undo()).toBe(true);
        harness.host.flush();

        expect(harness.host.getMarkdown()).not.toContain("and that");
    });

    it("redoes an undone edit", async () => {
        const harness = await mount("keep this\n");
        harness.host.replaceSourceRange({ anchor: 9, head: 9 }, " and that");
        harness.host.flush();
        harness.host.undo();
        harness.host.flush();

        expect(harness.host.redo()).toBe(true);
        harness.host.flush();

        expect(harness.host.getMarkdown()).toContain("and that");
    });

    // Milkdown's replaceAll dispatches an ordinary transaction unless asked to
    // rebuild state. With history recording it, one undo after a clean reload
    // restored the pre-reload content and emitted it back to the session, so a
    // reloaded or conflict-resolved document could be silently reverted.
    it("does not restore pre-replace content on undo", async () => {
        const harness = await mount("local edits in progress\n");
        harness.host.replaceMarkdown("content freshly loaded from disk\n");
        harness.changes.length = 0;

        expect(harness.host.undo()).toBe(false);
        harness.host.flush();

        expect(harness.host.getMarkdown()).toContain("freshly loaded from disk");
        expect(harness.host.getMarkdown()).not.toContain("local edits");
        expect(harness.changes).toEqual([]);
    });
});

describe("regression: an external replace must not swallow a pending edit", () => {
    it("emits the pending keystroke before overwriting it", async () => {
        const neverRuns = () => {};
        const harness = await mount("abc\n", neverRuns);
        harness.host.replaceSourceRange({ anchor: 3, head: 3 }, "d");
        expect(harness.changes).toEqual([]);

        harness.host.replaceMarkdown("from disk\n");

        expect(harness.changes).toHaveLength(1);
        expect(harness.changes[0]).toContain("abcd");
        expect(harness.host.getMarkdown()).toBe("from disk\n");
    });
});

describe("regression: selection events report the current caret", () => {
    // The change observer used to run inside Plugin.state.apply, where
    // view.state is still the previous state, so every selection event the
    // session received was one move behind and pinned commands targeted the
    // previous caret.
    it("reports the selection that was just applied, not the previous one", async () => {
        const markdown = "abcdefghijkl\n";
        const harness = await mount(markdown);
        harness.selections.length = 0;

        for (const offset of [2, 8, 11]) {
            harness.host.setSelection({ anchor: offset, head: offset });
        }

        const reported = harness.selections.map((entry) => entry?.anchor);
        expect(reported).toEqual([2, 8, 11]);
        expect(harness.host.getSelection()).toEqual({ anchor: 11, head: 11 });
    });
});

describe("regression: source offsets survive serializer normalization", () => {
    // Blocks used to be anchored by searching for their own serialization in
    // the canonical Markdown. A setext heading serializes as ATX, the search
    // missed, and every later block's offsets shifted — so an edit aimed at one
    // word silently rewrote different characters and still reported success.
    it("edits the text the offsets name when an earlier block is normalized", async () => {
        const markdown = "Setext Title\n============\n\nBody paragraph here.\n";
        const harness = await mount(markdown);
        const bodyStart = markdown.indexOf("Body");

        const applied = harness.host.replaceSourceRange(
            { anchor: bodyStart, head: bodyStart + "Body".length },
            "ZZZZ",
        );
        harness.host.flush();

        expect(applied).toBe(true);
        const result = harness.host.getMarkdown();
        expect(result).toContain("ZZZZ paragraph here.");
        expect(result).not.toContain("Body paragraph");
        expect(result).not.toContain("paragrZZZZ");
    });

    it("keeps a caret inside list item text off the bullet marker", async () => {
        const markdown = "- item one\n- item two\n";
        const harness = await mount(markdown);
        const secondItem = markdown.indexOf("item two");

        harness.host.setSelection({ anchor: secondItem, head: secondItem });

        const reported = harness.host.getSelection();
        expect(reported).not.toBeNull();
        expect(
            harness.host.getMarkdown().slice(reported!.anchor, reported!.anchor + 4),
        ).toBe("item");
    });

    it("appends at the end of the document instead of starting a block", async () => {
        const markdown = "Hello world.\n";
        const harness = await mount(markdown);

        const applied = harness.host.replaceSourceRange(
            { anchor: markdown.length, head: markdown.length },
            "!",
        );
        harness.host.flush();

        expect(applied).toBe(true);
        expect(harness.host.getMarkdown()).toBe("Hello world.!\n");
    });
});

describe("regression: a lagging session confirm must not discard keystrokes", () => {
    // The guard decided confirm-versus-replace by comparing the incoming
    // Markdown against its newest local value. While the user kept typing, a
    // confirm carrying content from one edit earlier failed that comparison and
    // was treated as an external replace, wiping every keystroke since.
    it("confirms an emission the surface has already moved past", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 1,
            markdown: "Hello world.\n",
        });

        guard.recordLocalMarkdown("Hello world.!\n");
        guard.recordLocalMarkdown("Hello world.!?\n");

        const disposition = guard.evaluateSnapshot({
            documentId: "doc-a",
            revision: 2,
            markdown: "Hello world.!\n",
        });

        expect(disposition).toEqual({ kind: "confirm", revision: 2 });
    });

    it("rejects newer content the adapter never produced", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 1,
            markdown: "Hello world.\n",
        });

        const disposition = guard.evaluateSnapshot({
            documentId: "doc-a",
            revision: 2,
            markdown: "content from somewhere else\n",
        });

        expect(disposition).toEqual({
            kind: "reject",
            code: "unconfirmed_content",
        });
    });

    it("advances the revision on confirm without adopting the confirmed text", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 1,
            markdown: "a\n",
        });
        guard.recordLocalMarkdown("ab\n");
        guard.recordLocalMarkdown("abc\n");

        guard.commitConfirmation({
            documentId: "doc-a",
            revision: 2,
            markdown: "ab\n",
        });

        const state = guard.state();
        expect(state.revision).toBe(2);
        expect(state.markdown).toBe("abc\n");
    });
});

describe("regression: commands pinned to superseded content are refused", () => {
    // Only redelivery of the same commandId was blocked. Two different commands
    // pinned to the same revision both passed, and the second wrote at offsets
    // the first had already invalidated, splicing text mid-word.
    //
    // Which layer refuses has since moved. `D-008` requires a pin to survive
    // intervening *mappable* local edits, so the guard no longer refuses on the
    // mere existence of one; the surface that applied the edits decides, by
    // carrying the pin across its own transactions. This pin cannot be carried:
    // the text it named is exactly what the first command replaced.
    it("refuses a second command whose pinned text the first one replaced", async () => {
        const base = "Hello world.\n";
        const pinned = { anchor: 6, head: 11 };
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 1,
            markdown: base,
        });

        const first = guard.evaluateCommand({
            commandId: "a",
            documentId: "doc-a",
            baseRevision: 1,
            selection: pinned,
            kind: "replace-selection",
            text: "EVERYONE",
        });
        expect(first).toEqual({ ok: true });
        guard.consumeCommand("a");

        const harness = await mount(base);
        expect(harness.host.replaceSourceRange(pinned, "EVERYONE")).toBe(true);
        harness.host.flush();
        expect(harness.host.getMarkdown()).toBe("Hello EVERYONE.\n");
        guard.recordLocalMarkdown(harness.host.getMarkdown());

        // The guard admits the command: same document, same revision, an id it
        // has not seen.
        expect(
            guard.evaluateCommand({
                commandId: "b",
                documentId: "doc-a",
                baseRevision: 1,
                selection: pinned,
                kind: "replace-selection",
                text: "NOBODY",
            }),
        ).toEqual({ ok: true });

        // And the surface refuses the pin, so nothing is written mid-word.
        expect(harness.host.mapPinnedRange(base, pinned)).toBeNull();
        expect(harness.host.getMarkdown()).toBe("Hello EVERYONE.\n");
    });

    it("carries a pin across a local edit that left its text alone", async () => {
        const base = "Hello world.\n";
        const harness = await mount(base);
        // An edit before the pin, moving it without touching what it names.
        expect(
            harness.host.replaceSourceRange({ anchor: 0, head: 0 }, "Well, "),
        ).toBe(true);
        harness.host.flush();
        expect(harness.host.getMarkdown()).toBe("Well, Hello world.\n");

        // `world` sat at 6..11 and now sits six characters later.
        expect(harness.host.mapPinnedRange(base, { anchor: 6, head: 11 })).toEqual(
            { anchor: 12, head: 17 },
        );
    });

    // A clean reload, a restore and a conflict resolution all arrive at the
    // surface as `replaceMarkdown`. None of them is an edit anything can be
    // mapped across: the text a pin named is gone, and no transaction ever
    // described its going.
    it("forgets every pin an external replace discarded the text of", async () => {
        const base = "Hello world.\n";
        const harness = await mount(base);
        // Mappable before the replace, so the refusal afterwards is the
        // replace's doing and not a pin that never worked.
        expect(harness.host.mapPinnedRange(base, { anchor: 6, head: 11 })).toEqual(
            { anchor: 6, head: 11 },
        );

        expect(harness.host.replaceMarkdown("Something else entirely.\n")).toBe(
            true,
        );

        expect(
            harness.host.mapPinnedRange(base, { anchor: 6, head: 11 }),
        ).toBeNull();
    });

    it("refuses a pin whose base state the surface never held", async () => {
        const harness = await mount("Hello world.\n");
        expect(
            harness.host.mapPinnedRange("Never seen.\n", { anchor: 0, head: 0 }),
        ).toBeNull();
    });

    it("bounds the consumed-command ledger", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 1,
            markdown: "x\n",
        });
        for (let index = 0; index < 600; index += 1) {
            expect(guard.consumeCommand(`cmd-${index}`)).toBe(true);
        }
        // The newest ids are still remembered, so recent redelivery is blocked.
        expect(guard.consumeCommand("cmd-599")).toBe(false);
    });
});

describe("regression: offset lookup does not scale with block size", () => {
    // Mapping a source offset used to re-align the block's text from the start
    // for every candidate position, which is quadratic: a single 20 KB
    // paragraph blocked the main thread for roughly a second on one lookup.
    it("maps offsets in a large paragraph without a quadratic scan", async () => {
        const paragraph = "lorem ipsum dolor sit amet ".repeat(800);
        const markdown = `${paragraph}\n`;
        const harness = await mount(markdown);

        const started = performance.now();
        for (let index = 0; index < 20; index += 1) {
            const offset = Math.floor((markdown.length / 20) * index);
            harness.host.setSelection({ anchor: offset, head: offset });
            harness.host.getSelection();
        }
        const elapsed = performance.now() - started;

        // Twenty lookups over a 21 KB paragraph. The quadratic implementation
        // needed about a second for one; the threshold is loose enough to
        // absorb CI jitter while still failing if the scan returns.
        expect(elapsed).toBeLessThan(1000);
    });
});

describe("regression: a snapshot older than the surface never replaces it", () => {
    it("rejects a stale revision even when it declares a replace reason", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot({
            documentId: "doc-a",
            revision: 7,
            markdown: "current\n",
        });

        const disposition = guard.evaluateSnapshot({
            documentId: "doc-a",
            revision: 3,
            markdown: "ancient\n",
            replaceReason: "clean-reload",
        });

        expect(disposition).toEqual({ kind: "reject", code: "stale_revision" });
    });
});
