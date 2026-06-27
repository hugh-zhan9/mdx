import type { LayoutDocument, LayoutViewport } from "../layout-ir";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface LayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutTextRunPosition {
    blockId: string;
    pmFrom: number;
    pmTo: number;
    left: number;
    baseline: number;
    width: number;
    height: number;
    fontFamily: string;
    fontSize: number;
    text: string;
}

export interface LayoutLineSnapshot {
    id: string;
    blockId: string;
    y: number;
    baseline: number;
    height: number;
    textRuns: LayoutTextRunPosition[];
}

export interface LayoutCanvasDrawOp {
    blockId: string;
    kind: string;
    x: number;
    y: number;
    width: number;
    height: number;
    data: JsonValue;
}

export interface LayoutHitTestEntry {
    blockId: string;
    rect: LayoutRect;
    pmFrom: number;
    pmTo: number;
}

export interface LayoutCaretAnchor {
    lineId: string;
    pmPosition: number;
    x: number;
    y: number;
    height: number;
}

export interface LayoutSelectionGeometry {
    pmFrom: number;
    pmTo: number;
    rects: LayoutRect[];
}

export interface LayoutMirrorBlock {
    blockId: string;
    pmFrom: number;
    pmTo: number;
    semanticText: string;
    ariaLabel: string;
}

export interface LayoutSnapshot {
    revision: number;
    lines: LayoutLineSnapshot[];
    canvasDrawOps: LayoutCanvasDrawOp[];
    hitTestEntries: LayoutHitTestEntry[];
    caretAnchors: LayoutCaretAnchor[];
    selectionGeometries: LayoutSelectionGeometry[];
    mirrorBlocks: LayoutMirrorBlock[];
}

export interface LayoutHitTestResult {
    blockId: string;
    rect: LayoutRect;
    pmFrom: number;
    pmTo: number;
}

export interface LayoutBridgeModule {
    layout_initialize_document: (
        documentId: string,
        layoutIrBytes: number[],
        styleContextBytes: number[],
        viewportBytes: number[],
        platformBytes: number[],
    ) => Uint8Array;
    layout_update_document: (
        documentId: string,
        documentRevision: number | bigint,
        updatedBlocksBytes: number[],
        removedBlockIdsBytes: number[],
        viewportBytes: number[],
    ) => Uint8Array;
    layout_get_viewport_snapshot: (
        documentId: string,
        revision: number | bigint,
        viewportBytes: number[],
        devicePixelRatio: number,
    ) => Uint8Array;
    layout_hit_test: (
        documentId: string,
        revision: number | bigint,
        x: number,
        y: number,
        granularityBytes: number[],
    ) => Uint8Array;
    layout_get_selection_geometry: (
        documentId: string,
        revision: number | bigint,
        pmFrom: number,
        pmTo: number,
    ) => Uint8Array;
}

export interface InitializeLayoutRequest extends LayoutDocument {
    viewport?: LayoutViewport;
    platform?: JsonValue;
}

export type UpdateLayoutRequest = LayoutDocument;

export interface ViewportSnapshotRequest extends LayoutDocument {
    viewport?: LayoutViewport;
    devicePixelRatio?: number;
}

export interface HitTestLayoutRequest {
    documentId: string;
    revision: number;
    x: number;
    y: number;
    granularity: LayoutLineSnapshot[];
}

export interface SelectionGeometryRequest {
    documentId: string;
    revision: number;
    pmFrom: number;
    pmTo: number;
}

