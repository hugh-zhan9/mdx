import { describe, expect, it, vi } from "vitest";
import {
    findRenderedHeadingByIndex,
    scrollRenderedHeadingIntoView,
} from "./outline-scroll";

describe("outline scroll helpers", () => {
    it("matches duplicate heading text by source order", () => {
        const firstHeading = createHeading("Repeat");
        const secondHeading = createHeading("Repeat");
        const root = createHeadingRoot([firstHeading, secondHeading]);

        expect(findRenderedHeadingByIndex(root, 1)).toBe(secondHeading);
    });

    it("does not throw when the heading cannot be found", () => {
        const root = createHeadingRoot([]);

        expect(() => scrollRenderedHeadingIntoView(root, 0)).not.toThrow();
        expect(scrollRenderedHeadingIntoView(root, 0)).toBe(false);
    });

    it("requests scrolling for the heading at the outline index", () => {
        const firstHeading = createHeading("One");
        const secondHeading = createHeading("Two");
        const root = createHeadingRoot([firstHeading, secondHeading]);

        expect(scrollRenderedHeadingIntoView(root, 1)).toBe(true);
        expect(firstHeading.scrollIntoView).not.toHaveBeenCalled();
        expect(secondHeading.scrollIntoView).toHaveBeenCalledWith({
            block: "start",
            inline: "nearest",
        });
    });
});

function createHeading(text: string) {
    return {
        scrollIntoView: vi.fn(),
        textContent: text,
    } as unknown as HTMLElement;
}

function createHeadingRoot(headings: HTMLElement[]) {
    return {
        querySelectorAll: vi.fn(() => headings),
    } as unknown as ParentNode;
}
