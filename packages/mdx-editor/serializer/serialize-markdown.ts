import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { parseMarkdown } from "../parser/parse-markdown";

const WIKILINK_HREF_PREFIX = "mdx-wikilink:";

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
        return normalizeLineEndings(source.text) === normalizeLineEndings(node.textContent);
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
            return `${"#".repeat(headingLevel(node))} ${serializeInline(node)}\n`;
        case "paragraph":
            return `${serializeInline(node)}\n`;
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

function serializeInline(node: ProseMirrorNode): string {
    let output = "";

    node.forEach((child) => {
        output += child.isText ? serializeTextNode(child) : child.textContent;
    });

    return output;
}

function serializeTextNode(node: ProseMirrorNode): string {
    const text = node.text ?? "";
    const link = node.marks.find((mark) => mark.type.name === "link");

    if (!link) {
        return serializeMarkedText(text, node.marks);
    }

    const href = String(link.attrs.href ?? "");
    if (href.startsWith(WIKILINK_HREF_PREFIX)) {
        return serializeWikilink(text, href);
    }

    const label = serializeMarkedText(
        text,
        node.marks.filter((mark) => mark !== link),
    );
    const title =
        typeof link.attrs.title === "string" && link.attrs.title.length > 0
            ? ` "${escapeLinkTitle(link.attrs.title)}"`
            : "";

    return `[${label}](${href}${title})`;
}

function serializeMarkedText(text: string, marks: readonly Mark[]) {
    return marks.reduce((serialized, mark) => {
        switch (mark.type.name) {
            case "strong":
                return `**${serialized}**`;
            case "emphasis":
                return `*${serialized}*`;
            case "strike":
                return `~~${serialized}~~`;
            case "inline_code":
                return `\`${serialized}\``;
            default:
                return serialized;
        }
    }, text);
}

function serializeWikilink(text: string, href: string) {
    const originalPayload = decodeWikilinkPayload(
        href.slice(WIKILINK_HREF_PREFIX.length),
    );
    const separatorIndex = originalPayload.indexOf("|");
    const target =
        separatorIndex >= 0
            ? originalPayload.slice(0, separatorIndex)
            : originalPayload;
    const originalLabel =
        separatorIndex >= 0 ? originalPayload.slice(separatorIndex + 1) : target;

    if (text === originalLabel) {
        return `[[${originalPayload}]]`;
    }

    if (text === target) {
        return `[[${target}]]`;
    }

    return `[[${target}|${text}]]`;
}

function decodeWikilinkPayload(payload: string) {
    try {
        return decodeURIComponent(payload);
    } catch {
        return payload;
    }
}

function escapeLinkTitle(title: string) {
    return title.replaceAll('"', '\\"');
}

function normalizeLineEndings(value: string) {
    return value.replace(/\r\n/g, "\n");
}
