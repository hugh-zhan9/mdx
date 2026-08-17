/**
 * Read-only publishing contract.
 *
 * Publishing consumes one immutable `{documentId, revision, markdown}` and
 * produces a preview model or a PDF. Nothing declared here can reach an editor
 * session: there is no handle, no dirty or draft setter, no selection, and no
 * hit-test capability anywhere in these types, and the layout snapshot shape
 * publishing accepts has no place to carry caret anchors, selection geometry or
 * hit-test entries even if a layout engine produced them.
 *
 * The only symbol this module reads from the adapter is the `PublishingSnapshot`
 * type itself, and it is imported as a type so no adapter module is present in
 * the publishing runtime graph.
 */

import type { PublishingSnapshot } from "../adapter/types";

export type { PublishingSnapshot };

/** Emphasis a run of text carries. Presentation, not geometry. */
export type PublishingEmphasis = "strong" | "emphasis" | "strike";

export type PublishingInlineKind =
    | "text"
    | "link"
    | "image"
    | "code"
    | "math"
    | "break";

export interface PublishingInline {
    kind: PublishingInlineKind;
    /** Human-visible text. Empty for images and breaks. */
    text: string;
    /** Link destination for `link`, image source for `image`. */
    target?: string;
    /** Alternative text for `image`. */
    alt?: string;
    title?: string;
    emphasis?: PublishingEmphasis[];
}

export type PublishingHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface PublishingHeadingBlock {
    kind: "heading";
    level: PublishingHeadingLevel;
    inlines: PublishingInline[];
}

export interface PublishingParagraphBlock {
    kind: "paragraph";
    inlines: PublishingInline[];
}

export interface PublishingQuoteBlock {
    kind: "quote";
    inlines: PublishingInline[];
}

export interface PublishingListItemBlock {
    kind: "list_item";
    ordered: boolean;
    depth: number;
    /** Task-list state, or null when the item is not a task. */
    checked: boolean | null;
    inlines: PublishingInline[];
}

export interface PublishingCodeBlock {
    kind: "code";
    /** Fence info string, or an empty string when the fence carried none. */
    language: string;
    text: string;
}

export interface PublishingMathBlock {
    kind: "math";
    text: string;
}

export interface PublishingTableRowBlock {
    kind: "table_row";
    header: boolean;
    cells: PublishingInline[][];
}

export interface PublishingThematicBreakBlock {
    kind: "thematic_break";
}

export interface PublishingHtmlBlock {
    kind: "html";
    text: string;
}

export interface PublishingFrontmatterBlock {
    kind: "frontmatter";
    text: string;
}

export type PublishingBlock =
    | PublishingHeadingBlock
    | PublishingParagraphBlock
    | PublishingQuoteBlock
    | PublishingListItemBlock
    | PublishingCodeBlock
    | PublishingMathBlock
    | PublishingTableRowBlock
    | PublishingThematicBreakBlock
    | PublishingHtmlBlock
    | PublishingFrontmatterBlock;

export interface PublishingContent {
    blocks: PublishingBlock[];
}

/**
 * A read-only preview of one captured revision.
 *
 * It reports what the screen shows as content, and it identifies the revision
 * it was built from. It carries no caret, no selection and no hit-test data.
 */
export interface PublishingPreview {
    documentId: string;
    revision: number;
    blocks: PublishingBlock[];
}

/**
 * Publishing failure codes.
 *
 * Every one of these is returned to the publishing caller. None of them implies
 * a compensating write anywhere else, and none of them is satisfied by a
 * different output than the one that was asked for.
 */
export type PublishingErrorCode =
    | "invalid_snapshot"
    | "invalid_output_path"
    | "layout_timeout"
    | "layout_failed"
    | "image_read_failed"
    | "font_failed"
    | "output_path_denied"
    | "revision_mismatch"
    | "export_failed";

export interface PublishingError {
    code: PublishingErrorCode;
    message: string;
}

export type PublishingOutcome<TValue> =
    | {
          ok: true;
          documentId: string;
          revision: number;
          value: TValue;
          warnings: string[];
      }
    | {
          ok: false;
          documentId: string;
          revision: number;
          error: PublishingError;
      };

