"use client";

import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "themePreference";
const LEGACY_STORAGE_KEY = "theme";
const CHANGE_EVENT = "mdx-theme-change";

export function resolveThemePreference(
    preference: string | null | undefined,
): ThemePreference {
    return preference === "light" ||
        preference === "dark" ||
        preference === "system"
        ? preference
        : "system";
}

export function themeFromPreference(
    preference: ThemePreference,
    osPrefersDark: boolean,
): ResolvedTheme {
    if (preference === "dark" || preference === "light") {
        return preference;
    }

    return osPrefersDark ? "dark" : "light";
}

export function useThemePreference() {
    const preference = useSyncExternalStore<ThemePreference>(
        subscribeToThemePreference,
        readThemePreference,
        () => "system",
    );
    const resolvedTheme = themeFromPreference(preference, osPrefersDark());

    useEffect(() => {
        void syncNativeTheme(resolvedTheme).catch((error) => {
            console.warn("Failed to sync native app theme.", error);
        });
    }, [resolvedTheme]);

    return {
        preference,
        resolvedTheme,
        setPreference: applyThemePreference,
    };
}

export function readThemePreference(): ThemePreference {
    if (typeof localStorage === "undefined") {
        return "system";
    }

    try {
        const stored = localStorage.getItem(STORAGE_KEY);

        if (stored) {
            return resolveThemePreference(stored);
        }

        return resolveThemePreference(localStorage.getItem(LEGACY_STORAGE_KEY));
    } catch {
        return "system";
    }
}

export function applyThemePreference(preference: ThemePreference) {
    if (typeof document === "undefined") {
        return;
    }

    const resolvedPreference = resolveThemePreference(preference);
    const theme = themeFromPreference(resolvedPreference, osPrefersDark());
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    try {
        localStorage.setItem(STORAGE_KEY, resolvedPreference);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
        // Ignore storage failures in private or locked-down environments.
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribeToThemePreference(callback: () => void) {
    if (typeof window === "undefined") {
        return () => {};
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) {
            callback();
        }
    };
    const handleSystemThemeChange = () => {
        if (readThemePreference() === "system") {
            applyThemePreference("system");
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
    return (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    );
}

async function syncNativeTheme(theme: ResolvedTheme) {
    if (!isTauriRuntime()) {
        return;
    }

    const { setTheme } = await import("@tauri-apps/api/app");
    await setTheme(theme);
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}
