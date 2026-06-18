import { describe, expect, it } from "vitest";
import { markdownInputRules } from "./editor-input-rules";

describe("markdown input rules", () => {
    it("includes common Markdown block patterns", () => {
        const patterns = markdownInputRules().map((rule) =>
            (rule as { match: RegExp }).match.toString(),
        );

        expect(patterns.some((pattern) => pattern.includes("#{1,6}"))).toBe(
            true,
        );
        expect(patterns.some((pattern) => pattern.includes("\\[ \\]"))).toBe(
            true,
        );
        expect(patterns.some((pattern) => pattern.includes(">"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("```"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("\\|"))).toBe(true);
    });
});
