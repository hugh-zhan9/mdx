export type {
    EditorDiagnostic,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
export type {
    MarkdownNodeKind,
    MarkdownNodeMetadata,
} from "./core/markdown-nodes";
export { originalSliceForRange, sourceRange } from "./core/source-map";
