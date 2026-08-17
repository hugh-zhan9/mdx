// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type {
    EditorAdapterDiagnostic,
    EditorChangeEvent,
    EditorDocumentSnapshot,
    EditorWikilinkActivation,
    MarkdownEditorAdapterHandle,
    MarkdownEditorAdapterProps,
} from "../adapter/types";

const roots: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (roots.length > 0) {
        const entry = roots.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
});

interface Harness {
    handle: RefObject<MarkdownEditorAdapterHandle | null>;
    changes: EditorChangeEvent[];
    diagnostics: EditorAdapterDiagnostic[];
    readyCount: number;
    container: HTMLElement;
    render(next: Partial<MarkdownEditorAdapterProps>): Promise<void>;
}

async function mountAdapter(
    snapshot: EditorDocumentSnapshot,
    overrides: Partial<MarkdownEditorAdapterProps> = {},
): Promise<Harness> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });

    const handle = createRef<MarkdownEditorAdapterHandle>();
    const harness: Harness = {
        handle,
        changes: [],
        diagnostics: [],
        readyCount: 0,
        container,
        render: async () => {},
    };

    let currentProps: MarkdownEditorAdapterProps = {
        snapshot,
        mode: "wysiwyg",
        editable: true,
        onChange: (event) => harness.changes.push(event),
        onSelectionChange: () => {},
        onModeChange: () => {},
        onDiagnostic: (diagnostic) => harness.diagnostics.push(diagnostic),
        onOpenWikilink: () => {},
        onReady: () => {
            harness.readyCount += 1;
        },
        ...overrides,
    };

    harness.render = async (next) => {
        currentProps = { ...currentProps, ...next };
        await act(async () => {
            root.render(
                <MarkdownEditorAdapter ref={handle} {...currentProps} />,
            );
        });
    };

    await harness.render({});
    return harness;
}

function snapshotOf(
    overrides: Partial<EditorDocumentSnapshot> = {},
): EditorDocumentSnapshot {
    return {
        documentId: "doc-a",
        revision: 1,
        markdown: "Hello world.\n",
        ...overrides,
    };
}

describe("markdown editor adapter — mounting", () => {
    it("mounts an editing surface and signals ready once", async () => {
        const harness = await mountAdapter(snapshotOf());
        expect(harness.container.querySelector(".ProseMirror")).not.toBeNull();
        expect(harness.readyCount).toBe(1);
        expect(harness.diagnostics).toEqual([]);
    });

    it("exposes a handle whose selection is in source offsets", async () => {
        const harness = await mountAdapter(snapshotOf());
        act(() => {
            harness.handle.current?.setSelection({ anchor: 6, head: 11 });
        });
        expect(harness.handle.current?.getSelection()).toEqual({
            anchor: 6,
            head: 11,
        });
    });

    it("renders a read-only surface when editable is false", async () => {
        const harness = await mountAdapter(snapshotOf(), { editable: false });
        const surface = harness.container.querySelector(".ProseMirror");
        expect(surface?.getAttribute("contenteditable")).toBe("false");
    });

    it("toggles editability without losing content", async () => {
        const harness = await mountAdapter(snapshotOf(), { editable: false });
        await harness.render({ editable: true });
        const surface = harness.container.querySelector(".ProseMirror");
        expect(surface?.getAttribute("contenteditable")).toBe("true");
        expect(harness.container.textContent).toContain("Hello world.");
    });
});

