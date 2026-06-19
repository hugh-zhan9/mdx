import { describe, expect, it } from "vitest";
import {
    clipboardTextToMarkdown,
    markdownToClipboardHtml,
} from "./editor-clipboard";

describe("markdown clipboard helpers", () => {
    it("renders Markdown as rich clipboard HTML", () => {
        const html = markdownToClipboardHtml(
            "# Title\n\nA **bold** [link](https://example.com).\n",
        );

        expect(html).toContain("<h1");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain('href="https://example.com"');
    });

    it("keeps plain clipboard text as canonical Markdown", () => {
        expect(clipboardTextToMarkdown("plain\ntext")).toBe("plain\ntext");
    });

    it("sanitizes pasted clipboard HTML before Markdown conversion", () => {
        const markdown = clipboardTextToMarkdown(
            "Safe",
            "<p>Safe</p><script>alert(1)</script>",
        );

        expect(markdown).toContain("Safe");
        expect(markdown).not.toContain("script");
    });
});