export interface PublishingExportOutput {
    outputPath: string;
    pageCount: number;
    /** The cache/request identity this export was issued under. */
    requestKey: string;
}

export interface PublishingViewport {
    width: number;
    height: number;
}

export interface PublishingLayoutInlineRun {
    text: string;
    kind: PublishingInlineKind;
    /** Link destination when the run is a link, otherwise null. */
    link: string | null;
    /** Image source when the run is an image, otherwise null. */
    src: string | null;
    emphasis: PublishingEmphasis[];
    code: boolean;
}

export interface PublishingLayoutBlock {
    blockId: string;
    kind: PublishingBlock["kind"];
    /** Heading level, or list nesting depth. Zero elsewhere. */
    level: number;
    /** Whether a list item belongs to an ordered list. */
    ordered: boolean;
    /** Task-list state of a list item, or null when it is not a task. */
    checked: boolean | null;
    /** Whether a table row is the header row. */
    header: boolean;
    language: string;
    text: string;
    inlines: PublishingLayoutInlineRun[];
    /** Table row cells. Empty for every other block kind. */
    cells: PublishingLayoutInlineRun[][];
}

/**
 * The document publishing hands a layout engine.
 *
 * It is addressed by document and revision and describes content only. There
 * are no editor positions in it, so a layout engine cannot map a result back
 * onto an editor document.
 */
export interface PublishingLayoutDocument {
    documentId: string;
    revision: number;
    viewport: PublishingViewport;
    blocks: PublishingLayoutBlock[];
    styleContext: {
        defaultFontSize: number;
        defaultFontFamily: string;
        defaultLineHeight: number;
        viewportWidth: number;
        viewportHeight: number;
    };
}

export interface PublishingLayoutTextRun {
    blockId: string;
    left: number;
    baseline: number;
    width: number;
    height: number;
    fontFamily: string;
    fontSize: number;
    text: string;
    link?: string | null;
}

export interface PublishingLayoutLine {
    id: string;
    blockId: string;
    y: number;
    baseline: number;
    height: number;
    textRuns: PublishingLayoutTextRun[];
}

export interface PublishingLayoutDrawOp {
    blockId: string;
    kind: "Math" | "TableGrid" | "CodeHighlight" | "Image" | "Mermaid" | "Html" | "Fallback" | "Decoration";
    x: number;
    y: number;
    width: number;
    height: number;
    /** Draw payload, serialized exactly as the exporter reads it. */
    data: string;
}

/**
 * What a layout engine may return to publishing.
 *
 * Deliberately narrower than the interactive layout snapshot: there is no
 * field for hit-test entries, caret anchors or selection geometry, so a layout
 * engine cannot hand publishing interactive geometry through this port.
 */
export interface PublishingLayoutSnapshot {
    revision: number;
    lines: PublishingLayoutLine[];
    canvasDrawOps: PublishingLayoutDrawOp[];
}

export interface PublishingLayoutPort {
    layout(request: PublishingLayoutDocument): Promise<PublishingLayoutSnapshot>;
}

export interface PublishingPageSetup {
    widthPt: number;
    heightPt: number;
    marginTopPt: number;
    marginRightPt: number;
    marginBottomPt: number;
    marginLeftPt: number;
    fontEmbedMode: string;
}

/**
 * The exact payload the native exporter receives.
 *
 * `requestKey` is the cache identity of the request and always names both the
 * document and the revision the output corresponds to.
 */
export interface PublishingPdfPayload {
    requestKey: string;
    rootPath: string;
    documentId: string;
    revision: number;
    layoutDocumentJson: string;
    layoutSnapshotJson: string;
    outputPath: string;
    page: PublishingPageSetup;
}

export type PublishingPdfTransportResult =
    | { ok: true; pageCount: number; warnings: string[] }
    | { ok: false; error: PublishingError };

export interface PublishingPdfTransport {
    export(payload: PublishingPdfPayload): Promise<PublishingPdfTransportResult>;
}

export interface PublishingExportRequest {
    snapshot: PublishingSnapshot;
    rootPath: string;
    outputPath: string;
    viewport: PublishingViewport;
    page: PublishingPageSetup;
    layout: PublishingLayoutPort;
    transport: PublishingPdfTransport;
    /** Wall-clock budget for the layout stage. */
    layoutTimeoutMs: number;
}
