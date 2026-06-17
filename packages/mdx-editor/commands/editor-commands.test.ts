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

    it("produces serializable Markdown after command-style mutation", () => {
        const parsed = parseMarkdown("# Title\n");

        expect(serializeMarkdown(parsed)).toBe("# Title\n");
    });
});
