import type { DiffLine } from "./types";

const MAX_LCS_CELLS = 1_000_000;

export function buildLineDiff(leftText: string, rightText: string): DiffLine[] {
    const leftLines = splitLines(leftText);
    const rightLines = splitLines(rightText);

    if ((leftLines.length + 1) * (rightLines.length + 1) > MAX_LCS_CELLS) {
        return buildFallbackLineDiff(leftLines, rightLines);
    }

    const lcs = buildLcsTable(leftLines, rightLines);
    const lines: DiffLine[] = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
        if (leftLines[leftIndex] === rightLines[rightIndex]) {
            lines.push({
                kind: "equal",
                leftLine: leftIndex + 1,
                rightLine: rightIndex + 1,
                text: leftLines[leftIndex],
            });
            leftIndex += 1;
            rightIndex += 1;
            continue;
        }

        if (lcs[leftIndex + 1][rightIndex] >= lcs[leftIndex][rightIndex + 1]) {
            lines.push({
                kind: "removed",
                leftLine: leftIndex + 1,
                rightLine: null,
                text: leftLines[leftIndex],
            });
            leftIndex += 1;
            continue;
        }

        lines.push({
            kind: "added",
            leftLine: null,
            rightLine: rightIndex + 1,
            text: rightLines[rightIndex],
        });
        rightIndex += 1;
    }

    while (leftIndex < leftLines.length) {
        lines.push({
            kind: "removed",
            leftLine: leftIndex + 1,
            rightLine: null,
            text: leftLines[leftIndex],
        });
        leftIndex += 1;
    }

    while (rightIndex < rightLines.length) {
        lines.push({
            kind: "added",
            leftLine: null,
            rightLine: rightIndex + 1,
            text: rightLines[rightIndex],
        });
        rightIndex += 1;
    }

    return lines;
}

function splitLines(value: string) {
    const lines = value.split(/\r?\n/);
    if (lines.at(-1) === "") {
        lines.pop();
    }
    return lines;
}

function buildLcsTable(leftLines: string[], rightLines: string[]): number[][] {
    const lcs = Array.from({ length: leftLines.length + 1 }, () =>
        Array<number>(rightLines.length + 1).fill(0),
    );

    for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
        for (
            let rightIndex = rightLines.length - 1;
            rightIndex >= 0;
            rightIndex -= 1
        ) {
            lcs[leftIndex][rightIndex] =
                leftLines[leftIndex] === rightLines[rightIndex]
                    ? lcs[leftIndex + 1][rightIndex + 1] + 1
                    : Math.max(
                          lcs[leftIndex + 1][rightIndex],
                          lcs[leftIndex][rightIndex + 1],
                      );
        }
    }

    return lcs;
}

function buildFallbackLineDiff(
    leftLines: string[],
    rightLines: string[],
): DiffLine[] {
    const lines: DiffLine[] = [];
    const maxLineCount = Math.max(leftLines.length, rightLines.length);

    for (let index = 0; index < maxLineCount; index += 1) {
        const leftLine = leftLines[index];
        const rightLine = rightLines[index];

        if (leftLine !== undefined && rightLine !== undefined && leftLine === rightLine) {
            lines.push({
                kind: "equal",
                leftLine: index + 1,
                rightLine: index + 1,
                text: leftLine,
            });
            continue;
        }

        if (leftLine !== undefined) {
            lines.push({
                kind: "removed",
                leftLine: index + 1,
                rightLine: null,
                text: leftLine,
            });
        }

        if (rightLine !== undefined) {
            lines.push({
                kind: "added",
                leftLine: null,
                rightLine: index + 1,
                text: rightLine,
            });
        }
    }

    return lines;
}
