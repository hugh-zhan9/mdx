// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type {
    EditorAdapterDiagnostic,
    EditorDocumentSnapshot,
    EditorSurfaceMode,
    MarkdownEditorAdapterHandle,
} from "../adapter/types";

/** Deep blockquote nesting exhausts the parser's stack. */
const UNBUILDABLE = `${"> ".repeat(3000)}deep\n`;

/**
 * Long enough for the nesting above, with room for a loaded machine.
 *
 * Parsing 3000 levels takes seconds, which under parallel load lands either
 * side of the 5s default and flakes. The nesting is not reduced to go faster:
 * the margin above the ~1500 floor is the point of the fixture.
 */
const UNBUILDABLE_TIMEOUT_MS = 30_000;

const roots: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (roots.length > 0) {
        const entry = roots.pop();
        if (!entry) continue;
        await act(async () => entry.root.unmount());
        entry.container.remove();
    }
});

interface Harness {
    handle: RefObject<MarkdownEditorAdapterHandle | null>;
    container: HTMLElement;
    diagnostics: EditorAdapterDiagnostic[];
    mode(): EditorSurfaceMode;
    reload(markdown: string): Promise<void>;
}

async function open(markdown: string): Promise<Harness> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });

    const handle = createRef<MarkdownEditorAdapterHandle>();
    let snapshot: EditorDocumentSnapshot = {
        documentId: "doc",
        revision: 1,
        markdown,
    };
    let mode: EditorSurfaceMode = "wysiwyg";
    const harness: Harness = {
        handle,
        container,
        diagnostics: [],
        mode: () => mode,
        reload: async () => {},
    };

    const render = async (): Promise<void> => {
        await act(async () => {
            root.render(
                <MarkdownEditorAdapter
                    ref={handle}
                    snapshot={snapshot}
                    mode={mode}
                    editable
                    onChange={() => {}}
                    onSelectionChange={() => {}}
                    onModeChange={(next) => {
                        mode = next;
                        void render();
                    }}
                    onDiagnostic={(entry) => harness.diagnostics.push(entry)}
                    onOpenWikilink={() => {}}
                    onReady={() => {}}
                />,
            );
        });
    };

    harness.reload = async (next) => {
        snapshot = {
            documentId: "doc",
            revision: snapshot.revision + 1,
            markdown: next,
            replaceReason: "clean-reload",
        };
        await render();
    };

    await render();
    return harness;
}

describe("regression: a refused document does not strand the surface", () => {
    // A build failure poisons that editor instance's parser — every later parse
    // on it throws. Keeping the surface after a refusal therefore left the user
    // on stale content permanently: the file could be repaired on disk and the
    // repair would be refused too, with the editor still showing the old text.
    it("shows repaired content after refusing a broken reload", async () => {
        const harness = await open("# First\n\nOriginal body.\n");

        await harness.reload(UNBUILDABLE);
        expect(harness.diagnostics.map((d) => d.code)).toContain(
            "unsafe_visual_parse",
        );

        await harness.reload("# Second\n\nRepaired body.\n");

        expect(harness.container.textContent).toContain("Repaired body.");
        expect(harness.container.textContent).not.toContain("Original body.");
    }, UNBUILDABLE_TIMEOUT_MS);

    it("still edits normally after the recovery", async () => {
        const harness = await open("# First\n\nOriginal body.\n");
        await harness.reload(UNBUILDABLE);
        await harness.reload("start\n");

        const result = await harness.handle.current!.execute({
            commandId: "c1",
            documentId: "doc",
            baseRevision: 3,
            selection: { anchor: 5, head: 5 },
            kind: "replace-selection",
            text: " typed",
        });

        expect(result).toEqual({ ok: true });
    }, UNBUILDABLE_TIMEOUT_MS);

    it("falls to source when the content stays unbuildable", async () => {
        const harness = await open("# First\n\nOriginal body.\n");

        await harness.reload(UNBUILDABLE);
        await act(async () => {
            await Promise.resolve();
        });

        // The rebuild is attempted with the same unbuildable content; when it
        // fails in turn the session is asked for source mode rather than being
        // left with no editor.
        expect(harness.mode()).toBe("source");
    }, UNBUILDABLE_TIMEOUT_MS);
});
