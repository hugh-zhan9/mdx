import type { AppPreferences } from "./types";

const DEFAULT_SEARCH_MAX_FILE_BYTES = 2_097_152;
const DEFAULT_SEARCH_MAX_RESULTS = 200;
const DEFAULT_SEARCH_MAX_MATCHES_PER_FILE = 20;

const MIN_SEARCH_MAX_FILE_BYTES = 1_024;
const MAX_SEARCH_MAX_FILE_BYTES = 52_428_800;
const MIN_SEARCH_MAX_RESULTS = 1;
const MAX_SEARCH_MAX_RESULTS = 5_000;
const MIN_SEARCH_MAX_MATCHES_PER_FILE = 1;
const MAX_SEARCH_MAX_MATCHES_PER_FILE = 500;

export function createDefaultAppPreferences(): AppPreferences {
    return {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: DEFAULT_SEARCH_MAX_FILE_BYTES,
        searchMaxResults: DEFAULT_SEARCH_MAX_RESULTS,
        searchMaxMatchesPerFile: DEFAULT_SEARCH_MAX_MATCHES_PER_FILE,
    };
}

export function normalizeAppPreferences(
    preferences: Partial<AppPreferences> | undefined,
): AppPreferences {
    return {
        fileTreeExcludeDirs: normalizeExcludeDirs(
            preferences?.fileTreeExcludeDirs,
        ),
        fileWatchEnabled: preferences?.fileWatchEnabled !== false,
        searchMaxFileBytes: clampInteger(
            preferences?.searchMaxFileBytes,
            MIN_SEARCH_MAX_FILE_BYTES,
            MAX_SEARCH_MAX_FILE_BYTES,
            DEFAULT_SEARCH_MAX_FILE_BYTES,
        ),
        searchMaxResults: clampInteger(
            preferences?.searchMaxResults,
            MIN_SEARCH_MAX_RESULTS,
            MAX_SEARCH_MAX_RESULTS,
            DEFAULT_SEARCH_MAX_RESULTS,
        ),
        searchMaxMatchesPerFile: clampInteger(
            preferences?.searchMaxMatchesPerFile,
            MIN_SEARCH_MAX_MATCHES_PER_FILE,
            MAX_SEARCH_MAX_MATCHES_PER_FILE,
            DEFAULT_SEARCH_MAX_MATCHES_PER_FILE,
        ),
    };
}

export function appPreferencesEqual(
    left: AppPreferences,
    right: AppPreferences,
) {
    return (
        stringListsEqual(
            left.fileTreeExcludeDirs,
            right.fileTreeExcludeDirs,
        ) &&
        left.fileWatchEnabled === right.fileWatchEnabled &&
        left.searchMaxFileBytes === right.searchMaxFileBytes &&
        left.searchMaxResults === right.searchMaxResults &&
        left.searchMaxMatchesPerFile === right.searchMaxMatchesPerFile
    );
}

function clampInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(Math.max(Math.round(value), min), max);
}

function stringListsEqual(left: string[], right: string[]) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((item, index) => item === right[index]);
}

function normalizeExcludeDirs(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(
        new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.replaceAll("\\", "/").trim())
                .map((item) => item.replace(/^\/+|\/+$/g, ""))
                .filter((item) => item.length > 0)
                .filter(
                    (item) =>
                        !item
                            .split("/")
                            .some((part) => part === "." || part === ".."),
                ),
        ),
    );
}
