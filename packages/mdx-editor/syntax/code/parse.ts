import type { BlockParserContribution, MarkdownParseContext } from "../../kernel";

interface LogicalLine {
    text: string;
    start: number;
    end: number;
}

export const codeBlockParsers: BlockParserContribution[] = [
    {
        phase: "block",
        priority: 100,
        parse: parseFrontmatter,
    },
    {
        phase: "block",
        priority: 80,
        parse: parseCodeFence,
    },
];

function parseFrontmatter(context: MarkdownParseContext, index: number) {
    if (index !== 0) {
        return { status: "notMatched" } as const;
    }

    const logicalLines = splitLogicalLines(context.markdown);
    if (logicalLines[0]?.text !== "---") {
        return { status: "notMatched" } as const;
    }

    const closing = logicalLines.findIndex(
        (line, lineIndex) => lineIndex > 0 && line.text === "---",
    );
    if (closing <= 0) {
        return { status: "notMatched" } as const;
    }

    const start = logicalLines[0].start;
    const end = logicalLines[closing].end;
    const sourceId = context.allocateSourceSlice(start, end);
    const text = context.markdown.slice(
        logicalLines[0].end,
        logicalLines[closing].start,
    );

    return {
        status: "matched",
        node: context.schema.nodes.frontmatter.create(
            { sourceId },
            textNode(text, context),
        ),
        nextIndex: end,
    } as const;
}

function parseCodeFence(context: MarkdownParseContext, index: number) {
    const logicalLines = splitLogicalLines(context.markdown);
    const startLine = logicalLines.findIndex((line) => line.start === index);
    const line = logicalLines[startLine];
    if (!line) {
        return { status: "notMatched" } as const;
    }

    const singleLineCode = parseSingleLineBacktickFence(line.text);
    const fence = singleLineCode
        ? singleLineCode
        : isLineStartingInlineCodeSpan(line.text)
          ? null
          : parseOpeningBacktickFence(line.text);
    if (!fence) {
        return { status: "notMatched" } as const;
    }

    if (!singleLineCode && firstInfoToken(fence.info).toLowerCase() === "mermaid") {
        return { status: "notMatched" } as const;
    }

    let endLine = -1;
    if (!singleLineCode) {
        for (let next = startLine + 1; next < logicalLines.length; next += 1) {
            const closing = logicalLines[next];
            if (closing && isClosingBacktickFence(closing.text, fence.markerLength)) {
                endLine = next;
                break;
            }
        }
    }

    const start = line.start;
    const end = singleLineCode
        ? line.end
        : endLine >= 0
          ? logicalLines[endLine].end
          : (logicalLines[logicalLines.length - 1]?.end ?? line.end);
    const contentStart = line.end;
    const contentEnd = endLine >= 0 ? logicalLines[endLine].start : end;
    const info = singleLineCode ? "" : fence.info;
    const content = singleLineCode
        ? `${singleLineCode.content}\n`
        : context.markdown.slice(contentStart, contentEnd);
    const sourceId = context.allocateSourceSlice(start, end);

    return {
        status: "matched",
        node: context.schema.nodes.code_block.create(
            {
                language: singleLineCode ? "" : firstInfoToken(info),
                info: singleLineCode ? "" : info,
                sourceId,
            },
            textNode(content, context),
        ),
        nextIndex: end,
    } as const;
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

function textNode(text: string, context: MarkdownParseContext) {
    return text.length > 0 ? context.schema.text(text) : null;
}
