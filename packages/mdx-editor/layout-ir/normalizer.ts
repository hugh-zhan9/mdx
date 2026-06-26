import type {
    LayoutBlock,
    LayoutDocument,
    LayoutInlineRun,
    LayoutViewport,
} from "./types";
import { isMermaidFenceLanguage } from "../../../features/editor/lib/mermaid-code-fences";

const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.5;
const HEADING_FONT_SIZE = 28;
const INLINE_STYLE = { bold: false, italic: false, code: false } as const;
const INLINE_MATH_TOKEN = "$x^2$";

export function normalizeLayoutDocument(
    markdown: string,
    viewport: LayoutViewport,
): LayoutDocument {
    const blocks = createLayoutBlocks(markdown);

    return {
        documentId: "active-document",
        revision: 1,
        blocks,
        styleContext: {
            defaultFontSize: DEFAULT_FONT_SIZE,
            defaultFontFamily: DEFAULT_FONT_FAMILY,
            defaultLineHeight: DEFAULT_LINE_HEIGHT,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            devicePixelRatio: viewport.devicePixelRatio,
        },
    };
}

function createLayoutBlocks(markdown: string): LayoutBlock[] {
    const blocks: LayoutBlock[] = [];
    let index = 0;
    let cursor = 0;

    while (cursor < markdown.length) {
        const blankLines = markdown
            .slice(cursor)
            .match(/^(?:\r?\n)+/u)?.[0];
        if (blankLines) {
            cursor += blankLines.length;
            continue;
        }

        const mermaidBlock = readMermaidBlock(markdown, cursor);
        if (mermaidBlock) {
            blocks.push(
                createLayoutBlock({
                    index,
                    content: mermaidBlock.code,
                    kind: "mermaid",
                    pmFrom: mermaidBlock.codeStart,
                }),
            );
            cursor = mermaidBlock.nextCursor;
            index += 1;
            continue;
        }

        const blockMatch = markdown
            .slice(cursor)
            .match(/\S[\s\S]*?(?=(?:\r?\n){2,}|\s*$)/u)?.[0];
        if (!blockMatch) {
            break;
        }

        blocks.push(
            createLayoutBlock({
                index,
                content: blockMatch.replace(/(?:\r?\n)+$/u, ""),
                pmFrom: cursor,
            }),
        );
        cursor += blockMatch.length;
        index += 1;
    }

    return blocks;
}

function createLayoutBlock({
    content,
    index,
    kind,
    pmFrom,
}: {
    content: string;
    index: number;
    kind?: LayoutBlock["kind"];
    pmFrom: number;
}): LayoutBlock {
    const isHeading = kind === undefined && content.startsWith("#");
    const headingText = content.replace(/^#+\s*/u, "");
    const blockKind = kind ?? (isHeading ? "heading" : "paragraph");

    return {
        blockId: `block-${index}`,
        kind: blockKind,
        pmFrom,
        pmTo: pmFrom + content.length,
        depth: 0,
        inlines:
            blockKind === "mermaid"
                ? [createTextRun(content, 0)]
                : content.includes(INLINE_MATH_TOKEN)
                  ? createMathInlineRuns(content)
                  : [
                        {
                            text: headingText,
                            kind: "text",
                            from: 0,
                            to: headingText.length,
                            style: { ...INLINE_STYLE },
                        },
                    ],
        style: {
            fontSize: isHeading ? HEADING_FONT_SIZE : DEFAULT_FONT_SIZE,
            fontFamily: DEFAULT_FONT_FAMILY,
            lineHeight: DEFAULT_LINE_HEIGHT,
            headingLevel: isHeading ? 1 : undefined,
        },
    };
}

function createMathInlineRuns(line: string): LayoutInlineRun[] {
    const runs: LayoutInlineRun[] = [];
    let searchFrom = 0;

    while (searchFrom < line.length) {
        const mathStart = line.indexOf(INLINE_MATH_TOKEN, searchFrom);

        if (mathStart === -1) {
            if (searchFrom < line.length) {
                runs.push(createTextRun(line.slice(searchFrom), searchFrom));
            }
            break;
        }

        if (mathStart > searchFrom) {
            runs.push(
                createTextRun(line.slice(searchFrom, mathStart), searchFrom),
            );
        }

        const mathContentFrom = mathStart + 1;
        const mathContentTo = mathStart + INLINE_MATH_TOKEN.length - 1;
        runs.push({
            text: line.slice(mathContentFrom, mathContentTo),
            kind: "math_inline",
            from: mathContentFrom,
            to: mathContentTo,
            style: { ...INLINE_STYLE },
        });

        searchFrom = mathStart + INLINE_MATH_TOKEN.length;
    }

    return runs;
}

function createTextRun(text: string, from: number): LayoutInlineRun {
    return {
        text,
        kind: "text",
        from,
        to: from + text.length,
        style: { ...INLINE_STYLE },
    };
}

function readMermaidBlock(markdown: string, cursor: number) {
    const openingLine = readLine(markdown, cursor);
    const openingMatch = openingLine.text.match(/^(`{3,})([^\n`]*)$/u);
    if (!openingMatch || !isMermaidFenceLanguage(openingMatch[2] ?? "")) {
        return null;
    }

    const fenceLength = openingMatch[1]?.length ?? 0;
    let searchCursor = openingLine.next;

    while (searchCursor <= markdown.length) {
        const line = readLine(markdown, searchCursor);
        if (isClosingFence(line.text, fenceLength)) {
            const rawCode = markdown.slice(openingLine.next, line.start);
            const code = rawCode.replace(/\r?\n$/u, "");

            return {
                code,
                codeStart: openingLine.next,
                nextCursor: line.next,
            };
        }

        if (line.next <= searchCursor) {
            break;
        }

        searchCursor = line.next;
    }

    return null;
}

function readLine(markdown: string, start: number) {
    const newlineIndex = markdown.indexOf("\n", start);
    if (newlineIndex === -1) {
        return {
            text: markdown.slice(start),
            start,
            next: markdown.length,
        };
    }

    const end =
        newlineIndex > start && markdown[newlineIndex - 1] === "\r"
            ? newlineIndex - 1
            : newlineIndex;

    return {
        text: markdown.slice(start, end),
        start,
        next: newlineIndex + 1,
    };
}

function isClosingFence(line: string, fenceLength: number) {
    const match = line.match(/^( {0,3})(`+)[ \t]*$/u);
    return (match?.[2]?.length ?? 0) >= fenceLength;
}
