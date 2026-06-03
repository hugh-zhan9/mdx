import { describe, expect, it } from "vitest";
import {
    resolveThemePreference,
    themeFromPreference,
} from "./theme-preference";

describe("theme preference", () => {
    it("accepts light, dark, and system preferences", () => {
        expect(resolveThemePreference("light")).toBe("light");
        expect(resolveThemePreference("dark")).toBe("dark");
        expect(resolveThemePreference("system")).toBe("system");
    });

    it("falls back to system for unknown preferences", () => {
        expect(resolveThemePreference("unknown")).toBe("system");
        expect(resolveThemePreference(null)).toBe("system");
    });

    it("resolves system preference from the current OS theme", () => {
        expect(themeFromPreference("system", true)).toBe("dark");
        expect(themeFromPreference("system", false)).toBe("light");
        expect(themeFromPreference("dark", false)).toBe("dark");
        expect(themeFromPreference("light", true)).toBe("light");
    });
});
