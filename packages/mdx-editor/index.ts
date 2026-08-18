/**
 * Stable product entry for Markdown editing.
 *
 * Product and workspace code integrates through this contract only. Milkdown
 * contexts, ProseMirror positions and plugin keys, CodeMirror views, and
 * implementation-private DOM stay inside the package.
 */
export { MarkdownEditorAdapter } from "./adapter/markdown-editor-adapter";
/**
 * How many documents keep their built editing view. Exported so the product's
 * tests can state the bound they rely on rather than restate the number.
 */
export { DEFAULT_SURFACE_CACHE_LIMIT } from "./adapter/surface-cache";
export type {
    DocumentSelectionRange as EditorSourceSelection,
    EditorAdapterDiagnostic,
    EditorChangeEvent,
    EditorChangeOrigin,
    EditorCodeToken,
    EditorCodeTokenizer,
    EditorCommandFailureCode,
    EditorCommandResult,
    EditorDocumentSnapshot,
    EditorFindMatch,
    EditorFindRequest,
    EditorFindResult,
    EditorImageLoader,
    EditorModeChangeResult,
    EditorOutlineEntry,
    EditorReplaceReason,
    EditorSurfaceMode,
    EditorSurfaceServiceReader,
    EditorSurfaceServices,
    EditorLinkActivation,
    EditorLinkLabels,
    EditorWikilinkActivation,
    LastStableVisual,
    MarkdownEditorAdapterHandle,
    MarkdownEditorAdapterProps,
    PinnedEditorCommand,
    PinnedEditorCommandKind,
    PublishingSnapshot,
} from "./adapter/types";

/** Markdown-offset selection, which the product surface builds its pins from. */
export { selectionSnapshotFromMarkdownOffsets } from "./core/selection";

/**
 * Read-only publishing: the only source of a layout module, and the only
 * read-only port built on one. Nothing interactive is reachable from here.
 */
export {
    createReadOnlyPreviewLayoutPort,
    loadLayoutWasmModule,
    type WasmLayoutBridgeModule,
} from "./react";
export type {
    EditorDiagnostic,
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
