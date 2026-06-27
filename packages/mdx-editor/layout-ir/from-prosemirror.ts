import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type {
    LayoutBlock,
    LayoutBlockStyle,
    LayoutDocument,
    LayoutInlineMark,
    LayoutInlineRun,
    LayoutNormalizationOptions,
} from "./types";

const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.5;
const HEADING_FONT_SIZE = 28;

export function normalizeProseMirrorLayoutDocument(
    doc: ProseMirrorNode,
    options: LayoutNormalizationOptions,
): LayoutDocument {
    const blocks: LayoutBlock[] = [];

    doc.descendants((node, pos) => {
        if (!isLayoutBlockNode(node)) {
            return true;
        }

        blocks.push(createLayoutBlock(node, pos, blocks.length));
        return shouldDescendIntoBlock(node);
    });

    return {
        documentId: options.documentId,
        revision: options.revision,
        viewport: options.viewport,
        blocks,
        styleContext: {
            defaultFontSize: DEFAULT_FONT_SIZE,
            defaultFontFamily: DEFAULT_FONT_FAMILY,
            defaultLineHeight: DEFAULT_LINE_HEIGHT,
            viewportWidth: options.viewport.width,
            viewportHeight: options.viewport.height,
            devicePixelRatio: 1,
        },
    };
}

function createLayoutBlock(
    node: ProseMirrorNode,
    pos: number,
    index: number,
): LayoutBlock {
    const kind = blockKindFromNode(node);

    return {
        blockId: blockIdFromNode(node, index),
        kind,
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        depth: 0,
        inlines: collectInlineRuns(node, pos, index),
        style: blockStyleFromNode(node, kind),
    };
}

function collectInlineRuns(
    block: ProseMirrorNode,
    blockPos: number,
    blockIndex: number,
): LayoutInlineRun[] {
    const runs: LayoutInlineRun[] = [];

    block.descendants((node, pos) => {
        if (node.isBlock && node !== block) {
            return false;
        }

        if (node.isText) {
            runs.push({
                id: inlineId(block, node, blockIndex, pos, runs.length),
                kind: "text",
                text: node.text ?? "",
                marks: marksFromNode(node.marks),
                sourceFrom: blockPos + 1 + pos,
                sourceTo: blockPos + 1 + pos + node.nodeSize,
                style: inlineStyleFromMarks(node.marks),
            });
            return false;
        }

        if (!node.isInline) {
            return true;
        }

        runs.push({
            id: inlineId(block, node, blockIndex, pos, runs.length),
            kind: inlineKindFromNode(node),
            text: inlineTextFromNode(node),
            attrs: inlineAttrsFromNode(node),
            marks: marksFromNode(node.marks),
            sourceFrom: blockPos + 1 + pos,
            sourceTo: blockPos + 1 + pos + node.nodeSize,
            style: inlineStyleFromMarks(node.marks),
        });
        return false;
    });

    if (runs.length === 0 && isCanvasOnlyBlock(block)) {
        runs.push({
            id: `${blockIdFromNode(block, blockIndex)}-content`,
            kind: "text",
            text: block.textContent,
            marks: [],
            sourceFrom: blockPos + 1,
            sourceTo: blockPos + Math.max(block.nodeSize - 1, 1),
            style: inlineStyleFromMarks([]),
        });
    }

    return runs;
}

function isLayoutBlockNode(node: ProseMirrorNode): boolean {
    return node.isBlock && node.type.name !== "doc";
}

function shouldDescendIntoBlock(node: ProseMirrorNode): boolean {
    return [
        "blockquote",
        "bullet_list",
        "ordered_list",
        "list_item",
        "task_item",
        "callout",
        "table",
        "table_row",
    ].includes(node.type.name);
}

function blockKindFromNode(node: ProseMirrorNode): LayoutBlock["kind"] {
    switch (node.type.name) {
        case "paragraph":
            return "paragraph";
        case "heading":
            return "heading";
        case "blockquote":
        case "bullet_list":
        case "ordered_list":
        case "list_item":
        case "task_item":
            return "list";
        case "table":
        case "table_row":
        case "table_cell":
        case "table_header":
            return "table";
        case "code_block":
        case "frontmatter":
            return "code";
        case "math_block":
            return "math_block";
        case "mermaid_block":
            return "mermaid";
        case "html_block":
            return "html";
        case "image":
            return "image";
        default:
            return "fallback";
    }
}

