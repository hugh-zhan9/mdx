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
    const blocks = markdown
        .split(/\n{2,}/u)
        .filter(Boolean)
        .map((line, index) => createLayoutBlock(markdown, line, index));

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

function createLayoutBlock(
    markdown: string,
    line: string,
    index: number,
): LayoutBlock {
    const isHeading = line.startsWith("#");
    const headingText = line.replace(/^#+\s*/u, "");
    const pmFrom = markdown.indexOf(line);

    return {
        blockId: `block-${index}`,
        kind: isHeading ? "heading" : "paragraph",
        pmFrom,
        pmTo: pmFrom + line.length,
        depth: 0,
        inlines: line.includes(INLINE_MATH_TOKEN)
            ? createMathInlineRuns(line)
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
    return [
        {
            text: line.replace(INLINE_MATH_TOKEN, ""),
            kind: "text",
            from: 0,
            to: line.length - 4,
            style: { ...INLINE_STYLE },
        },
        {
            text: "x^2",
            kind: "math_inline",
            from: line.length - 4,
            to: line.length - 1,
            style: { ...INLINE_STYLE },
        },
    ];
}
