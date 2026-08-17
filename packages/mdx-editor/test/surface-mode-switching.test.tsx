// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { createRef, type RefObject } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type {
    DocumentSelectionRange,
    EditorAdapterDiagnostic,
    EditorChangeEvent,
    EditorCommandResult,
    EditorDocumentSnapshot,
    EditorModeChangeResult,
    EditorSurfaceMode,
    MarkdownEditorAdapterHandle,
} from "../adapter/types";
import { allSyntaxFixtures, type SyntaxFixture } from "./syntax-fixtures";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A document the visual surface genuinely cannot build.
 *
 * Unknown syntax and raw HTML are deliberately *not* fatal — the fallback layer
 * accepts them — so a real refusal needs an input that defeats the parser
 * itself rather than one it has an answer for. Nesting depth does it: the parse
 * recurses once per blockquote level, and past roughly 1500 levels the build
 * dies with a RangeError instead of producing a document. This depth is an
 * order of magnitude past that floor, so no plausible stack size makes the
 * fixture stop being fatal, and the source surface holds the same text in a few
 * milliseconds.
 */
const FATAL_MARKDOWN = `${"> ".repeat(20000)}x\n`;

const roots: Array<{ root: Root; container: HTMLElement }> = [];
let commandSeq = 0;

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

interface Session {
    handle: RefObject<MarkdownEditorAdapterHandle | null>;
    container: HTMLElement;
    changes: EditorChangeEvent[];
    diagnostics: EditorAdapterDiagnostic[];
    modeChanges: EditorSurfaceMode[];
    /** The revision the session has assigned; what a command must be pinned to. */
    revision(): number;
    /** The newest Markdown the session has been told about, confirmed or not. */
    latest(): string;
    mode(): EditorSurfaceMode;
    dirty(): boolean;
    conflicted(): boolean;
    /** Persists what the session currently holds, exactly as a save would. */
    save(): void;
    /** The file changed underneath a buffer that has unsaved edits. */
    reportExternalConflict(): void;
    /** Delivers any snapshot without yielding, whatever the adapter makes of it. */
    deliver(snapshot: EditorDocumentSnapshot): void;
    /** An external clean reload: new content from disk, nothing unsaved left. */
    reload(markdown: string): void;
    /** The editor goes away, as it does when the tab is switched. */
    close(): Promise<void>;
    settle(): Promise<void>;
}

/**
 * A stand-in for the Workspace/Document shell.
 *
 * It owns canonical Markdown, the revision, dirty and conflict state, and
 * drives `mode` as controlled state. Unlike the harness in `surface-mode.test`
 * it also *confirms* changes by handing back the next revision, which is what a
 * real shell does and what lets a test make more than one edit: the revision
 * guard refuses a command pinned to a revision it has not confirmed. While a
 * conflict is open it stops confirming, because it cannot decide whose content
 * wins until the conflict is resolved.
 */
