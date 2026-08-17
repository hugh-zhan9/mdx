/**
 * Stable product contract for the Markdown editor.
 *
 * Everything crossing this boundary is product semantics expressed in Markdown
 * UTF-16 source offsets. Milkdown contexts, ProseMirror positions and plugin
 * keys, CodeMirror views, and implementation-private DOM never appear here.
 */

export type EditorSurfaceMode = "wysiwyg" | "source";

/** Where the new Markdown came from. Replace reasons never echo back as these. */
export type EditorChangeOrigin = "user" | "command" | "source";

/** Why the caller replaced the document content. Inputs only. */
export type EditorReplaceReason =
    | "open"
    | "clean-reload"
    | "restore"
    | "conflict-resolution";

export interface DocumentSelectionRange {
    /** UTF-16 offset into snapshot.markdown. */
    anchor: number;
    /** UTF-16 offset into snapshot.markdown; direction is preserved. */
    head: number;
}

export interface EditorDocumentSnapshot {
    documentId: string;
    /** Monotonic in-memory revision; never persisted to Markdown or workspace. */
    revision: number;
    markdown: string;
    replaceReason?: EditorReplaceReason;
}

export interface EditorChangeEvent {
    documentId: string;
    baseRevision: number;
    markdown: string;
    selection: DocumentSelectionRange | null;
    origin: EditorChangeOrigin;
}

export type PinnedEditorCommandKind =
    | "focus"
    | "replace-selection"
    | "insert-image"
    | "reveal-range";

/**
 * An image the product asks the editor to insert.
 *
 * It is product semantics, not Markdown: the surface decides how an image is
 * represented in the document it holds. The visual surface inserts an image
 * node; the source surface writes the Markdown that produces one.
 */
export interface EditorImageInsertion {
    src: string;
    alt?: string;
    title?: string;
}

export interface PinnedEditorCommand {
    commandId: string;
    documentId: string;
    baseRevision: number;
    selection: DocumentSelectionRange | null;
    kind: PinnedEditorCommandKind;
    text?: string;
    image?: EditorImageInsertion;
    range?: DocumentSelectionRange;
}

export type EditorCommandFailureCode =
    | "stale_document"
    | "stale_revision"
    | "invalid_range";

export type EditorCommandResult =
    | { ok: true }
    | { ok: false; code: EditorCommandFailureCode };

export type EditorModeChangeResult =
    | { ok: true }
    | {
          ok: false;
          code: "unsafe_visual_parse";
          diagnostics: EditorAdapterDiagnostic[];
      };

/**
 * The last Markdown a visual surface actually presented.
 *
 * It is a derived read-only cache, kept so a refused switch can still show the
 * last stable view and locate its diagnostic. It is never canonical content:
 * the Markdown source is the authority, and this value is never written back
 * over it.
 */
export interface LastStableVisual {
    readonly markdown: string;
    /**
     * The session revision the cached Markdown was derived from — the base the
     * content was built on, not a revision whose content this is.
     *
     * When the surface held edits the session had not confirmed, the Markdown
     * is *ahead* of this revision: those edits keep the revision they were made
     * against until the session confirms them. Both halves are read together
     * from the revision guard, so the pair always describes one moment.
     */
    readonly revision: number;
}

/**
 * A wikilink the user activated, as the document wrote it.
 *
 * Both halves cross the boundary because the syntax layer parsed both, and a
 * caller handed only the target cannot name the link the way the document does:
 * `[[Notes/2026|last week]]` is opened by its target and spoken of by its alias.
 */
export interface EditorWikilinkActivation {
    target: string;
    /** `null` when the source wrote `[[Target]]` rather than `[[Target|alias]]`. */
    alias: string | null;
}

export interface EditorFindRequest {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
}

export interface EditorFindMatch {
    id: string;
    range: DocumentSelectionRange;
}

export interface EditorFindResult {
    matches: EditorFindMatch[];
    activeMatchId: string | null;
}

