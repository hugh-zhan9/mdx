"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
    SYSTEM_THEME_IDS,
    findTheme,
    type ThemeAppearance,
} from "./themes";

/**
 * `"system"`, or the id of a theme.
 *
 * `"light"` and `"dark"` remain valid values because they are theme ids, which
 * is what keeps every preference stored by an earlier version meaningful.
 */
export type ThemePreference = string;
/** The id of the theme actually in effect. */
export type ResolvedTheme = string;

const STORAGE_KEY = "themePreference";
const LEGACY_STORAGE_KEY = "theme";
const CHANGE_EVENT = "mdx-theme-change";

export const SYSTEM_THEME_PREFERENCE = "system";

export function resolveThemePreference(
    preference: string | null | undefined,
): ThemePreference {
    if (preference === SYSTEM_THEME_PREFERENCE) return SYSTEM_THEME_PREFERENCE;
    // A theme that no longer exists — one the user imported and then removed,
    // or one a later version dropped — must not leave the application with no
    // palette at all, so following the system is what it falls back to.
    return preference && findTheme(preference)
        ? preference
        : SYSTEM_THEME_PREFERENCE;
}

export function themeFromPreference(
    preference: ThemePreference,
    osPrefersDark: boolean,
): ResolvedTheme {
    if (preference !== SYSTEM_THEME_PREFERENCE && findTheme(preference)) {
        return preference;
    }

    return SYSTEM_THEME_IDS[osPrefersDark ? "dark" : "light"];
}

/** Whether the theme in effect sits on a light or a dark ground. */
export function appearanceOfTheme(themeId: string): ThemeAppearance {
    return findTheme(themeId)?.appearance ?? "light";
}

export function useThemePreference() {
    const preference = useSyncExternalStore<ThemePreference>(
        subscribeToThemePreference,
        readThemePreference,
        () => SYSTEM_THEME_PREFERENCE,
    );
    const resolvedTheme = themeFromPreference(preference, osPrefersDark());

    useEffect(() => {
        void syncNativeThemePreference(preference, resolvedTheme).catch((error) => {
            console.warn("Failed to sync native app theme.", error);
        });
    }, [preference, resolvedTheme]);

    return {
        preference,
        resolvedTheme,
        setPreference: applyThemePreference,
    };
}

export function readThemePreference(): ThemePreference {
    if (typeof localStorage === "undefined") {
        return SYSTEM_THEME_PREFERENCE;
    }

    try {
        const stored = localStorage.getItem(STORAGE_KEY);

        if (stored) {
            return resolveThemePreference(stored);
        }

        return resolveThemePreference(localStorage.getItem(LEGACY_STORAGE_KEY));
    } catch {
        return SYSTEM_THEME_PREFERENCE;
    }
}

export function applyThemePreference(preference: ThemePreference) {
    if (typeof document === "undefined") {
        return;
    }

    const resolvedPreference = resolveThemePreference(preference);
    const theme = themeFromPreference(resolvedPreference, osPrefersDark());
    applyResolvedTheme(theme);

    try {
        localStorage.setItem(STORAGE_KEY, resolvedPreference);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
        // Ignore storage failures in private or locked-down environments.
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribeToThemePreference(callback: () => void) {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) {
            callback();
        }
    };
    const handleSystemThemeChange = () => {
        if (readThemePreference() === SYSTEM_THEME_PREFERENCE) {
            applyThemePreference(SYSTEM_THEME_PREFERENCE);
            callback();
        }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHANGE_EVENT, callback);
    media.addEventListener("change", handleSystemThemeChange);

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(CHANGE_EVENT, callback);
        media.removeEventListener("change", handleSystemThemeChange);
    };
}

function osPrefersDark() {
    // `matchMedia` is checked rather than assumed: not every environment this
    // runs in provides it, and an environment that cannot report the OS
    // appearance should resolve to the light default rather than throw on a
    // path that is only trying to pick a colour.
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    );
}

async function syncNativeTheme(appearance: ThemeAppearance | null) {
    if (!isTauriRuntime()) {
        return;
    }

    const { setTheme } = await import("@tauri-apps/api/app");
    // macOS draws the title bar and native menus itself and knows nothing of
    // our palettes, so it is told the appearance rather than the theme.
    await setTheme(appearance);
}

async function syncNativeThemePreference(
    preference: ThemePreference,
    resolvedTheme: ResolvedTheme,
) {
    if (preference !== SYSTEM_THEME_PREFERENCE) {
        await syncNativeTheme(appearanceOfTheme(resolvedTheme));
        return;
    }

    await syncNativeTheme(null);
    applyResolvedTheme(
        themeFromPreference(SYSTEM_THEME_PREFERENCE, osPrefersDark()),
    );
}

function applyResolvedTheme(theme: ResolvedTheme) {
    if (typeof document === "undefined") {
        return;
    }

    // Two attributes, because two questions are being answered: which palette
    // to paint with, and whether that palette is light or dark. Everything that
    // only needs the second — scrollbars, form controls, syntax colors — reads
    // the appearance and stays correct as themes are added.
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mdxAppearance = appearanceOfTheme(theme);
    document.documentElement.style.colorScheme = appearanceOfTheme(theme);
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}
