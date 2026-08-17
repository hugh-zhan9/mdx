/**
 * The themes the product ships, and what a theme is.
 *
 * A theme is a set of CSS custom properties, nothing more. It carries no
 * behaviour and no layout: switching one changes how the application looks and
 * never what it does. That is what makes a user-supplied theme safe to load —
 * see `theme-contract.md` for the properties a theme may set, which is a public
 * contract precisely because people write files against it.
 *
 * Every theme declares its own appearance rather than deriving it. The window
 * chrome macOS draws around us, the `color-scheme` the WebView uses for
 * scrollbars and form controls, and the syntax-highlighting palette all need to
 * know whether they are on a light or a dark ground, and a theme is the only
 * thing that knows.
 */

export type ThemeAppearance = "light" | "dark";

export interface ThemeDefinition {
    /** Stable identity. Persisted, and written into `data-theme`. */
    id: string;
    /** What the user sees in the theme list. */
    name: string;
    /** One line on what the theme is for, shown beside the name. */
    description: string;
    appearance: ThemeAppearance;
}

/**
 * Themes built into the application.
 *
 * Deliberately few. A short list of themes that each have a reason to exist is
 * more useful than a long one where most are a hue rotation of another, and
 * every one of these has to be maintained against every surface the product
 * grows.
 */
export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
    {
        id: "light",
        name: "浅色",
        description: "macOS 系统浅色，克制的灰阶与系统蓝。",
        appearance: "light",
    },
    {
        id: "paper",
        name: "纸感",
        description: "暖白纸张与墨黑正文，适合长时间写作。",
        appearance: "light",
    },
    {
        id: "graphite",
        name: "石墨",
        description: "冷灰调，弱化的强调色，信息密度优先。",
        appearance: "light",
    },
    {
        id: "dark",
        name: "深色",
        description: "macOS 系统深色，柔和的黑与系统蓝。",
        appearance: "dark",
    },
    {
        id: "midnight",
        name: "午夜",
        description: "接近纯黑，适合暗环境与 OLED 屏幕。",
        appearance: "dark",
    },
    {
        id: "ink",
        name: "墨蓝",
        description: "蓝黑基调，低对比，长时间阅读不刺眼。",
        appearance: "dark",
    },
] as const;

/** The theme used when a stored preference names one that no longer exists. */
export const FALLBACK_THEME_ID = "light";

/** The theme a system-following preference resolves to, by OS appearance. */
export const SYSTEM_THEME_IDS: Record<ThemeAppearance, string> = {
    light: "light",
    dark: "dark",
};

export function findBuiltInTheme(id: string): ThemeDefinition | undefined {
    return BUILT_IN_THEMES.find((theme) => theme.id === id);
}

/**
 * Themes loaded from the user's own files, by id.
 *
 * Module state because the answer to "does this theme exist, and is it dark" has
 * to be available to code that cannot await a file read: the preference resolver
 * runs synchronously, and a `useSyncExternalStore` snapshot cannot be a promise.
 * It is written once per load and read everywhere else.
 */
let userThemes: ThemeDefinition[] = [];

export function setUserThemes(themes: ThemeDefinition[]): void {
    userThemes = themes;
}

export function getUserThemes(): readonly ThemeDefinition[] {
    return userThemes;
}

/**
 * Any theme that currently exists, built-in or loaded from a file.
 *
 * This is what decides whether a stored preference still names something. A
 * theme whose file was deleted stops resolving here, which is what makes the
 * fallback to following the system happen on its own.
 */
export function findTheme(id: string): ThemeDefinition | undefined {
    return findBuiltInTheme(id) ?? userThemes.find((theme) => theme.id === id);
}

/** Built-in themes grouped by appearance, for a list that reads in sections. */
export function builtInThemesByAppearance(): Record<
    ThemeAppearance,
    ThemeDefinition[]
> {
    return {
        light: BUILT_IN_THEMES.filter((theme) => theme.appearance === "light"),
        dark: BUILT_IN_THEMES.filter((theme) => theme.appearance === "dark"),
    };
}
