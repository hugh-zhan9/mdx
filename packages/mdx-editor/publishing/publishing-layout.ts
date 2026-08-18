/**
 * Turning captured content into what a layout engine and the native exporter
 * receive.
 *
 * The payload built here is the only thing that crosses into Rust. It carries
 * the document and revision it was captured for, the content semantics, and the
 * geometry the layout engine produced for that content. It never carries
 * hit-test entries, caret anchors or selection geometry: those arrays are
 * written empty, so no interactive geometry reaches the export path even if a
 * layout engine computed some.
 */

import { publishingRequestKey } from "./publishing-snapshot";
import type {
    PublishingContent,
    PublishingEmphasis,
    PublishingInline,
    PublishingLayoutBlock,
    PublishingLayoutDocument,
    PublishingLayoutInlineRun,
    PublishingLayoutSnapshot,
    PublishingPageSetup,
    PublishingPdfPayload,
    PublishingSnapshot,
    PublishingViewport,
} from "./types";

const DEFAULT_FONT_FAMILY = "Helvetica";
/** Body size in points, matching what the layout port sets on each block. */
const DEFAULT_FONT_SIZE = 11;
const DEFAULT_LINE_HEIGHT = 1.5;

export function buildPublishingLayoutDocument(
    snapshot: PublishingSnapshot,
    content: PublishingContent,
    viewport: PublishingViewport,
): PublishingLayoutDocument {
    return {
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        viewport: { width: viewport.width, height: viewport.height },
        blocks: content.blocks.map((block, index) => toLayoutBlock(block, index)),
        styleContext: {
            defaultFontSize: DEFAULT_FONT_SIZE,
            defaultFontFamily: DEFAULT_FONT_FAMILY,
            defaultLineHeight: DEFAULT_LINE_HEIGHT,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
        },
    };
}

function toLayoutBlock(
    block: PublishingContent["blocks"][number],
    index: number,
): PublishingLayoutBlock {
    const base = {
        blockId: `${block.kind}-${index}`,
        kind: block.kind,
        level: 0,
        ordered: false,
        checked: null as boolean | null,
        header: false,
        language: "",
        text: "",
        inlines: [] as PublishingLayoutInlineRun[],
        cells: [] as PublishingLayoutInlineRun[][],
    };

    switch (block.kind) {
        case "heading":
            return { ...base, level: block.level, inlines: toRuns(block.inlines) };
        case "paragraph":
        case "quote":
            return { ...base, inlines: toRuns(block.inlines) };
        case "list_item":
            return {
                ...base,
                level: block.depth,
                ordered: block.ordered,
                checked: block.checked,
                inlines: toRuns(block.inlines),
            };
        case "code":
            return { ...base, language: block.language, text: block.text };
        case "math":
            return { ...base, text: block.text };
        case "table_row":
            return {
                ...base,
                header: block.header,
                cells: block.cells.map((cell) => toRuns(cell)),
            };
        case "thematic_break":
            return base;
        case "html":
        case "frontmatter":
            return { ...base, text: block.text };
    }
}

function toRuns(inlines: PublishingInline[]): PublishingLayoutInlineRun[] {
    return inlines.map((inline) => ({
        text: inline.kind === "image" ? (inline.alt ?? "") : inline.text,
        kind: inline.kind,
        link: inline.kind === "link" ? (inline.target ?? "") : null,
        src: inline.kind === "image" ? (inline.target ?? "") : null,
        emphasis: [...(inline.emphasis ?? [])] as PublishingEmphasis[],
        code: inline.kind === "code",
    }));
}

export interface PublishingPdfPayloadInput {
    snapshot: PublishingSnapshot;
    rootPath: string;
    outputPath: string;
    page: PublishingPageSetup;
    layoutDocument: PublishingLayoutDocument;
    layoutSnapshot: PublishingLayoutSnapshot;
}

