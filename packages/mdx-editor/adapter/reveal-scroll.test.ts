// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
    findScrollableAncestor,
    scrollTargetIntoComfortableView,
} from "./reveal-scroll";

/**
 * Where a jump lands.
 *
 * `scrollIntoView` moves the minimum distance that makes something visible, so
 * a heading below the fold stops flush against the bottom edge of the window —
 * technically revealed, and indistinguishable from a jump that missed. These
 * cover the arithmetic that puts it somewhere readable instead, and the cases
 * where there is nothing sensible to scroll.
 */

const built: HTMLElement[] = [];

afterEach(() => {
    while (built.length > 0) built.pop()?.remove();
});

/** A scrollable box with the geometry jsdom will not compute on its own. */
function scroller(options: {
    overflowY?: string;
    clientHeight?: number;
    scrollHeight?: number;
    top?: number;
}): HTMLElement {
    const element = document.createElement("div");
    element.style.overflowY = options.overflowY ?? "auto";
    document.body.append(element);
    built.push(element);

    Object.defineProperty(element, "clientHeight", {
        configurable: true,
        value: options.clientHeight ?? 600,
    });
    Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: options.scrollHeight ?? 5000,
    });
    element.getBoundingClientRect = () =>
        ({ top: options.top ?? 0 }) as DOMRect;
    return element;
}

describe("findScrollableAncestor", () => {
    it("finds the scrolling box a descendant sits in", () => {
        const box = scroller({});
        const child = document.createElement("p");
        box.append(child);

        expect(findScrollableAncestor(child)).toBe(box);
    });

    it("ignores a box that does not overflow", () => {
        // `overflow-y: auto` on content that fits scrolls nothing, so scrolling
        // it would move the wrong element — or nothing at all.
        const box = scroller({ clientHeight: 600, scrollHeight: 600 });
        const child = document.createElement("p");
        box.append(child);

        expect(findScrollableAncestor(child)).toBeNull();
    });

    it("ignores a box that does not scroll", () => {
        const box = scroller({ overflowY: "visible" });
        const child = document.createElement("p");
        box.append(child);

        expect(findScrollableAncestor(child)).toBeNull();
    });
});

describe("scrollTargetIntoComfortableView", () => {
    it("brings a target below the fold up to a readable position", () => {
        const box = scroller({ clientHeight: 600, top: 0 });
        box.scrollTop = 0;

        // 2000px down the viewport — far below the fold.
        scrollTargetIntoComfortableView(box, 2000);

        // It lands a quarter of the way down rather than at the bottom edge:
        // 2000 - (0 + 600 * 0.25) = 1850.
        expect(box.scrollTop).toBe(1850);
    });

    it("scrolls back up for a target above the viewport", () => {
        const box = scroller({ clientHeight: 600, top: 0 });
        box.scrollTop = 1000;

        scrollTargetIntoComfortableView(box, -400);

        // -400 - 150 = -550, applied to the current position.
        expect(box.scrollTop).toBe(450);
    });

    it("accounts for a viewport that does not start at the top of the window", () => {
        const box = scroller({ clientHeight: 600, top: 100 });
        box.scrollTop = 0;

        scrollTargetIntoComfortableView(box, 2000);

        // The comfortable line is 100 + 150 = 250 down the window.
        expect(box.scrollTop).toBe(1750);
    });

    it("does nothing when there is no layout to measure", () => {
        // A zero-height box means no viewport, as in a test environment or
        // before first layout. Scrolling by a number derived from it would be
        // arithmetic on a measurement that does not exist.
        const box = scroller({ clientHeight: 0 });
        box.scrollTop = 42;

        scrollTargetIntoComfortableView(box, 2000);

        expect(box.scrollTop).toBe(42);
    });

    it("does nothing when nothing scrolls", () => {
        expect(() => {
            scrollTargetIntoComfortableView(null, 2000);
        }).not.toThrow();
    });
});
