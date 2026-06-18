import type { Node as ProseMirrorNode } from "prosemirror-model";
import { sourceRange } from "../core/source-map";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";

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
                    parseInlineText(heading[2]),
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
                parseInlineText(paragraphLines.join("\n")),
            ),
        );
    }

    return blocks;
}

function parseInlineText(text: string): ProseMirrorNode[] {
    const children: ProseMirrorNode[] = [];
    let cursor = 0;
    let buffer = "";

    while (cursor < text.length) {
        const wikilink = tryParseWikilink(text, cursor);
        if (wikilink) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.text(wikilink.label, [
                    mdxEditorSchema.marks.link.create({
                        href: `mdx-wikilink:${encodeURIComponent(wikilink.payload)}`,
                    }),
                ]),
            );
            cursor = wikilink.nextIndex;
            continue;
        }

        const image = tryParseImage(text, cursor);
        if (image) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.nodes.image.create({
                    src: image.src,
                    alt: image.alt,
                    title: image.title,
                }),
            );
            cursor = image.nextIndex;
            continue;
        }

        const link = tryParseLink(text, cursor);
        if (link) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.text(link.label, [
                    mdxEditorSchema.marks.link.create({
                        href: link.href,
                        title: link.title,
                    }),
                ]),
            );
            cursor = link.nextIndex;
            continue;
        }

        const escaped = tryParseEscapedChar(text, cursor);
        if (escaped) {
            buffer += escaped.value;
            cursor = escaped.nextIndex;
            continue;
        }

        buffer += text[cursor];
        cursor += 1;
    }

    pushText(children, buffer);
    return children;
}

function pushText(children: ProseMirrorNode[], text: string) {
    if (text.length > 0) {
        children.push(mdxEditorSchema.text(text));
    }
}

function tryParseEscapedChar(text: string, startIndex: number) {
    if (text[startIndex] !== "\\" || startIndex + 1 >= text.length) {
        return null;
    }

    return {
        value: text[startIndex + 1],
        nextIndex: startIndex + 2,
    };
}

function tryParseWikilink(text: string, startIndex: number) {
    if (!text.startsWith("[[", startIndex)) {
        return null;
    }

    let cursor = startIndex + 2;
    while (cursor < text.length) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
            cursor += 2;
            continue;
        }

        if (text[cursor] === "]" && text[cursor + 1] === "]") {
            const body = text.slice(startIndex + 2, cursor);
            const separatorIndex = findUnescaped(body, "|");
            const rawTarget =
                separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
            const rawLabel =
                separatorIndex >= 0 ? body.slice(separatorIndex + 1) : rawTarget;
            const target = decodeEscapes(rawTarget);
            const label = decodeEscapes(rawLabel);

            return {
                label,
                payload:
                    separatorIndex >= 0 ? `${target}|${label}` : target,
                nextIndex: cursor + 2,
            };
        }

        cursor += 1;
    }

    return null;
}

function tryParseImage(text: string, startIndex: number) {
    if (text[startIndex] !== "!" || text[startIndex + 1] !== "[") {
        return null;
    }

    const link = tryParseLink(text, startIndex + 1);
    if (!link) {
        return null;
    }

    return {
        alt: link.label,
        src: link.href,
        title: link.title,
        nextIndex: link.nextIndex,
    };
}

function tryParseLink(text: string, startIndex: number) {
    if (text[startIndex] !== "[" || text[startIndex + 1] === "[") {
        return null;
    }

    const labelEnd = findUnescaped(text, "]", startIndex + 1);
    if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
        return null;
    }

    const rawLabel = text.slice(startIndex + 1, labelEnd);
    let cursor = labelEnd + 2;
    let href = "";

    while (cursor < text.length) {
        const current = text[cursor];
        if (current === "\\" && cursor + 1 < text.length) {
            href += text[cursor + 1];
            cursor += 2;
            continue;
        }

        if (current === ")") {
            return {
                label: decodeEscapes(rawLabel),
                href,
                title: null,
                nextIndex: cursor + 1,
            };
        }

        if (/\s/.test(current)) {
            break;
        }

        href += current;
        cursor += 1;
    }

    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }

    if (text[cursor] !== '"') {
        return null;
    }

    cursor += 1;
    let title = "";
    while (cursor < text.length) {
        const current = text[cursor];
        if (current === "\\" && cursor + 1 < text.length) {
            title += text[cursor + 1];
            cursor += 2;
            continue;
        }

        if (current === '"') {
            cursor += 1;
            break;
        }

        title += current;
        cursor += 1;
    }

    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }

    if (text[cursor] !== ")") {
        return null;
    }

    return {
        label: decodeEscapes(rawLabel),
        href,
        title,
        nextIndex: cursor + 1,
    };
}

function findUnescaped(
    text: string,
    target: string,
    startIndex = 0,
) {
    for (let index = startIndex; index < text.length; index += 1) {
        if (text[index] === "\\" && index + 1 < text.length) {
            index += 1;
            continue;
        }

        if (text[index] === target) {
            return index;
        }
    }

    return -1;
}

function decodeEscapes(text: string) {
    return text.replace(/\\(.)/g, "$1");
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
