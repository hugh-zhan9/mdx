import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "..";
import { insertImageMarkdown, insertPlainTextMarkdown } from "./editor-commands";

describe("editor commands", () => {
    it("inserts plain text into Markdown at an offset", () => {
        expect(insertPlainTextMarkdown("Hello world", 6, "brave ")).toBe(
            "Hello brave world",
        );
    });

    it("inserts Markdown image syntax with alt text", () => {
        expect(insertImageMarkdown("Hello\n", 6, ".assets/a.png", "Diagram")).toBe(
            "Hello\n![Diagram](.assets/a.png)",
        );
    });

    it("escapes parentheses in image URLs", () => {
        expect(insertImageMarkdown("", 0, ".assets/a)b.png", "Diagram")).toBe(
            "![Diagram](.assets/a\\)b.png)",
        );
    });

    it("escapes brackets in image alt text", () => {
        expect(insertImageMarkdown("", 0, ".assets/a.png", "Diagram [draft]")).toBe(
            "![Diagram \\[draft\\]](.assets/a.png)",
        );
    });

    it("round-trips inserted image markdown without source-slice reuse", () => {
        const markdown = insertImageMarkdown(
            "",
            0,
            ".assets/a)b.png",
            String.raw`Diagram \ draft`,
        );
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown({ ...parsed, sourceSlices: [] })).toBe(
            `${markdown}\n`,
        );
    });

    it("produces serializable Markdown after command-style mutation", () => {
        const markdown = insertPlainTextMarkdown("# Title\n", 8, "Body.\n");
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe("# Title\nBody.\n");
    });
});
