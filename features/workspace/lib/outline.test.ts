import { describe, expect, it } from "vitest";
import { outlineHeadingLabel, parseMarkdownOutline } from "./outline";

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

describe("outlineHeadingLabel", () => {
    it("decodes the character references the editor itself writes", () => {
        // A heading holding only an escaped space: the body shows it blank, so
        // the outline must not show five characters instead.
        expect(outlineHeadingLabel("&#x20;")).toBe("");
        expect(outlineHeadingLabel("one&#x20;two")).toBe("one two");
        expect(outlineHeadingLabel("&#65;")).toBe("A");
        expect(outlineHeadingLabel("Fish &amp; Chips")).toBe("Fish & Chips");
    });

    it("leaves a reference that names no character exactly as written", () => {
        expect(outlineHeadingLabel("&frac12;")).toBe("&frac12;");
        expect(outlineHeadingLabel("&#x110000;")).toBe("&#x110000;");
        expect(outlineHeadingLabel("&#xd800;")).toBe("&#xd800;");
        expect(outlineHeadingLabel("&#0;")).toBe("&#0;");
    });

    it("keeps what inline markup wraps and drops the markup", () => {
        expect(outlineHeadingLabel("**Bold** and `code`")).toBe(
            "Bold and code",
        );
        expect(outlineHeadingLabel("~~gone~~ and _italic_")).toBe(
            "gone and italic",
        );
    });

    it("keeps what a link says and drops where it points", () => {
        expect(outlineHeadingLabel("[百度](https://baidu.com)")).toBe("百度");
        expect(outlineHeadingLabel("[[目标笔记|读题]]")).toBe("读题");
        expect(outlineHeadingLabel("[[目标笔记]]")).toBe("目标笔记");
        expect(outlineHeadingLabel("![屏幕截图](a.png)")).toBe("屏幕截图");
    });

    it("does not touch the source text a plain heading already is", () => {
        expect(outlineHeadingLabel("Two Sum")).toBe("Two Sum");
        expect(outlineHeadingLabel("2026-03-23 17:06")).toBe("2026-03-23 17:06");
    });
});
