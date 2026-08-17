import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ChangeSet, Compartment, EditorState, MapMode } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
    findHighlightExtension,
    setSourceFindHighlights,
    type SourceFindHighlight,
} from "./find-highlight";
import type { MarkdownAnalyzer } from "../milkdown/markdown-analyzer";
import {
    MIXED_LINE_ENDINGS_DIAGNOSTIC,
    fromLineFeeds,
    fromNormalizedOffset,
    readLineEndingStyle,
    toLineFeeds,
    toNormalizedOffset,
    type LineEndingStyle,
} from "../adapter/line-endings";
import { findSemanticMatches } from "../adapter/semantic-find";
import {
    alignOffsetToCharacterBoundary,
    isValidSourceRange,
} from "../adapter/source-offsets";
import type {
    DocumentSelectionRange,
    EditorAdapterDiagnostic,
    EditorFindRequest,
} from "../adapter/types";

/**
 * How far below the top of the viewport a revealed line comes to rest.
 *
 * Enough to leave the preceding lines visible, so a jump reads as arriving
 * somewhere rather than as the document having moved.
 */
const REVEAL_TOP_MARGIN_PX = 96;

export interface SourceEditorHostOptions {
    root: HTMLElement;
    markdown: string;
    editable: boolean;
    /** Fires once per batch of document-changing transactions. */
    onMarkdownChange(markdown: string): void;
    /** Fires when the selection moves without changing the document. */
    onSelectionChange(): void;
    /** Structured failure reports. Never carries document text. */
    onDiagnostic?(diagnostic: EditorAdapterDiagnostic): void;
    /**
     * Reads Markdown into the document the syntax layer builds from it.
     *
     * Find searches the document's text, and this surface holds Markdown rather
     * than a document. Without an analyzer it has nothing to search and says
     * so, instead of searching the Markdown — which would make a query mean one
     * thing here and another in WYSIWYG.
     */
    analyzer?: MarkdownAnalyzer;
    /**
     * Defers change emission off the input path. Defaults to a microtask.
     * `flush()` always drains pending work synchronously regardless.
     */
    scheduleChangeEmission?: (emit: () => void) => void;
}

/**
 * The Markdown source surface.
 *
 * It presents the same shape as the WYSIWYG host so the adapter can drive
 * either one without knowing which is mounted. There is no offset mapping to
 * do here: CodeMirror's own document positions are UTF-16 offsets into the
 * Markdown, which is exactly the coordinate space the product contract uses.
 *
 * This surface owns no file state. It edits a projection of the session's
 * canonical Markdown and reports changes; dirty, drafts, conflicts and saving
 * stay with the session, and there is no second save path.
 */
export interface SourceEditorHost {
    getMarkdown(): string;
    getSelection(): DocumentSelectionRange | null;
    setSelection(range: DocumentSelectionRange): boolean;
    /** Applies a selection and scrolls it to the top of the viewport. */
    revealRange(range: DocumentSelectionRange): boolean;
    /** Paints the find matches. Decoration only; never enters the text. */
    setFindHighlights(
        ranges: DocumentSelectionRange[],
        activeIndex: number | null,
    ): void;
    /** Replaces the whole document for an explicit external replace. */
    replaceMarkdown(markdown: string): boolean;
    setEditable(editable: boolean): void;
    focus(): void;
    replaceSourceRange(range: DocumentSelectionRange, text: string): boolean;
    /**
     * Every match for `request`, in document order, as source ranges.
     *
     * The search is over the document's semantic text, exactly as it is on the
     * visual surface, so the same query returns the same matches whichever view
     * is mounted. This surface shows the Markdown, but the Markdown is a
     * spelling of the document, not the document: `**` around a bold word, a
     * link's destination and an inline formula's LaTeX are on screen here and
     * are still not text the reader is searching.
     */
    findMatches(request: EditorFindRequest): DocumentSelectionRange[];
    /**
     * Maps a range pinned against `baseMarkdown` onto the document as it stands
     * now, or null when no faithful mapping exists.
     *
     * The mapping is CodeMirror's own: every local transaction since the
     * document held `baseMarkdown` contributes its `ChangeSet`, and the pinned
     * offsets are carried through them in order. A pin whose text was deleted,
     * or whose base state this surface never held — because an external replace
     * discarded the history, or the surface was rebuilt — has no faithful
     * answer and gets null rather than a nearby guess.
     */
    mapPinnedRange(
        baseMarkdown: string,
        range: DocumentSelectionRange,
    ): DocumentSelectionRange | null;
    /** Emits any pending change synchronously. Safe to call when idle. */
    flush(): void;
    isDestroyed(): boolean;
    destroy(): void;
}