describe("markdown editor adapter — snapshot discipline", () => {
    it("applies a clean reload as an explicit replace", async () => {
        const harness = await mountAdapter(snapshotOf());
        await harness.render({
            snapshot: snapshotOf({
                revision: 2,
                markdown: "From disk.\n",
                replaceReason: "clean-reload",
            }),
        });
        expect(harness.container.textContent).toContain("From disk.");
        expect(harness.changes).toEqual([]);
    });

    it("rejects a snapshot whose revision moved backwards", async () => {
        const harness = await mountAdapter(snapshotOf({ revision: 5 }));
        await harness.render({
            snapshot: snapshotOf({ revision: 2, markdown: "stale\n" }),
        });
        expect(harness.diagnostics.map((entry) => entry.code)).toContain(
            "stale_editor_change",
        );
        expect(harness.container.textContent).toContain("Hello world.");
    });

    it("ignores a repeated identical snapshot without rebuilding", async () => {
        const harness = await mountAdapter(snapshotOf());
        await harness.render({ snapshot: snapshotOf() });
        expect(harness.readyCount).toBe(1);
        expect(harness.diagnostics).toEqual([]);
    });

    it("carries documentId and baseRevision on every change", async () => {
        const harness = await mountAdapter(snapshotOf());
        act(() => {
            harness.handle.current?.execute({
                commandId: "c1",
                documentId: "doc-a",
                baseRevision: 1,
                selection: { anchor: 12, head: 12 },
                kind: "replace-selection",
                text: "!",
            });
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(harness.changes.length).toBeGreaterThan(0);
        for (const change of harness.changes) {
            expect(change.documentId).toBe("doc-a");
            expect(change.baseRevision).toBe(1);
        }
    });

    it("rebuilds the surface when the document identity changes", async () => {
        const harness = await mountAdapter(snapshotOf());
        await harness.render({
            snapshot: snapshotOf({
                documentId: "doc-b",
                revision: 1,
                markdown: "Second document.\n",
            }),
        });
        expect(harness.container.textContent).toContain("Second document.");
        expect(harness.readyCount).toBe(2);
    });

    it("does not report changes belonging to a closed document", async () => {
        const harness = await mountAdapter(snapshotOf());
        await harness.render({
            snapshot: snapshotOf({ documentId: "doc-b", markdown: "B\n" }),
        });
        const foreign = harness.changes.filter(
            (change) => change.documentId === "doc-a",
        );
        expect(foreign).toEqual([]);
    });
});

describe("markdown editor adapter — pinned commands", () => {
    it("rejects a command aimed at another document", async () => {
        const harness = await mountAdapter(snapshotOf());
        const result = await harness.handle.current!.execute({
            commandId: "c1",
            documentId: "doc-other",
            baseRevision: 1,
            selection: { anchor: 0, head: 0 },
            kind: "focus",
        });
        expect(result).toEqual({ ok: false, code: "stale_document" });
    });

    it("rejects a command pinned to a superseded revision", async () => {
        const harness = await mountAdapter(snapshotOf({ revision: 3 }));
        const result = await harness.handle.current!.execute({
            commandId: "c1",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 0, head: 0 },
            kind: "focus",
        });
        expect(result).toEqual({ ok: false, code: "stale_revision" });
    });

    it("rejects an out-of-document range instead of clamping it", async () => {
        const harness = await mountAdapter(snapshotOf());
        const result = await harness.handle.current!.execute({
            commandId: "c1",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 9999, head: 9999 },
            kind: "replace-selection",
            text: "x",
        });
        expect(result).toEqual({ ok: false, code: "invalid_range" });
    });

    it("applies a command id at most once", async () => {
        const harness = await mountAdapter(snapshotOf());
        const command = {
            commandId: "only-once",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 12, head: 12 },
            kind: "replace-selection" as const,
            text: "!",
        };
        const first = await harness.handle.current!.execute(command);
        const second = await harness.handle.current!.execute(command);
        expect(first).toEqual({ ok: true });
        expect(second.ok).toBe(false);
    });

    it("inserts an image at the pinned selection", async () => {
        const harness = await mountAdapter(snapshotOf());
        const result = await harness.handle.current!.execute({
            commandId: "img",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 12, head: 12 },
            kind: "insert-image",
            image: { src: "assets/a.png", alt: "A" },
        });
        expect(result).toEqual({ ok: true });
        await act(async () => {
            await Promise.resolve();
        });
        expect(harness.changes.at(-1)?.markdown).toContain("assets/a.png");
    });
});

