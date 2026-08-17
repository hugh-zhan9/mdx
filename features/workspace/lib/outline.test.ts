import { describe, expect, it } from "vitest";
import { parseMarkdownOutline } from "./outline";

describe("parseMarkdownOutline", () => {
    it("parses h1-h6 in source order", () => {
        const headings = parseMarkdownOutline("# One\n\n## Two\n### Three");
        expect(headings.map((h) => h.text)).toEqual(["One", "Two", "Three"]);
        expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
    });

    it("ignores code fences and invalid heading markers", () => {
        const headings = parseMarkdownOutline(
            "# One\n```md\n## Hidden\n```\n####### Nope\n###### Six",
        );
        expect(headings.map((h) => h.text)).toEqual(["One", "Six"]);
        expect(headings.map((h) => h.level)).toEqual([1, 6]);
    });

    it("ignores indented atx headings", () => {
        const headings = parseMarkdownOutline("  # Hidden\n# Visible");
        expect(headings.map((h) => h.text)).toEqual(["Visible"]);
    });

    it("does not treat indented fences as code blocks", () => {
        const headings = parseMarkdownOutline("  ```\n# Hidden\n  ```\n# Visible");
        expect(headings.map((h) => h.text)).toEqual(["Hidden", "Visible"]);
    });

    it("does not treat tilde fences as code blocks", () => {
        const headings = parseMarkdownOutline("~~~\n# Hidden\n~~~\n# Visible");
        expect(headings.map((h) => h.text)).toEqual(["Hidden", "Visible"]);
    });

    it("does not keep same-line backtick fences open", () => {
        const headings = parseMarkdownOutline("```js```\n# Visible");
        expect(headings.map((h) => h.text)).toEqual(["Visible"]);
    });

    it("closes backtick fences when triple backticks appear inside a line", () => {
        const headings = parseMarkdownOutline(
            '```js\nconst fence = "```";\n# Visible\n```',
        );
        expect(headings.map((h) => h.text)).toEqual(["Visible"]);
    });

    it("does not require a matching fence length", () => {
        const headings = parseMarkdownOutline("````\n# Hidden\n```\n# Visible");
        expect(headings.map((h) => h.text)).toEqual(["Visible"]);
    });
});

describe("parseMarkdownOutline source ranges", () => {
    it("spans exactly the heading text in the source", () => {
        const markdown = "# One\n\nbody\n\n### Three\n";
        const headings = parseMarkdownOutline(markdown);

        expect(
            headings.map((heading) =>
                markdown.slice(heading.range.anchor, heading.range.head),
            ),
        ).toEqual(["One", "Three"]);
    });

    it("counts both characters of a CRLF line ending", () => {
        const markdown = "# One\r\n\r\nbody\r\n\r\n## Two\r\n";
        const headings = parseMarkdownOutline(markdown);

        expect(
            headings.map((heading) =>
                markdown.slice(heading.range.anchor, heading.range.head),
            ),
        ).toEqual(["One", "Two"]);
    });

    it("excludes the marker, its padding and a closing hash run", () => {
        const markdown = "##   Padded  ##\n";
        const [heading] = parseMarkdownOutline(markdown);

        expect(heading.text).toBe("Padded");
        expect(markdown.slice(heading.range.anchor, heading.range.head)).toBe(
            "Padded",
        );
    });

    it("keeps offsets past astral characters in the preceding lines", () => {
        const markdown = "\u{1F600}\u{1F600}\n\n# After\n";
        const [heading] = parseMarkdownOutline(markdown);

        expect(markdown.slice(heading.range.anchor, heading.range.head)).toBe(
            "After",
        );
    });
});
