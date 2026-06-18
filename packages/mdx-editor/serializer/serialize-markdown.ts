import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { parseMarkdown } from "../parser/parse-markdown";
import { serializeInlineContent } from "./inline-serializer";

interface RenderedBlock {
    text: string;
    source: SourceReference | null;
}

interface SourceReference {
    index: number;
    slice: SourceSlice;
}

export function serializeMarkdown(parsed: ParsedMarkdownDocument): string {
    if (isParserPlaceholderDocument(parsed)) {
        return parsed.originalMarkdown;
    }

    const sourceReferencesById = new Map(
        parsed.sourceSlices.map((sourceSlice, index) => [
            sourceSlice.id,
            { index, slice: sourceSlice },
        ]),
    );
    const renderedBlocks: RenderedBlock[] = [];

    parsed.doc.forEach((node) => {
        const source = sourceForNode(sourceReferencesById, node);
        renderedBlocks.push({
            source,
            text:
                source && nodeMatchesSource(node, source.slice)
                    ? source.slice.text
                    : serializeNode(node),
        });
    });

    return renderBlocksWithSourceGaps(
        parsed.originalMarkdown,
        renderedBlocks,
        parsed.sourceSlices.length,
    );
}

function sourceForNode(
    sourceReferencesById: Map<string, SourceReference>,
    node: ProseMirrorNode,
) {
    const sourceId = node.attrs.sourceId as string | null | undefined;

    return sourceId ? sourceReferencesById.get(sourceId) ?? null : null;
}

function renderBlocksWithSourceGaps(
    originalMarkdown: string,
    renderedBlocks: RenderedBlock[],
    sourceSliceCount: number,
) {
    let output = "";
    let lastSourceEnd: number | null = null;
    let lastSourceIndex: number | null = null;
    let lastBlock: RenderedBlock | null = null;

    for (const block of renderedBlocks) {
        if (block.source) {
            const { index: sourceIndex, slice } = block.source;
            const { start, end } = slice.range;
            if (lastSourceEnd === null && output.length === 0) {
                if (sourceIndex === 0) {
                    output += originalMarkdown.slice(0, start);
                }
            } else if (
                lastSourceEnd !== null &&
                lastSourceIndex !== null &&
                sourceIndex === lastSourceIndex + 1 &&
                start >= lastSourceEnd
            ) {
                output += originalMarkdown.slice(lastSourceEnd, start);
            } else if (output.length > 0) {
                output += defaultBlockGap(output);
            }

            output += block.text;
            lastSourceEnd = end;
            lastSourceIndex = sourceIndex;
        } else {
            if (output.length > 0) {
                output += defaultBlockGap(output);
            }
            output += block.text;
            lastSourceEnd = null;
            lastSourceIndex = null;
        }

        lastBlock = block;
    }

    if (lastBlock?.source && lastBlock.source.index === sourceSliceCount - 1) {
        output += originalMarkdown.slice(lastBlock.source.slice.range.end);
    }

    return output;
}

function isParserPlaceholderDocument(parsed: ParsedMarkdownDocument) {
    return (
        parsed.sourceSlices.length === 0 &&
        parsed.doc.childCount === 1 &&
        parsed.doc.child(0).type.name === "paragraph" &&
        parsed.doc.child(0).childCount === 0 &&
        parsed.doc.child(0).textContent.length === 0 &&
        parsed.originalMarkdown.trim().length === 0
    );
}

function defaultBlockGap(output: string) {
    if (output.endsWith("\n\n")) {
        return "";
    }

    return output.endsWith("\n") ? "\n" : "\n\n";
}

function nodeMatchesSource(node: ProseMirrorNode, source: SourceSlice) {
    if (node.type.name === "opaque_block") {
        const sourceText = normalizeLineEndings(source.text);
        const nodeText = normalizeLineEndings(node.textContent);

        if (node.attrs.reason === "source-preserved") {
            return (
                sourceText === nodeText ||
                sourceText === `${nodeText}\n`
            );
        }

        return sourceText === nodeText;
    }

    const reparsed = parseMarkdown(source.text);
    if (reparsed.doc.childCount !== 1) {
        return false;
    }

    return nodesEquivalent(node, reparsed.doc.child(0));
}

function nodesEquivalent(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
    if (left.type.name !== right.type.name) {
        return false;
    }

    if (left.isText || right.isText) {
        return (
            left.isText &&
            right.isText &&
            left.text === right.text &&
            marksEquivalent(left.marks, right.marks)
        );
    }

    if (!attrsEquivalent(left.attrs, right.attrs)) {
        return false;
    }

    if (left.childCount !== right.childCount) {
        return false;
    }

    for (let index = 0; index < left.childCount; index += 1) {
        if (!nodesEquivalent(left.child(index), right.child(index))) {
            return false;
        }
    }

    return true;
}

function marksEquivalent(left: readonly Mark[], right: readonly Mark[]) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((leftMark, index) => {
        const rightMark = right[index];

        return (
            rightMark !== undefined &&
            leftMark.type.name === rightMark.type.name &&
            attrsEquivalent(leftMark.attrs, rightMark.attrs)
        );
    });
}

