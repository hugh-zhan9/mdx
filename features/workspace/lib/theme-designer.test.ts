import { describe, expect, it } from "vitest";

import { parseUserTheme } from "./theme-contract";
import {
    THEME_DESIGNER_FIELDS,
    buildThemeCss,
    readableTextOn,
    themeFileName,
    toHexColor,
    type ThemeDraft,
} from "./theme-designer";

function draft(overrides: Partial<ThemeDraft> = {}): ThemeDraft {
    return {
        name: "我的主题",
        appearance: "dark",
        colors: Object.fromEntries(
            THEME_DESIGNER_FIELDS.map((field, index) => [
                field.property,
                `#${String(index).repeat(6).slice(0, 6)}`,
            ]),
        ),
        ...overrides,
    };
}

describe("a theme made in the application", () => {
    it("is read back by the same parser a hand-written one goes through", () => {
        // The whole point of writing the public contract rather than a private
        // format: there is one reader, and this side is only a convenience.
        const made = draft();

        const parsed = parseUserTheme("mine.css", buildThemeCss(made));

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.theme.name).toBe("我的主题");
        expect(parsed.theme.appearance).toBe("dark");
        expect(parsed.theme.ignored).toEqual([]);
    });

    it("lands every colour it offered somewhere on the page", () => {
        // A field that painted nothing would be worse than no field at all.
        const parsed = parseUserTheme("mine.css", buildThemeCss(draft()));

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const targets = Object.keys(parsed.theme.declarations);
        expect(targets).toContain("--color-base-100");
        expect(targets).toContain("--color-base-content");
        expect(targets).toContain("--color-primary");
        expect(targets).toContain("--mdx-selection-bg");
        expect(targets).toContain("--mdx-code-bg");
        expect(targets).toContain("--mdx-chrome-bg");
    });

    it("reads like a file a person could have typed", () => {
        // It is the user's file from the moment it is written, and they will open
        // it: it says where it came from and that it can be edited by hand.
        const css = buildThemeCss(draft());

        expect(css).toContain(":root {");
        expect(css).toContain("--mdx-theme-*");
        expect(css.endsWith("}\n")).toBe(true);
    });

    it("keeps a name that would break the file out of it", () => {
        // The contract's own name check refuses these, so a theme carrying one
        // would come back nameless with no way to see why.
        const css = buildThemeCss(draft({ name: 'a"; } @import x; {' }));
        const parsed = parseUserTheme("mine.css", css);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.theme.name).toBe("a  import x");
    });

    describe("the words on top of the accent", () => {
        it("is not left to the light theme underneath", () => {
            // A user theme only sets what the contract covers; button text came
            // from the default palette, so a pale accent meant white on pale.
            const made = draft({
                colors: {
                    ...draft().colors,
                    "--mdx-theme-accent": "#f2d9a0",
                },
            });

            const parsed = parseUserTheme("mine.css", buildThemeCss(made));

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;
            expect(parsed.theme.declarations["--color-primary-content"]).toBe(
                "#101010",
            );
        });

        it("turns white once the accent is dark enough to need it", () => {
            const made = draft({
                colors: { ...draft().colors, "--mdx-theme-accent": "#1f3a8a" },
            });

            const parsed = parseUserTheme("mine.css", buildThemeCss(made));

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;
            expect(parsed.theme.declarations["--color-primary-content"]).toBe(
                "#ffffff",
            );
        });

        it("reads a saturated colour by luminance, not by lightness", () => {
            // Yellow and blue of similar lightness need opposite text, which is
            // the whole reason this is not a brightness average.
            expect(readableTextOn("#ffff00")).toBe("#101010");
            expect(readableTextOn("#0000ff")).toBe("#ffffff");
            // Nothing readable to judge: white text is the safer default, since
            // an accent is normally the darker of the two.
            expect(readableTextOn("not a colour")).toBe("#ffffff");
        });
    });

    describe("the file it is saved as", () => {
        it("is the name the user gave it", () => {
            expect(themeFileName("暖沙")).toBe("暖沙.css");
            expect(themeFileName("  Kraft Paper  ")).toBe("Kraft Paper.css");
        });

        it("cannot be a path", () => {
            expect(themeFileName("../escape")).toBe("escape.css");
            expect(themeFileName("a/b")).toBe("a b.css");
            expect(themeFileName(".hidden")).toBe("hidden.css");
        });

        it("is nothing when the name is nothing", () => {
            // Refused here rather than saved as a file nobody can identify.
            expect(themeFileName("   ")).toBeNull();
            expect(themeFileName("///")).toBeNull();
            expect(themeFileName("...")).toBeNull();
        });
    });

    describe("reading a colour a browser reports", () => {
        it("takes what a computed style actually gives back", () => {
            // `getComputedStyle` answers in `rgb()`, and a colour input only
            // takes `#rrggbb`: this is the whole reason the seeding works.
            expect(toHexColor("rgb(9, 10, 11)")).toBe("#090a0b");
            expect(toHexColor("rgba(255, 0, 0, 0.5)")).toBe("#ff0000");
            expect(toHexColor("  #ABC  ")).toBe("#aabbcc");
            expect(toHexColor("#11223344")).toBe("#112233");
        });

        it("takes what the browser computes a mix into", () => {
            // Half the theme properties are a `color-mix()` over another
            // variable, and a computed one comes back as `color(srgb …)` with
            // channels in 0–1. Read as text these gave a colour input nothing,
            // so two of the ten fields opened grey.
            expect(toHexColor("color(srgb 0.110824 0.0867451 0.0744314)")).toBe(
                "#1c1613",
            );
            expect(toHexColor("color(srgb 1 1 1)")).toBe("#ffffff");
            expect(toHexColor("color(srgb 0.5 0.5 0.5 / 0.22)")).toBe("#808080");
        });

        it("says nothing for a value that is not a colour", () => {
            // A theme built on a guess is one the user cannot correct, because
            // the field would not be showing them what the theme holds.
            // Unresolved, as text: `resolvedColor` is what hands these to the
            // browser, and it is the browser that turns them into channels.
            expect(toHexColor("color-mix(in srgb, red 50%, blue)")).toBeNull();
            expect(toHexColor("var(--x)")).toBeNull();
            expect(toHexColor("")).toBeNull();
            expect(toHexColor("transparent")).toBeNull();
        });
    });
});