/**
 * How many emitted document states stay mappable for pinned commands.
 *
 * A pin is only ever mapped from a state the session has not confirmed yet, and
 * the revision guard keeps exactly that many unconfirmed emissions, so matching
 * its budget means the surface can answer for every pin the guard will admit.
 */
const PIN_CHECKPOINT_LIMIT = 64;

/** A document state a pinned range may be mapped forward from. */
interface PinCheckpoint {
    /** The Markdown the document held at this point. */
    markdown: string;
    /** Position in the change stream at which this state began. */
    changeIndex: number;
}

export function createSourceEditorHost(
    options: SourceEditorHostOptions,
): SourceEditorHost {
    const {
        root,
        markdown: initialMarkdown,
        editable,
        onMarkdownChange,
        onSelectionChange,
        onDiagnostic,
        analyzer,
        scheduleChangeEmission = (emit) => queueMicrotask(emit),
    } = options;

    let currentMarkdown = initialMarkdown;
    /**
     * The line ending this document is written with.
     *
     * CodeMirror holds one character per line break whatever arrived, so the
     * style is read from the incoming Markdown and applied again on the way
     * out. Nothing in between ever holds a carriage return.
     */
    let lineEnding: LineEndingStyle = "lf";
    let destroyed = false;
    /** Suppresses change callbacks while the host itself replaces content. */
    let applyingExternalReplace = false;
    let changePending = false;
    let emissionScheduled = false;
    /** Local transactions, in order, since `changeBase`. */
    let changeLog: ChangeSet[] = [];
    /** Stream position of `changeLog[0]`, so trimming never renumbers a checkpoint. */
    let changeBase = 0;
    let checkpoints: PinCheckpoint[] = [
        { markdown: initialMarkdown, changeIndex: 0 },
    ];

    const editableCompartment = new Compartment();

    /**
     * Adopts `markdown`'s line ending, reporting a mixed-ending file once.
     *
     * Reading it here — at the two points a document arrives — is what makes
     * the report happen once per document rather than once per keystroke.
     */
    function adoptLineEnding(markdown: string): void {
        const reading = readLineEndingStyle(markdown);
        lineEnding = reading.style;
        if (reading.mixed) onDiagnostic?.({ ...MIXED_LINE_ENDINGS_DIAGNOSTIC });
    }

    adoptLineEnding(initialMarkdown);

    /** Starts the pin history over at `markdown`, discarding what came before. */
    function resetPinHistory(markdown: string): void {
        changeLog = [];
        changeBase = 0;
        checkpoints = [{ markdown, changeIndex: 0 }];
    }

    function recordCheckpoint(markdown: string): void {
        checkpoints.push({
            markdown,
            changeIndex: changeBase + changeLog.length,
        });
        if (checkpoints.length <= PIN_CHECKPOINT_LIMIT) return;
        checkpoints = checkpoints.slice(-PIN_CHECKPOINT_LIMIT);
        const oldest = checkpoints[0].changeIndex;
        changeLog = changeLog.slice(oldest - changeBase);
        changeBase = oldest;
    }

    function emitPendingChange(): void {
        emissionScheduled = false;
        if (!changePending || destroyed) return;
        changePending = false;
        // The one place a line ending is written: the document CodeMirror holds
        // is `\n` throughout, and the file's own ending goes back on here.
        const next = fromLineFeeds(view.state.doc.toString(), lineEnding);
        if (next === currentMarkdown) return;
        currentMarkdown = next;
        recordCheckpoint(next);
        onMarkdownChange(next);
    }

    function flush(): void {
        if (destroyed) return;
        emitPendingChange();
    }

    /**
     * Maps a Markdown source offset onto a position in the CodeMirror document.
     *
     * The skew between the two coordinate spaces is owned by the line-ending
     * module; all this adds is the document's own bound.
     */
    function documentOffsetIn(
        markdown: string,
        sourceOffset: number,
    ): number | null {
        return toNormalizedOffset(
            markdown,
            alignOffsetToCharacterBoundary(markdown, sourceOffset),
        );
    }

    function toDocumentOffset(sourceOffset: number): number | null {
        const documentOffset = documentOffsetIn(currentMarkdown, sourceOffset);
        if (documentOffset === null) return null;
        return documentOffset > view.state.doc.length ? null : documentOffset;
    }

    /** Maps a CodeMirror position back to an offset into the session's Markdown. */
    function toSourceOffset(documentOffset: number): number {
        return fromNormalizedOffset(currentMarkdown, documentOffset);
    }

    /**
     * Carries `position` through every local change recorded since `from`.
     *
     * Each change is applied in turn rather than composed, so a position the
     * intervening edits deleted is caught at the step that deleted it instead of
     * disappearing into a composition that only reports the net effect.
     */
    function mapThroughChanges(
        from: number,
        position: number,
        assoc: number,
        mode: MapMode,
    ): number | null {
        const start = from - changeBase;
        if (start < 0 || start > changeLog.length) return null;
        let mapped = position;
        for (let index = start; index < changeLog.length; index += 1) {
            // `MapMode.TrackDel` answers null for a position whose content this
            // change removed, which is the whole point of asking per change.
            const next = changeLog[index].mapPos(mapped, assoc, mode);
            if (next === null) return null;
            mapped = next;
        }
        return mapped;
    }

    const view = new EditorView({
        parent: root,
        state: EditorState.create({
            doc: toLineFeeds(initialMarkdown),
            extensions: [
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                markdown(),
                findHighlightExtension(),
                EditorView.lineWrapping,
                editableCompartment.of(EditorView.editable.of(editable)),
                EditorView.updateListener.of((update) => {
                    if (applyingExternalReplace) return;
                    if (update.docChanged) {
                        changeLog.push(update.changes);
                        changePending = true;
                        if (emissionScheduled) return;
                        emissionScheduled = true;
                        scheduleChangeEmission(emitPendingChange);
                        return;
                    }
                    if (update.selectionSet) onSelectionChange();
                }),
            ],
        }),
    });

    /**
     * Places the selection, optionally scrolling to it.
     *
     * CodeMirror can be told where to land, so a revealed range is put at the
     * top of the viewport with a margin rather than merely made visible: a
     * heading that stops at the very bottom edge looks like the jump missed.
     */
    function applySelection(
        range: DocumentSelectionRange,
        reveal: boolean,
    ): boolean {
        if (destroyed) return false;
        flush();
        if (!isValidSourceRange(currentMarkdown, range)) return false;
        const anchor = toDocumentOffset(range.anchor);
        const head = toDocumentOffset(range.head);
        if (anchor === null || head === null) return false;
        view.dispatch({
            selection: { anchor, head },
            ...(reveal
                ? {
                      effects: EditorView.scrollIntoView(anchor, {
                          y: "start",
                          yMargin: REVEAL_TOP_MARGIN_PX,
                      }),
                  }
                : {}),
        });
        return true;
    }

    return {
        getMarkdown() {
            flush();
            return currentMarkdown;
        },

        getSelection() {
            if (destroyed) return null;
            flush();
            const { anchor, head } = view.state.selection.main;
            return {
                anchor: alignOffsetToCharacterBoundary(
                    currentMarkdown,
                    toSourceOffset(anchor),
                ),
                head: alignOffsetToCharacterBoundary(
                    currentMarkdown,
                    toSourceOffset(head),
                ),
            };
        },

        setSelection(range) {
            return applySelection(range, false);
        },

        revealRange(range) {
            return applySelection(range, true);
        },

        setFindHighlights(ranges, activeIndex) {
            if (destroyed) return;
            const highlights: SourceFindHighlight[] = [];
            ranges.forEach((range, index) => {
                const from = toDocumentOffset(range.anchor);
                const to = toDocumentOffset(range.head);
                if (from === null || to === null) return;
                highlights.push({
                    from: Math.min(from, to),
                    to: Math.max(from, to),
                    active: index === activeIndex,
                });
            });
            view.dispatch({ effects: setSourceFindHighlights.of(highlights) });
        },

        replaceMarkdown(markdown) {
            if (destroyed) return false;
            // Hand any unemitted keystroke to the session before overwriting it,
            // and so the no-op check below compares against what the surface
            // actually holds.
            emitPendingChange();
            if (markdown === currentMarkdown) return true;
            adoptLineEnding(markdown);
            applyingExternalReplace = true;
            try {
                view.dispatch({
                    changes: {
                        from: 0,
                        to: view.state.doc.length,
                        insert: toLineFeeds(markdown),
                    },
                });
                currentMarkdown = markdown;
                changePending = false;
                // An external replace is a new document state the session
                // declared, not an edit anything can be mapped across: a pin
                // taken before it describes text that is gone.
                resetPinHistory(markdown);
            } finally {
                applyingExternalReplace = false;
            }
            return true;
        },

        setEditable(nextEditable) {
            if (destroyed) return;
            view.dispatch({
                effects: editableCompartment.reconfigure(
                    EditorView.editable.of(nextEditable),
                ),
            });
        },

        focus() {
            if (!destroyed) view.focus();
        },

        replaceSourceRange(range, text) {
            if (destroyed) return false;
            flush();
            if (!isValidSourceRange(currentMarkdown, range)) return false;
            const from = toDocumentOffset(Math.min(range.anchor, range.head));
            const to = toDocumentOffset(Math.max(range.anchor, range.head));
            if (from === null || to === null) return false;
            // Inserted text joins the document, which holds `\n` throughout:
            // a carriage return let in here would come back doubled on the way
            // out of a CRLF file.
            view.dispatch({ changes: { from, to, insert: toLineFeeds(text) } });
            return true;
        },

        findMatches(request) {
            if (destroyed) return [];
            flush();
            // The document's text, not the Markdown that spells it: the `**`
            // around a bold word, a link's destination and an inline formula's
            // LaTeX are not text the reader is looking at, and matching them
            // here would make find mean something different in this view than
            // in the other one.
            const analysis = analyzer?.analyze(view.state.doc.toString());
            if (!analysis) {
                onDiagnostic?.({
                    code: "editor_semantic_text_unavailable",
                    message:
                        "the document's text could not be read, so find has nothing to search",
                });
                return [];
            }
            const { ranges, unplaced } = findSemanticMatches(
                analysis.doc,
                analysis.map,
                request,
            );
            // A match with no faithful source range is dropped, never reported
            // at a guessed offset — and the caller is told the result is short.
            if (unplaced) {
                onDiagnostic?.({
                    code: "editor_position_unmapped",
                    message:
                        "no faithful mapping exists between this position and the markdown",
                });
            }
            return ranges.map((range) => ({
                anchor: alignOffsetToCharacterBoundary(
                    currentMarkdown,
                    fromNormalizedOffset(currentMarkdown, range.anchor),
                ),
                head: alignOffsetToCharacterBoundary(
                    currentMarkdown,
                    fromNormalizedOffset(currentMarkdown, range.head),
                ),
            }));
        },

        mapPinnedRange(baseMarkdown, range) {
            if (destroyed) return null;
            flush();
            if (!isValidSourceRange(baseMarkdown, range)) return null;

            // The newest state matching the pin's base: identical Markdown
            // means identical offsets, so the latest one is the same answer
            // reached across the fewest changes.
            let index = -1;
            for (let step = checkpoints.length - 1; step >= 0; step -= 1) {
                if (checkpoints[step].markdown === baseMarkdown) {
                    index = step;
                    break;
                }
            }
            if (index < 0) return null;
            const { changeIndex } = checkpoints[index];

            const anchorDoc = documentOffsetIn(baseMarkdown, range.anchor);
            const headDoc = documentOffsetIn(baseMarkdown, range.head);
            if (anchorDoc === null || headDoc === null) return null;

            // A collapsed pin is an insertion point: it has no text to lose, so
            // it maps wherever the changes carry it, and text typed at that
            // exact spot lands after it rather than dragging it along — the pin
            // names where the caller pointed, not where the caret has got to.
            // A pin with a range must still cover its own text, so each edge
            // watches the side the range's content is on:
            // the leading edge refuses when what followed it was deleted, the
            // trailing edge when what preceded it was.
            const collapsed = anchorDoc === headDoc;
            const forward = anchorDoc < headDoc;
            const leading = collapsed
                ? MapMode.Simple
                : MapMode.TrackAfter;
            const trailing = collapsed
                ? MapMode.Simple
                : MapMode.TrackBefore;

            const anchor = mapThroughChanges(
                changeIndex,
                anchorDoc,
                collapsed ? -1 : forward ? 1 : -1,
                forward ? leading : trailing,
            );
            const head = mapThroughChanges(
                changeIndex,
                headDoc,
                collapsed ? -1 : forward ? -1 : 1,
                forward ? trailing : leading,
            );
            if (anchor === null || head === null) return null;
            // An edge that overtook the other no longer describes the pin.
            if (forward ? anchor > head : head > anchor) return null;

            return {
                anchor: fromNormalizedOffset(currentMarkdown, anchor),
                head: fromNormalizedOffset(currentMarkdown, head),
            };
        },

        flush,

        isDestroyed() {
            return destroyed;
        },

        destroy() {
            if (destroyed) return;
            // Drain before the view goes away so a mode switch or tab change
            // never loses the last keystrokes.
            emitPendingChange();
            destroyed = true;
            view.destroy();
        },
    };
}
