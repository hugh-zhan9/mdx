import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/parse-markdown";
import { roundTripFixtures } from "../test/fixtures";
import { serializeMarkdown } from "./serialize-markdown";

describe("Markdown round-trip fixtures", () => {
    it.each(roundTripFixtures)("$name", ({ markdown }) => {
        const parsed = parseMarkdown(markdown);

        expect(parsed.diagnostics).toEqual([]);
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });
});
