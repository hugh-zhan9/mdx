"use client";

import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";

import {
    createEditingSurface,
    type EditingSurface,
} from "./editing-surface";
import {
    createDocumentRevisionGuard,
    type DocumentRevisionGuard,
} from "./document-revision";
import { isValidSourceRange } from "./source-offsets";
import { createSurfaceCache, surfaceCacheKey } from "./surface-cache";
import type {
    DocumentSelectionRange,
    EditorAdapterDiagnostic,
    EditorChangeOrigin,
    EditorCommandResult,
    EditorFindMatch,
    EditorFindRequest,
    EditorFindResult,
    EditorModeChangeResult,
    EditorSurfaceMode,
    EditorSurfaceServiceReader,
    LastStableVisual,
    MarkdownEditorAdapterHandle,
    MarkdownEditorAdapterProps,
    PinnedEditorCommand,
} from "./types";

/**
 * A selection carried across a surface swap, and the document it belongs to.
 *
 * The document has to travel with it. Both surfaces speak source offsets, so an
 * offset from one document is a perfectly valid offset in another and would be
 * applied without complaint — dropping the caret at whatever the previous file's
 * offset happens to name in this one.
 */
interface CarriedSelection {
    documentId: string;
    range: DocumentSelectionRange;
}

/** A match's stable identity: the range it covers, which no two matches share. */
function findMatchId(range: DocumentSelectionRange): string {
    return `${range.anchor}-${range.head}`;
}

/**
 * Runs the visual build a switch depends on, reporting why it failed.
 *
 * The build *is* the preflight: the product's own plugins, parser and schema
 * either produce a document or throw. The trial surface is built off-document
 * and destroyed immediately, so nothing the user can see is touched by a check
 * that fails.
 */
async function preflightVisualBuild(markdown: string): Promise<string | null> {
    const probe = document.createElement("div");
    try {
        const trial = await createEditingSurface("wysiwyg", {
            root: probe,
            markdown,
            editable: false,
            onMarkdownChange: () => {},
            onSelectionChange: () => {},
        });
        await trial.destroy();
        return null;
    } catch (error: unknown) {
        return error instanceof Error
            ? error.message
            : "the document could not be opened visually";
    }
}

/**
 * Callbacks are read through a ref so an in-flight editor never calls into a
 * closure captured from a previous document or a previous render.
 */
type AdapterCallbacks = Pick<
    MarkdownEditorAdapterProps,
    | "onChange"
    | "onSelectionChange"
    | "onModeChange"
    | "onDiagnostic"
    | "onOpenWikilink"
    | "onReady"
>;

export const MarkdownEditorAdapter = forwardRef<
    MarkdownEditorAdapterHandle,
    MarkdownEditorAdapterProps
