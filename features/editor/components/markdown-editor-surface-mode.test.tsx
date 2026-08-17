// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorSurface } from "./markdown-editor-surface";
import { createEditorSessionBinding } from "../lib/editor-session-binding";
import type { EditorSurfaceMode } from "../../../packages/mdx-editor";

/**
 * Reaching source mode as a user.
 *
 * The adapter has always been able to change surface, but a capability the
 * product exposes nowhere is one the user does not have: `AC-012` asks that a
 * person can move between the WYSIWYG surface and the global CodeMirror source
 * mode, and there is no toolbar and no menu item to do it with. These tests
 * hold the keystroke that closes that gap, and hold the round trip it has to
 * survive — the two surfaces are views of one session, so crossing between
 * them may not cost an edit.
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
    /** The Markdown the session holds right now. */
    markdown(): string;
    /** Which surface is mounted, by the element only that surface renders. */
    surface(): "wysiwyg" | "source" | "none";
    /** The mounted editing element, whichever surface owns it. */
    editor(): HTMLElement;
}

function SessionHost({
    initialMarkdown,
    initialMode,
    markdownRef,
}: {
    initialMarkdown: string;
    initialMode: EditorSurfaceMode;
    markdownRef: { current: string };
}) {
    const [binding] = useState(createEditorSessionBinding);
    const [markdown, setMarkdown] = useState(initialMarkdown);

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
    initialMarkdown: string,
    initialMode: EditorSurfaceMode = "wysiwyg",
): Promise<Harness> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    const markdownRef = { current: initialMarkdown };

    await act(async () => {
        root.render(
            <SessionHost
                initialMarkdown={initialMarkdown}
                initialMode={initialMode}
                markdownRef={markdownRef}
            />,
        );
    });

    return {
        container,
        markdown: () => markdownRef.current,
        surface() {
            if (container.querySelector(".cm-content")) return "source";
            if (container.querySelector(".ProseMirror")) return "wysiwyg";
            return "none";
        },
        editor() {
            const surface = container.querySelector<HTMLElement>(
                ".cm-content, .ProseMirror",
            );
            if (!surface) throw new Error("editing surface did not mount");
            return surface;
        },
    };
}

/**
 * The mode keystroke, delivered at the focused editing element so that it
 * reaches the surface by bubbling exactly as a user's would.
 */
async function pressModeShortcut(harness: Harness): Promise<void> {
    await act(async () => {
        harness.editor().dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "M",
                code: "KeyM",
                metaKey: true,
                shiftKey: true,
            }),
        );
    });
}

