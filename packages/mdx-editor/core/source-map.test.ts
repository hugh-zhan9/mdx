import { describe, expect, it } from "vitest";
import {
    originalSliceForRange,
    sourceRange,
    type SourceRange,
} from "./source-map";

describe("mdx editor source map helpers", () => {
    it("creates immutable source ranges and reads original slices", () => {
        const markdown = "# Title\n\nBody\n";
        const range: SourceRange = sourceRange(0, 7);

        expect(range).toEqual({ start: 0, end: 7 });
        expect(originalSliceForRange(markdown, range)).toBe("# Title");
    });

    it("clamps out-of-bounds ranges when reading slices", () => {
        const markdown = "abc";

        expect(originalSliceForRange(markdown, sourceRange(-10, 99))).toBe("abc");
    });
});
