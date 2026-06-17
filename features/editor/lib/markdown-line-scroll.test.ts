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

    it("keeps multi-paragraph list item lines in the same top-level block", () => {
        const markdown = "- Item\n\n  More detail\n\nAfter\n";

        expect(markdownLineToBlockIndex(markdown, 1)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 3)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 5)).toBe(1);
    });

    it("keeps nested fenced code inside the same top-level list block", () => {
        const markdown = "- Item\n\n  ```js\n  code\n  ```\n\nAfter\n";

        expect(markdownLineToBlockIndex(markdown, 1)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 4)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 7)).toBe(1);
    });

    it("scrolls the matching rendered block into view", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.setAttribute("data-mdx-editor-root", "");
        const first = document.createElement("h1");
        const second = document.createElement("p");
        first.setAttribute("data-mdx-node-type", "heading");
        second.setAttribute("data-mdx-node-type", "paragraph");
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

    it("scrolls the editor root when a single-line document has no rendered block elements", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.setAttribute("data-mdx-editor-root", "");
        domd.setAttribute("data-mdx-text", "");
        domd.textContent = "single line match";
        domd.scrollIntoView = vi.fn();
        root.scrollIntoView = vi.fn();
        root.append(domd);

        expect(scrollMarkdownLineIntoView(root, "single line match", 1)).toBe(
            true,
        );
        expect(domd.scrollIntoView).toHaveBeenCalledWith({
            block: "center",
            inline: "nearest",
        });
        expect(root.scrollIntoView).not.toHaveBeenCalled();
    });

    it("ignores nested matching descendants when choosing a rendered block", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.setAttribute("data-mdx-editor-root", "");
        const quote = document.createElement("blockquote");
        const quoteParagraph = document.createElement("p");
        const after = document.createElement("p");
        quote.setAttribute("data-mdx-node-type", "blockquote");
        quoteParagraph.setAttribute("data-mdx-node-type", "paragraph");
        after.setAttribute("data-mdx-node-type", "paragraph");
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

    it("scrolls nested list-item code hits to the top-level list block", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.setAttribute("data-mdx-editor-root", "");
        const list = document.createElement("ul");
        const item = document.createElement("li");
        const paragraph = document.createElement("p");
        const codeBlock = document.createElement("pre");
        const after = document.createElement("p");
        list.setAttribute("data-mdx-node-type", "bullet_list");
        paragraph.setAttribute("data-mdx-node-type", "paragraph");
        codeBlock.setAttribute("data-mdx-node-type", "code_block");
        after.setAttribute("data-mdx-node-type", "paragraph");
        list.scrollIntoView = vi.fn();
        codeBlock.scrollIntoView = vi.fn();
        after.scrollIntoView = vi.fn();
        item.append(paragraph, codeBlock);
        list.append(item);
        domd.append(list, after);
        root.append(domd);

        expect(
            scrollMarkdownLineIntoView(
                root,
                "- Item\n\n  ```js\n  code\n  ```\n\nAfter\n",
                4,
            ),
        ).toBe(true);
        expect(list.scrollIntoView).toHaveBeenCalledWith({
            block: "center",
            inline: "nearest",
        });
        expect(codeBlock.scrollIntoView).not.toHaveBeenCalled();
    });
});
