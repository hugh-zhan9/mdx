import { describe, expect, it } from "vitest";
import { buildLineDiff } from "./line-diff";

describe("buildLineDiff", () => {
    it("marks equal, removed, and added lines", () => {
        expect(buildLineDiff("a\nb\nc\n", "a\nx\nc\n")).toEqual([
            { kind: "equal", leftLine: 1, rightLine: 1, text: "a" },
            { kind: "removed", leftLine: 2, rightLine: null, text: "b" },
            { kind: "added", leftLine: null, rightLine: 2, text: "x" },
            { kind: "equal", leftLine: 3, rightLine: 3, text: "c" },
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
});
