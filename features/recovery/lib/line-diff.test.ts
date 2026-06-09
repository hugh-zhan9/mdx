import { describe, expect, it } from "vitest";
import { buildLineDiff } from "./line-diff";

describe("buildLineDiff", () => {
    it("returns no rows for empty input", () => {
        expect(buildLineDiff("", "")).toEqual([]);
    });

    it("normalizes CRLF and LF line endings", () => {
        expect(buildLineDiff("a\r\nb\r\n", "a\nb\nc\r\n")).toEqual([
            { kind: "equal", leftLine: 1, rightLine: 1, text: "a" },
            { kind: "equal", leftLine: 2, rightLine: 2, text: "b" },
            { kind: "added", leftLine: null, rightLine: 3, text: "c" },
        ]);
    });

    it("marks equal, removed, and added lines", () => {
        expect(buildLineDiff("a\nb\nc\n", "a\nx\nc\n")).toEqual([
            { kind: "equal", leftLine: 1, rightLine: 1, text: "a" },
            { kind: "removed", leftLine: 2, rightLine: null, text: "b" },
            { kind: "added", leftLine: null, rightLine: 2, text: "x" },
            { kind: "equal", leftLine: 3, rightLine: 3, text: "c" },
        ]);
    });

    it("keeps a head insertion aligned with the original lines", () => {
        expect(buildLineDiff("b\nc\n", "a\nb\nc\n")).toEqual([
            { kind: "added", leftLine: null, rightLine: 1, text: "a" },
            { kind: "equal", leftLine: 1, rightLine: 2, text: "b" },
            { kind: "equal", leftLine: 2, rightLine: 3, text: "c" },
        ]);
    });

    it("keeps a tail insertion aligned with the original lines", () => {
        expect(buildLineDiff("a\nb\n", "a\nb\nc\n")).toEqual([
            { kind: "equal", leftLine: 1, rightLine: 1, text: "a" },
            { kind: "equal", leftLine: 2, rightLine: 2, text: "b" },
            { kind: "added", leftLine: null, rightLine: 3, text: "c" },
        ]);
    });

    it("keeps trailing empty lines readable", () => {
        expect(buildLineDiff("a\n", "a\n\n").at(-1)).toEqual({
            kind: "added",
            leftLine: null,
            rightLine: 2,
            text: "",
        });
    });

    it("keeps fallback-sized head insertions from churning unchanged lines", () => {
        const unchangedLines = Array.from(
            { length: 1_100 },
            (_, index) => `line-${index}`,
        );
        const leftText = [...unchangedLines, "tail-left"].join("\n");
        const rightText = ["inserted-head", ...unchangedLines, "tail-right"].join(
            "\n",
        );

        const diff = buildLineDiff(leftText, rightText);

        expect(diff[0]).toEqual({
            kind: "added",
            leftLine: null,
            rightLine: 1,
            text: "inserted-head",
        });
        expect(diff.filter((line) => line.kind === "equal")).toHaveLength(
            unchangedLines.length,
        );
        expect(diff.filter((line) => line.kind === "removed")).toHaveLength(1);
        expect(diff.filter((line) => line.kind === "added")).toHaveLength(2);
    });
});
