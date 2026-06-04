// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    rangeForVisibleTextMatch,
} from "./visible-text-search";

describe("visible text search", () => {
    it("finds visible paragraph text case-insensitively by default", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw material lives here.");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toBe("Raw material lives here.");
        expect(matches).toEqual([
            {
                end: 3,
                start: 0,
            },
        ]);
    });

    it("honors case-sensitive matching", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw raw RAW");
        const index = buildVisibleTextIndex(root);

        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: false }),
        ).toHaveLength(3);
        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: true }),
        ).toEqual([{ start: 4, end: 7 }]);
    });

    it("includes visible code block text", () => {
        const root = element("div", "DOMD-Root");
        const pre = child(root, "pre", "DOMD-Pre");
        child(pre, "code", "DOMD-PreCode", "const raw = true;");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toContain("const raw = true;");
        expect(matches).toEqual([{ start: 6, end: 9 }]);
    });

    it("excludes hidden markdown syntax marker elements", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P");
        child(paragraph, "span", "DOMD-MdSymbol", "![");
        child(paragraph, "span", "DOMD-Plain", "Visible alt");
        child(paragraph, "span", "DOMD-MdSymbol", "](assets/raw.png)");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible alt");
        expect(
            findVisibleTextMatches(index, "assets/raw.png", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes link hrefs while keeping visible link labels", () => {
        const root = element("div", "DOMD-Root");
        const link = child(root, "a", "DOMD-Link");
        link.setAttribute("href", "https://example.com/raw-secret");
        child(link, "span", "DOMD-Plain", "Raw label");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Raw label");
        expect(
            findVisibleTextMatches(index, "raw label", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(index, "raw-secret", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes display-none nodes", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Visible");
        const hidden = child(root, "span", "DOMD-Plain", "Hidden raw");
        hidden.style.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("creates a DOM range for a single-node match", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P", "Find raw here");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(paragraph.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(paragraph.firstChild);
        expect(range?.endOffset).toBe(8);
    });
});

function element(tagName: string, className = "", text = ""): HTMLElement {
    const node = document.createElement(tagName);
    node.className = className;
    if (text) {
        node.textContent = text;
    }
    return node;
}

function child(
    parent: HTMLElement,
    tagName: string,
    className = "",
    text = "",
): HTMLElement {
    const node = element(tagName, className, text);
    parent.appendChild(node);
    return node;
}