function attrsEquivalent(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

    keys.delete("sourceId");

    for (const key of keys) {
        if (!Object.is(left[key], right[key])) {
            return false;
        }
    }

    return true;
}

function serializeNode(node: ProseMirrorNode): string {
    switch (node.type.name) {
        case "heading":
            return `${"#".repeat(headingLevel(node))} ${serializeInlineContent(node)}\n`;
        case "paragraph":
            return `${serializeInlineContent(node)}\n`;
        case "bullet_list":
            return serializeList(node, "-");
        case "ordered_list":
            return serializeOrderedList(node);
        case "list_item":
            return serializeListItem(node, "-");
        case "task_item":
            return serializeTaskItem(node);
        case "table":
            return serializeTable(node);
        case "table_row":
            return serializeTableRow(node);
        case "table_cell":
        case "table_header":
            return `${serializeInlineContent(node)}\n`;
        case "callout":
            return serializeCallout(node);
        case "code_block":
            return `\`\`\`${codeBlockInfo(node)}\n${textBeforeClosingFence(
                node.textContent,
            )}\`\`\`\n`;
        case "frontmatter":
            return `---\n${textBeforeClosingFence(node.textContent)}---\n`;
        case "opaque_block":
            return ensureTrailingNewline(node.textContent);
        default:
            return ensureTrailingNewline(node.textContent);
    }
}

function serializeList(node: ProseMirrorNode, marker: string) {
    let output = "";

    node.forEach((child) => {
        output += serializeListItem(child, marker);
    });

    return output;
}

function serializeOrderedList(node: ProseMirrorNode) {
    let output = "";
    let order = typeof node.attrs.order === "number" ? node.attrs.order : 1;

    node.forEach((child) => {
        output += serializeListItem(child, `${order}.`);
        order += 1;
    });

    return output;
}

function serializeTaskItem(node: ProseMirrorNode) {
    return serializeListItem(node, node.attrs.checked ? "- [x]" : "- [ ]");
}

function serializeListItem(node: ProseMirrorNode, marker: string) {
    const firstChild = node.firstChild;
    if (!firstChild) {
        return `${marker}\n`;
    }

    const firstLine =
        firstChild.type.name === "paragraph"
            ? serializeInlineContent(firstChild)
            : serializeNestedBlock(firstChild);
    const lines = [`${marker} ${firstLine}`];

    for (let index = 1; index < node.childCount; index += 1) {
        const childText = serializeNestedBlock(node.child(index));
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `  ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

function serializeTable(node: ProseMirrorNode) {
    let output = "";

    node.forEach((row, _offset, index) => {
        output += serializeTableRow(row);
        if (index === 0 && tableRowHasHeader(row)) {
            output += serializeTableSeparator(row, node.attrs.alignments);
        }
    });

    return output;
}

function serializeTableRow(node: ProseMirrorNode) {
    const cells: string[] = [];

    node.forEach((cell) => {
        cells.push(serializeInlineContent(cell));
    });

    return `| ${cells.join(" | ")} |\n`;
}

function serializeTableSeparator(
    row: ProseMirrorNode,
    alignments: unknown,
) {
    const alignmentValues = Array.isArray(alignments) ? alignments : [];
    const cells: string[] = [];

    row.forEach((_cell, _offset, index) => {
        const alignment = alignmentValues[index];
        switch (alignment) {
            case "left":
                cells.push(":---");
                break;
            case "right":
                cells.push("---:");
                break;
            case "center":
                cells.push(":---:");
                break;
            default:
                cells.push("---");
                break;
        }
    });

    return `| ${cells.join(" | ")} |\n`;
}

function tableRowHasHeader(row: ProseMirrorNode) {
    for (let index = 0; index < row.childCount; index += 1) {
        if (row.child(index).type.name === "table_header") {
            return true;
        }
    }

    return false;
}

function serializeCallout(node: ProseMirrorNode) {
    const title =
        typeof node.attrs.title === "string" && node.attrs.title.length > 0
            ? ` ${node.attrs.title}`
            : "";
    const lines = [`> [!${String(node.attrs.kind ?? "NOTE")}]${title}`];

    node.forEach((child) => {
        const childText = serializeNestedBlock(child);
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `> ${line}` : ">");
        }
    });

    return `${lines.join("\n")}\n`;
}

function serializeNestedBlock(node: ProseMirrorNode) {
    return serializeNode(node).replace(/\n$/, "");
}

function headingLevel(node: ProseMirrorNode) {
    const level = node.attrs.level;

    return typeof level === "number" && level >= 1 && level <= 6 ? level : 1;
}

function codeBlockInfo(node: ProseMirrorNode) {
    const info = node.attrs.info;
    const language = node.attrs.language;

    if (typeof info === "string" && info.length > 0) {
        return info;
    }

    return typeof language === "string" ? language : "";
}

function textBeforeClosingFence(text: string) {
    return text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
}

function ensureTrailingNewline(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

function normalizeLineEndings(value: string) {
    return value.replace(/\r\n/g, "\n");
}