describe("markdown editor surface mode shortcut", () => {
    it("moves a user from the visual surface to source mode", async () => {
        const harness = await mountSurface("# Title\n\nBody text.\n");
        expect(harness.surface()).toBe("wysiwyg");

        await pressModeShortcut(harness);

        expect(harness.surface()).toBe("source");
    });

    it("moves back to the visual surface on a second press", async () => {
        const harness = await mountSurface("# Title\n\nBody text.\n");

        await pressModeShortcut(harness);
        expect(harness.surface()).toBe("source");

        await pressModeShortcut(harness);
        expect(harness.surface()).toBe("wysiwyg");
    });

    it("keeps the document's Markdown across the round trip", async () => {
        // Syntax the visual surface preserves rather than structures, so the
        // round trip is asserted on content that has to survive both a
        // serializer and a re-parse.
        const markdown = "# Title\n\n> [!NOTE]\n> Care.\n\n[[Target|alias]]\n";
        const harness = await mountSurface(markdown);

        await pressModeShortcut(harness);
        // Asserted here so the round trip cannot pass by never leaving.
        expect(harness.surface()).toBe("source");

        await pressModeShortcut(harness);

        expect(harness.surface()).toBe("wysiwyg");
        expect(harness.markdown()).toBe(markdown);
    });

    it("leaves ⌘/ to the source surface, which binds it to comment toggling", async () => {
        const harness = await mountSurface("# Title\n\nBody text.\n");
        await pressModeShortcut(harness);
        expect(harness.surface()).toBe("source");

        await act(async () => {
            harness.editor().dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "/",
                    code: "Slash",
                    metaKey: true,
                }),
            );
        });

        // The switch must not answer to a key CodeMirror already uses, or
        // toggling a comment would eject the user from the surface instead.
        expect(harness.surface()).toBe("source");
    });

    it("says so when the switch back is refused, instead of doing nothing", async () => {
        // Deep blockquote nesting exhausts the parser's stack; it is the one
        // input that genuinely defeats the visual build rather than falling
        // back. Shared with packages/mdx-editor/test/unbuildable-document.
        const unbuildable = `${"> ".repeat(3000)}deep\n`;
        const harness = await mountSurface(unbuildable, "source");
        expect(harness.surface()).toBe("source");

        await pressModeShortcut(harness);

        // The user keeps the surface holding their content...
        expect(harness.surface()).toBe("source");
        // ...and is told why the key appeared to do nothing.
        const notice = harness.container.querySelector(
            "[data-mdx-editor-mode-refusal]",
        );
        expect(notice).not.toBeNull();
        // The product speaks Chinese; the builder's own error is appended to
        // locate the problem rather than shown alone as the whole message.
        expect(notice?.textContent ?? "").toContain("无法切换到可视模式");
        expect((notice?.textContent ?? "").length).toBeGreaterThan(
            "无法切换到可视模式：".length,
        );
    });

    it("drops a refusal when the document underneath is swapped", async () => {
        const unbuildable = `${"> ".repeat(3000)}deep\n`;
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        mounted.push({ root, container });

        const binding = createEditorSessionBinding();
        const render = async (documentId: string, markdown: string) => {
            await act(async () => {
                root.render(
                    <MarkdownEditorSurface
                        session={binding}
                        documentId={documentId}
                        markdown={markdown}
                        initialMode="source"
                        onMarkdownChange={() => {}}
                    />,
                );
            });
        };

        await render("doc-a", unbuildable);
        await act(async () => {
            container.querySelector(".cm-content")!.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "M",
                    code: "KeyM",
                    metaKey: true,
                    shiftKey: true,
                }),
            );
        });
        expect(
            container.querySelector("[data-mdx-editor-mode-refusal]"),
        ).not.toBeNull();

        // A tab switch changes props rather than remounting, so the notice has
        // to go with the document it was about.
        await render("doc-b", "# Fine\n");

        expect(
            container.querySelector("[data-mdx-editor-mode-refusal]"),
        ).toBeNull();

        // Coming back shows it again, because it is still true: this document
        // at this revision still cannot be built visually. The notice tracks
        // the condition, not the keystroke that discovered it.
        await render("doc-a", unbuildable);

        expect(
            container.querySelector("[data-mdx-editor-mode-refusal]"),
        ).not.toBeNull();
    });

    it("retires a refusal once the content it described is replaced", async () => {
        const unbuildable = `${"> ".repeat(3000)}deep\n`;
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        mounted.push({ root, container });

        const binding = createEditorSessionBinding();
        const render = async (markdown: string) => {
            await act(async () => {
                root.render(
                    <MarkdownEditorSurface
                        session={binding}
                        documentId="doc"
                        markdown={markdown}
                        initialMode="source"
                        onMarkdownChange={() => {}}
                    />,
                );
            });
        };

        await render(unbuildable);
        await act(async () => {
            container.querySelector(".cm-content")!.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "M",
                    code: "KeyM",
                    metaKey: true,
                    shiftKey: true,
                }),
            );
        });
        expect(
            container.querySelector("[data-mdx-editor-mode-refusal]"),
        ).not.toBeNull();

        // The same document, new content — an external clean reload looks like
        // this, and it may be exactly the fix the refusal asked for.
        await render("# Fixed\n");

        expect(
            container.querySelector("[data-mdx-editor-mode-refusal]"),
        ).toBeNull();
    });

    it("leaves one editable surface mounted, never two", async () => {
        const harness = await mountSurface("# Title\n\nBody text.\n");

        await pressModeShortcut(harness);

        expect(harness.container.querySelectorAll(".ProseMirror")).toHaveLength(
            0,
        );
        expect(harness.container.querySelectorAll(".cm-content")).toHaveLength(
            1,
        );
    });
});
