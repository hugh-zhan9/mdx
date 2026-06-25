import type {
    LayoutBlock,
    LayoutDocument,
    LayoutInlineRun,
    LayoutViewport,
} from "./types";

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
    const blockMatcher = /\S[\s\S]*?(?=\n{2,}|\s*$)/gu;

    for (const [index, match] of Array.from(
        markdown.matchAll(blockMatcher),
    ).entries()) {
        blocks.push(
            createLayoutBlock({
                index,
                content: match[0].replace(/\n+$/u, ""),
                pmFrom: match.index ?? 0,
            }),
        );
    }

    return blocks;
}

function createLayoutBlock({
    content,
    index,
    pmFrom,
}: {
    content: string;
    index: number;
    pmFrom: number;
}): LayoutBlock {
    const isHeading = content.startsWith("#");
    const headingText = content.replace(/^#+\s*/u, "");

    return {
        blockId: `block-${index}`,
        kind: isHeading ? "heading" : "paragraph",
        pmFrom,
        pmTo: pmFrom + content.length,
        depth: 0,
        inlines: content.includes(INLINE_MATH_TOKEN)
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
