import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BACKGROUND_FIT_OPTIONS } from "./background-image";
import {
    BACKGROUND_IMAGE_PROPERTY,
    BACKGROUND_ROOT_ATTRIBUTE,
    BACKGROUND_VEIL_PROPERTY,
} from "./background-preference";

/**
 * The join between what the background writes and what the stylesheet reads.
 *
 * This file exists because that kind of join has broken here before, silently
 * and completely: the stylesheet addressed a previous editor's DOM contract, and
 * when the editor was replaced every typography rule stopped matching anything
 * while the whole suite stayed green. The background is the same shape of risk —
 * two custom properties, one attribute and one marker attribute, agreed between
 * a TypeScript module, three components and a `.css` file, with nothing in the
 * running application that fails when one side is renamed.
 *
 * So both sides are asserted: the name the module writes, and the rule that
 * reads it.
 */

const STYLESHEET = readFileSync("app/globals.css", "utf8");
const LAYOUTS = [
    readFileSync("features/workspace/components/editor-stage.tsx", "utf8"),
    readFileSync("features/document/components/document-shell.tsx", "utf8"),
];

/** The attribute the surface rules are written against. */
const SURFACE = "[data-mdx-content-surface]";

describe("the properties the module sets", () => {
    it("are the ones the stylesheet reads", () => {
        expect(STYLESHEET).toContain(`var(${BACKGROUND_IMAGE_PROPERTY})`);
        expect(STYLESHEET).toContain(`${BACKGROUND_VEIL_PROPERTY}: 100%`);
    });

    it("have a default that shows nothing until a background is chosen", () => {
        // A veil of 100% is exactly the theme's own background colour, so a
        // window with no background is a window that looks untouched.
        expect(STYLESHEET).toContain(`${BACKGROUND_IMAGE_PROPERTY}: none`);
    });

    it("fade the image towards the theme's background rather than towards white", () => {
        // The veil has to be mixed from the content background, or a dark theme
        // would fade its picture into a pale haze.
        expect(STYLESHEET).toMatch(
            /--mdx-bg-veil:\s*color-mix\(\s*in srgb,\s*var\(--mdx-content-bg\) var\(--mdx-bg-veil-strength\)/,
        );
    });
});

describe("the attribute the module sets", () => {
    it("has a rule for every layout that can be stored", () => {
        for (const option of BACKGROUND_FIT_OPTIONS) {
            expect(STYLESHEET).toContain(
                `html[${BACKGROUND_ROOT_ATTRIBUTE}="${option.value}"] ${SURFACE}`,
            );
        }
    });

    it("paints the veil over the image, in that order", () => {
        // Both are background layers of the same element, which is what keeps the
        // text on top at full contrast. The veil is written first because the
        // first layer in `background-image` is the topmost one.
        expect(STYLESHEET).toMatch(
            /background-image:\s*\n?\s*linear-gradient\(var\(--mdx-bg-veil\), var\(--mdx-bg-veil\)\),\s*\n?\s*var\(--mdx-bg-image\);/,
        );
    });
});

describe("the surface the rules address", () => {
    it("is an attribute the layouts actually set", () => {
        for (const layout of LAYOUTS) {
            expect(layout).toContain("data-mdx-content-surface");
        }
    });

    it("is the only thing any background rule paints on", () => {
        // The sidebar and the title bar carry small dense text, which is the
        // first thing to stop being readable over a picture. Asserted over every
        // rule rather than against one selector spelling, so painting the shell,
        // the sidebar or the tab bar fails here however it is written.
        const painted = [...STYLESHEET.matchAll(/([^{}]*)\{[^{}]*\}/g)]
            .map((match) => match[1].trim())
            .filter((selector) =>
                selector.includes(BACKGROUND_ROOT_ATTRIBUTE),
            );

        expect(painted.length).toBeGreaterThan(0);
        for (const selector of painted) {
            expect(selector).toContain(SURFACE);
        }
    });
});

describe("each layout", () => {
    it("scales one copy to fill, or repeats it at its own size", () => {
        // The image is the second layer, so it is the second value in each of
        // these. Swapping them sizes the veil to cover and leaves the picture at
        // its intrinsic size, which is wrong in both layouts at once.
        const cover = ruleFor("cover");
        const tile = ruleFor("tile");

        expect(cover).toContain("background-size: auto, cover");
        expect(cover).toContain("background-repeat: no-repeat");
        expect(tile).toContain("background-size: auto, auto");
        expect(tile).toContain("background-repeat: no-repeat, repeat");
    });
});

describe("printing", () => {
    it("leaves the background image off paper", () => {
        const printBlock = STYLESHEET.slice(STYLESHEET.indexOf("@media print"));

        expect(printBlock).toContain(BACKGROUND_ROOT_ATTRIBUTE);
        expect(printBlock).toMatch(
            /html\[data-mdx-bg="tile"\] \[data-mdx-content-surface\] \{\s*background-image: none;/,
        );
    });

    it("overrides the rule rather than the variable", () => {
        // The image is an inline custom property on the root element, and an
        // inline style outranks every selector — so redefining `--mdx-bg-image`
        // under `@media print` would look right and do nothing.
        const printBlock = STYLESHEET.slice(STYLESHEET.indexOf("@media print"));

        expect(printBlock).not.toContain(`${BACKGROUND_IMAGE_PROPERTY}: none`);
    });
});

/** The declarations of the rule that addresses one layout on its own. */
function ruleFor(fit: string): string {
    const selector = `html[${BACKGROUND_ROOT_ATTRIBUTE}="${fit}"] ${SURFACE}`;
    const rule = [...STYLESHEET.matchAll(/([^{}]*)\{([^{}]*)\}/g)].find(
        // Exactly this selector and nothing else, which is what tells the rule
        // that sizes one layout apart from the one both layouts share — and from
        // the `@media print` override, whose captured selector carries the block
        // it sits inside.
        (match) => match[1].trim() === selector,
    );

    expect(rule, `no rule for ${selector}`).toBeDefined();

    return rule?.[2] ?? "";
}
