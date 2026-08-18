import { describe, expect, it } from "vitest";
import { buildDiffSegments, summarizeDiff } from "./diff-segments";
import { buildLineDiff } from "./line-diff";
import type { DiffLine } from "./types";

function equalLines(count: number, offset = 0): DiffLine[] {
    return Array.from({ length: count }, (_, index) => ({
        kind: "equal" as const,
        leftLine: offset + index + 1,
        rightLine: offset + index + 1,
        text: `line ${offset + index + 1}`,
    }));
}

describe("summarizeDiff", () => {
    it("reports nothing for identical documents", () => {
        expect(summarizeDiff(buildLineDiff("a\nb\n", "a\nb\n"))).toEqual({
            added: 0,
            removed: 0,
            changes: 0,
        });
    });

    it("counts changed lines and the places they occur in", () => {
        const diffLines = buildLineDiff("a\nb\nc\nd\n", "a\nx\nc\ny\n");

        expect(summarizeDiff(diffLines)).toEqual({
            added: 2,
            removed: 2,
            changes: 2,
        });
    });
});

describe("buildDiffSegments", () => {
    it("keeps a short document whole", () => {
        const diffLines = buildLineDiff("a\nb\nc\n", "a\nx\nc\n");

        expect(buildDiffSegments(diffLines)).toEqual([
            { kind: "lines", lines: diffLines },
        ]);
    });

    it("folds a long unchanged stretch between two changes", () => {
        const diffLines: DiffLine[] = [
            { kind: "removed", leftLine: 1, rightLine: null, text: "head" },
            ...equalLines(20, 1),
            { kind: "added", leftLine: null, rightLine: 22, text: "tail" },
        ];

        const segments = buildDiffSegments(diffLines);

        expect(segments.map((segment) => segment.kind)).toEqual([
            "lines",
            "collapsed",
            "lines",
        ]);
        // Three lines of context stay on each side of the fold.
        expect(segments[0].lines).toHaveLength(4);
        expect(segments[1].lines).toHaveLength(14);
        expect(segments[2].lines).toHaveLength(4);
    });

    it("does not fold a stretch shorter than its own context", () => {
        const diffLines: DiffLine[] = [
            { kind: "removed", leftLine: 1, rightLine: null, text: "head" },
            ...equalLines(6, 1),
            { kind: "added", leftLine: null, rightLine: 8, text: "tail" },
        ];

        expect(
            buildDiffSegments(diffLines).map((segment) => segment.kind),
        ).toEqual(["lines"]);
    });

    it("gives no leading context to a change at the top of the document", () => {
        const diffLines: DiffLine[] = [
            { kind: "added", leftLine: null, rightLine: 1, text: "new first" },
            ...equalLines(30, 0),
        ];

        const segments = buildDiffSegments(diffLines);

        expect(segments.map((segment) => segment.kind)).toEqual([
            "lines",
            "collapsed",
        ]);
        expect(segments[0].lines).toHaveLength(4);
        // Nothing follows the run, so no trailing context is held back.
        expect(segments[1].lines).toHaveLength(27);
    });

    it("keeps every line reachable through exactly one segment", () => {
        const diffLines: DiffLine[] = [
            ...equalLines(15),
            { kind: "removed", leftLine: 16, rightLine: null, text: "gone" },
            ...equalLines(15, 16),
        ];

        const flattened = buildDiffSegments(diffLines).flatMap(
            (segment) => segment.lines,
        );

        expect(flattened).toEqual(diffLines);
    });
});
