// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorSurface } from "./markdown-editor-surface";
import { createEditorSessionBinding } from "../lib/editor-session-binding";
import type { EditorSessionBinding } from "../lib/editor-session-binding";
import { DEFAULT_SURFACE_CACHE_LIMIT } from "../../../packages/mdx-editor";

/**
 * Returning to a tab without rebuilding it.
 *
 * Building a surface parses the document, builds the schema, mounts every node
 * view and runs KaTeX and Mermaid over the result — most of a second on a
 * 100 KiB file. Doing that on every tab switch is what made switching unusable,
 * and it also threw away the undo history and caret each time, because both
 * live in the view being discarded.
 *
 * So these tests are about identity, not speed: a timing assertion would be
 * flaky, but "the same view came back" is exact, and it is the thing that makes
 * the switch cheap and the history survive.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (mounted.length > 0) {
        const entry = mounted.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
});

interface Harness {
    container: HTMLElement;
    /** Renders the surface for one document, as a tab switch does. */
    show(documentId: string, markdown: string): Promise<void>;
    /** The mounted editing view, as an object identity. */
    view(): Element;
    unmount(): Promise<void>;
}

function mountHarness(): Harness {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const entry = { root, container };
    mounted.push(entry);

    let binding: EditorSessionBinding | null = null;
    binding ??= createEditorSessionBinding();

    return {
        container,
        async show(documentId, markdown) {
            await act(async () => {
                root.render(
                    <MarkdownEditorSurface
                        session={binding}
                        documentId={documentId}
                        markdown={markdown}
                        onMarkdownChange={() => {}}
                    />,
                );
            });
        },
        view() {
            const view = container.querySelector(".ProseMirror");
            if (!view) throw new Error("no editing view mounted");
            return view;
        },
        async unmount() {
            const index = mounted.indexOf(entry);
            if (index >= 0) mounted.splice(index, 1);
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
    };
}

describe("editor surface tab cache", () => {
    it("brings back the same view when returning to a document", async () => {
        const harness = mountHarness();
        await harness.show("a", "# A\n");
        const firstView = harness.view();

        await harness.show("b", "# B\n");
        expect(harness.view()).not.toBe(firstView);

        await harness.show("a", "# A\n");

        // Identity, not equality: this is the built view itself, with the undo
        // history and caret that only exist inside it.
        expect(harness.view()).toBe(firstView);
    });

    it("keeps only one view attached at a time", async () => {
        const harness = mountHarness();
        await harness.show("a", "# A\n");
        await harness.show("b", "# B\n");

        // The cached view is kept alive but out of the document; two mounted
        // contenteditables would both answer the keyboard.
        expect(harness.container.querySelectorAll(".ProseMirror")).toHaveLength(
            1,
        );
        expect(harness.container.textContent).toContain("B");
        expect(harness.container.textContent).not.toContain("A");
    });

    it("shows what the session holds, not what the cached view held", async () => {
        const harness = mountHarness();
        await harness.show("a", "# A\n");
        const firstView = harness.view();

        await harness.show("b", "# B\n");
        // The same document comes back with different content — a clean
        // external reload, which the session decided and the view must adopt.
        await harness.show("a", "# A changed\n");

        expect(harness.view()).toBe(firstView);
        expect(harness.container.textContent).toContain("changed");
    });

    it("rebuilds a document evicted past the cache limit", async () => {
        const harness = mountHarness();
        await harness.show("doc-0", "# 0\n");
        const evicted = harness.view();

        // Fill the cache past its limit, so the first document is the least
        // recently used one and goes.
        for (let index = 1; index <= DEFAULT_SURFACE_CACHE_LIMIT; index += 1) {
            await harness.show(`doc-${String(index)}`, `# ${String(index)}\n`);
        }

        await harness.show("doc-0", "# 0\n");

        // A rebuild is correct here, and it is the bound working: without one
        // every document ever opened would stay in memory.
        expect(harness.view()).not.toBe(evicted);
        expect(harness.container.textContent).toContain("0");
    });

    it("keeps a document that stays in use, however many tabs are visited", async () => {
        const harness = mountHarness();
        await harness.show("hot", "# hot\n");
        const hotView = harness.view();

        // Revisiting `hot` between the others keeps it the most recently used
        // entry, so it is never the one evicted.
        for (let index = 1; index <= DEFAULT_SURFACE_CACHE_LIMIT * 2; index += 1) {
            await harness.show(`cold-${String(index)}`, `# ${String(index)}\n`);
            await harness.show("hot", "# hot\n");
        }

        expect(harness.view()).toBe(hotView);
    });

    it("leaves nothing mounted after the surface unmounts", async () => {
        const harness = mountHarness();
        await harness.show("a", "# A\n");
        await harness.show("b", "# B\n");

        await harness.unmount();

        expect(document.querySelectorAll(".ProseMirror")).toHaveLength(0);
    });
});