async function openSession(initialMarkdown: string): Promise<Session> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });

    const handle = createRef<MarkdownEditorAdapterHandle>();
    let snapshot: EditorDocumentSnapshot = {
        documentId: "doc",
        revision: 1,
        markdown: initialMarkdown,
    };
    let saved = initialMarkdown;
    let conflicted = false;
    let mode: EditorSurfaceMode = "wysiwyg";
    /**
     * Set when a callback changed the props the adapter is rendered with.
     *
     * The re-render is deferred to `settle()` rather than started inside the
     * callback: rendering from a promise continuation interleaves React's `act`
     * scopes, and an interleaved scope swallows every later render in the file.
     */
    let renderDirty = false;

    const element = (): React.ReactElement => (
        <MarkdownEditorAdapter
            ref={handle}
            snapshot={snapshot}
            mode={mode}
            editable
            onChange={(event) => {
                session.changes.push(event);
                if (event.documentId !== snapshot.documentId) return;
                if (conflicted) return;
                snapshot = {
                    documentId: snapshot.documentId,
                    revision: snapshot.revision + 1,
                    markdown: event.markdown,
                };
                scheduleRender();
            }}
            onSelectionChange={() => {}}
            onModeChange={(next) => {
                session.modeChanges.push(next);
                mode = next;
                scheduleRender();
            }}
            onDiagnostic={(diagnostic) => session.diagnostics.push(diagnostic)}
            onOpenWikilink={() => {}}
            onReady={() => {}}
        />
    );

    const render = async (): Promise<void> => {
        await act(async () => {
            root.render(element());
        });
    };

    /**
     * Renders and commits without yielding.
     *
     * A snapshot that arrives *during* a switch has to reach the adapter before
     * the switch's next await resumes. An awaited render cannot do that: the
     * suspended switch resumes on the microtask queue first, and the snapshot
     * would land after the switch had already finished — which is the switch
     * not being interrupted at all.
     */
    const renderNow = (): void => {
        act(() => {
            root.render(element());
        });
    };

    const scheduleRender = (): void => {
        renderDirty = true;
    };

    const session: Session = {
        handle,
        container,
        changes: [],
        diagnostics: [],
        modeChanges: [],
        revision: () => snapshot.revision,
        latest: () =>
            session.changes.length > 0
                ? session.changes[session.changes.length - 1].markdown
                : snapshot.markdown,
        mode: () => mode,
        dirty: () => session.latest() !== saved,
        conflicted: () => conflicted,
        save: () => {
            saved = session.latest();
        },
        reportExternalConflict: () => {
            conflicted = true;
        },
        deliver: (next) => {
            snapshot = next;
            renderNow();
        },
        reload: (markdown) => {
            snapshot = {
                documentId: snapshot.documentId,
                revision: snapshot.revision + 1,
                markdown,
                replaceReason: "clean-reload",
            };
            saved = markdown;
            conflicted = false;
            session.changes.length = 0;
            renderNow();
        },
        close: async () => {
            const index = roots.findIndex((entry) => entry.root === root);
            if (index >= 0) roots.splice(index, 1);
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
        settle: async () => {
            while (renderDirty) {
                renderDirty = false;
                await render();
            }
        },
    };

    await render();
    return session;
}

function surfaceKinds(container: HTMLElement): {
    wysiwyg: number;
    source: number;
} {
    return {
        wysiwyg: container.querySelectorAll(".ProseMirror").length,
        source: container.querySelectorAll(".cm-editor").length,
    };
}

async function switchTo(
    session: Session,
    mode: EditorSurfaceMode,
): Promise<EditorModeChangeResult> {
    let result!: EditorModeChangeResult;
    await act(async () => {
        result = await session.handle.current!.setMode(mode);
    });
    await session.settle();
    return result;
}

/** Edits through whichever surface is mounted, as a pinned command would. */
async function editThroughSurface(
    session: Session,
    range: DocumentSelectionRange,
    text: string,
): Promise<EditorCommandResult> {
    let result!: EditorCommandResult;
    await act(async () => {
        result = await session.handle.current!.execute({
            commandId: `cmd-${(commandSeq += 1)}`,
            documentId: "doc",
            baseRevision: session.revision(),
            selection: range,
            kind: "replace-selection",
            text,
        });
    });
    await session.settle();
    return result;
}

async function appendThroughSurface(
    session: Session,
    text: string,
): Promise<EditorCommandResult> {
    const end = session.latest().length;
    return editThroughSurface(session, { anchor: end, head: end }, text);
}

async function replaceWholeDocument(
    session: Session,
    markdown: string,
): Promise<EditorCommandResult> {
    return editThroughSurface(
        session,
        { anchor: 0, head: session.latest().length },
        markdown,
    );
}

function sourceView(session: Session): EditorView {
    const dom = session.container.querySelector<HTMLElement>(".cm-editor");
    if (!dom) throw new Error("no source surface is mounted");
    const view = EditorView.findFromDOM(dom);
    if (!view) throw new Error("the source surface has no CodeMirror view");
    return view;
}

