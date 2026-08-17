// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorSurface } from "./markdown-editor-surface";
import { createEditorSessionBinding } from "../lib/editor-session-binding";
import type { EditorSurfaceMode } from "../../../packages/mdx-editor";

/**
 * Every match is visible, not just counted.
 *
 * Find already knew where the matches were — it counted them for the "3 / 17"
 * label and moved the caret to one — but nothing painted them, so the other
 * sixteen were invisible and the current one was as visible as a selection in
 * an unfocused editor. The existing tests asserted the count and the jump and
 * never asked whether the user could see anything, which is exactly how the
 * gap survived a green suite.
 *
 * So these assert what is on screen. They also pin that the highlights are
 * decoration: the Markdown the session holds must be unchanged by painting.
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

const DOCUMENT = "alpha beta alpha gamma alpha\n";

interface Harness {
    container: HTMLElement;
    markdown(): string;
    editor(): HTMLElement;
    /** Highlighted spans, in document order, as their text. */
    highlights(): string[];
    /** The text of the current match, or null when none is marked. */
    activeHighlight(): string | null;
    findInput(): HTMLInputElement;
}

function SessionHost({
    initialMode,
    markdownRef,
}: {
    initialMode: EditorSurfaceMode;
    markdownRef: { current: string };
}) {
    const [binding] = useState(createEditorSessionBinding);
    const [markdown, setMarkdown] = useState(DOCUMENT);

    useEffect(() => {
        markdownRef.current = markdown;
    }, [markdown, markdownRef]);

    return (
        <MarkdownEditorSurface
            session={binding}
            documentId="doc"
            markdown={markdown}
            initialMode={initialMode}
            onMarkdownChange={(_, next) => setMarkdown(next)}
        />
    );
}

async function mountSurface(
    initialMode: EditorSurfaceMode = "wysiwyg",
): Promise<Harness> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const markdownRef = { current: DOCUMENT };

    await act(async () => {
        root.render(
            <SessionHost initialMode={initialMode} markdownRef={markdownRef} />,
        );
    });

    return {
        container,
        markdown: () => markdownRef.current,
        editor() {
            const surface = container.querySelector<HTMLElement>(
                ".cm-content, .ProseMirror",
            );
            if (!surface) throw new Error("editing surface did not mount");
            return surface;
        },
        highlights() {
            return [
                ...container.querySelectorAll<HTMLElement>(".mdx-find-match"),
            ].map((node) => node.textContent ?? "");
        },
        activeHighlight() {
            const active = container.querySelector<HTMLElement>(
                ".mdx-find-match-active",
            );
            return active ? (active.textContent ?? "") : null;
        },
        findInput() {
            const input = container.querySelector<HTMLInputElement>(
                "input[aria-label]",
            );
            if (!input) throw new Error("find bar did not open");
            return input;
        },
    };
}

/** Opens the find bar the way the user does. */
async function openFind(harness: Harness): Promise<void> {
    await act(async () => {
        harness.editor().dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "f",
                code: "KeyF",
                metaKey: true,
            }),
        );
    });
}

/** Types a query, past React's record of the input's value. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
    )?.set;
    if (!setter) throw new Error("no value setter on HTMLInputElement");
    await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function search(harness: Harness, query: string): Promise<void> {
    await openFind(harness);
    await type(harness.findInput(), query);
}

describe.each(["wysiwyg", "source"] as const)(
    "find highlighting on the %s surface",
    (mode) => {
        it("paints every match, not only the current one", async () => {
            const harness = await mountSurface(mode);

            await search(harness, "alpha");

            // Three matches in the document; all three are on screen.
            expect(harness.highlights()).toEqual(["alpha", "alpha", "alpha"]);
        });

        it("marks exactly one match as current", async () => {
            const harness = await mountSurface(mode);

            await search(harness, "alpha");

            expect(
                harness.container.querySelectorAll(".mdx-find-match-active"),
            ).toHaveLength(1);
            expect(harness.activeHighlight()).toBe("alpha");
        });

        it("paints nothing for a query with no matches", async () => {
            const harness = await mountSurface(mode);

            await search(harness, "nothing-here");

            expect(harness.highlights()).toEqual([]);
        });

        it("clears the highlights when the bar closes", async () => {
            const harness = await mountSurface(mode);
            await search(harness, "alpha");
            expect(harness.highlights().length).toBeGreaterThan(0);

            await act(async () => {
                harness.findInput().dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        key: "Escape",
                        code: "Escape",
                    }),
                );
            });

            expect(harness.highlights()).toEqual([]);
        });

        it("does not change the document by painting it", async () => {
            const harness = await mountSurface(mode);

            await search(harness, "alpha");

            // The highlights are decorations. If they were marks or text, this
            // is where it would show — and it would then reach the file.
            expect(harness.markdown()).toBe(DOCUMENT);
        });
    },
);
