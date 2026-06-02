"use client";

import { useEffect, useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark";

export function ThemeToggleButton() {
    const theme = useSyncExternalStore<ThemeMode>(
        subscribeToTheme,
        readTheme,
        () => "light",
    );

    const toggleTheme = () => {
        applyTheme(theme === "dark" ? "light" : "dark");
    };

    useEffect(() => {
        void syncNativeTheme(theme).catch((error) => {
            console.warn("Failed to sync native app theme.", error);
        });
    }, [theme]);

    return (
        <button
            type="button"
            className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300"
            onClick={toggleTheme}
            aria-label={
                theme === "dark"
                    ? "切换到浅色模式"
                    : "切换到深色模式"
            }
            title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
            {theme === "dark" ? "浅色" : "深色"}
        </button>
    );
}

function readTheme(): ThemeMode {
    if (typeof document === "undefined") {
        return "light";
    }

    return document.documentElement.dataset.theme === "dark"
        ? "dark"
        : "light";
}

function applyTheme(theme: ThemeMode) {
    if (typeof document === "undefined") {
        return;
    }

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    try {
        localStorage.setItem("theme", theme);
    } catch {
        // Ignore storage failures in private or locked-down environments.
    }

    window.dispatchEvent(new Event("mdx-theme-change"));
}

async function syncNativeTheme(theme: ThemeMode) {
    if (!isTauriRuntime()) {
        return;
    }

    const { setTheme } = await import("@tauri-apps/api/app");
    await setTheme(theme);
}

function subscribeToTheme(callback: () => void) {
    if (typeof window === "undefined") {
        return () => {};
    }

    const handleStorage = (event: StorageEvent) => {
        if (event.key === "theme") {
            callback();
        }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("mdx-theme-change", callback);

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener("mdx-theme-change", callback);
    };
}

function isTauriRuntime() {
    return (
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window
    );
}