/**
 * Types into the mounted source surface the way the keyboard does.
 *
 * `execute` cannot stand in for this: it drains the surface itself, so an edit
 * made through it has always been reported by the time it returns. A keystroke
 * has not — emission is deferred by a microtask — and that gap is where a
 * switch, a snapshot or an unmount can lose it.
 */
function typeIntoSource(session: Session, at: number, text: string): void {
    sourceView(session).dispatch({
        changes: { from: at, to: at, insert: text },
    });
}

/** A paste over the whole source document, likewise not yet emitted. */
function pasteOverSource(session: Session, markdown: string): void {
    const view = sourceView(session);
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: markdown },
    });
}

/** Lets a queued change emission run, without rendering anything. */
async function drainEmission(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

describe("surface mode — a source document the visual surface cannot build", () => {
    it("refuses the switch, keeps the source, and locates the failure", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        expect(await switchTo(session, "source")).toEqual({ ok: true });
        expect(await replaceWholeDocument(session, FATAL_MARKDOWN)).toEqual({
            ok: true,
        });
        expect(session.dirty()).toBe(true);

        const result = await switchTo(session, "wysiwyg");

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(result.code).toBe("unsafe_visual_parse");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].code).toBe("unsafe_visual_parse");
        // The refusal came from the build itself failing, not from a check that
        // decided in advance which documents it dislikes.
        expect(result.diagnostics[0].message).toContain("call stack");
        // The failure is located in the source that could not be built.
        expect(result.diagnostics[0].range).toEqual({
            anchor: 0,
            head: FATAL_MARKDOWN.length,
        });
        expect(session.diagnostics).toContainEqual(result.diagnostics[0]);

        // The user stays in CodeMirror with the source and the dirty state.
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        expect(session.mode()).toBe("source");
        expect(session.modeChanges).toEqual(["source"]);
        expect(session.latest()).toBe(FATAL_MARKDOWN);
        expect(session.dirty()).toBe(true);
    }, 60000);

    it("saves the refused source and switches once it is fixed", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        await switchTo(session, "source");
        await replaceWholeDocument(session, FATAL_MARKDOWN);
        expect((await switchTo(session, "wysiwyg")).ok).toBe(false);

        // Markdown is the authority, so the refused document still saves.
        session.save();
        expect(session.dirty()).toBe(false);
        expect(session.latest()).toBe(FATAL_MARKDOWN);

        expect(await replaceWholeDocument(session, "# Fixed\n\nBody.\n")).toEqual(
            { ok: true },
        );
        expect(await switchTo(session, "wysiwyg")).toEqual({ ok: true });

        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        expect(session.container.querySelector("h1")?.textContent).toBe("Fixed");
        expect(session.latest()).toBe("# Fixed\n\nBody.\n");
    }, 60000);
});