export function buildPublishingPdfPayload(
    input: PublishingPdfPayloadInput,
): PublishingPdfPayload {
    return {
        requestKey: publishingRequestKey(input.snapshot),
        rootPath: input.rootPath,
        documentId: input.snapshot.documentId,
        revision: input.snapshot.revision,
        layoutDocumentJson: JSON.stringify(input.layoutDocument),
        layoutSnapshotJson: JSON.stringify(
            toNativeLayoutSnapshot(input.layoutSnapshot),
        ),
        outputPath: input.outputPath,
        page: input.page,
    };
}

/**
 * The exporter's snapshot wire shape.
 *
 * The interactive arrays are always empty here. Publishing has no use for them
 * and the exporter must not receive a way to address a caret or a selection.
 */
function toNativeLayoutSnapshot(snapshot: PublishingLayoutSnapshot) {
    return {
        revision: snapshot.revision,
        lines: snapshot.lines.map((line) => ({
            id: line.id,
            blockId: line.blockId,
            y: line.y,
            baseline: line.baseline,
            height: line.height,
            textRuns: line.textRuns.map((run) => ({
                blockId: run.blockId,
                left: run.left,
                baseline: run.baseline,
                width: run.width,
                height: run.height,
                fontFamily: run.fontFamily,
                fontSize: run.fontSize,
                text: run.text,
                style: {
                    bold: false,
                    italic: false,
                    code: false,
                    link: run.link ?? null,
                    strike: false,
                    underline: false,
                },
            })),
        })),
        canvasDrawOps: snapshot.canvasDrawOps.map((op) => ({
            blockId: op.blockId,
            kind: op.kind,
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            data: op.data,
        })),
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks: [],
    };
}

/**
 * Reads the semantics back out of the payload that will reach the exporter.
 *
 * This deliberately re-parses the serialized JSON rather than reusing the
 * objects it was built from, so comparing it against the preview compares what
 * the exporter is actually told, not what publishing meant to tell it.
 */
export function publishingPayloadDigest(
    payload: PublishingPdfPayload,
): string[] {
    const document = JSON.parse(
        payload.layoutDocumentJson,
    ) as PublishingLayoutDocument;
    const tokens: string[] = [];

    for (const block of document.blocks) {
        switch (block.kind) {
            case "heading":
                tokens.push(`heading:${block.level}`);
                pushRunTokens(tokens, block.inlines);
                break;
            case "paragraph":
                tokens.push("paragraph");
                pushRunTokens(tokens, block.inlines);
                break;
            case "quote":
                tokens.push("quote");
                pushRunTokens(tokens, block.inlines);
                break;
            case "list_item":
                tokens.push(
                    `list_item:${block.ordered ? "ordered" : "bullet"}:${block.level}:${
                        block.checked === null ? "none" : String(block.checked)
                    }`,
                );
                pushRunTokens(tokens, block.inlines);
                break;
            case "code":
                tokens.push(`code:${block.language}=${block.text}`);
                break;
            case "math":
                tokens.push(`math=${block.text}`);
                break;
            case "table_row":
                tokens.push(`table_row:${block.header ? "header" : "body"}`);
                for (const cell of block.cells) {
                    tokens.push("table_cell");
                    pushRunTokens(tokens, cell);
                }
                break;
            case "thematic_break":
                tokens.push("thematic_break");
                break;
            case "html":
                tokens.push(`html=${block.text}`);
                break;
            case "frontmatter":
                tokens.push(`frontmatter=${block.text}`);
                break;
        }
    }

    return tokens;
}

function pushRunTokens(
    tokens: string[],
    runs: PublishingLayoutInlineRun[],
): void {
    for (const run of runs) {
        const emphasis =
            run.emphasis.length > 0
                ? `[${[...run.emphasis].sort().join("+")}]`
                : "";

        switch (run.kind) {
            case "text":
                tokens.push(`text${emphasis}=${run.text}`);
                break;
            case "link":
                tokens.push(`link${emphasis}=${run.link ?? ""}|${run.text}`);
                break;
            case "image":
                tokens.push(`image=${run.src ?? ""}|${run.text}`);
                break;
            case "code":
                tokens.push(`inline_code${emphasis}=${run.text}`);
                break;
            case "math":
                tokens.push(`inline_math${emphasis}=${run.text}`);
                break;
            case "break":
                tokens.push("break");
                break;
        }
    }
}
