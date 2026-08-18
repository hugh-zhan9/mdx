/**
 * The only path from publishing to the WASM layout engine.
 *
 * Publishing owns no layout engine. It declares a port that takes a content
 * document and returns lines and draw ops, and this module is the read-only
 * implementation of that port on top of the existing WASM bridge.
 *
 * Two things make it read-only, and both are enforced here rather than by
 * convention:
 *
 * - It calls exactly one bridge entry point, `initialize`. The bridge no longer
 *   offers an interactive one: hit-testing and selection geometry left with the
 *   interactive editor, so no interactive query can be issued through this port
 *   — or through the bridge at all.
 * - It drops every interactive field the artifact returns. Hit-test entries,
 *   caret anchors, selection geometry and mirror blocks do not appear in the
 *   publishing layout snapshot type, and are discarded here rather than being
 *   carried forward for someone to reach for later.
 */

import type {
    PublishingLayoutBlock,
    PublishingLayoutDocument,
    PublishingLayoutDrawOp,
    PublishingLayoutPort,
    PublishingLayoutSnapshot,
} from "../publishing";
import type { LayoutBlock, LayoutDocument, LayoutInlineRun } from "../layout-ir";
import { createLayoutBridge, type LayoutBridgeModule } from "./wasm-layout-bridge";

const BLOCK_KIND: Record<PublishingLayoutBlock["kind"], LayoutBlock["kind"]> = {
    heading: "heading",
    paragraph: "paragraph",
    quote: "paragraph",
    list_item: "list",
    code: "code",
    math: "math_block",
    table_row: "table",
    thematic_break: "fallback",
    html: "html",
    frontmatter: "fallback",
};

/** Body size in points: what a printed document is normally set in. */
const DEFAULT_FONT_SIZE = 11;
/**
 * Heading sizes in points, for a printed page.
 *
 * A scale rather than six arbitrary numbers: each step is about a fifth larger
 * than the next, which is enough to tell a level apart from the one below it at
 * arm's length without a heading taking a line of its own to breathe.
 */
const HEADING_FONT_SIZES: Record<number, number> = {
    1: 22,
    2: 17,
    3: 14,
    4: 12.5,
    5: 11.5,
    6: 11,
};

/**
 * Builds the read-only layout port over an already loaded WASM bridge module.
 *
 * The returned object exposes `layout` and nothing else: there is no method on
 * it that could hit-test a point or resolve a selection.
 */
export function createReadOnlyPreviewLayoutPort(
    wasmModule: LayoutBridgeModule,
): PublishingLayoutPort {
    const bridge = createLayoutBridge(wasmModule);

    return {
        async layout(request) {
            const snapshot = await bridge.initialize(
                toInteractiveFreeLayoutDocument(request),
            );

            return toPublishingLayoutSnapshot(request, snapshot);
        },
    };
}

function toPublishingLayoutSnapshot(
    request: PublishingLayoutDocument,
    snapshot: {
        revision: number;
        lines: Array<{
            id: string;
            blockId: string;
            y: number;
            baseline: number;
            height: number;
            textRuns: Array<{
                blockId: string;
                left: number;
                baseline: number;
                width: number;
                height: number;
                fontFamily: string;
                fontSize: number;
                text: string;
                style?: { link?: string | null };
            }>;
        }>;
        canvasDrawOps: Array<{
            blockId: string;
            kind: string;
            x: number;
            y: number;
            width: number;
            height: number;
            data: unknown;
        }>;
    },
): PublishingLayoutSnapshot {
    return {
        revision: request.revision,
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
                link: run.style?.link ?? null,
            })),
        })),
        canvasDrawOps: snapshot.canvasDrawOps.map((op) => ({
            blockId: op.blockId,
            kind: op.kind as PublishingLayoutDrawOp["kind"],
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            data: typeof op.data === "string" ? op.data : JSON.stringify(op.data),
        })),
    };
}

/**
 * Adapts a publishing content document to the layout engine's document shape.
 *
 * The engine's shape still carries editor position fields. Publishing has no
 * editor positions, so they are written as zero here and every position the
 * engine hands back is discarded: nothing in this direction can be mapped onto
 * an editor document.
 */
function toInteractiveFreeLayoutDocument(
    request: PublishingLayoutDocument,
): LayoutDocument {
    return {
        documentId: request.documentId,
        revision: request.revision,
        viewport: request.viewport,
        blocks: request.blocks.map((block) => toLayoutBlock(block)),
        styleContext: {
            defaultFontSize: request.styleContext.defaultFontSize,
            defaultFontFamily: request.styleContext.defaultFontFamily,
            defaultLineHeight: request.styleContext.defaultLineHeight,
            viewportWidth: request.styleContext.viewportWidth,
            viewportHeight: request.styleContext.viewportHeight,
            devicePixelRatio: 1,
        },
    };
}

function toLayoutBlock(block: PublishingLayoutBlock): LayoutBlock {
    const headingLevel =
        block.kind === "heading" ? (block.level as 1 | 2 | 3 | 4 | 5 | 6) : undefined;
    const runs =
        block.kind === "table_row"
            ? block.cells.flat()
            : block.inlines;
    const inlines: LayoutInlineRun[] = runs.map((run, index) =>
        toInlineRun(block, run, index),
    );

    if (block.text.length > 0 && inlines.length === 0) {
        inlines.push({
            id: `${block.blockId}-0`,
            text: block.text,
            kind: block.kind === "math" ? "math_inline" : "text",
            marks: [],
            sourceFrom: 0,
            sourceTo: 0,
            style: { bold: false, italic: false, code: block.kind === "code" },
        });
    }

    return {
        blockId: block.blockId,
        kind: BLOCK_KIND[block.kind],
        pmFrom: 0,
        pmTo: 0,
        depth: block.kind === "list_item" ? block.level : 0,
        inlines,
        style: {
            fontSize:
                headingLevel === undefined
                    ? DEFAULT_FONT_SIZE
                    : (HEADING_FONT_SIZES[headingLevel] ?? DEFAULT_FONT_SIZE),
            fontFamily: "Helvetica",
            lineHeight: 1.5,
            ...(headingLevel === undefined ? {} : { headingLevel }),
            ...(block.kind === "math" ? { mathDisplay: "block" as const } : {}),
        },
    };
}

function toInlineRun(
    block: PublishingLayoutBlock,
    run: PublishingLayoutBlock["inlines"][number],
    index: number,
): LayoutInlineRun {
    return {
        id: `${block.blockId}-${index}`,
        text: run.text,
        kind:
            run.kind === "math"
                ? "math_inline"
                : run.kind === "image"
                  ? "image_inline"
                  : run.kind === "break"
                    ? "hard_break"
                    : "text",
        ...(run.src === null ? {} : { attrs: { src: run.src } }),
        marks: [
            ...(run.link === null
                ? []
                : ([{ type: "link" as const, href: run.link }] as const)),
            ...(run.emphasis.includes("strong")
                ? ([{ type: "bold" as const }] as const)
                : []),
            ...(run.emphasis.includes("emphasis")
                ? ([{ type: "italic" as const }] as const)
                : []),
            ...(run.emphasis.includes("strike")
                ? ([{ type: "strike" as const }] as const)
                : []),
        ],
        sourceFrom: 0,
        sourceTo: 0,
        style: {
            bold: run.emphasis.includes("strong"),
            italic: run.emphasis.includes("emphasis"),
            code: run.code,
        },
    };
}
