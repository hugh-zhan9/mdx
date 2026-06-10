import { describe, expect, it } from "vitest";
import {
    appPreferencesEqual,
    createDefaultAppPreferences,
    normalizeAppPreferences,
    parsePositiveIntegerSetting,
} from "./preferences";

describe("workspace preferences", () => {
    it("defaults file watching and bounded search settings", () => {
        expect(createDefaultAppPreferences()).toEqual({
            fileTreeExcludeDirs: [],
            fileWatchEnabled: true,
            searchMaxFileBytes: 2_097_152,
            searchMaxResults: 200,
            searchMaxMatchesPerFile: 20,
        });
    });

    it("normalizes old app state preferences", () => {
        expect(
            normalizeAppPreferences({
                fileTreeExcludeDirs: [" vendor ", "docs/archive", "../bad"],
            }),
        ).toEqual({
            fileTreeExcludeDirs: ["vendor", "docs/archive"],
            fileWatchEnabled: true,
            searchMaxFileBytes: 2_097_152,
            searchMaxResults: 200,
            searchMaxMatchesPerFile: 20,
        });
    });

    it("clamps invalid numeric search limits", () => {
        expect(
            normalizeAppPreferences({
                fileTreeExcludeDirs: [],
                fileWatchEnabled: false,
                searchMaxFileBytes: 8,
                searchMaxResults: 50_000,
                searchMaxMatchesPerFile: -1,
            }),
        ).toEqual({
            fileTreeExcludeDirs: [],
            fileWatchEnabled: false,
            searchMaxFileBytes: 1_024,
            searchMaxResults: 5_000,
            searchMaxMatchesPerFile: 1,
        });
    });

    it("parses positive integer settings with fallback and bounds", () => {
        expect(parsePositiveIntegerSetting("2048", 1024, 4096, 2000)).toBe(
            2048,
        );
        expect(parsePositiveIntegerSetting("bad", 1024, 4096, 2000)).toBe(
            2000,
        );
        expect(parsePositiveIntegerSetting("1", 1024, 4096, 2000)).toBe(1024);
        expect(parsePositiveIntegerSetting("9000", 1024, 4096, 2000)).toBe(
            4096,
        );
    });

    it("compares every stored preference field", () => {
        const base = createDefaultAppPreferences();
        expect(appPreferencesEqual(base, { ...base })).toBe(true);
        expect(appPreferencesEqual(base, { ...base, fileWatchEnabled: false })).toBe(false);
        expect(appPreferencesEqual(base, { ...base, searchMaxResults: 300 })).toBe(false);
    });
});