describe("surface mode — lastStableVisual", () => {
    it("survives a refused switch", async () => {
        const stable = "# Title\n\nBody.\n";
        const session = await openSession(stable);
        expect(session.handle.current!.getLastStableVisual()).toEqual({
            markdown: stable,
            revision: 1,
        });

        await switchTo(session, "source");
        await replaceWholeDocument(session, FATAL_MARKDOWN);
        expect((await switchTo(session, "wysiwyg")).ok).toBe(false);

        expect(session.handle.current!.getLastStableVisual()).toEqual({
            markdown: stable,
            revision: 1,
        });
    }, 60000);

    it("never becomes canonical content", async () => {
        const stable = "# Title\n\nBody.\n";
        const session = await openSession(stable);
        await switchTo(session, "source");
        await replaceWholeDocument(session, FATAL_MARKDOWN);
        session.changes.length = 0;

        expect((await switchTo(session, "wysiwyg")).ok).toBe(false);
        await session.settle();

        // Nothing wrote the cached visual back. A write-back is silent — the
        // surface suppresses its own replace — so it is caught by looking at
        // what the surface actually holds, not only at what it reported: the
        // refused source is still on screen, and the next edit lands on it.
        expect(session.changes).toEqual([]);
        expect(session.container.querySelector(".cm-editor")).not.toBeNull();
        expect(session.container.textContent).not.toContain("# Title");
        expect(await appendThroughSurface(session, "tail\n")).toEqual({
            ok: true,
        });
        expect(session.latest().startsWith("> > ")).toBe(true);
        expect(session.latest().endsWith("tail\n")).toBe(true);
        expect(session.latest()).not.toContain("# Title");

        const cached = session.handle.current!.getLastStableVisual()!;
        expect(cached.markdown).toBe(stable);

        // Read-only: what a caller reads cannot be turned into current content.
        expect(() => {
            (cached as { markdown: string }).markdown = "rewritten";
        }).toThrow();
        expect(session.handle.current!.getLastStableVisual()!.markdown).toBe(
            stable,
        );
    }, 60000);

    it("tracks what the visual surface last presented", async () => {
        const session = await openSession("# One\n");
        session.reload("# Two\n");
        await session.settle();

        // What the surface *presented*, not what arrived: content the surface
        // never took cannot be recorded as the last stable view.
        expect(session.container.querySelector("h1")?.textContent).toBe("Two");
        expect(session.handle.current!.getLastStableVisual()).toEqual({
            markdown: "# Two\n",
            revision: 2,
        });
    });

    it("pairs the cached Markdown with the revision it was derived from", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        // The file changed on disk, so the session stops confirming and the
        // next edit stays ahead of the revision it was made against.
        session.reportExternalConflict();
        await switchTo(session, "source");
        typeIntoSource(session, 0, "x");
        await drainEmission();
        expect(session.revision()).toBe(1);

        expect(await switchTo(session, "wysiwyg")).toEqual({ ok: true });

        // Both halves come from one read of the revision guard: the Markdown
        // the surface was seeded with, and the revision that Markdown was built
        // on. The edit is unconfirmed, so the Markdown is ahead of the revision
        // and the pair says exactly that, instead of pairing content the
        // surface holds with a revision holding different text.
        expect(session.handle.current!.getLastStableVisual()).toEqual({
            markdown: "x# Title\n\nBody.\n",
            revision: 1,
        });
    }, 60000);
});