function inlineKindFromNode(node: ProseMirrorNode): LayoutInlineRun["kind"] {
    switch (node.type.name) {
        case "math_inline":
            return "math_inline";
        case "image":
            return "image_inline";
        case "inline_html":
            return "html_inline";
        case "hard_break":
            return "hard_break";
        case "text":
            return "text";
        default:
            return "unsupported_inline";
    }
}

function inlineTextFromNode(node: ProseMirrorNode): string {
    switch (node.type.name) {
        case "math_inline":
            return String(node.attrs.latex ?? "");
        case "image":
            return String(node.attrs.alt ?? node.attrs.src ?? "");
        case "inline_html":
            return String(node.attrs.text ?? node.attrs.html ?? "");
        case "footnote_ref":
            return String(node.attrs.label ?? "");
        case "hard_break":
            return "\n";
        default:
            return node.textContent;
    }
}

function inlineAttrsFromNode(node: ProseMirrorNode) {
    if (node.type.name !== "image") {
        return undefined;
    }

    return {
        src: String(node.attrs.src ?? ""),
        alt: String(node.attrs.alt ?? ""),
        title: String(node.attrs.title ?? ""),
    };
}

function marksFromNode(marks: readonly Mark[]): LayoutInlineMark[] {
    return marks.map((mark) => {
        switch (mark.type.name) {
            case "strong":
                return { type: "bold" };
            case "emphasis":
                return { type: "italic" };
            case "inline_code":
                return { type: "code" };
            case "strike":
                return { type: "strike" };
            case "link":
                return {
                    type: "link",
                    href:
                        typeof mark.attrs.href === "string"
                            ? mark.attrs.href
                            : undefined,
                };
            default:
                return { type: "underline" };
        }
    });
}

function inlineStyleFromMarks(marks: readonly Mark[]) {
    return {
        bold: marks.some((mark) => mark.type.name === "strong"),
        italic: marks.some((mark) => mark.type.name === "emphasis"),
        code: marks.some((mark) => mark.type.name === "inline_code"),
    };
}

function blockStyleFromNode(
    node: ProseMirrorNode,
    kind: LayoutBlock["kind"],
): LayoutBlockStyle {
    const headingLevel =
        kind === "heading" ? headingLevelFromAttrs(node.attrs.level) : undefined;

    return {
        fontSize: headingLevel ? HEADING_FONT_SIZE : DEFAULT_FONT_SIZE,
        fontFamily: DEFAULT_FONT_FAMILY,
        lineHeight: DEFAULT_LINE_HEIGHT,
        headingLevel,
        mathDisplay: kind === "math_block" ? "block" : undefined,
    };
}

function headingLevelFromAttrs(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
    return value === 2 ||
        value === 3 ||
        value === 4 ||
        value === 5 ||
        value === 6
        ? value
        : 1;
}

function blockIdFromNode(node: ProseMirrorNode, index: number): string {
    const sourceId = node.attrs.sourceId;
    return typeof sourceId === "string" && sourceId.length > 0
        ? sourceId
        : `block-${index}`;
}

function inlineId(
    block: ProseMirrorNode,
    node: ProseMirrorNode,
    blockIndex: number,
    inlinePos: number,
    index: number,
): string {
    const sourceId = node.attrs.sourceId;
    if (typeof sourceId === "string" && sourceId.length > 0) {
        return sourceId;
    }

    return `${blockIdFromNode(block, blockIndex)}-run-${inlinePos}-${index}`;
}

function isCanvasOnlyBlock(node: ProseMirrorNode): boolean {
    return [
        "code_block",
        "frontmatter",
        "math_block",
        "mermaid_block",
        "opaque_block",
        "source_fallback",
        "html_block",
    ].includes(node.type.name);
}