describe("markdown editor adapter — insert-image inserts an image", () => {
    async function insertImage(
        harness: Harness,
        image: { src: string; alt?: string; title?: string },
    ): Promise<void> {
        const result = await harness.handle.current!.execute({
            commandId: `img-${image.src}`,
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 12, head: 12 },
            kind: "insert-image",
            image,
        });
        expect(result).toEqual({ ok: true });
        await act(async () => {
            await Promise.resolve();
        });
    }

    // The adapter used to hand `![alt](src)` to the surface as text. On the
    // source surface that is the right answer, because there the text is the
    // source; on the visual surface the serializer escaped the brackets and the
    // document ended up holding a literal `!\[A](assets/a.png)` that no reader
    // ever renders as a picture.
    it("writes unescaped image Markdown on the visual surface", async () => {
        const harness = await mountAdapter(snapshotOf());
        await insertImage(harness, { src: "assets/a.png", alt: "A" });

        expect(harness.changes.at(-1)?.markdown).toBe(
            "Hello world.![A](assets/a.png)\n",
        );
        expect(harness.changes.at(-1)?.markdown).not.toContain("\\[");
    });

    it("renders the inserted image as an image", async () => {
        const harness = await mountAdapter(snapshotOf());
        expect(harness.container.querySelector("img")).toBeNull();

        await insertImage(harness, { src: "assets/a.png", alt: "A" });

        const image = harness.container.querySelector("img");
        expect(image?.getAttribute("src")).toBe("assets/a.png");
        expect(image?.getAttribute("alt")).toBe("A");
    });

    it("carries a title through to the Markdown", async () => {
        const harness = await mountAdapter(snapshotOf());
        await insertImage(harness, {
            src: "assets/a.png",
            alt: "A",
            title: "Alt title",
        });
        expect(harness.changes.at(-1)?.markdown).toBe(
            'Hello world.![A](assets/a.png "Alt title")\n',
        );
    });

    it("writes the same Markdown on the source surface", async () => {
        const visual = await mountAdapter(snapshotOf());
        await insertImage(visual, { src: "assets/a.png", alt: "A" });

        const source = await mountAdapter(snapshotOf(), { mode: "source" });
        expect(source.container.querySelector(".cm-editor")).not.toBeNull();
        expect(source.container.querySelector(".ProseMirror")).toBeNull();
        await insertImage(source, { src: "assets/a.png", alt: "A" });

        expect(source.changes.at(-1)?.markdown).toBe(
            visual.changes.at(-1)?.markdown,
        );
    });

    it("refuses a block that cannot hold an image rather than writing text", async () => {
        // A fenced block's content is plain text. An image node cannot live
        // there, and writing one as characters is exactly the escaped literal
        // this command stopped producing.
        const markdown = "```\ncode here\n```\n";
        const harness = await mountAdapter(snapshotOf({ markdown }));
        const result = await harness.handle.current!.execute({
            commandId: "img-in-code",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: 8, head: 8 },
            kind: "insert-image",
            image: { src: "assets/a.png", alt: "A" },
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(result).toEqual({ ok: false, code: "invalid_range" });
        expect(harness.changes).toEqual([]);
    });
});