describe("surface mode — what a switch does about everything else in flight", () => {
    it("ignores a stale revision that arrives mid-switch", async () => {
        const session = await openSession("live content\n");
        await switchTo(session, "source");
        expect(await appendThroughSurface(session, "plus more\n")).toEqual({
            ok: true,
        });

        const switching = session.handle.current!.setMode("wysiwyg");
        session.deliver({
            documentId: "doc",
            revision: 1,
            markdown: "stale content\n",
        });
        // The snapshot landed while the switch was still suspended: nothing has
        // been reported yet.
        expect(session.modeChanges).toEqual(["source"]);

        let result!: EditorModeChangeResult;
        await act(async () => {
            result = await switching;
        });
        await session.settle();

        expect(result).toEqual({ ok: true });
        expect(session.diagnostics.map((each) => each.code)).toContain(
            "stale_editor_change",
        );
        expect(session.container.textContent).toContain("live content");
        expect(session.container.textContent).toContain("plus more");
        expect(session.container.textContent).not.toContain("stale content");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
    }, 60000);

    it("lets an external clean reload that arrives mid-switch win", async () => {
        const session = await openSession("original\n");
        await switchTo(session, "source");

        const switching = session.handle.current!.setMode("wysiwyg");
        session.reload("reloaded from disk\n");
        expect(session.modeChanges).toEqual(["source"]);

        let result!: EditorModeChangeResult;
        await act(async () => {
            result = await switching;
        });
        await session.settle();

        expect(result).toEqual({ ok: true });
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        expect(session.container.textContent).toContain("reloaded from disk");
        expect(session.container.textContent).not.toContain("original");
        expect(session.latest()).toBe("reloaded from disk\n");
        expect(session.dirty()).toBe(false);
    }, 60000);

    it("cancels the switch when the reload cannot be built visually", async () => {
        const session = await openSession("original\n");
        await switchTo(session, "source");

        const switching = session.handle.current!.setMode("wysiwyg");
        session.reload(FATAL_MARKDOWN);
        expect(session.modeChanges).toEqual(["source"]);

        let result!: EditorModeChangeResult;
        await act(async () => {
            result = await switching;
        });
        await session.settle();

        // The switch was checked against `original`, but the session's revision
        // moved underneath it: the content that would actually be mounted is
        // the reloaded one, and it cannot be built.
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(result.code).toBe("unsafe_visual_parse");
        expect(session.modeChanges).toEqual(["source"]);
        expect(session.mode()).toBe("source");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        expect(
            session.diagnostics.some(
                (each) => each.code === "editor_init_failed",
            ),
        ).toBe(false);
    }, 60000);

    it("cancels the switch when an edit lands while it is checking", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        await switchTo(session, "source");

        const switching = session.handle.current!.setMode("wysiwyg");
        // A paste while the toggle is in flight. It never reaches the session's
        // revision — the session has not seen it yet — so a check that watches
        // the revision cannot see it at all, and the swap would mount content
        // nothing ever checked.
        pasteOverSource(session, FATAL_MARKDOWN);

        let result!: EditorModeChangeResult;
        await act(async () => {
            result = await switching;
        });
        await session.settle();

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(result.code).toBe("unsafe_visual_parse");
        // Refused by the check, not by a mount that blew up afterwards.
        expect(
            session.diagnostics.some(
                (each) => each.code === "editor_init_failed",
            ),
        ).toBe(false);
        expect(session.mode()).toBe("source");
        expect(session.modeChanges).toEqual(["source"]);
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        expect(session.latest()).toBe(FATAL_MARKDOWN);
    }, 60000);

    it("checks the keystroke the surface has not emitted yet", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        await switchTo(session, "source");
        expect(await replaceWholeDocument(session, FATAL_MARKDOWN)).toEqual({
            ok: true,
        });

        // The user repairs the document and hits the toggle in the same beat:
        // the repair is still queued for emission when the switch starts, so a
        // switch that checks the session's copy would refuse a document that
        // builds perfectly well.
        pasteOverSource(session, "# Fixed\n");
        const result = await switchTo(session, "wysiwyg");

        expect(result).toEqual({ ok: true });
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        expect(session.container.querySelector("h1")?.textContent).toBe("Fixed");
        expect(session.latest()).toBe("# Fixed\n");
    }, 60000);

    it("keeps a keystroke the surface never got to emit", async () => {
        const session = await openSession("start\n");
        await switchTo(session, "source");
        session.changes.length = 0;

        // The last keystroke before the tab is switched away. Its emission is
        // still queued, and the queue is dead once the view is destroyed, so
        // the surface has to hand it over on the way out or it is gone.
        typeIntoSource(session, 5, " typed");
        await session.close();

        expect(session.changes.map((each) => each.markdown)).toEqual([
            "start typed\n",
        ]);
    }, 60000);

    it("reports every mode it asks the session for", async () => {
        const session = await openSession("# Title\n\nBody.\n");

        // Both calls land before React re-renders, so the mounted surface still
        // says "wysiwyg" while the session has already been told "source".
        const results: EditorModeChangeResult[] = [];
        await act(async () => {
            results.push(await session.handle.current!.setMode("source"));
            results.push(await session.handle.current!.setMode("wysiwyg"));
        });
        await session.settle();

        expect(results).toEqual([{ ok: true }, { ok: true }]);
        // A reported success is a mode the editor enters. The second call
        // cannot succeed by finding a surface the first one has not replaced
        // yet and reporting nothing.
        expect(session.modeChanges).toEqual(["source", "wysiwyg"]);
        expect(session.mode()).toBe("wysiwyg");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
    }, 60000);

    it("carries the caret across a surface swap", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        act(() => {
            session.handle.current!.setSelection({ anchor: 2, head: 7 });
        });
        expect(session.handle.current!.getSelection()).toEqual({
            anchor: 2,
            head: 7,
        });

        expect(await switchTo(session, "source")).toEqual({ ok: true });

        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        // Both surfaces speak source offsets, so the caret survives the swap
        // rather than being dropped at the top of the document.
        expect(session.handle.current!.getSelection()).toEqual({
            anchor: 2,
            head: 7,
        });
    }, 60000);

    it("switches once however many times the same mode is asked for", async () => {
        const session = await openSession("x\n");

        let results!: EditorModeChangeResult[];
        await act(async () => {
            results = await Promise.all([
                session.handle.current!.setMode("source"),
                session.handle.current!.setMode("source"),
                session.handle.current!.setMode("source"),
            ]);
        });
        await session.settle();

        expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        expect(session.modeChanges).toEqual(["source"]);
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
    });

    it("keeps a conflict and its unsaved edit across a switch", async () => {
        const session = await openSession("before\n");
        session.save();
        await switchTo(session, "source");
        expect(await appendThroughSurface(session, "edited\n")).toEqual({
            ok: true,
        });

        // The file changed on disk while the buffer had unsaved edits. The
        // shell raises a conflict and stops confirming, so the next edit stays
        // unconfirmed — the state a switch is most likely to lose.
        session.reportExternalConflict();
        expect(await appendThroughSurface(session, "and again\n")).toEqual({
            ok: true,
        });
        const changesBeforeSwitch = session.changes.length;

        expect(await switchTo(session, "wysiwyg")).toEqual({ ok: true });

        // The mode changes: a conflict does not block the switch.
        expect(session.mode()).toBe("wysiwyg");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        // And nothing about the conflict is resolved by switching: the unsaved
        // edits are still there, still dirty, with no silent rollback.
        expect(session.container.textContent).toContain("edited");
        expect(session.container.textContent).toContain("and again");
        expect(session.conflicted()).toBe(true);
        expect(session.dirty()).toBe(true);
        expect(session.changes).toHaveLength(changesBeforeSwitch);
    }, 60000);

    it("keeps the selection at 0,0 for an empty document", async () => {
        const session = await openSession("");
        expect(session.handle.current!.getSelection()).toEqual({
            anchor: 0,
            head: 0,
        });

        expect(await switchTo(session, "source")).toEqual({ ok: true });

        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        expect(session.handle.current!.getSelection()).toEqual({
            anchor: 0,
            head: 0,
        });
    });
});

