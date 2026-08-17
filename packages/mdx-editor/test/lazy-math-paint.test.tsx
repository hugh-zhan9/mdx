// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type { EditorDocumentSnapshot } from "../adapter/types";

/**
 * Formulae are typeset when they come into view, not when the file opens.
 *
 * KaTeX is by far the most expensive thing that happens while a document is
 * being mounted — on this repo's own fixtures it accounts for around five
 * sixths of the time to open a maths-heavy file, and almost all of that is
 * spent on formulae below the fold. These tests hold the deferral, and the two
 * things that make it safe: an unpainted formula still shows the author's
 * LaTeX, and an environment that cannot report visibility still paints.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<{ root: Root; container: HTMLElement }> = [];

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

/** Every observer built while a test runs, so it can decide what is seen. */
const observers: Array<{
    callback: ObserverCallback;
    elements: Element[];
}> = [];

function installObserver(): void {
    (
        globalThis as unknown as { IntersectionObserver: unknown }
    ).IntersectionObserver = class {
        private readonly entry: { callback: ObserverCallback; elements: Element[] };
        constructor(callback: ObserverCallback) {
            this.entry = { callback, elements: [] };
            observers.push(this.entry);
        }
        observe(element: Element) {
            this.entry.elements.push(element);
        }
        unobserve() {}
        disconnect() {
            this.entry.elements = [];
        }
        takeRecords() {
            return [];
        }
    };
}

function removeObserver(): void {
    delete (globalThis as unknown as { IntersectionObserver?: unknown })
        .IntersectionObserver;
}

/** Reports every observed element as having scrolled into view. */
function revealAll(): void {
    for (const observer of [...observers]) {
        const entries = observer.elements.map(
            (element) =>
                ({ isIntersecting: true, target: element }) as
                    unknown as IntersectionObserverEntry,
        );
        if (entries.length > 0) observer.callback(entries);
    }
}

afterEach(async () => {
    while (roots.length > 0) {
        const entry = roots.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
    observers.length = 0;
    removeObserver();
});

const MARKDOWN = "行内 $E=mc^2$ 公式。\n";

function snapshot(markdown: string): EditorDocumentSnapshot {
    return { documentId: "doc", revision: 1, markdown };
}

async function mount(markdown: string): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    await act(async () => {
        root.render(
            <MarkdownEditorAdapter
                snapshot={snapshot(markdown)}
                mode="wysiwyg"
                editable
                onChange={() => {}}
                onSelectionChange={() => {}}
                onModeChange={() => {}}
                onDiagnostic={() => {}}
                onOpenWikilink={() => {}}
                onReady={() => {}}
            />,
        );
    });
    return container;
}

function preview(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(".mdx-math-preview");
    if (!found) throw new Error("no math preview rendered");
    return found;
}

describe("math painting", () => {
    it("shows the author's LaTeX before it has been typeset", async () => {
        installObserver();
        const container = await mount(MARKDOWN);

        // Not yet seen, so KaTeX has not run — but the formula is not blank:
        // blank would collapse the line and tell the reader nothing.
        expect(preview(container).querySelector(".katex")).toBeNull();
        expect(preview(container).textContent).toBe("E=mc^2");
    });

    it("typesets a formula once it comes into view", async () => {
        installObserver();
        const container = await mount(MARKDOWN);

        await act(async () => {
            revealAll();
        });

        expect(preview(container).querySelector(".katex")).not.toBeNull();
    });

    it("typesets immediately where visibility cannot be observed", async () => {
        // No IntersectionObserver at all. Deferring here would mean waiting for
        // a signal that never comes, so a formula that never renders — which is
        // worse than one that renders slowly.
        removeObserver();
        const container = await mount(MARKDOWN);

        expect(preview(container).querySelector(".katex")).not.toBeNull();
    });
});
