const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,pre,blockquote,table,hr";
const SCROLL_OPTIONS: ScrollIntoViewOptions = {
    block: "center",
    inline: "nearest",
};

interface MarkdownBlock {
    startLine: number;
    endLine: number;
}

export function markdownLineToBlockIndex(markdown: string, lineNumber: number) {
    const blocks = collectMarkdownBlocks(markdown);

    if (blocks.length === 0) {
        return 0;
    }

    const targetLine = normalizeLineNumber(lineNumber);
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const [index, block] of blocks.entries()) {
        if (targetLine >= block.startLine && targetLine <= block.endLine) {
            return index;
        }

        const distance =
            targetLine < block.startLine
                ? block.startLine - targetLine
                : targetLine - block.endLine;

        if (
            distance < nearestDistance ||
            (distance === nearestDistance && targetLine <= block.startLine)
        ) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    }

    return nearestIndex;
}

export function scrollMarkdownLineIntoView(
    viewport: HTMLElement | null,
    markdown: string,
    lineNumber: number,
) {
    if (!viewport) {
        return false;
    }

    const root =
        viewport.querySelector<HTMLElement>(".DOMD-Root") ?? viewport;
    const renderedBlocks = collectRenderedBlocks(root);

    if (renderedBlocks.length === 0) {
        return false;
    }

    const blockIndex = markdownLineToBlockIndex(markdown, lineNumber);
    const clampedIndex = Math.max(
        0,
        Math.min(blockIndex, renderedBlocks.length - 1),
    );
    renderedBlocks[clampedIndex]?.scrollIntoView(SCROLL_OPTIONS);
    return Boolean(renderedBlocks[clampedIndex]);
}

function collectRenderedBlocks(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
        (node) => {
            const closestBlockAncestor =
                node.parentElement?.closest<HTMLElement>(BLOCK_SELECTOR) ?? null;

            return !closestBlockAncestor || !root.contains(closestBlockAncestor);
        },
    );
}

function collectMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const lines = markdown.split(/\r?\n/);
    const blocks: MarkdownBlock[] = [];
    let lineIndex = 1;

    while (lineIndex <= lines.length) {
        const currentLine = lines[lineIndex - 1] ?? "";

        if (isBlankLine(currentLine)) {
            lineIndex += 1;
            continue;
        }

        const fence = readFence(currentLine);
        if (fence) {
            const startLine = lineIndex;
            lineIndex += 1;

            while (lineIndex <= lines.length) {
                const line = lines[lineIndex - 1] ?? "";
                if (isFenceClose(line, fence)) {
                    lineIndex += 1;
                    break;
                }
                lineIndex += 1;
            }

            blocks.push({
                startLine,
                endLine: Math.max(startLine, lineIndex - 1),
            });
            continue;
        }

        if (isHeadingLine(currentLine)) {
            blocks.push({
                startLine: lineIndex,
                endLine: lineIndex,
            });
            lineIndex += 1;
            continue;
        }

        if (isListLine(currentLine)) {
            const startLine = lineIndex;
            lineIndex += 1;

            while (lineIndex <= lines.length) {
                const line = lines[lineIndex - 1] ?? "";

                if (isBlankLine(line) || readFence(line) || isHeadingLine(line)) {
                    break;
                }

                if (isListLine(line) || isIndentedListContinuation(line)) {
                    lineIndex += 1;
                    continue;
                }

                break;
            }

            blocks.push({
                startLine,
                endLine: lineIndex - 1,
            });
            continue;
        }

        const startLine = lineIndex;
        lineIndex += 1;

        while (lineIndex <= lines.length) {
            const line = lines[lineIndex - 1] ?? "";

            if (
                isBlankLine(line) ||
                readFence(line) ||
                isHeadingLine(line) ||
                isListLine(line)
            ) {
                break;
            }

            lineIndex += 1;
        }

        blocks.push({
            startLine,
            endLine: lineIndex - 1,
        });
    }

    return blocks;
}

function normalizeLineNumber(lineNumber: number) {
    if (!Number.isFinite(lineNumber)) {
        return 1;
    }

    return Math.max(1, Math.trunc(lineNumber));
}

function isBlankLine(line: string) {
    return line.trim().length === 0;
}

function isHeadingLine(line: string) {
    return /^#{1,6}\s/.test(line.trimStart());
}

function isListLine(line: string) {
    return /^(\s*)([-+*]|\d+[.)])\s+/.test(line);
}

function isIndentedListContinuation(line: string) {
    return /^\s{2,}\S/.test(line);
}

function readFence(line: string) {
    const match = line.trimStart().match(/^(`{3,}|~{3,})/);

    if (!match) {
        return null;
    }

    return match[1];
}

function isFenceClose(line: string, fence: string) {
    const trimmed = line.trimStart();

    return trimmed.startsWith(fence) && trimmed[0] === fence[0];
}
