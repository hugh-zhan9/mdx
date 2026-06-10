// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
    markdownLineToBlockIndex,
    scrollMarkdownLineIntoView,
} from "./markdown-line-scroll";

describe("markdown line scroll", () => {
    it("maps markdown lines to approximate rendered block indexes", () => {
        const markdown =
            "# Title\n\nParagraph one\ncontinued\n\n```js\ncode\n```\n\nAfter\n";

        expect(markdownLineToBlockIndex(markdown, 1)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 3)).toBe(1);
        expect(markdownLineToBlockIndex(markdown, 7)).toBe(2);
        expect(markdownLineToBlockIndex(markdown, 10)).toBe(3);
    });

    it("scrolls the matching rendered block into view", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.className = "DOMD-Root";
        const first = document.createElement("h1");
        const second = document.createElement("p");
        second.scrollIntoView = vi.fn();
        domd.append(first, second);
        root.append(domd);

        expect(scrollMarkdownLineIntoView(root, "# Title\n\nParagraph\n", 3)).toBe(
            true,
        );
        expect(second.scrollIntoView).toHaveBeenCalledWith({
            block: "center",
            inline: "nearest",
        });
    });

    it("ignores nested matching descendants when choosing a rendered block", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.className = "DOMD-Root";
        const quote = document.createElement("blockquote");
        const quoteParagraph = document.createElement("p");
        const after = document.createElement("p");
        quote.scrollIntoView = vi.fn();
        quoteParagraph.scrollIntoView = vi.fn();
        after.scrollIntoView = vi.fn();
        quote.append(quoteParagraph);
        domd.append(quote, after);
        root.append(domd);

        expect(
            scrollMarkdownLineIntoView(root, "> quoted\n\nAfter\n", 3),
        ).toBe(true);
        expect(after.scrollIntoView).toHaveBeenCalledWith({
            block: "center",
            inline: "nearest",
        });
        expect(quoteParagraph.scrollIntoView).not.toHaveBeenCalled();
    });
});
