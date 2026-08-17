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
    kind?: string;
    style?: {
        bold?: boolean;
        italic?: boolean;
        code?: boolean;
        link?: string | null;
        strike?: boolean;
        underline?: boolean;
    };
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

/**
 * What a laid-out document offers a reader: where the lines sit and what to
 * paint. Hit-test entries, caret anchors, selection geometry and mirror blocks
 * left with the interactive editor — those answered "what is under this point"
 * and "where does this selection sit", questions read-only publishing does not
 * ask. The Rust snapshot may still carry them; nothing here reads them.
 */
export interface LayoutSnapshot {
    revision: number;
    lines: LayoutLineSnapshot[];
    canvasDrawOps: LayoutCanvasDrawOp[];
}

/**
 * The WASM entry points publishing is allowed to reach.
 *
 * `loadLayoutWasmModule` returns this type through the package's public entry,
 * so anything declared here is callable by product code. The interactive
 * `layout_hit_test` and `layout_get_selection_geometry` exports are therefore
 * deliberately absent: the artifact still provides them, but no typed path
 * reaches them from outside this package.
 */
export interface LayoutBridgeModule {
    layout_initialize_document: (
        documentId: string,
        layoutIrBytes: Uint8Array,
        styleContextBytes: Uint8Array,
        viewportBytes: Uint8Array,
        platformBytes: Uint8Array,
    ) => Uint8Array;
    layout_update_document: (
        documentId: string,
        documentRevision: number | bigint,
        updatedBlocksBytes: Uint8Array,
        removedBlockIdsBytes: Uint8Array,
        viewportBytes: Uint8Array,
    ) => Uint8Array;
    layout_get_viewport_snapshot: (
        documentId: string,
        revision: number | bigint,
        viewportBytes: Uint8Array,
        devicePixelRatio: number,
    ) => Uint8Array;
}

export interface InitializeLayoutRequest extends LayoutDocument {
    platform?: JsonValue;
}

export type UpdateLayoutRequest = LayoutDocument;

export interface ViewportSnapshotRequest extends LayoutDocument {
    devicePixelRatio?: number;
}

export interface LayoutBridge {
    initialize(document: InitializeLayoutRequest): Promise<LayoutSnapshot>;
    update(request: UpdateLayoutRequest): Promise<LayoutSnapshot>;
    getViewportSnapshot(request: ViewportSnapshotRequest): Promise<LayoutSnapshot>;
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
            attrs: Record<string, string>;
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

function encodeJson(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value));
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
    if (!Array.isArray(snapshot.lines)) {
        throw new Error("layout snapshot missing lines");
    }
    if (!Array.isArray(snapshot.canvasDrawOps)) {
        throw new Error("layout snapshot missing canvasDrawOps");
    }
    return {
        ...snapshot,
        canvasDrawOps: snapshot.canvasDrawOps.map((op) => ({
            ...op,
            data: decodeDrawOpData(op.data),
        })),
    };
}

function decodeDrawOpData(data: JsonValue): JsonValue {
    if (typeof data !== "string") {
        return data;
    }

    try {
        const parsed = JSON.parse(data) as unknown;
        return isJsonValue(parsed) ? parsed : data;
    } catch {
        return data;
    }
}

function isJsonValue(value: unknown): value is JsonValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }

    if (typeof value === "object") {
        return Object.values(value as Record<string, unknown>).every(isJsonValue);
    }

    return false;
}

function resolveViewport(
    fallback: LayoutDocument["styleContext"],
    viewport?: LayoutDocument["viewport"] | LayoutViewport,
): LayoutViewport {
    if (!viewport) {
        return {
            width: fallback.viewportWidth,
            height: fallback.viewportHeight,
            devicePixelRatio: fallback.devicePixelRatio,
        };
    }

    return {
        width: viewport.width,
        height: viewport.height,
        devicePixelRatio:
            "devicePixelRatio" in viewport
                ? viewport.devicePixelRatio
                : fallback.devicePixelRatio,
    };
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
                attrs: inline.attrs ?? {},
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
                encodeJson([]),
                encodeJson([]),
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