export interface LayoutBridge {
    initialize(document: InitializeLayoutRequest): Promise<LayoutSnapshot>;
    update(request: UpdateLayoutRequest): Promise<LayoutSnapshot>;
    getViewportSnapshot(request: ViewportSnapshotRequest): Promise<LayoutSnapshot>;
    hitTest(request: HitTestLayoutRequest): Promise<LayoutHitTestResult | null>;
    getSelectionGeometry(
        request: SelectionGeometryRequest,
    ): Promise<LayoutSelectionGeometry>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const BLOCK_KIND_TO_RUST: Record<LayoutDocument["blocks"][number]["kind"], string> = {
    paragraph: "Paragraph",
    heading: "Heading",
    list: "List",
    table: "Table",
    code: "Code",
    image: "Image",
    mermaid: "Mermaid",
    html: "Html",
    math_block: "MathBlock",
    fallback: "Fallback",
};

const INLINE_KIND_TO_RUST = {
    text: "Text",
    math_inline: "MathInline",
    hard_break: "HardBreak",
    image_inline: "ImageInline",
    html_inline: "HtmlInline",
} as const;

type FrontendInlineKind = keyof typeof INLINE_KIND_TO_RUST;

interface RustLayoutTextRunPosition {
    block_id: string;
    pm_from: number;
    pm_to: number;
    left: number;
    baseline: number;
    width: number;
    height: number;
    font_family: string;
    font_size: number;
    text: string;
}

interface RustLayoutLineSnapshot {
    id: string;
    block_id: string;
    y: number;
    baseline: number;
    height: number;
    text_runs: RustLayoutTextRunPosition[];
}

interface RustLayoutViewport {
    width: number;
    height: number;
    device_pixel_ratio: number;
}

interface RustStyleContext {
    default_font_size: number;
    default_font_family: string;
    default_line_height: number;
    viewport_width: number;
    viewport_height: number;
    device_pixel_ratio: number;
}

interface RustLayoutDocument {
    document_id: string;
    revision: number;
    blocks: Array<{
        block_id: string;
        kind: string;
        pm_from: number;
        pm_to: number;
        style: {
            heading_level: number | null;
            text_align: string;
            font_size: number;
            font_family: string;
            line_height: number;
            math_display: string;
        };
        inlines: Array<{
            text: string;
            kind: string;
            from: number;
            to: number;
            style: {
                bold: boolean;
                italic: boolean;
                code: boolean;
                link: string | null;
                strike: boolean;
                underline: boolean;
            };
        }>;
        depth: number;
    }>;
    style_context: RustStyleContext;
}

function encodeJson(value: unknown): number[] {
    return Array.from(encoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(bytes: Uint8Array): T {
    const decoded = decoder.decode(bytes);
    return JSON.parse(decoded) as T;
}

function remapKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => remapKeys(entry));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
                toCamelCase(key),
                remapKeys(nested),
            ]),
        );
    }

    return value;
}

