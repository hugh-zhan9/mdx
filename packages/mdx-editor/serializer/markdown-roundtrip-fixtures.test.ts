import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
import { roundTripFixtures } from "../test/fixtures";

const { parseMarkdown, serializeMarkdown } = createMdxEditorKernel({
    syntax: defaultMarkdownSyntax(),
});

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

    it("round-trips list and blockquote lazy continuation structure", () => {
        for (const markdown of [
            "- item\n  continuation\n- next\n",
            "> quote\ncontinued\n",
        ]) {
            expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
        }
    });
});