>(function MarkdownEditorAdapter(props, ref) {
    const { snapshot, mode, editable } = props;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<EditingSurface | null>(null);
    const guardRef = useRef<DocumentRevisionGuard | null>(null);
    if (guardRef.current === null) {
        guardRef.current = createDocumentRevisionGuard();
    }
    const guard = guardRef.current;

    const callbacksRef = useRef<AdapterCallbacks>(props);
    const snapshotRef = useRef(snapshot);
    /**
     * The product's current capabilities.
     *
     * Held in a ref and read on demand rather than closed over at build time: a
     * surface is rebuilt only when the document or the view changes, and the
     * services can move without either — a rename changes what a relative asset
     * path resolves against while the same surface stays mounted.
     */
    const servicesRef = useRef(props.services);
    const readServices = useCallback<EditorSurfaceServiceReader>(
        () => servicesRef.current ?? {},
        [],
    );
    /**
     * Set while a pinned command drives an edit, so the resulting change is
     * reported with its true origin instead of being attributed to the user.
     */
    const activeOriginRef = useRef<EditorChangeOrigin>("user");
    /** Which document the mounted surface belongs to, to tell a mode switch from a document change. */
    const mountedDocumentRef = useRef<string | null>(null);
    /** Selection carried across a surface swap; both surfaces use source offsets. */
    const pendingSelectionRef = useRef<CarriedSelection | null>(null);
    /**
     * The last Markdown a visual surface presented. Derived, never canonical:
     * nothing in this file writes it back to the session or to a surface.
     */
    const lastStableVisualRef = useRef<LastStableVisual | null>(null);
    /**
     * The switch currently running. Repeating the same request while it is in
     * flight is the same switch, not a second one.
     */
    const pendingSwitchRef = useRef<{
        target: EditorSurfaceMode;
        promise: Promise<EditorModeChangeResult>;
    } | null>(null);
    /**
     * The mode `runSwitch` last announced, reset to the rendered mode by every
     * render.
     *
     * `mode` is controlled, so it lags a switch by a render and the mounted
     * surface lags it by a build. Between the two, neither can say whether this
     * mode has already been asked for — only what was announced can. A session
     * that declines by rendering the old mode resets this on that render; a
     * session that neither applies nor re-renders is indistinguishable from one
     * that has not got there yet, which is why this alone never decides.
     */
    const announcedModeRef = useRef<EditorSurfaceMode>(mode);
    const [hostGeneration, setHostGeneration] = useState(0);
    /** Bumped to rebuild the surface from scratch after it refuses content. */
    const [surfaceEpoch, setSurfaceEpoch] = useState(0);

    /**
     * Surfaces already built, kept so returning to a tab does not rebuild it.
     *
     * Only one is ever attached to the document; the rest sit detached with
     * their views intact. They keep answering their own callbacks, which is why
     * each one checks that it is the mounted surface before reporting anything.
     */
    const cacheRef = useRef(createSurfaceCache());
    /**
     * Whether the document may be edited right now.
     *
     * Read as a ref because a surface coming back from the cache was built
     * under whatever was true when it was last shown, and the effect that
     * mounts it deliberately does not re-run on `editable` — rebuilding for it
     * would throw away the history and caret this cache exists to keep.
     */
    const editableRef = useRef(editable);
    /** The epoch the cached surfaces were built under. */
    const builtEpochRef = useRef(surfaceEpoch);

    // Nothing outlives the adapter: every cached view holds a ProseMirror
    // document and its plugins' listeners, and dropping the references without
    // destroying them would leak all of it.
    useEffect(() => {
        const cache = cacheRef.current;
        return () => {
            cache.clear();
        };
    }, []);

    useEffect(() => {
        callbacksRef.current = props;
        snapshotRef.current = snapshot;
        servicesRef.current = props.services;
        editableRef.current = editable;
        // The session owns the mode: whatever it renders supersedes whatever
        // the adapter announced, including a change it decided not to take.
        announcedModeRef.current = mode;
    });

    const emitDiagnostic = useCallback((diagnostic: EditorAdapterDiagnostic) => {
        callbacksRef.current.onDiagnostic(diagnostic);
    }, []);

    /**
     * Records Markdown a visual surface presented without a build failure.
     *
     * Frozen because the cache is read-only by contract: a caller that could
     * mutate what it reads could turn a stale view into content the product
     * believes is current.
     */
    const recordStableVisual = useCallback(
        (markdown: string, revision: number) => {
            lastStableVisualRef.current = Object.freeze({ markdown, revision });
        },
        [],
    );

    // The surface is rebuilt only when the document identity changes. Markdown
    // and revision updates are applied to the live instance instead.
    const documentId = snapshot.documentId;

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const cache = cacheRef.current;
        // A bumped epoch means a built surface refused the content it was
        // given. Every surface built under it is suspect, not just that one.
        if (builtEpochRef.current !== surfaceEpoch) {
            builtEpochRef.current = surfaceEpoch;
            cache.clear();
        }

        const key = surfaceCacheKey(documentId, mode);
        let cancelled = false;
        let created: EditingSurface | null = null;
        /**
         * This effect's own surface, for its callbacks to identify themselves
         * by.
         *
         * A cached surface keeps the callbacks it was built with, so they
         * outlive the effect that created them and cannot be scoped by its
         * variables — those are cleared when it tears down. Comparing against
         * the mounted surface is what makes a detached view silent.
         */
        const self: { current: EditingSurface | null } = { current: null };
        const isMounted = () => hostRef.current === self.current;

        // A mode switch keeps the document; only the view changes. Seeding from
        // the snapshot would drop every keystroke the session has not confirmed
        // yet, so the guard's live Markdown wins whenever the document is the
        // same one already mounted.
        const isModeSwitch = mountedDocumentRef.current === documentId;
        const initial = snapshotRef.current;
        if (!isModeSwitch) guard.commitSnapshot(initial);
        mountedDocumentRef.current = documentId;
        // Content and the revision it was derived from are taken from one read
        // of the guard, so the pair can never mix content from one moment with
        // a revision from another. For a new document that read is the snapshot
        // just committed; for a mode switch it is the live Markdown, which is
        // ahead of the revision by exactly the edits the session has not
        // confirmed.
        const seed = guard.state();
        const seedMarkdown = seed.markdown;

        /**
         * Takes the surface off screen, keeping it built.
         *
         * The caret is carried so the session can restore it, and the pending
         * keystroke is drained: the surface stays alive but stops being the one
         * the session listens to, so an edit still in its coalescing window
         * would otherwise never be reported at all.
         */
        const detach = (
            host: EditingSurface | null,
            element: HTMLElement,
        ) => {
            // Drained while this surface is still the mounted one, because
            // that is what its callbacks check before reporting. A keystroke
            // sitting in the coalescing window when the user switches tabs
            // belongs to the document that produced it, and the session has to
            // hear about it — to accept it against that document, or to refuse
            // it because that document is gone.
            host?.flush();
            if (hostRef.current === host) hostRef.current = null;
            const leaving = host?.getSelection() ?? null;
            pendingSelectionRef.current = leaving
                ? { documentId, range: leaving }
                : null;
            created = null;
            element.remove();
        };

        /** Puts a built surface on screen and tells the session it is there. */
        const adopt = (host: EditingSurface) => {
            created = host;
            self.current = host;
            hostRef.current = host;
            if (host.mode === "wysiwyg") {
                recordStableVisual(seedMarkdown, seed.revision);
            }
            const carried = pendingSelectionRef.current;
            pendingSelectionRef.current = null;
            // A caret only survives a swap within its own document. Across
            // a document change there is nothing to carry: the offsets
            // described text that is no longer on screen.
            if (carried && carried.documentId === documentId) {
                host.setSelection(carried.range);
            }
            setHostGeneration((generation) => generation + 1);
            callbacksRef.current.onReady();
        };

        const reused = cache.get(key);
        if (reused) {
            // The view is intact, with its history and its caret. Only two
            // things can have moved on without it: the Markdown the session
            // holds, and whether the document may be edited.
            root.append(reused.container);
            // The session is the only authority on content. `replaceMarkdown`
            // is a no-op when the surface already holds this Markdown, which is
            // the ordinary case and the one that keeps undo history intact.
            reused.surface.replaceMarkdown(seedMarkdown);
            reused.surface.setEditable(editableRef.current);
            adopt(reused.surface);
            return () => {
                cancelled = true;
                detach(reused.surface, reused.container);
            };
        }

        const container = document.createElement("div");
        // The surface owns this element, so a cached one can be taken out of
        // the document and put back without its view being torn down. It
        // generates no box of its own, so wrapping the view in it leaves the
        // layout the stylesheet describes unchanged.
        container.style.display = "contents";
        root.append(container);

        void createEditingSurface(mode, {
            root: container,
            markdown: seedMarkdown,
            editable,
            readServices,
            onDiagnostic: emitDiagnostic,
            onMarkdownChange: (markdown) => {
                // A detached surface still holds a document and still runs its
                // plugins; what it must not do is speak for a session showing
                // something else.
                if (!isMounted()) return;
                const state = guard.state();
                if (state.documentId !== documentId) return;
                const baseRevision = state.revision;
                guard.recordLocalMarkdown(markdown);
                // Markdown the visual surface itself produced is by construction
                // Markdown the visual surface can hold.
                if (mode === "wysiwyg") recordStableVisual(markdown, baseRevision);
                callbacksRef.current.onChange({
                    documentId,
                    baseRevision,
                    markdown,
                    selection: self.current?.getSelection() ?? null,
                    origin: activeOriginRef.current,
                });
            },
            onSelectionChange: () => {
                if (!isMounted()) return;
                if (guard.state().documentId !== documentId) return;
                callbacksRef.current.onSelectionChange(
                    self.current?.getSelection() ?? null,
                );
            },
            onOpenWikilink: (activation) => {
                if (!isMounted()) return;
                if (guard.state().documentId !== documentId) return;
                callbacksRef.current.onOpenWikilink(activation);
            },
        })
            .then((host) => {
                if (cancelled) {
                    // Built too late to be shown. It was never cached, so
                    // nothing else will destroy it.
                    container.remove();
                    void host.destroy();
                    return;
                }
                self.current = host;
                cache.set(key, { surface: host, container });
                adopt(host);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                emitDiagnostic({
                    code: "editor_init_failed",
                    message:
                        error instanceof Error ? error.message : "editor init failed",
                });
                if (mode !== "wysiwyg") return;
                // A visual surface that cannot be built must not leave the user
                // with no editor at all. The document is still Markdown, and
                // the source surface can always hold it, so the session is
                // asked to show that instead — with the content, dirty state
                // and drafts untouched, and saving still available.
                callbacksRef.current.onModeChange("source");
            });

        return () => {
            cancelled = true;
            detach(created, container);
        };
        // `editable` is applied by its own effect; rebuilding on it would throw
        // away the user's history and selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        documentId,
        mode,
        surfaceEpoch,
        emitDiagnostic,
        guard,
        readServices,
        recordStableVisual,
    ]);

    // Apply incoming snapshots to the live surface.
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const disposition = guard.evaluateSnapshot(snapshot);

        switch (disposition.kind) {
            case "initialize":
            case "replace": {
                // The surface refuses content it cannot build rather than
                // throwing. The snapshot is not committed in that case, so the
                // guard keeps describing what the surface actually holds
                // instead of drifting from it, and the user can still reach
                // source mode with their content intact.
                if (!host.replaceMarkdown(snapshot.markdown)) {
                    emitDiagnostic({
                        code: "unsafe_visual_parse",
                        message:
                            "the incoming document could not be opened visually",
                    });
                    // A build failure poisons this editor's parser: Milkdown
                    // keeps throwing for every later parse on the same
                    // instance, so leaving the surface in place would strand
                    // the user on stale content even after the document is
                    // fixed. The snapshot is committed and the surface rebuilt
                    // from it — a fresh instance parses cleanly, and if the
                    // content is genuinely unbuildable the rebuild fails in
                    // turn and drops to source mode with the content intact.
                    guard.commitSnapshot(snapshot);
                    setSurfaceEpoch((epoch) => epoch + 1);
                    return;
                }
                guard.commitSnapshot(snapshot);
                if (host.mode === "wysiwyg") {
                    recordStableVisual(snapshot.markdown, snapshot.revision);
                }
                return;
            }
            case "confirm":
                // Advance the revision without touching the surface: the user
                // may have typed several more characters since this content was
                // emitted, and replacing would discard them.
                guard.commitConfirmation(snapshot);
                return;
            case "idempotent":
                return;
            case "reject":
                emitDiagnostic({
                    code: "stale_editor_change",
                    message: `snapshot rejected: ${disposition.code}`,
                });
                return;
        }
    }, [snapshot, hostGeneration, emitDiagnostic, guard, recordStableVisual]);

    useEffect(() => {
        hostRef.current?.setEditable(editable);
    }, [editable, hostGeneration]);

    const runSwitch = useCallback(
        async (next: EditorSurfaceMode): Promise<EditorModeChangeResult> => {
            // Asked for the mode already in effect: the surface shows it and
            // nothing is asking for anything else. Both halves are needed. The
            // mounted surface alone lags every switch by a build, so it reports
            // success for a mode the editor is about to leave; the announcement
            // alone cannot tell a session that has not reacted yet from one that
            // never will, and would go on refusing to ask a second time.
            if (
                announcedModeRef.current === next &&
                hostRef.current?.mode === next
            ) {
                return { ok: true };
            }

            // Drain first: the new surface is seeded from the Markdown the
            // guard holds, and a keystroke that has not been emitted yet has
            // not reached the guard. There may be no surface at all — a visual
            // build that failed leaves none — and a switch is still exactly
            // what such a session needs, so nothing here requires one.
            hostRef.current?.flush();

            if (next === "wysiwyg") {
                // The swap mounts what the guard holds, so that is what has to
                // build. A snapshot *or* a local edit landing while the check
                // runs moves it, and a local edit keeps the revision it was
                // made against, so only the content itself can report this.
                //
                // One retry is the bound. If the second check is overtaken too,
                // the build itself is the check: a mount that fails reports
                // `editor_init_failed` and asks the session for source mode, so
                // the user is never left without an editor.
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    const checked = guard.state().markdown;
                    const failure = await preflightVisualBuild(checked);
                    if (failure) {
                        // The user stays in source with their content, dirty
                        // state and drafts untouched, and can still save —
                        // Markdown is the authority either way.
                        const diagnostic: EditorAdapterDiagnostic = {
                            code: "unsafe_visual_parse",
                            message: failure,
                            // The build reports no position of its own, so the
                            // range locates the failure at the source that was
                            // preflighted rather than claiming a narrower spot
                            // that nothing established.
                            range: { anchor: 0, head: checked.length },
                        };
                        emitDiagnostic(diagnostic);
                        return {
                            ok: false,
                            code: "unsafe_visual_parse",
                            diagnostics: [diagnostic],
                        };
                    }
                    if (guard.state().markdown === checked) break;
                }
            }

            // `mode` is controlled, so the caller flips it and the surface
            // follows. Nothing here persists the mode.
            announcedModeRef.current = next;
            callbacksRef.current.onModeChange(next);
            return { ok: true };
        },
        [emitDiagnostic, guard],
    );

    useImperativeHandle(
        ref,
        (): MarkdownEditorAdapterHandle => ({
            focus() {
                hostRef.current?.focus();
            },

            getSelection() {
                return hostRef.current?.getSelection() ?? null;
            },

            setSelection(range) {
                const host = hostRef.current;
                if (!host) return;
                // Validated against the live document, not the last committed
                // snapshot: the snapshot lags by every unconfirmed keystroke.
                if (!isValidSourceRange(host.getMarkdown(), range)) {
                    emitDiagnostic({
                        code: "invalid_source_range",
                        message: "selection range is outside the document",
                    });
                    return;
                }
                if (!host.setSelection(range)) {
                    emitDiagnostic({
                        code: "invalid_source_range",
                        message: "selection range does not resolve to text",
                    });
                }
            },

            async execute(
                command: PinnedEditorCommand,
            ): Promise<EditorCommandResult> {
                const host = hostRef.current;
                if (!host) return { ok: false, code: "stale_document" };

                // Drain before asking the guard. An unemitted keystroke has
                // already moved the text the command's offsets were computed
                // against, and the guard cannot see it until it is reported.
                const markdown = host.getMarkdown();

                const verdict = guard.evaluateCommand(command);
                if (!verdict.ok) return verdict;

                // The command's offsets are into the Markdown of the revision
                // it was pinned to, which is behind what the surface holds by
                // exactly the edits the session has not confirmed. Validate
                // against that text, then carry the offsets across those edits
                // through the surface's own transaction mapping.
                const base = guard.state().revisionMarkdown;
                const pinned = command.range ?? command.selection;
                const needsRange = command.kind !== "focus";
                if (needsRange && pinned && !isValidSourceRange(base, pinned)) {
                    return { ok: false, code: "invalid_range" };
                }
                // `focus` carries a pin it never uses, so nothing about it can
                // be stale enough to refuse.
                let target = pinned;
                if (needsRange && pinned && base !== markdown) {
                    target = host.mapPinnedRange(base, pinned);
                    // No faithful mapping: the text the offsets described is
                    // gone. Writing at the current caret instead would put the
                    // edit somewhere nobody asked for.
                    if (!target) return { ok: false, code: "stale_revision" };
                }

                // Claim the id before applying so a redelivered command can
                // never insert twice.
                if (!guard.consumeCommand(command.commandId)) {
                    return { ok: false, code: "stale_revision" };
                }

                activeOriginRef.current = "command";
                try {
                    switch (command.kind) {
                        case "focus":
                            host.focus();
                            return { ok: true };

                        case "reveal-range": {
                            if (!command.range || !target) {
                                return { ok: false, code: "invalid_range" };
                            }
                            // Reveal, not just select: the caller is an outline
                            // click or a CLI jump, and a caret placed off screen
                            // reads as the command having done nothing.
                            return host.revealRange(target)
                                ? { ok: true }
                                : { ok: false, code: "invalid_range" };
                        }

                        case "replace-selection": {
                            if (!target || command.text === undefined) {
                                return { ok: false, code: "invalid_range" };
                            }
                            const applied = host.replaceSourceRange(
                                target,
                                command.text,
                            );
                            host.flush();
                            return applied
                                ? { ok: true }
                                : { ok: false, code: "invalid_range" };
                        }

                        case "insert-image": {
                            if (!target || !command.image) {
                                return { ok: false, code: "invalid_range" };
                            }
                            // The surface is told an image goes here, not what
                            // characters to type: written as text the visual
                            // surface would escape the brackets and hold a
                            // literal that never renders.
                            const applied = host.insertImage(
                                target,
                                command.image,
                            );
                            host.flush();
                            return applied
                                ? { ok: true }
                                : { ok: false, code: "invalid_range" };
                        }
                    }
                } finally {
                    activeOriginRef.current = "user";
                }
            },

            setMode(next: EditorSurfaceMode): Promise<EditorModeChangeResult> {
                const pending = pendingSwitchRef.current;
                // Holding the shortcut repeats the request, it does not ask for
                // a second switch: the same switch is returned, so no duplicate
                // view is built and the change is reported once.
                if (pending && pending.target === next) return pending.promise;
                const promise = runSwitch(next);
                const entry = { target: next, promise };
                pendingSwitchRef.current = entry;
                void promise
                    .catch(() => undefined)
                    .then(() => {
                        if (pendingSwitchRef.current === entry) {
                            pendingSwitchRef.current = null;
                        }
                    });
                return promise;
            },

            getLastStableVisual() {
                return lastStableVisualRef.current;
            },

            /**
             * Every match for `request` in the mounted surface's document.
             *
             * The search runs over the document's semantic text and returns
             * Markdown source offsets, so what a caller does with a result — a
             * jump, a replace — lands on the source the match came from. It is
             * never a scan of rendered DOM: a Mermaid diagram, KaTeX output and
             * a NodeView's buttons are chrome, not document text, and counting
             * them would report matches the document does not contain and
             * report the ones it does contain twice.
             */
            find(request: EditorFindRequest): EditorFindResult {
                const host = hostRef.current;
                if (!host) return { matches: [], activeMatchId: null };
                const matches: EditorFindMatch[] = host
                    .findMatches(request)
                    .map((range) => ({ id: findMatchId(range), range }));
                if (matches.length === 0) {
                    return { matches, activeMatchId: null };
                }
                // Active is the first match at or after the caret, wrapping to
                // the first: the same match the user would reach by pressing
                // "next" from where they are standing.
                const selection = host.getSelection();
                const from = selection
                    ? Math.min(selection.anchor, selection.head)
                    : 0;
                const active =
                    matches.find((match) => match.range.anchor >= from) ??
                    matches[0];
                return { matches, activeMatchId: active.id };
            },
        }),
        [emitDiagnostic, guard, runSwitch],
    );

    return (
        <div
            ref={rootRef}
            data-mdx-markdown-editor=""
            data-mdx-surface-mode={mode}
            className="mdx-markdown-editor h-full w-full"
        />
    );
});
