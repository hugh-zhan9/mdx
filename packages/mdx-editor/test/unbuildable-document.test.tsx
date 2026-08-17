// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type {
    EditorAdapterDiagnostic,
    EditorDocumentSnapshot,
    MarkdownEditorAdapterHandle,
} from "../adapter/types";

/**
 * Deep blockquote nesting exhausts the parser's stack. It is the one input
 * found that genuinely defeats the visual build — brackets, unknown directives,
 * raw HTML and deep `<div>` nesting all go to fallback and build fine, which is
 * fallback doing its job.
 *
 * The measured floor is between 1000 (builds) and 1500 (throws), and 3000 keeps
 * a wide margin against that floor drifting.
 *
 * It is not cheap, though — an earlier note here claimed it was, and the suite
 * has since grown past that being true. Parsing this much nesting takes seconds,
 * which under parallel load lands either side of the 5s default and makes these
 * tests flake rather than fail. So every test that mounts it says how long it is
 * allowed to take. The margin is worth more than the seconds: lowering the
 * nesting to go faster would weaken the very bound being asserted.
 */
const UNBUILDABLE = `${"> ".repeat(3000)}deep\n`;

/** Long enough for the nesting above, with room for a loaded machine. */
const UNBUILDABLE_TIMEOUT_MS = 30_000;

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
    container: HTMLElement;
    diagnostics: EditorAdapterDiagnostic[];
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
    // The harness has to honour a mode change, or the adapter asking for source
    // mode mounts nothing and every assertion about a surface is about a
    // surface that was never allowed to exist.
    let mode: "wysiwyg" | "source" = "wysiwyg";
    const harness: Harness = {
        handle,
        container,
        diagnostics: [],
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
                    onDiagnostic={(diagnostic) =>
                        harness.diagnostics.push(diagnostic)
                    }
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

describe("regression: unbuildable content cannot tear down the editor", () => {
    // `replaceAll` parses, so a document the visual surface cannot build threw
    // straight out of a React effect: the whole editor tree unmounted, no
    // surface remained, no diagnostic was reported, and there was no route back
    // to source with the user's content.
    //
    // The first two tests here originally asserted that the refused surface
    // stayed mounted showing its previous content. That turned out to pin a
    // second defect rather than the fix: a build failure poisons that editor
    // instance's parser, so a surface kept after a refusal can never accept any
    // later content — the file could be repaired on disk and the repair refused
    // too. The surface is now rebuilt, and the editor still exists either way,
    // which is what these assert.
    it("reports the failure and still has an editor", async () => {
        const harness = await open("# Fine\n\nBody.\n");
        expect(harness.container.querySelector(".ProseMirror")).not.toBeNull();

        await harness.reload(UNBUILDABLE);

        expect(harness.handle.current).not.toBeNull();
        expect(
            harness.diagnostics.map((entry) => entry.code),
        ).toContain("unsafe_visual_parse");
    }, UNBUILDABLE_TIMEOUT_MS);

    it("does not throw the editor tree away", async () => {
        const harness = await open("# Fine\n\nBody.\n");
        await harness.reload(UNBUILDABLE);

        // Some editable surface is present — the visual one if the rebuild
        // succeeded, the source one if the content is still unbuildable.
        const surfaces =
            harness.container.querySelectorAll(".ProseMirror").length +
            harness.container.querySelectorAll(".cm-editor").length;
        expect(surfaces).toBeGreaterThan(0);
    }, UNBUILDABLE_TIMEOUT_MS);

    it("can still reach source mode after refusing the content", async () => {
        const harness = await open("# Fine\n\nBody.\n");
        await harness.reload(UNBUILDABLE);

        const result = await act(async () =>
            harness.handle.current!.setMode("source"),
        );

        expect(result).toEqual({ ok: true });
    }, UNBUILDABLE_TIMEOUT_MS);
});

/**
 * Opens unbuildable content in visual mode and leaves it there.
 *
 * The build fails, so no surface is ever mounted. `mode` is deliberately not
 * driven from `onModeChange`: this is the window between the failure and the
 * session reacting to it, which is exactly when the shell asks for source mode.
 */
async function openFailedVisualBuild(): Promise<{
    handle: RefObject<MarkdownEditorAdapterHandle | null>;
    container: HTMLElement;
    modeChanges: string[];
    diagnostics: EditorAdapterDiagnostic[];
}> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });

    const handle = createRef<MarkdownEditorAdapterHandle>();
    const modeChanges: string[] = [];
    const diagnostics: EditorAdapterDiagnostic[] = [];

    await act(async () => {
        root.render(
            <MarkdownEditorAdapter
                ref={handle}
                snapshot={{
                    documentId: "doc",
                    revision: 1,
                    markdown: UNBUILDABLE,
                }}
                mode="wysiwyg"
                editable
                onChange={() => {}}
                onSelectionChange={() => {}}
                onModeChange={(next) => modeChanges.push(next)}
                onDiagnostic={(entry) => diagnostics.push(entry)}
                onOpenWikilink={() => {}}
                onReady={() => {}}
            />,
        );
    });

    return { handle, container, modeChanges, diagnostics };
}

describe("regression: opening unbuildable content still gives an editor", () => {
    // A visual build failure on open left no surface mounted at all, and
    // `setMode("source")` then refused with `surface_not_ready` — the user had
    // no route to their own content. The design requires that an editor
    // initialization failure keep the session and drop into source mode.
    it("asks the session for source mode when the visual build fails on open", async () => {
        const { modeChanges, diagnostics } = await openFailedVisualBuild();

        expect(diagnostics.map((entry) => entry.code)).toContain(
            "editor_init_failed",
        );
        expect(modeChanges).toEqual(["source"]);
    }, UNBUILDABLE_TIMEOUT_MS);

    it("asks again when the session did not act on the first request", async () => {
        const { handle, modeChanges } = await openFailedVisualBuild();
        expect(modeChanges).toEqual(["source"]);

        await act(async () => handle.current!.setMode("source"));
        await act(async () => handle.current!.setMode("source"));

        // This session never applies the mode it is handed, so the surface
        // never becomes the one being asked for. Treating the last thing the
        // adapter said as settled would make the second press — and every press
        // after it — silently do nothing.
        expect(modeChanges).toEqual(["source", "source", "source"]);
    }, UNBUILDABLE_TIMEOUT_MS);

    it("reports the switch to source instead of refusing it", async () => {
        const { handle, container, modeChanges, diagnostics } =
            await openFailedVisualBuild();
        expect(container.querySelector(".ProseMirror")).toBeNull();
        expect(container.querySelector(".cm-editor")).toBeNull();
        diagnostics.length = 0;

        const result = await act(async () => handle.current!.setMode("source"));

        // Source can hold any Markdown, and nothing about a visual parse was
        // checked here, so a refusal naming one would tell the shell the
        // opposite of what happened — and a shell reading that code stays in
        // the mode it is trying to leave.
        expect(result).toEqual({ ok: true });
        expect(modeChanges[modeChanges.length - 1]).toBe("source");
        expect(diagnostics).toEqual([]);
    }, UNBUILDABLE_TIMEOUT_MS);
});
