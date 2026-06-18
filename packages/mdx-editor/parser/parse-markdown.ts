import type { Node as ProseMirrorNode } from "prosemirror-model";
import { sourceRange } from "../core/source-map";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";
import { parseInlineMarkdown } from "./inline-markdown";

export function parseMarkdown(markdown: string): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseBlocks(markdown, sourceSlices);
    const doc = mdxEditorSchema.nodes.doc.create(
        null,
        nodes.length > 0
            ? nodes
            : [mdxEditorSchema.nodes.paragraph.create({ sourceId: null })],
    );

    return {
        doc,
        originalMarkdown: markdown,
        sourceSlices,
        diagnostics: [],
    };
}

function parseBlocks(
    markdown: string,
    sourceSlices: SourceSlice[],
): ProseMirrorNode[] {
    const blocks: ProseMirrorNode[] = [];
    const lines = markdown.split(/(\r?\n)/);
    const logicalLines: { text: string; start: number; end: number }[] = [];
    let offset = 0;

    for (let index = 0; index < lines.length; index += 2) {
        const text = lines[index] ?? "";
        const newline = lines[index + 1] ?? "";
        logicalLines.push({
            text,
            start: offset,
            end: offset + text.length + newline.length,
        });
        offset += text.length + newline.length;
    }

    let cursor = 0;
    if (logicalLines[0]?.text === "---") {
        const closing = logicalLines.findIndex(
            (line, index) => index > 0 && line.text === "---",
        );
        if (closing > 0) {
            const start = logicalLines[0].start;
            const end = logicalLines[closing].end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            blocks.push(
                mdxEditorSchema.nodes.frontmatter.create(
                    { sourceId },
                    textNode(
                        markdown.slice(
                            logicalLines[0].end,
                            logicalLines[closing].start,
                        ),
                    ),
                ),
            );
            cursor = closing + 1;
        }
    }

    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        if (!line || line.text.trim() === "") {
            cursor += 1;
            continue;
        }

        const fence = line.text.match(/^```([^\s`]*)?(.*)$/);
        if (fence) {
            const startLine = cursor;
            let endLine = -1;
            for (let next = cursor + 1; next < logicalLines.length; next += 1) {
                const closing = logicalLines[next];
                if (closing?.text.match(/^```[ \t]*$/)) {
                    endLine = next;
                    break;
                }
            }
            const start = logicalLines[startLine].start;
            const end =
                endLine >= 0
                    ? logicalLines[endLine].end
                    : logicalLines[logicalLines.length - 1]?.end ?? line.end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            const contentStart = logicalLines[startLine].end;
            const contentEnd =
                endLine >= 0 ? logicalLines[endLine].start : end;
            const info = line.text.slice(3).trim();
            blocks.push(
                mdxEditorSchema.nodes.code_block.create(
                    {
                        language: fence[1] ?? "",
                        info,
                        sourceId,
                    },
                    textNode(markdown.slice(contentStart, contentEnd)),
                ),
            );
            cursor = endLine >= 0 ? endLine + 1 : logicalLines.length;
            continue;
        }

        const heading = line.text.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const sourceId = addSlice(sourceSlices, markdown, line.start, line.end);
            blocks.push(
                mdxEditorSchema.nodes.heading.create(
                    { level: heading[1].length, sourceId },
                    parseInlineMarkdown(heading[2]),
                ),
            );
            cursor += 1;
            continue;
        }

        const opaqueRange = tryParseOpaqueBlock(logicalLines, cursor);
        if (opaqueRange) {
            const start = logicalLines[opaqueRange.startLine]?.start ?? line.start;
            const end =
                logicalLines[opaqueRange.endLine]?.end ??
                logicalLines[opaqueRange.startLine]?.end ??
                line.end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            const text = markdown.slice(start, end).replace(/\r?\n$/, "");
            blocks.push(
                mdxEditorSchema.nodes.opaque_block.create(
                    { reason: "source-preserved", sourceId },
                    textNode(text),
                ),
            );
            cursor = opaqueRange.endLine + 1;
            continue;
        }

        const paragraphStart = cursor;
        const paragraphLines: string[] = [];
        while (
            cursor < logicalLines.length &&
            logicalLines[cursor]?.text.trim() !== ""
        ) {
            paragraphLines.push(logicalLines[cursor]?.text ?? "");
            cursor += 1;
        }
        const start = logicalLines[paragraphStart].start;
        const end =
            logicalLines[cursor - 1]?.end ?? logicalLines[paragraphStart].end;
        const sourceId = addSlice(sourceSlices, markdown, start, end);
        blocks.push(
            mdxEditorSchema.nodes.paragraph.create(
                { sourceId },
                parseInlineMarkdown(paragraphLines.join("\n")),
            ),
        );
    }

    return blocks;
}

function textNode(text: string): ProseMirrorNode | null {
    return text.length > 0 ? mdxEditorSchema.text(text) : null;
}

function addSlice(
    sourceSlices: SourceSlice[],
    markdown: string,
    start: number,
    end: number,
) {
    const id = `source-${sourceSlices.length}`;
    sourceSlices.push({
        id,
        range: sourceRange(start, end),
        text: markdown.slice(start, end),
    });
    return id;
}

function tryParseOpaqueBlock(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    const firstLine = logicalLines[startLine]?.text ?? "";

    if (isTableStart(logicalLines, startLine)) {
        return consumeUntilBlankLine(logicalLines, startLine);
    }

    if (isCalloutStart(firstLine)) {
        return consumeCalloutBlock(logicalLines, startLine);
    }

    if (isListLikeStart(firstLine)) {
        return consumeListLikeOpaqueBlock(logicalLines, startLine);
    }

    if (isHtmlStart(firstLine)) {
        return consumeHtmlOpaqueBlock(logicalLines, startLine);
    }

    if (isFootnoteDefinitionStart(firstLine)) {
        let endLine = startLine;
        while (endLine + 1 < logicalLines.length) {
            const next = logicalLines[endLine + 1];
            if (!next || next.text.trim() === "") {
                break;
            }
            if (!/^(?:[ \t]+|$)/.test(next.text)) {
                break;
            }
            endLine += 1;
        }

        return { startLine, endLine };
    }

    if (isMathBlockStart(firstLine)) {
        let endLine = startLine;
        while (endLine + 1 < logicalLines.length) {
            endLine += 1;
            if ((logicalLines[endLine]?.text ?? "").trim() === "$$") {
                break;
            }
        }

        return { startLine, endLine };
    }

    return null;
}

function consumeUntilBlankLine(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    let endLine = startLine;
    while (endLine + 1 < logicalLines.length) {
        const next = logicalLines[endLine + 1];
        if (!next || next.text.trim() === "") {
            break;
        }
        endLine += 1;
    }

    return { startLine, endLine };
}

function consumeCalloutBlock(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    let endLine = startLine;

    while (endLine + 1 < logicalLines.length) {
        const next = logicalLines[endLine + 1];
        if (!next || next.text.trim() === "") {
            break;
        }

        if (!next.text.startsWith(">")) {
            break;
        }

        endLine += 1;
    }

    return { startLine, endLine };
}

function consumeListLikeOpaqueBlock(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    let endLine = startLine;

    while (endLine + 1 < logicalLines.length) {
        const next = logicalLines[endLine + 1];
        if (!next || next.text.trim() === "") {
            break;
        }

        if (!isListLikeStart(next.text) && !/^[ \t]+/.test(next.text)) {
            break;
        }

        endLine += 1;
    }

    return { startLine, endLine };
}

function consumeHtmlOpaqueBlock(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    let endLine = startLine;

    while (endLine + 1 < logicalLines.length) {
        const next = logicalLines[endLine + 1];
        if (!next || next.text.trim() === "") {
            break;
        }

        if (
            /^#{1,6}\s/.test(next.text.trimStart()) ||
            isListLikeStart(next.text) ||
            isCalloutStart(next.text)
        ) {
            break;
        }

        endLine += 1;
    }

    return { startLine, endLine };
}

function isTableStart(
    logicalLines: { text: string; start: number; end: number }[],
    startLine: number,
) {
    const header = logicalLines[startLine]?.text ?? "";
    const separator = logicalLines[startLine + 1]?.text ?? "";

    return header.trimStart().startsWith("|") && isTableSeparator(separator);
}

function isTableSeparator(text: string) {
    return /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/.test(
        text,
    );
}

function isCalloutStart(text: string) {
    return /^>\s*\[![^\]]+\]/.test(text);
}

function isListLikeStart(text: string) {
    return /^([*-]\s|\d+\.\s)/.test(text);
}

function isFootnoteDefinitionStart(text: string) {
    return /^\[\^[^\]]+\]:/.test(text);
}

function isMathBlockStart(text: string) {
    return text.trim() === "$$";
}

function isHtmlStart(text: string) {
    return /^<[A-Za-z][^>]*>$/.test(text.trim());
}