describe("markdown editor adapter — wikilink activation reaches the product", () => {
    function wikilinks(container: HTMLElement): HTMLElement[] {
        return [...container.querySelectorAll<HTMLElement>("a[data-mdx-wikilink]")];
    }

    it("reports the parsed target and alias when a rendered wikilink is clicked", async () => {
        const opened: EditorWikilinkActivation[] = [];
        const harness = await mountAdapter(
            snapshotOf({ markdown: "See [[Target Page|the page]] now.\n" }),
            { onOpenWikilink: (activation) => opened.push(activation) },
        );

        const [link] = wikilinks(harness.container);
        expect(link).toBeDefined();
        // The label the user clicks is the alias, so a handler that reported
        // what it read off the element would say "the page" instead.
        expect(link.textContent).toBe("the page");

        act(() => {
            link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        // Both halves the syntax layer parsed cross the boundary: the target
        // names what to open, the alias names it the way the document does.
        expect(opened).toEqual([{ target: "Target Page", alias: "the page" }]);
    });

    it("reports a null alias for a link written without one", async () => {
        const opened: EditorWikilinkActivation[] = [];
        const harness = await mountAdapter(
            snapshotOf({ markdown: "See [[Target Page]] now.\n" }),
            { onOpenWikilink: (activation) => opened.push(activation) },
        );

        act(() => {
            wikilinks(harness.container)[0].dispatchEvent(
                new MouseEvent("click", { bubbles: true }),
            );
        });

        expect(opened).toEqual([{ target: "Target Page", alias: null }]);
    });

    it("reports each link in the document independently", async () => {
        const opened: EditorWikilinkActivation[] = [];
        const harness = await mountAdapter(
            snapshotOf({ markdown: "[[One]] then [[Two|2]].\n" }),
            { onOpenWikilink: (activation) => opened.push(activation) },
        );

        act(() => {
            for (const link of wikilinks(harness.container)) {
                link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
        });

        expect(opened).toEqual([
            { target: "One", alias: null },
            { target: "Two", alias: "2" },
        ]);
    });

    it("ignores a click that is not the primary button", async () => {
        const opened: EditorWikilinkActivation[] = [];
        const harness = await mountAdapter(
            snapshotOf({ markdown: "See [[Target Page]] now.\n" }),
            { onOpenWikilink: (activation) => opened.push(activation) },
        );

        act(() => {
            wikilinks(harness.container)[0].dispatchEvent(
                new MouseEvent("click", { bubbles: true, button: 2 }),
            );
        });

        expect(opened).toEqual([]);
    });

    it("calls the callback the latest render supplied", async () => {
        const first: EditorWikilinkActivation[] = [];
        const second: EditorWikilinkActivation[] = [];
        const harness = await mountAdapter(
            snapshotOf({ markdown: "See [[Target Page]] now.\n" }),
            { onOpenWikilink: (activation) => first.push(activation) },
        );
        await harness.render({
            onOpenWikilink: (activation) => second.push(activation),
        });

        act(() => {
            wikilinks(harness.container)[0].dispatchEvent(
                new MouseEvent("click", { bubbles: true }),
            );
        });

        // The surface was not rebuilt by that render, so a handler captured at
        // build time would still be the first one.
        expect(harness.readyCount).toBe(1);
        expect(first).toEqual([]);
        expect(second).toEqual([{ target: "Target Page", alias: null }]);
    });
});

describe("markdown editor adapter — a carried selection belongs to its document", () => {
    const FIRST = "# Alpha\n\nSecond paragraph here.\n";
    const SECOND = "Different document body text here.\n";

    it("drops the selection when the document changes", async () => {
        const harness = await mountAdapter(snapshotOf({ markdown: FIRST }));
        act(() => {
            harness.handle.current?.setSelection({ anchor: 20, head: 20 });
        });
        expect(harness.handle.current?.getSelection()).toEqual({
            anchor: 20,
            head: 20,
        });

        await harness.render({
            snapshot: snapshotOf({
                documentId: "doc-b",
                revision: 1,
                markdown: SECOND,
            }),
        });

        expect(harness.container.textContent).toContain("Different document");
        // 20 is a perfectly good offset in the new document — it lands inside
        // `body` — which is why carrying it is silent damage rather than an
        // error the surface would refuse.
        expect(SECOND.length).toBeGreaterThan(20);
        expect(harness.handle.current?.getSelection()).toEqual({
            anchor: 0,
            head: 0,
        });
    });

    it("keeps the selection across a mode switch on the same document", async () => {
        const harness = await mountAdapter(snapshotOf({ markdown: FIRST }));
        act(() => {
            harness.handle.current?.setSelection({ anchor: 20, head: 26 });
        });

        await harness.render({ mode: "source" });

        expect(harness.container.querySelector(".cm-editor")).not.toBeNull();
        expect(harness.handle.current?.getSelection()).toEqual({
            anchor: 20,
            head: 26,
        });
    });
});

describe("markdown editor adapter — the product entry uses the MDX syntax layer", () => {
    // The adapter previously mounted the CommonMark/GFM baseline, which turns
    // `---\ntitle: x\n---` into a thematic break plus a heading and escapes
    // wikilinks and callout markers. One keystroke rewrote the document.
    async function typeAndRead(markdown: string): Promise<string> {
        const harness = await mountAdapter(snapshotOf({ markdown }));
        await harness.handle.current!.execute({
            commandId: "edit",
            documentId: "doc-a",
            baseRevision: 1,
            selection: { anchor: markdown.length, head: markdown.length },
            kind: "replace-selection",
            text: "!",
        });
        await act(async () => {
            await Promise.resolve();
        });
        return harness.changes.at(-1)?.markdown ?? "";
    }

    it("keeps frontmatter intact through an edit", async () => {
        const result = await typeAndRead("---\ntitle: x\n---\n\nBody.\n");
        expect(result).toContain("---\ntitle: x\n---");
        expect(result).not.toContain("## title");
    });

    it("keeps a wikilink unescaped through an edit", async () => {
        const result = await typeAndRead("See [[Target]] here.\n");
        expect(result).toContain("[[Target]]");
        expect(result).not.toContain("\\[\\[Target]]");
    });

    it("keeps a callout marker unescaped through an edit", async () => {
        const result = await typeAndRead("> [!WARNING]\n> careful\n");
        expect(result).toContain("[!WARNING]");
        expect(result).not.toContain("\\[!WARNING]");
    });
});

describe("markdown editor adapter — teardown", () => {
    it("tears down cleanly and leaves no surface behind", async () => {
        await mountAdapter(snapshotOf());
        const entry = roots.pop()!;
        await act(async () => {
            entry.root.unmount();
        });
        expect(entry.container.querySelector(".ProseMirror")).toBeNull();
        entry.container.remove();
    });

    it("survives repeated mount and unmount cycles", async () => {
        for (let round = 0; round < 3; round += 1) {
            const harness = await mountAdapter(
                snapshotOf({ documentId: `doc-${round}` }),
            );
            expect(harness.readyCount).toBe(1);
            const entry = roots.pop()!;
            await act(async () => {
                entry.root.unmount();
            });
            entry.container.remove();
        }
        expect(document.querySelectorAll(".ProseMirror")).toHaveLength(0);
    });
});
