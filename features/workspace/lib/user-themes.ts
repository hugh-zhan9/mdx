"use client";

import { tauriCore } from "@/common/lib/tauri";

import {
    parseUserTheme,
    userThemeId,
    userThemesCss,
    type IgnoredDeclaration,
    type ParsedUserTheme,
} from "./theme-contract";
import type { ThemeAppearance, ThemeDefinition } from "./themes";

/**
 * Loading the user's themes, and putting them on the page.
 *
 * The file text comes from Rust — the front end has no filesystem permission,
 * by design — and everything after that is this module: parse, validate, and
 * write one `<style>` element we own. The user's CSS is never handed to the
 * browser, so a theme cannot reach past the colours it declares.
 */

/** A theme file as the settings panel needs to describe it. */
export type UserThemeEntry =
    | {
          status: "ready";
          id: string;
          fileName: string;
          name: string;
          appearance: ThemeAppearance;
          /** Declarations that were refused. Shown so a typo is findable. */
          ignored: IgnoredDeclaration[];
      }
    | {
          status: "failed";
          id: string;
          fileName: string;
          /** Why this file did not become a theme. */
          reason: string;
      };

/** The element the generated rules live in. Ours, and rewritten wholesale. */
const STYLE_ELEMENT_ID = "mdx-user-themes";

/** Where the first frame's palette is remembered. See `cacheUserThemeCss`. */
const CSS_CACHE_KEY = "userThemeCss";
/** Where the first frame's theme identities are remembered. */
const META_CACHE_KEY = "userThemeMeta";

interface UserThemeFile {
    fileName: string;
    text: string | null;
    error: string | null;
}

export interface LoadedUserThemes {
    entries: UserThemeEntry[];
    /** Readable themes, for the registry and the stylesheet. */
    themes: ParsedUserTheme[];
    /** Set when the directory itself could not be read. */
    directoryError: string | null;
}

const EMPTY: LoadedUserThemes = {
    entries: [],
    themes: [],
    directoryError: null,
};

export async function loadUserThemes(): Promise<LoadedUserThemes> {
    if (!isTauriRuntime()) {
        // A browser has no theme directory to read. Not an error: the built-in
        // themes are the whole set there.
        return EMPTY;
    }

    let files: UserThemeFile[];
    try {
        const { invoke } = await tauriCore();
        files = await invoke<UserThemeFile[]>("list_user_themes");
    } catch (error) {
        return {
            ...EMPTY,
            directoryError:
                error instanceof Error ? error.message : String(error),
        };
    }

    const entries: UserThemeEntry[] = [];
    const themes: ParsedUserTheme[] = [];

    for (const file of files) {
        if (file.text === null) {
            entries.push({
                status: "failed",
                id: userThemeId(file.fileName),
                fileName: file.fileName,
                reason: file.error ?? "无法读取",
            });
            continue;
        }

        const parsed = parseUserTheme(file.fileName, file.text);
        if (!parsed.ok) {
            entries.push({
                status: "failed",
                id: userThemeId(file.fileName),
                fileName: file.fileName,
                reason: parsed.reason,
            });
            continue;
        }

        themes.push(parsed.theme);
        entries.push({
            status: "ready",
            id: parsed.theme.id,
            fileName: file.fileName,
            name: parsed.theme.name,
            appearance: parsed.theme.appearance,
            ignored: parsed.theme.ignored,
        });
    }

    return { entries, themes, directoryError: null };
}

/**
 * Installs the generated rules, replacing whatever was there.
 *
 * Wholesale replacement rather than appending, so refreshing is idempotent and a
 * theme whose file was deleted stops being addressable.
 */
export function applyUserThemesCss(themes: ParsedUserTheme[]): void {
    if (typeof document === "undefined") return;

    const css = userThemesCss(themes);
    let style = document.getElementById(STYLE_ELEMENT_ID);
    if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ELEMENT_ID;
        document.head.append(style);
    }
    style.textContent = css;
    cacheUserThemeCss(css);
    cacheUserThemeMeta(themes);
}

/**
 * Remembers the generated CSS for the next cold start.
 *
 * The pre-hydration script runs before any file can be read, so a user whose
 * chosen theme lives in a file would otherwise see one frame of a built-in
 * palette — a white flash, for anyone on a dark theme. What is cached is our own
 * generated, already-validated rules, never the user's file text, and the real
 * read replaces it a moment later; a stale cache costs one frame of old colour,
 * not a wrong state.
 */
function cacheUserThemeCss(css: string): void {
    try {
        if (css.length === 0) {
            localStorage.removeItem(CSS_CACHE_KEY);
            return;
        }
        localStorage.setItem(CSS_CACHE_KEY, css);
    } catch {
        // Private or locked-down storage. The only cost is the first frame.
    }
}

/**
 * Remembers which user themes exist and whether each is light or dark.
 *
 * The palette alone is not enough to avoid a flash. React resolves the stored
 * preference on its first render, and a preference naming a theme it has not
 * heard of falls back to following the system — which would paint a built-in
 * palette over the one the pre-hydration script had just set correctly. Knowing
 * the identities up front is what lets the first render agree with that script.
 */
function cacheUserThemeMeta(themes: ParsedUserTheme[]): void {
    try {
        if (themes.length === 0) {
            localStorage.removeItem(META_CACHE_KEY);
            return;
        }
        localStorage.setItem(
            META_CACHE_KEY,
            JSON.stringify(
                themes.map((theme) => ({
                    id: theme.id,
                    name: theme.name,
                    appearance: theme.appearance,
                })),
            ),
        );
    } catch {
        // As above: a missing cache costs a frame, never correctness.
    }
}

/**
 * The themes the last run knew about, for the first render to work from.
 *
 * Treated as a hint, not as truth: the real read replaces it within moments, and
 * a theme listed here whose file is gone stops resolving as soon as it does.
 */
export function cachedUserThemes(): ThemeDefinition[] {
    if (typeof localStorage === "undefined") return [];
    try {
        const stored = localStorage.getItem(META_CACHE_KEY);
        if (!stored) return [];
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap((entry) => {
            if (typeof entry !== "object" || entry === null) return [];
            const { id, name, appearance } = entry as Record<string, unknown>;
            if (typeof id !== "string" || !id.startsWith("user:")) return [];
            if (appearance !== "light" && appearance !== "dark") return [];
            return [
                {
                    id,
                    name: typeof name === "string" ? name : id,
                    description: "",
                    appearance,
                },
            ];
        });
    } catch {
        return [];
    }
}

function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