function toCamelCase(key: string): string {
    return key.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function decodeCamelCaseJson<T>(bytes: Uint8Array): T {
    return remapKeys(decodeJson<unknown>(bytes)) as T;
}

function decodeLayoutSnapshot(bytes: Uint8Array): LayoutSnapshot {
    const snapshot = decodeCamelCaseJson<LayoutSnapshot>(bytes);
    if (!Array.isArray(snapshot.hitTestEntries)) {
        throw new Error("layout snapshot missing hitTestEntries");
    }
    if (!Array.isArray(snapshot.selectionGeometries)) {
        throw new Error("layout snapshot missing selectionGeometries");
    }
    if (!Array.isArray(snapshot.mirrorBlocks)) {
        throw new Error("layout snapshot missing mirrorBlocks");
    }
    return snapshot;
}

function resolveViewport(
    fallback: LayoutDocument["styleContext"],
    viewport?: LayoutViewport,
): LayoutViewport {
    return (
        viewport ?? {
            width: fallback.viewportWidth,
            height: fallback.viewportHeight,
            devicePixelRatio: fallback.devicePixelRatio,
        }
    );
}

function toRustStyleContext(
    styleContext: LayoutDocument["styleContext"],
): RustStyleContext {
    return {
        default_font_size: styleContext.defaultFontSize,
        default_font_family: styleContext.defaultFontFamily,
        default_line_height: styleContext.defaultLineHeight,
        viewport_width: styleContext.viewportWidth,
        viewport_height: styleContext.viewportHeight,
        device_pixel_ratio: styleContext.devicePixelRatio,
    };
}

function toRustViewport(viewport: LayoutViewport): RustLayoutViewport {
    return {
        width: viewport.width,
        height: viewport.height,
        device_pixel_ratio: viewport.devicePixelRatio,
    };
}

function toRustDocument(document: LayoutDocument): RustLayoutDocument {
    return {
        document_id: document.documentId,
        revision: document.revision,
        blocks: document.blocks.map((block) => ({
            block_id: block.blockId,
            kind: BLOCK_KIND_TO_RUST[block.kind],
            pm_from: block.pmFrom,
            pm_to: block.pmTo,
            style: {
                heading_level: block.style.headingLevel ?? null,
                text_align: "Left",
                font_size: block.style.fontSize,
                font_family: block.style.fontFamily,
                line_height: block.style.lineHeight,
                math_display: block.style.mathDisplay === "block" ? "Block" : "Inline",
            },
            inlines: block.inlines.map((inline) => ({
                text:
                    inline.kind === "image_inline"
                        ? inline.attrs?.src ?? inline.text
                        : inline.text,
                kind: INLINE_KIND_TO_RUST[inline.kind as FrontendInlineKind] ?? "Text",
                from: rustWireFromForInline(inline),
                to: rustWireToForInline(inline),
                style: {
                    bold: inline.style.bold,
                    italic: inline.style.italic,
                    code: inline.style.code,
                    link:
                        (inline.marks ?? []).find((mark) => mark.type === "link")?.href ??
                        null,
                    strike: (inline.marks ?? []).some(
                        (mark) => mark.type === "strike",
                    ),
                    underline: (inline.marks ?? []).some(
                        (mark) => mark.type === "underline",
                    ),
                },
            })),
            depth: block.depth,
        })),
        style_context: toRustStyleContext(document.styleContext),
    };
}

function sourceFromForInline(inline: LayoutDocument["blocks"][number]["inlines"][number]) {
    return inline.sourceFrom ?? (inline as unknown as { from: number }).from;
}

function sourceToForInline(inline: LayoutDocument["blocks"][number]["inlines"][number]) {
    return inline.sourceTo ?? (inline as unknown as { to: number }).to;
}

function rustWireFromForInline(
    inline: LayoutDocument["blocks"][number]["inlines"][number],
) {
    return sourceFromForInline(inline);
}

function rustWireToForInline(
    inline: LayoutDocument["blocks"][number]["inlines"][number],
) {
    const from = rustWireFromForInline(inline);
    const sourceWidth = sourceToForInline(inline) - sourceFromForInline(inline);
    return from + Math.max(sourceWidth, inline.text.length);
}

function toRustLineSnapshot(line: LayoutLineSnapshot): RustLayoutLineSnapshot {
    return {
        id: line.id,
        block_id: line.blockId,
        y: line.y,
        baseline: line.baseline,
        height: line.height,
        text_runs: line.textRuns.map((run) => ({
            block_id: run.blockId,
            pm_from: run.pmFrom,
            pm_to: run.pmTo,
            left: run.left,
            baseline: run.baseline,
            width: run.width,
            height: run.height,
            font_family: run.fontFamily,
            font_size: run.fontSize,
            text: run.text,
        })),
    };
}

export function createLayoutBridge(wasmModule: LayoutBridgeModule): LayoutBridge {
    return {
        async initialize(document) {
            const viewport = resolveViewport(
                document.styleContext,
                document.viewport,
            );
            const rustDocument = toRustDocument(document);
            const bytes = wasmModule.layout_initialize_document(
                document.documentId,
                encodeJson(rustDocument),
                encodeJson(rustDocument.style_context),
                encodeJson(toRustViewport(viewport)),
                encodeJson(document.platform ?? {}),
            );
            return decodeLayoutSnapshot(bytes);
        },

        async update(request) {
            const bytes = wasmModule.layout_update_document(
                request.documentId,
                BigInt(request.revision),
                encodeJson(toRustDocument(request)),
                [],
                [],
            );
            return decodeLayoutSnapshot(bytes);
        },

        async getViewportSnapshot(request) {
            const viewport = resolveViewport(
                request.styleContext,
                request.viewport,
            );
            const bytes = wasmModule.layout_get_viewport_snapshot(
                request.documentId,
                BigInt(request.revision),
                encodeJson(toRustDocument(request)),
                request.devicePixelRatio ?? viewport.devicePixelRatio,
            );
            return decodeLayoutSnapshot(bytes);
        },

        async hitTest(request) {
            const bytes = wasmModule.layout_hit_test(
                request.documentId,
                BigInt(request.revision),
                request.x,
                request.y,
                encodeJson(request.granularity.map(toRustLineSnapshot)),
            );

            if (bytes.length === 0) {
                return null;
            }

            return decodeCamelCaseJson<LayoutHitTestResult>(bytes);
        },

        async getSelectionGeometry(request) {
            const bytes = wasmModule.layout_get_selection_geometry(
                request.documentId,
                BigInt(request.revision),
                request.pmFrom,
                request.pmTo,
            );
            return decodeCamelCaseJson<LayoutSelectionGeometry>(bytes);
        },
    };
}

export function initializeLayoutDocument(
    wasmModule: LayoutBridgeModule,
    document: InitializeLayoutRequest,
) {
    return createLayoutBridge(wasmModule).initialize(document);
}

export function updateLayoutDocument(
    wasmModule: LayoutBridgeModule,
    request: UpdateLayoutRequest,
) {
    return createLayoutBridge(wasmModule).update(request);
}

export function getViewportSnapshot(
    wasmModule: LayoutBridgeModule,
    request: ViewportSnapshotRequest,
) {
    return createLayoutBridge(wasmModule).getViewportSnapshot(request);
}

export function hitTestLayout(
    wasmModule: LayoutBridgeModule,
    request: HitTestLayoutRequest,
) {
    return createLayoutBridge(wasmModule).hitTest(request);
}

export function getSelectionGeometry(
    wasmModule: LayoutBridgeModule,
    request: SelectionGeometryRequest,
) {
    return createLayoutBridge(wasmModule).getSelectionGeometry(request);
}