describe("surface mode — round trip through the source surface", () => {
    it("keeps content and dirty state through wysiwyg → source → wysiwyg", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        session.save();
        expect(session.dirty()).toBe(false);

        await switchTo(session, "source");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        expect(await appendThroughSurface(session, "\nAdded in source.\n")).toEqual(
            { ok: true },
        );
        expect(session.dirty()).toBe(true);

        expect(await switchTo(session, "wysiwyg")).toEqual({ ok: true });

        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        expect(session.latest()).toContain("Added in source.");
        expect(session.container.querySelector("h1")?.textContent).toBe("Title");
        expect(session.container.textContent).toContain("Added in source.");
        expect(session.dirty()).toBe(true);
    }, 60000);

    it("does not report the switch itself as an edit", async () => {
        const session = await openSession("# Title\n\nBody.\n");
        await switchTo(session, "source");
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 0,
            source: 1,
        });
        session.changes.length = 0;

        await switchTo(session, "wysiwyg");
        await session.settle();

        // The swap really happened — a switch that never runs reports nothing
        // either — and it reported nothing, because rebuilding the view is not
        // an edit to the document.
        expect(surfaceKinds(session.container)).toEqual({
            wysiwyg: 1,
            source: 0,
        });
        expect(session.container.querySelector("h1")?.textContent).toBe("Title");
        expect(session.changes).toEqual([]);
    }, 60000);

    it("writes an escape the same way whichever surface made the edit", async () => {
        const session = await openSession("Lead.\n\nBody \\[kept] here.\n");
        session.save();

        // Text put in on the visual surface has no source to preserve, so it is
        // written as it was put in — no backslash the user did not make — while
        // the escape the author did write, elsewhere in the document, survives
        // the same serialization.
        expect(
            await editThroughSurface(session, { anchor: 4, head: 4 }, " array[0]"),
        ).toEqual({ ok: true });
        expect(session.latest()).toBe(
            "Lead array[0].\n\nBody \\[kept] here.\n",
        );

        // The source surface is handed those exact bytes, not a re-escaped copy.
        expect(await switchTo(session, "source")).toEqual({ ok: true });
        expect(sourceView(session).state.doc.toString()).toBe(
            "Lead array[0].\n\nBody \\[kept] here.\n",
        );

        // An escape typed into the source surface is authored content: coming
        // back through the visual surface, and out again past another edit, it
        // is still there.
        typeIntoSource(session, "Lead array[0]".length, " \\*star\\*");
        await drainEmission();
        expect(await switchTo(session, "wysiwyg")).toEqual({ ok: true });
        expect(await appendThroughSurface(session, "\n\nTail.\n")).toEqual({
            ok: true,
        });

        expect(session.latest()).toBe(
            "Lead array[0] \\*star\\*.\n\nBody \\[kept] here.\n\nTail.\n",
        );
    }, 60000);

    describe("syntax fixtures survive the trip", () => {
        for (const fixture of allSyntaxFixtures) {
            it(`${fixture.kind}: ${fixture.name}`, async () => {
                const session = await openSession(fixture.markdown);

                await switchTo(session, "source");
                expect(surfaceKinds(session.container).source).toBe(1);
                // Serialization only runs once a transaction dirties the
                // document, so the fidelity claim needs an edit on each side of
                // the trip. Both are appended past the end of every fixture, so
                // neither lands inside the slice under test.
                expect(await appendThroughSurface(session, "edited")).toEqual({
                    ok: true,
                });

                await switchTo(session, "wysiwyg");
                expect(surfaceKinds(session.container).wysiwyg).toBe(1);
                expect(await appendThroughSurface(session, " again")).toEqual({
                    ok: true,
                });

                expectSlicesPreserved(session.latest(), fixture);
            }, 60000);
        }
    });
});

