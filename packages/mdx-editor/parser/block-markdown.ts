import type { Node as ProseMirrorNode } from "prosemirror-model";
import { sourceRange } from "../core/source-map";
import type { SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";
import { parseInlineMarkdown } from "./inline-markdown";

interface LogicalLine {
    text: string;
    start: number;
    end: number;
}

interface ListMarker {
    indent: number;
    kind: "bullet" | "ordered";
    checked?: boolean;
    content: string;
    order?: number;
    task: boolean;
}

export function parseMarkdownBlocks(
    markdown: string,
    sourceSlices: SourceSlice[],
): ProseMirrorNode[] {
    const blocks: ProseMirrorNode[] = [];
    const logicalLines = splitLogicalLines(markdown);

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

        const singleLineCode = parseSingleLineBacktickFence(line.text);
        const fence = singleLineCode
            ? singleLineCode
            : isLineStartingInlineCodeSpan(line.text)
              ? null
              : parseOpeningBacktickFence(line.text);
        if (fence) {
            const startLine = cursor;
            let endLine = -1;
            if (!singleLineCode) {
                for (let next = cursor + 1; next < logicalLines.length; next += 1) {
                    const closing = logicalLines[next];
                    if (
                        closing &&
                        isClosingBacktickFence(closing.text, fence.markerLength)
                    ) {
                        endLine = next;
                        break;
                    }
                }
            }
            const start = logicalLines[startLine].start;
            const end = singleLineCode
                ? line.end
                : endLine >= 0
                  ? logicalLines[endLine].end
                  : (logicalLines[logicalLines.length - 1]?.end ?? line.end);
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            const contentStart = logicalLines[startLine].end;
            const contentEnd = endLine >= 0 ? logicalLines[endLine].start : end;
            const info = singleLineCode ? "" : fence.info;
            const nextCursor = singleLineCode
                ? startLine + 1
                : endLine >= 0
                  ? endLine + 1
                  : logicalLines.length;
            const content = textNode(
                singleLineCode
                    ? `${singleLineCode.content}\n`
                    : markdown.slice(contentStart, contentEnd),
            );
            blocks.push(
                !singleLineCode && firstInfoToken(info).toLowerCase() === "mermaid"
                    ? mdxEditorSchema.nodes.mermaid_block.create(
                          {
                              info: info || "mermaid",
                              sourceId,
                          },
                          content,
                      )
                    : mdxEditorSchema.nodes.code_block.create(
                          {
                              language: singleLineCode
                                  ? ""
                                  : firstInfoToken(info),
                              info: singleLineCode ? "" : info,
                              sourceId,
                          },
                          content,
                      ),
            );
            cursor = nextCursor;
            continue;
        }

        if (isThematicBreakLine(line.text)) {
            const sourceId = addSlice(
                sourceSlices,
                markdown,
                line.start,
                line.end,
            );
            blocks.push(
                mdxEditorSchema.nodes.horizontal_rule.create({ sourceId }),
            );
            cursor += 1;
            continue;
        }

        const heading = line.text.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const sourceId = addSlice(
                sourceSlices,
                markdown,
                line.start,
                line.end,
            );
            blocks.push(
                mdxEditorSchema.nodes.heading.create(
                    { level: heading[1].length, sourceId },
                    parseInlineMarkdown(heading[2]),
                ),
            );
            cursor += 1;
            continue;
        }

        const taskListRange = tryParseTaskList(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (taskListRange) {
            const { node, nextCursor } = taskListRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const tableRange = tryParseTable(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (tableRange) {
            const { node, nextCursor } = tableRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const calloutRange = tryParseCallout(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (calloutRange) {
            const { node, nextCursor } = calloutRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const mathRange = tryParseMathBlock(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (mathRange) {
            const { node, nextCursor } = mathRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const footnoteRange = tryParseFootnoteDefinition(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (footnoteRange) {
            const { node, nextCursor } = footnoteRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const htmlBlockRange = tryParseHtmlBlock(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (htmlBlockRange) {
            const { node, nextCursor } = htmlBlockRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const fallbackRange = tryParseSourceFallbackBlock(logicalLines, cursor);
        if (fallbackRange) {
            const start =
                logicalLines[fallbackRange.startLine]?.start ?? line.start;
            const end =
                logicalLines[fallbackRange.endLine]?.end ??
                logicalLines[fallbackRange.startLine]?.end ??
                line.end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            const fallbackMarkdown = markdown.slice(start, end);
            blocks.push(
                mdxEditorSchema.nodes.source_fallback.create(
                    {
                        markdown: fallbackMarkdown,
                        reason: "unsupported",
                        sourceId,
                    },
                    textNode(fallbackMarkdown),
                ),
            );
            cursor = fallbackRange.endLine + 1;
            continue;
        }

        const bulletRange = tryParseBulletList(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (bulletRange) {
            const { node, nextCursor } = bulletRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const orderedRange = tryParseOrderedList(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (orderedRange) {
            const { node, nextCursor } = orderedRange;
            blocks.push(node);
            cursor = nextCursor;
            continue;
        }

        const blockquoteRange = tryParseBlockquote(
            logicalLines,
            cursor,
            markdown,
            sourceSlices,
        );
        if (blockquoteRange) {
            const { node, nextCursor } = blockquoteRange;
            blocks.push(node);
            cursor = nextCursor;
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

function parseOpeningBacktickFence(text: string) {
    const match = text.match(/^ {0,3}(`{3,})([^`]*)$/);
    if (!match) {
        return null;
    }

    return {
        info: match[2].trim(),
        markerLength: match[1].length,
    };
}

function parseSingleLineBacktickFence(text: string) {
    const match = text.match(/^ {0,3}(`{3,})([^`]*)\1[ \t]*$/);
    if (!match) {
        return null;
    }

    return {
        content: match[2],
        info: "",
        markerLength: match[1].length,
    };
}

function isClosingBacktickFence(text: string, markerLength: number) {
    const match = text.match(/^ {0,3}(`+)[ \t]*$/);
    return Boolean(match && match[1].length >= markerLength);
}

function firstInfoToken(info: string) {
    return info.trim().split(/\s+/, 1)[0] ?? "";
}

function splitLogicalLines(markdown: string): LogicalLine[] {
    const lines = markdown.split(/(\r?\n)/);
    const logicalLines: LogicalLine[] = [];
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

    return logicalLines;
}

function tryParseBulletList(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const marker = parseListMarker(logicalLines[startLine]?.text ?? "");
    if (!marker || marker.kind !== "bullet" || marker.task) {
        return null;
    }

    return parseListAt(
        logicalLines,
        startLine,
        marker.indent,
        marker.kind,
        markdown,
        sourceSlices,
    );
}

function tryParseTaskList(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const marker = parseListMarker(logicalLines[startLine]?.text ?? "");
    if (!marker || !marker.task) {
        return null;
    }

    return parseListAt(
        logicalLines,
        startLine,
        marker.indent,
        marker.kind,
        markdown,
        sourceSlices,
    );
}

function tryParseTable(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    if (!isTableStart(logicalLines, startLine)) {
        return null;
    }

    const headerCells = parseTableRow(logicalLines[startLine]?.text ?? "");
    const alignments = parseTableAlignments(
        logicalLines[startLine + 1]?.text ?? "",
    );

    if (
        headerCells.length === 0 ||
        headerCells.length !== alignments.length
    ) {
        return null;
    }

    const rows: ProseMirrorNode[] = [
        createTableRow("table_header", headerCells, alignments),
    ];
    let cursor = startLine + 2;

    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        if (!line || line.text.trim() === "" || !line.text.includes("|")) {
            break;
        }

        const bodyCells = parseTableRow(line.text);
        if (bodyCells.length !== headerCells.length) {
            break;
        }

        rows.push(createTableRow("table_cell", bodyCells, alignments));
        cursor += 1;
    }

    const sourceId = addSlice(
        sourceSlices,
        markdown,
        logicalLines[startLine].start,
        logicalLines[cursor - 1]?.end ?? logicalLines[startLine].end,
    );

    return {
        node: mdxEditorSchema.nodes.table.create(
            { alignments, sourceId },
            rows,
        ),
        nextCursor: cursor,
    };
}

function tryParseCallout(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const firstLine = logicalLines[startLine]?.text ?? "";
    const callout = firstLine.match(/^>\s*\[!([^\]]+)\](?:[ \t]+(.*))?$/);
    if (!callout) {
        return null;
    }

    const contentLines: string[] = [];
    let cursor = startLine + 1;
    let hasNonBlankContent = false;
    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        const match = blockquoteLine(line?.text ?? "");
        if (!line) {
            break;
        }

        if (match) {
            const content = match[1] ?? "";
            contentLines.push(content);
            hasNonBlankContent ||= content.trim().length > 0;
            cursor += 1;
            continue;
        }

        if (line.text.trim() === "") {
            if (hasNonBlankContent) {
                break;
            }

            contentLines.push("");
            cursor += 1;
            continue;
        }

        if (isCalloutLazyContinuationBoundary(logicalLines, cursor)) {
            break;
        }

        contentLines.push(line.text);
        hasNonBlankContent = true;
        cursor += 1;
    }

    const children = createParagraphBlocks(contentLines);
    const sourceId = addSlice(
        sourceSlices,
        markdown,
        logicalLines[startLine].start,
        logicalLines[cursor - 1]?.end ?? logicalLines[startLine].end,
    );

    return {
        node: mdxEditorSchema.nodes.callout.create(
            {
                kind: callout[1].toUpperCase(),
                title: callout[2] && callout[2].length > 0 ? callout[2] : null,
                sourceId,
            },
            children.length > 0
                ? children
                : [mdxEditorSchema.nodes.paragraph.create({ sourceId: null })],
        ),
        nextCursor: cursor,
    };
}

function isCalloutLazyContinuationBoundary(
    logicalLines: LogicalLine[],
    cursor: number,
) {
    const text = logicalLines[cursor]?.text ?? "";

    return (
        /^ {0,3}```/.test(text) ||
        /^#{1,6}\s/.test(text.trimStart()) ||
        isListLikeStart(text) ||
        isCalloutStart(text) ||
        isTableStart(logicalLines, cursor) ||
        isMalformedTableStart(logicalLines, cursor) ||
        isFootnoteDefinitionStart(text) ||
        isMathBlockStart(text) ||
        isThematicBreakLine(text) ||
        isHtmlStart(text) ||
        isUnknownBlockSyntaxStart(text)
    );
}

function tryParseMathBlock(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    if (!isMathBlockStart(logicalLines[startLine]?.text ?? "")) {
        return null;
    }

    let endLine = -1;
    for (let cursor = startLine + 1; cursor < logicalLines.length; cursor += 1) {
        if ((logicalLines[cursor]?.text ?? "").trim() === "$$") {
            endLine = cursor;
            break;
        }
    }

    if (endLine < 0) {
        return null;
    }

    const start = logicalLines[startLine].start;
    const end = logicalLines[endLine].end;
    const sourceId = addSlice(sourceSlices, markdown, start, end);
    const content = markdown.slice(
        logicalLines[startLine].end,
        logicalLines[endLine].start,
    );

    return {
        node: mdxEditorSchema.nodes.math_block.create(
            { sourceId },
            textNode(content),
        ),
        nextCursor: endLine + 1,
    };
}

function tryParseFootnoteDefinition(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const line = logicalLines[startLine];
    const match = (line?.text ?? "").match(/^\[\^([^\]]+)\]:[ \t]*(.*)$/);
    if (!line || !match) {
        return null;
    }

    const contentLines = [match[2]];
    let endLine = startLine;

    while (endLine + 1 < logicalLines.length) {
        const nextLine = logicalLines[endLine + 1];
        if (!nextLine || nextLine.text.trim() === "") {
            break;
        }

        if (!/^[ \t]+/.test(nextLine.text)) {
            break;
        }

        contentLines.push(stripFootnoteContinuationIndent(nextLine.text));
        endLine += 1;
    }

    const sourceId = addSlice(
        sourceSlices,
        markdown,
        line.start,
        logicalLines[endLine]?.end ?? line.end,
    );
    const content = contentLines.map((contentLine) =>
        mdxEditorSchema.nodes.paragraph.create(
            { sourceId: null },
            parseInlineMarkdown(contentLine),
        ),
    );

    return {
        node: mdxEditorSchema.nodes.footnote_definition.create(
            { label: match[1], sourceId },
            content,
        ),
        nextCursor: endLine + 1,
    };
}

function stripFootnoteContinuationIndent(text: string) {
    if (text.startsWith("\t")) {
        return text.slice(1);
    }

    return text.replace(/^ {1,4}/, "");
}

function tryParseOrderedList(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const marker = parseListMarker(logicalLines[startLine]?.text ?? "");
    if (!marker || marker.kind !== "ordered") {
        return null;
    }

    return parseListAt(
        logicalLines,
        startLine,
        marker.indent,
        marker.kind,
        markdown,
        sourceSlices,
    );
}

function parseListAt(
    logicalLines: LogicalLine[],
    startLine: number,
    indent: number,
    kind: ListMarker["kind"],
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const items: ProseMirrorNode[] = [];
    let cursor = startLine;
    const firstMarker = parseListMarker(logicalLines[startLine]?.text ?? "");

    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        const marker = parseListMarker(line?.text ?? "");
        if (!line) {
            break;
        }

        if (!marker) {
            if (
                items.length > 0 &&
                isListContinuationLine(line.text, indent)
            ) {
                items[items.length - 1] = appendListItemContinuation(
                    items[items.length - 1],
                    line.text.trimStart(),
                );
                cursor += 1;
                continue;
            }

            break;
        }

        if (marker.indent < indent) {
            break;
        }

        if (marker.indent > indent) {
            if (items.length === 0) {
                break;
            }
            const nested = parseListAt(
                logicalLines,
                cursor,
                marker.indent,
                marker.kind,
                markdown,
                sourceSlices,
            );
            items[items.length - 1] = appendListItemChild(
                items[items.length - 1],
                nested.node,
            );
            cursor = nested.nextCursor;
            continue;
        }

        if (marker.kind !== kind) {
            break;
        }

        items.push(createListItem(marker));
        cursor += 1;
    }

    const sourceId = addSlice(
        sourceSlices,
        markdown,
        logicalLines[startLine].start,
        logicalLines[cursor - 1]?.end ?? logicalLines[startLine].end,
    );

    const node = kind === "ordered"
        ? mdxEditorSchema.nodes.ordered_list.create(
              { order: firstMarker?.order ?? 1, sourceId },
              items,
          )
        : mdxEditorSchema.nodes.bullet_list.create({ sourceId }, items);

    return { node, nextCursor: cursor };
}

function tryParseBlockquote(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    if (!blockquoteLine(logicalLines[startLine]?.text ?? "")) {
        return null;
    }

    const quoteLines: string[] = [];
    let cursor = startLine;
    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        const match = blockquoteLine(line?.text ?? "");
        if (!line) {
            break;
        }

        if (match) {
            quoteLines.push(match[1] ?? "");
            cursor += 1;
            continue;
        }

        if (
            quoteLines.length > 0 &&
            line.text.trim() !== "" &&
            !isBlockBoundaryStart(line.text)
        ) {
            quoteLines.push(line.text);
            cursor += 1;
            continue;
        }

        break;
    }

    const children: ProseMirrorNode[] = [];
    let paragraphLines: string[] = [];
    const flushParagraph = () => {
        if (paragraphLines.length === 0) {
            return;
        }

        children.push(
            mdxEditorSchema.nodes.paragraph.create(
                { sourceId: null },
                parseInlineMarkdown(paragraphLines.join("\n")),
            ),
        );
        paragraphLines = [];
    };

    for (const quoteLine of quoteLines) {
        if (quoteLine.trim() === "") {
            flushParagraph();
            continue;
        }

        paragraphLines.push(quoteLine);
    }
    flushParagraph();

    if (children.length === 0) {
        children.push(
            mdxEditorSchema.nodes.paragraph.create({ sourceId: null }),
        );
    }

    const start = logicalLines[startLine].start;
    const end = logicalLines[cursor - 1]?.end ?? logicalLines[startLine].end;
    const sourceId = addSlice(sourceSlices, markdown, start, end);

    return {
        node: mdxEditorSchema.nodes.blockquote.create({ sourceId }, children),
        nextCursor: cursor,
    };
}

function createListItem(marker: ListMarker) {
    const paragraph = mdxEditorSchema.nodes.paragraph.create(
        { sourceId: null },
        parseInlineMarkdown(marker.content),
    );

    return marker.task
        ? mdxEditorSchema.nodes.task_item.create(
              { checked: marker.checked, sourceId: null },
              paragraph,
          )
        : mdxEditorSchema.nodes.list_item.create(
              { sourceId: null },
              paragraph,
          );
}

function appendListItemChild(item: ProseMirrorNode, child: ProseMirrorNode) {
    const children: ProseMirrorNode[] = [];
    item.forEach((existing) => {
        children.push(existing);
    });
    children.push(child);

    return item.type.create(item.attrs, children);
}

function appendListItemContinuation(item: ProseMirrorNode, content: string) {
    const children: ProseMirrorNode[] = [];
    item.forEach((existing, _offset, index) => {
        if (index === 0 && existing.type.name === "paragraph") {
            const paragraphChildren: ProseMirrorNode[] = [];
            existing.forEach((inline) => {
                paragraphChildren.push(inline);
            });
            paragraphChildren.push(mdxEditorSchema.text("\n"));
            paragraphChildren.push(...parseInlineMarkdown(content));
            children.push(existing.type.create(existing.attrs, paragraphChildren));
            return;
        }

        children.push(existing);
    });

    return item.type.create(item.attrs, children);
}

function createParagraphBlocks(lines: string[]) {
    const children: ProseMirrorNode[] = [];
    let paragraphLines: string[] = [];
    const flushParagraph = () => {
        if (paragraphLines.length === 0) {
            return;
        }

        children.push(
            mdxEditorSchema.nodes.paragraph.create(
                { sourceId: null },
                parseInlineMarkdown(paragraphLines.join("\n")),
            ),
        );
        paragraphLines = [];
    };

    for (const line of lines) {
        if (line.trim() === "") {
            flushParagraph();
            continue;
        }

        paragraphLines.push(line);
    }
    flushParagraph();

    return children;
}

function createTableRow(
    cellType: "table_cell" | "table_header",
    cells: string[],
    alignments: (string | null)[],
) {
    return mdxEditorSchema.nodes.table_row.create(
        null,
        cells.map((cell, index) =>
            mdxEditorSchema.nodes[cellType].create(
                { align: alignments[index] ?? null },
                parseInlineMarkdown(cell),
            ),
        ),
    );
}

function parseTableRow(text: string) {
    const trimmed = text.trim();
    const withoutLeadingPipe = trimmed.startsWith("|")
        ? trimmed.slice(1)
        : trimmed;
    const withoutOuterPipes = endsWithUnescapedPipe(withoutLeadingPipe)
        ? withoutLeadingPipe.slice(0, -1)
        : withoutLeadingPipe;
    const cells: string[] = [];
    let cell = "";

    for (let index = 0; index < withoutOuterPipes.length;) {
        const protectedInline = readProtectedInlineSpan(withoutOuterPipes, index);
        if (protectedInline) {
            cell += protectedInline.value;
            index = protectedInline.nextIndex;
            continue;
        }

        const char = withoutOuterPipes[index];
        if (char === "\\" && withoutOuterPipes[index + 1] === "|") {
            cell += "|";
            index += 2;
            continue;
        }
        if (char === "\\" && index + 1 < withoutOuterPipes.length) {
            cell += char + withoutOuterPipes[index + 1];
            index += 2;
            continue;
        }

        if (char === "|") {
            cells.push(unescapeTableCellPipes(cell.trim()));
            cell = "";
            index += 1;
            continue;
        }

        cell += char;
        index += 1;
    }

    cells.push(unescapeTableCellPipes(cell.trim()));
    return cells;
}

function unescapeTableCellPipes(markdown: string) {
    return markdown.replaceAll("\\|", "|");
}

function readProtectedInlineSpan(text: string, startIndex: number) {
    const codeSpan = readCodeSpan(text, startIndex);
    if (codeSpan) {
        return codeSpan;
    }

    const wikilink = readUntilUnescapedToken(text, startIndex, "[[", "]]");
    if (wikilink) {
        return wikilink;
    }

    const markdownLink = readMarkdownLinkOrImage(text, startIndex);
    if (markdownLink) {
        return markdownLink;
    }

    const inlineMath = readUntilUnescapedToken(text, startIndex, "$", "$");
    if (inlineMath) {
        return inlineMath;
    }

    return null;
}

function readCodeSpan(text: string, startIndex: number) {
    if (text[startIndex] !== "`") {
        return null;
    }

    let delimiterLength = 0;
    while (text[startIndex + delimiterLength] === "`") {
        delimiterLength += 1;
    }

    const delimiter = "`".repeat(delimiterLength);
    const closeIndex = text.indexOf(delimiter, startIndex + delimiterLength);
    if (closeIndex < 0) {
        return null;
    }

    const nextIndex = closeIndex + delimiterLength;
    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function readMarkdownLinkOrImage(text: string, startIndex: number) {
    const labelStart =
        text[startIndex] === "!" && text[startIndex + 1] === "["
            ? startIndex + 1
            : startIndex;
    if (text[labelStart] !== "[" || text[labelStart + 1] === "[") {
        return null;
    }

    const labelEnd = findUnescapedToken(text, "]", labelStart + 1);
    if (labelEnd < 0) {
        return null;
    }

    let nextIndex = labelEnd + 1;
    if (text[nextIndex] === "(") {
        const targetEnd = findUnescapedToken(text, ")", nextIndex + 1);
        if (targetEnd >= 0) {
            nextIndex = targetEnd + 1;
        }
    }

    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function readUntilUnescapedToken(
    text: string,
    startIndex: number,
    opener: string,
    closer: string,
) {
    if (!text.startsWith(opener, startIndex)) {
        return null;
    }

    const closeIndex = findUnescapedToken(text, closer, startIndex + opener.length);
    if (closeIndex < 0) {
        return null;
    }

    const nextIndex = closeIndex + closer.length;
    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function findUnescapedToken(text: string, token: string, startIndex: number) {
    for (let index = startIndex; index <= text.length - token.length; index += 1) {
        if (text[index] === "\\") {
            index += 1;
            continue;
        }

        if (text.startsWith(token, index)) {
            return index;
        }
    }

    return -1;
}

function endsWithUnescapedPipe(text: string) {
    const pipeIndex = text.length - 1;
    if (text[pipeIndex] !== "|") {
        return false;
    }

    let slashCount = 0;
    for (let index = pipeIndex - 1; index >= 0 && text[index] === "\\"; index -= 1) {
        slashCount += 1;
    }

    return slashCount % 2 === 0;
}

function parseTableAlignments(text: string) {
    return parseTableRow(text).map((cell) => {
        const trimmed = cell.trim();
        const left = trimmed.startsWith(":");
        const right = trimmed.endsWith(":");

        if (left && right) {
            return "center";
        }
        if (left) {
            return "left";
        }
        if (right) {
            return "right";
        }

        return null;
    });
}

function parseListMarker(text: string): ListMarker | null {
    const task = text.match(/^([ \t]*)([-*])\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
        return {
            indent: indentationWidth(task[1]),
            kind: "bullet",
            checked: task[3].toLowerCase() === "x",
            content: task[4],
            task: true,
        };
    }

    const bullet = text.match(/^([ \t]*)([-*])\s+(.*)$/);
    if (bullet) {
        return {
            indent: indentationWidth(bullet[1]),
            kind: "bullet",
            content: bullet[3],
            task: false,
        };
    }

    const ordered = text.match(/^([ \t]*)(\d+)\.\s+(.*)$/);
    if (ordered) {
        return {
            indent: indentationWidth(ordered[1]),
            kind: "ordered",
            content: ordered[3],
            order: Number(ordered[2]),
            task: false,
        };
    }

    return null;
}

function isListContinuationLine(text: string, parentIndent: number) {
    const indent = indentationWidth(text.match(/^[ \t]*/)?.[0] ?? "");

    return (
        text.trim().length > 0 &&
        indent > parentIndent &&
        !isBlockBoundaryStart(text)
    );
}

function indentationWidth(indent: string) {
    let width = 0;
    for (const char of indent) {
        width += char === "\t" ? 4 : 1;
    }

    return width;
}

function blockquoteLine(text: string) {
    return text.match(/^> ?(.*)$/);
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

function isLineStartingInlineCodeSpan(text: string) {
    if (text[0] !== "`") {
        return false;
    }

    let delimiterLength = 0;
    while (text[delimiterLength] === "`") {
        delimiterLength += 1;
    }

    const delimiter = "`".repeat(delimiterLength);

    return text.indexOf(delimiter, delimiterLength) >= delimiterLength;
}

function tryParseSourceFallbackBlock(
    logicalLines: LogicalLine[],
    startLine: number,
) {
    const firstLine = logicalLines[startLine]?.text ?? "";

    if (
        isTableStart(logicalLines, startLine) ||
        isMalformedTableStart(logicalLines, startLine)
    ) {
        return consumeUntilBlankLine(logicalLines, startLine);
    }

    if (isCalloutStart(firstLine)) {
        return consumeCalloutBlock(logicalLines, startLine);
    }

    if (isTaskListStart(firstLine)) {
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

    if (isUnknownBlockSyntaxStart(firstLine)) {
        return consumeUntilBlankLine(logicalLines, startLine);
    }

    return null;
}

function consumeUntilBlankLine(logicalLines: LogicalLine[], startLine: number) {
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

function consumeCalloutBlock(logicalLines: LogicalLine[], startLine: number) {
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
    logicalLines: LogicalLine[],
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
    logicalLines: LogicalLine[],
    startLine: number,
) {
    const startTag = htmlStartTagName(logicalLines[startLine]?.text ?? "");
    if (startTag) {
        const closePattern = new RegExp(`</${escapeRegExp(startTag)}\\s*>`, "i");

        for (let line = startLine; line < logicalLines.length; line += 1) {
            if (closePattern.test(logicalLines[line]?.text ?? "")) {
                return { startLine, endLine: line };
            }
        }
    }

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

function htmlStartTagName(text: string) {
    return text.trim().match(/^<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^>]*)?>/)?.[1] ?? null;
}

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTableStart(logicalLines: LogicalLine[], startLine: number) {
    const header = logicalLines[startLine]?.text ?? "";
    const separator = logicalLines[startLine + 1]?.text ?? "";

    return header.trimStart().startsWith("|") && isTableSeparator(separator);
}

function isMalformedTableStart(logicalLines: LogicalLine[], startLine: number) {
    const header = logicalLines[startLine]?.text ?? "";
    const separator = logicalLines[startLine + 1]?.text ?? "";

    return (
        header.trimStart().startsWith("|") &&
        separator.trim().length > 0 &&
        separator.includes("|")
    );
}

function isTableSeparator(text: string) {
    return /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/.test(
        text,
    );
}

function isCalloutStart(text: string) {
    return /^>\s*\[![^\]]+\]/.test(text);
}

function isTaskListStart(text: string) {
    return /^[-*]\s+\[[ xX]\]\s/.test(text);
}

function isListLikeStart(text: string) {
    return /^([*-]\s|\d+\.\s)/.test(text);
}

function isBlockBoundaryStart(text: string) {
    const trimmed = text.trimStart();

    return (
        /^#{1,6}\s/.test(trimmed) ||
        /^ {0,3}(?:```|~~~)/.test(text) ||
        isThematicBreakLine(text) ||
        parseListMarker(text) !== null ||
        isCalloutStart(trimmed) ||
        isMathBlockStart(text) ||
        isFootnoteDefinitionStart(trimmed) ||
        isHtmlStart(text) ||
        isUnknownBlockSyntaxStart(text)
    );
}

function isFootnoteDefinitionStart(text: string) {
    return /^\[\^[^\]]+\]:/.test(text);
}

function isMathBlockStart(text: string) {
    return text.trim() === "$$";
}

function isThematicBreakLine(text: string) {
    return /^ {0,3}(?:[-*_][ \t]*){3,}$/.test(text);
}

function isHtmlStart(text: string) {
    const trimmed = text.trim();
    return (
        /^<[A-Za-z][^>]*>$/.test(trimmed) ||
        /^<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>$/.test(trimmed)
    );
}

function tryParseHtmlBlock(
    logicalLines: LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
) {
    const firstLine = logicalLines[startLine]?.text ?? "";

    // 只支持特定的交互式块级 HTML 标签
    const blockHtmlMatch = firstLine.match(/^<(details)(\s[^>]*)?>$/);
    if (!blockHtmlMatch) {
        return null;
    }

    const tag = blockHtmlMatch[1];
    const closeTag = `</${tag}>`;
    let endLine = startLine;
    let foundClose = false;

    // 查找闭合标签
    for (let i = startLine; i < logicalLines.length; i++) {
        const line = logicalLines[i]?.text ?? "";
        if (line.includes(closeTag)) {
            endLine = i;
            foundClose = true;
            break;
        }
    }

    if (!foundClose) {
        return null;
    }

    const start = logicalLines[startLine].start;
    const end = logicalLines[endLine].end;
    const sourceId = addSlice(sourceSlices, markdown, start, end);
    const html = markdown.slice(start, end);

    return {
        node: mdxEditorSchema.nodes.html_block.create(
            {
                html,
                tag,
                collapsed: tag === "details",
                sourceId,
            },
            textNode(html),
        ),
        nextCursor: endLine + 1,
    };
}


function isUnknownBlockSyntaxStart(text: string) {
    const trimmed = text.trimStart();

    return (
        /^:{2,}/.test(trimmed) ||
        /^~{3,}/.test(trimmed) ||
        /^(?:import|export)\s/.test(trimmed) ||
        /^<[!/]/.test(trimmed) ||
        /^{[%#]/.test(trimmed)
    );
}