export interface EditorOutlineEntry {
    id: string;
    level: number;
    text: string;
    range: DocumentSelectionRange;
}

/**
 * Diagnostics never carry document text, selected text, clipboard payloads, or
 * raw HTML. Codes are stable; ranges are Markdown source offsets.
 */
export interface EditorAdapterDiagnostic {
    code: string;
    message: string;
    range?: DocumentSelectionRange;
    syntaxKind?: string;
}

/**
 * Resolves an image reference as the document wrote it into something the
 * surface can display.
 *
 * The document holds what the author typed — `./assets/diagram.png` — which is
 * not a URL any renderer can fetch. Only the product knows what that path is
 * relative to, so the resolution stays with it and the editor is handed the
 * result.
 */
export type EditorImageLoader = (src: string) => Promise<string>;

/**
 * One token of highlighted code.
 *
 * Only the two fields highlighting needs are named. A tokenizer is free to
 * carry more; nothing here interprets a token's grammar, and no highlighting
 * library appears in this contract.
 */
export interface EditorCodeToken {
    type?: string;
    /** The token's own text, or the tokens it is composed of. */
    content?: unknown;
}

/**
 * Splits fenced code into tokens for highlighting.
 *
 * `language` is the fence's info string exactly as the document wrote it. A
 * tokenizer that does not know the language returns the code as one plain
 * token; it never throws, because a fence with an unknown language is a fence
 * that renders unhighlighted, not a document that fails to open.
 */
export type EditorCodeTokenizer = (
    code: string,
    language?: string,
) => Array<string | EditorCodeToken>;

/**
 * Product capabilities the rendered document needs but the editor cannot have.
 *
 * Each one is a question only the product can answer — where a relative asset
 * lives, how a language is tokenized — so the editor asks rather than deciding.
 * Every field is optional: a surface handed none of them still opens the same
 * document, it just renders it plainly.
 */
export interface EditorSurfaceServices {
    imageLoader?: EditorImageLoader;
    codeTokenizer?: EditorCodeTokenizer;
}

/**
 * Reads the services the product currently offers.
 *
 * A reader rather than a value because a surface outlives any one of them: the
 * file a relative path is resolved against changes when the document is
 * renamed, and a surface holding the loader it was built with would go on
 * resolving assets against a path the file no longer has.
 */
export type EditorSurfaceServiceReader = () => EditorSurfaceServices;

export interface MarkdownEditorAdapterHandle {
    focus(): void;
    getSelection(): DocumentSelectionRange | null;
    setSelection(range: DocumentSelectionRange): void;
    execute(command: PinnedEditorCommand): Promise<EditorCommandResult>;
    setMode(mode: EditorSurfaceMode): Promise<EditorModeChangeResult>;
    /** The last stable visual state, or null if no visual surface ever built. */
    getLastStableVisual(): LastStableVisual | null;
    find(request: EditorFindRequest): EditorFindResult;
    /**
     * Paints the find matches, marking one as current.
     *
     * Separate from `find` because the two answer different questions: `find`
     * says where the matches are, this says which of them the user can see. A
     * caller that only counts matches never has to paint them.
     */
    highlightMatches(
        ranges: DocumentSelectionRange[],
        activeIndex: number | null,
    ): void;
}

export interface MarkdownEditorAdapterProps {
    snapshot: EditorDocumentSnapshot;
    mode: EditorSurfaceMode;
    editable: boolean;
    /** Capabilities the rendered document needs from the product. */
    services?: EditorSurfaceServices;
    onChange(event: EditorChangeEvent): void;
    onSelectionChange(selection: DocumentSelectionRange | null): void;
    onModeChange(mode: EditorSurfaceMode): void;
    onDiagnostic(diagnostic: EditorAdapterDiagnostic): void;
    onOpenWikilink(activation: EditorWikilinkActivation): void;
    onReady(): void;
}

/** Immutable content handed to publishing. It carries no editor capability. */
export interface PublishingSnapshot {
    documentId: string;
    revision: number;
    markdown: string;
}