describe("surface mode — a confirmation the surface has already moved past", () => {
    it("advances the revision without rewriting what the user is typing", async () => {
        const session = await openSession("start\n");
        await switchTo(session, "source");

        // Two keystrokes, each reported to the session as it happens.
        typeIntoSource(session, 5, " one");
        await drainEmission();
        typeIntoSource(session, 9, " two");
        await drainEmission();
        expect(sourceView(session).state.doc.toString()).toBe("start one two\n");

        // The session catches up one revision at a time, so its confirmation
        // carries the *first* edit while the surface already holds the second.
        session.deliver({
            documentId: "doc",
            revision: 2,
            markdown: "start one\n",
        });
        await session.settle();

        // Confirming is bookkeeping. Writing the confirmed content back would
        // delete every character typed since it was emitted.
        expect(sourceView(session).state.doc.toString()).toBe("start one two\n");
        expect(session.container.textContent).toContain("start one two");
        expect(
            session.diagnostics.map((each) => each.code),
        ).not.toContain("stale_editor_change");
    }, 60000);
});

function expectSlicesPreserved(result: string, fixture: SyntaxFixture): void {
    for (const slice of fixture.preservedSlices) {
        expect(
            result.includes(slice),
            `expected ${fixture.name} to preserve ${JSON.stringify(slice)} but got ${JSON.stringify(result)}`,
        ).toBe(true);
    }
}
