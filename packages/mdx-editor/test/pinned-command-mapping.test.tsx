// @vitest-environment jsdom
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
    EditorSurfaceMode,
    MarkdownEditorAdapterHandle,
    PinnedEditorCommand,
} from "../adapter/types";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    /** The revision a command must be pinned to. */
    revision(): number;
    /** The newest Markdown the session has been told about, confirmed or not. */
    latest(): string;
    /**
     * Stops handing back a new revision for every change, exactly as a shell
     * does while a conflict is open. Edits made after this stay pinned to the
     * revision they were made against, which is the state a command arriving
     * late has to be carried across.
     */
    stopConfirming(): void;
    /** An external clean reload: new content from disk at a new revision. */
    reload(markdown: string): Promise<void>;
    run(command: Partial<PinnedEditorCommand>): Promise<EditorCommandResult>;
    /** Applies a mode change the way the shell does, as controlled state. */
    switchTo(mode: EditorSurfaceMode): Promise<void>;
    settle(): Promise<void>;
}

async function openSession(
    initialMarkdown: string,
    initialMode: EditorSurfaceMode,
): Promise<Session> {
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
    let confirming = true;
    let renderDirty = false;
    let mode = initialMode;

    const element = (): React.ReactElement => (
        <MarkdownEditorAdapter
            ref={handle}
            snapshot={snapshot}
            mode={mode}
            editable
            onChange={(event) => {
                session.changes.push(event);
                if (event.documentId !== snapshot.documentId) return;
                if (!confirming) return;
                snapshot = {
                    documentId: snapshot.documentId,
                    revision: snapshot.revision + 1,
                    markdown: event.markdown,
                };
                renderDirty = true;
            }}
            onSelectionChange={() => {}}
            onModeChange={(next) => {
                mode = next;
                renderDirty = true;
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

    const session: Session = {
        handle,
        container,
        changes: [],
        diagnostics: [],
        revision: () => snapshot.revision,
        latest: () =>
            session.changes.length > 0
                ? session.changes[session.changes.length - 1].markdown
                : snapshot.markdown,
        stopConfirming: () => {
            confirming = false;
        },
        reload: async (markdown) => {
            snapshot = {
                documentId: snapshot.documentId,
                revision: snapshot.revision + 1,
                markdown,
                replaceReason: "clean-reload",
            };
            confirming = true;
            session.changes.length = 0;
            await render();
        },
        run: async (command) => {
            let result!: EditorCommandResult;
            await act(async () => {
                result = await handle.current!.execute({
                    commandId: `cmd-${(commandSeq += 1)}`,
                    documentId: "doc",
                    baseRevision: snapshot.revision,
                    selection: null,
                    kind: "replace-selection",
                    ...command,
                });
            });
            await session.settle();
            return result;
        },
        switchTo: async (next) => {
            await act(async () => {
                await handle.current!.setMode(next);
            });
            await session.settle();
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

function mountedSurface(container: HTMLElement): EditorSurfaceMode | null {
    if (container.querySelector(".ProseMirror")) return "wysiwyg";
    if (container.querySelector(".cm-editor")) return "source";
    return null;
}

const BASE = "Hello world.\n";
/** Offset just past `Hello`, and the range covering `world`. */
const AFTER_HELLO: DocumentSelectionRange = { anchor: 5, head: 5 };
const WORLD: DocumentSelectionRange = { anchor: 6, head: 11 };

for (const mode of ["wysiwyg", "source"] as const) {
    describe(`pinned commands on the ${mode} surface`, () => {
        /**
         * Opens a session that has already taken one unconfirmed local edit, so
         * every pin below predates it. The edit inserts six characters at the
         * very start, which moves everything the pins name without touching any
         * of it.
         */
        async function sessionWithEarlierEdit(): Promise<Session> {
            const session = await openSession(BASE, mode);
            expect(mountedSurface(session.container)).toBe(mode);
            session.stopConfirming();
            expect(
                await session.run({
                    selection: { anchor: 0, head: 0 },
                    text: "Well, ",
                }),
            ).toEqual({ ok: true });
            expect(session.latest()).toBe("Well, Hello world.\n");
            // The session never caught up, so the next command is pinned to a
            // revision whose Markdown the surface no longer holds.
            expect(session.revision()).toBe(1);
            return session;
        }

        it("carries a caret pin across the edit that moved it", async () => {
            const session = await sessionWithEarlierEdit();

            expect(
                await session.run({ selection: AFTER_HELLO, text: "!" }),
            ).toEqual({ ok: true });

            // Applied where `Hello` ends now, not at raw offset 5 — which in
            // the current text sits inside `Well,` and would have produced
            // "Well,! Hello world.".
            expect(session.latest()).toBe("Well, Hello! world.\n");
        }, 60000);

        it("carries a range pin across the edit that moved it", async () => {
            const session = await sessionWithEarlierEdit();

            expect(
                await session.run({ kind: "reveal-range", range: WORLD }),
            ).toEqual({ ok: true });

            // `world` moved from 6..11 to 12..17.
            expect(session.handle.current!.getSelection()).toEqual({
                anchor: 12,
                head: 17,
            });
        }, 60000);

        it("puts a pinned image where the pin was, not at the caret", async () => {
            const session = await sessionWithEarlierEdit();
            // The caret is wherever the earlier edit left it; the image belongs
            // at the pin.
            act(() => {
                session.handle.current!.setSelection({ anchor: 0, head: 0 });
            });

            expect(
                await session.run({
                    kind: "insert-image",
                    selection: AFTER_HELLO,
                    image: { src: "assets/a.png", alt: "A" },
                }),
            ).toEqual({ ok: true });

            expect(session.latest()).toBe(
                "Well, Hello![A](assets/a.png) world.\n",
            );
        }, 60000);

        it("refuses a pin whose text an earlier edit replaced", async () => {
            const session = await openSession(BASE, mode);
            session.stopConfirming();
            expect(
                await session.run({ selection: WORLD, text: "EVERYONE" }),
            ).toEqual({ ok: true });
            expect(session.latest()).toBe("Hello EVERYONE.\n");

            const result = await session.run({
                selection: WORLD,
                text: "NOBODY",
            });

            expect(result).toEqual({ ok: false, code: "stale_revision" });
            // Refused, not applied somewhere else: neither at the raw offsets,
            // which would splice `NOBODY` into the middle of `EVERYONE`, nor at
            // the caret.
            expect(session.latest()).toBe("Hello EVERYONE.\n");
            expect(session.latest()).not.toContain("NOBODY");
        }, 60000);

        it("refuses a pin taken before a clean reload", async () => {
            const session = await openSession(BASE, mode);
            const pinned = {
                commandId: "before-reload",
                documentId: "doc",
                baseRevision: session.revision(),
                selection: AFTER_HELLO,
                kind: "replace-selection" as const,
                text: "!",
            };

            await session.reload("Something else entirely.\n");
            expect(session.latest()).toBe("Something else entirely.\n");

            let result!: EditorCommandResult;
            await act(async () => {
                result = await session.handle.current!.execute(pinned);
            });
            await session.settle();

            expect(result).toEqual({ ok: false, code: "stale_revision" });
            expect(session.latest()).toBe("Something else entirely.\n");
        }, 60000);

        it("refuses a pin aimed at a document the surface no longer holds", async () => {
            const session = await openSession(BASE, mode);
            let result!: EditorCommandResult;
            await act(async () => {
                result = await session.handle.current!.execute({
                    commandId: "other-tab",
                    documentId: "another-doc",
                    baseRevision: 1,
                    selection: AFTER_HELLO,
                    kind: "replace-selection",
                    text: "!",
                });
            });
            expect(result).toEqual({ ok: false, code: "stale_document" });
            expect(session.latest()).toBe(BASE);
        }, 60000);

        it("focuses even when the pin it carries could not be mapped", async () => {
            const session = await openSession(BASE, mode);
            session.stopConfirming();
            // Replaces the text the pin below names, so the pin is exactly the
            // one the other commands are refused for.
            expect(
                await session.run({ selection: WORLD, text: "EVERYONE" }),
            ).toEqual({ ok: true });
            expect(
                await session.run({ selection: WORLD, text: "NOBODY" }),
            ).toEqual({ ok: false, code: "stale_revision" });

            // `focus` never reads the pin, so nothing about it is stale.
            expect(
                await session.run({ kind: "focus", selection: WORLD }),
            ).toEqual({ ok: true });
            expect(session.latest()).toBe("Hello EVERYONE.\n");
        }, 60000);

        it("validates the pin against the Markdown it was pinned to", async () => {
            const session = await sessionWithEarlierEdit();
            // Past the end of `Hello world.\n`, though well inside the longer
            // text the surface now holds. It is the pinned document the offsets
            // have to be legal in.
            expect(
                await session.run({
                    selection: { anchor: 17, head: 17 },
                    text: "!",
                }),
            ).toEqual({ ok: false, code: "invalid_range" });
            expect(session.latest()).toBe("Well, Hello world.\n");
        }, 60000);
    });
}

describe("pinned commands — what a surface swap cannot carry", () => {
    it("refuses a pin taken before an unconfirmed edit the previous surface applied", async () => {
        // Deliberate and conservative. Rebuilding the surface leaves the
        // transaction history of the surface that is going away with it, so the
        // only thing left to map the pin with would be a guess at what changed.
        const session = await openSession(BASE, "wysiwyg");
        session.stopConfirming();
        expect(
            await session.run({
                selection: { anchor: 0, head: 0 },
                text: "Well, ",
            }),
        ).toEqual({ ok: true });

        await session.switchTo("source");
        // The swap really happened: a mode change the session declined to apply
        // would leave the original surface mounted, still holding the
        // transactions that make the pin mappable, and this test would claim
        // nothing.
        expect(mountedSurface(session.container)).toBe("source");

        const result = await session.run({ selection: AFTER_HELLO, text: "!" });
        expect(result).toEqual({ ok: false, code: "stale_revision" });
        expect(session.latest()).toBe("Well, Hello world.\n");
    }, 60000);
});
