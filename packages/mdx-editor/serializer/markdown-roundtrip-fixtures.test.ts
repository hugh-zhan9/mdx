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

    it("round-trips nested bullet lists as list structure", () => {
        const markdown = "- one\n  - two\n    - three\n- four\n";
        const reparsed = parseMarkdown(serializeMarkdown(parseMarkdown(markdown)));
        const list = reparsed.doc.child(0);

        expect(list.type.name).toBe("bullet_list");
        expect(list.child(0).child(1).type.name).toBe("bullet_list");
        expect(list.child(0).child(1).child(0).child(1).type.name).toBe(
            "bullet_list",
        );
        expect(serializeMarkdown(reparsed)).toBe(markdown);
    });
});
