import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    BUILT_IN_THEMES,
    SYSTEM_THEME_IDS,
    builtInThemesByAppearance,
    findBuiltInTheme,
} from "./themes";
import {
    SYSTEM_THEME_PREFERENCE,
    appearanceOfTheme,
    resolveThemePreference,
    themeFromPreference,
} from "./theme-preference";

/**
 * The theme registry, and the two places that have to agree with it.
 *
 * A theme is only real if three things know about it: the registry, the
 * stylesheet that defines its palette, and the script that runs before React
 * hydrates. The first is the source of truth; the other two are checked here,
 * because a theme missing from either fails in a way no type can catch — the
 * palette silently falls back, or the first frame paints with the wrong
 * scrollbars.
 */

const STYLESHEET = readFileSync("app/globals.css", "utf8");
const LAYOUT = readFileSync("app/layout.tsx", "utf8");

describe("built-in themes", () => {
    it("gives every theme a palette in the stylesheet", () => {
        const undefined_ = BUILT_IN_THEMES.filter(
            (theme) => !STYLESHEET.includes(`name: "${theme.id}"`),
        ).map((theme) => theme.id);

        expect(undefined_).toEqual([]);
    });

    it("tells the pre-hydration script which themes are dark", () => {
        // That script runs as a string, before any module loads, so it carries
        // its own copy of this fact. A dark theme missing from it paints its
        // first frame with light scrollbars and form controls.
        const darkTable = LAYOUT.slice(
            LAYOUT.indexOf("var DARK = {"),
            LAYOUT.indexOf("}", LAYOUT.indexOf("var DARK = {")),
        );
        const missing = BUILT_IN_THEMES.filter(
            (theme) => theme.appearance === "dark" && !darkTable.includes(theme.id),
        ).map((theme) => theme.id);
        const overclaimed = BUILT_IN_THEMES.filter(
            (theme) => theme.appearance === "light" && darkTable.includes(theme.id),
        ).map((theme) => theme.id);

        expect({ missing, overclaimed }).toEqual({
            missing: [],
            overclaimed: [],
        });
    });

    it("keeps ids unique, since one names a stored preference", () => {
        const ids = BUILT_IN_THEMES.map((theme) => theme.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it("resolves the themes the system preference maps to", () => {
        expect(findBuiltInTheme(SYSTEM_THEME_IDS.light)?.appearance).toBe(
            "light",
        );
        expect(findBuiltInTheme(SYSTEM_THEME_IDS.dark)?.appearance).toBe("dark");
    });

    it("offers both a light and a dark group to choose from", () => {
        const groups = builtInThemesByAppearance();

        expect(groups.light.length).toBeGreaterThan(0);
        expect(groups.dark.length).toBeGreaterThan(0);
        expect(groups.light.length + groups.dark.length).toBe(
            BUILT_IN_THEMES.length,
        );
    });
});

describe("theme preference", () => {
    it("keeps preferences stored before themes existed meaningful", () => {
        // `light` and `dark` were the only values an earlier version could
        // store, and both are still theme ids.
        expect(resolveThemePreference("light")).toBe("light");
        expect(resolveThemePreference("dark")).toBe("dark");
        expect(resolveThemePreference(SYSTEM_THEME_PREFERENCE)).toBe(
            SYSTEM_THEME_PREFERENCE,
        );
    });

    it("falls back to the system for a theme that no longer exists", () => {
        // A theme the user removed, or one a later version dropped. Leaving the
        // application with no palette at all is the one outcome not allowed.
        expect(resolveThemePreference("a-theme-that-was-deleted")).toBe(
            SYSTEM_THEME_PREFERENCE,
        );
        expect(resolveThemePreference(null)).toBe(SYSTEM_THEME_PREFERENCE);
        expect(resolveThemePreference("")).toBe(SYSTEM_THEME_PREFERENCE);
    });

    it("follows the OS only when asked to", () => {
        expect(themeFromPreference(SYSTEM_THEME_PREFERENCE, true)).toBe(
            SYSTEM_THEME_IDS.dark,
        );
        expect(themeFromPreference(SYSTEM_THEME_PREFERENCE, false)).toBe(
            SYSTEM_THEME_IDS.light,
        );
        // A chosen theme is not overridden by the OS switching appearance.
        expect(themeFromPreference("paper", true)).toBe("paper");
        expect(themeFromPreference("midnight", false)).toBe("midnight");
    });

    it("reports the appearance the window chrome should use", () => {
        expect(appearanceOfTheme("paper")).toBe("light");
        expect(appearanceOfTheme("ink")).toBe("dark");
        // An unknown theme is not a reason to have no answer.
        expect(appearanceOfTheme("nonexistent")).toBe("light");
    });
});
