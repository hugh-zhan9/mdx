import type { ThemeAppearance } from "./themes";

/**
 * The public contract a user-written theme file is written against.
 *
 * A theme is data, not code. This module reads a `.css` file as text, takes out
 * the declarations it recognises, checks each value, and hands back the internal
 * custom properties to set. Nothing from the file is ever given to the browser
 * to execute: selectors, `@import`, `@media`, `url()` and unrecognised
 * properties are not extracted, so they cannot reach the page.
 *
 * That is a deliberate departure from ColaMD, whose themes also carry direct
 * selectors reaching into the editor's own rendered elements. Three reasons, in
 * order of weight: `docs/loopx/specs/editor.md` forbids third-party theme
 * classes from depending on implementation-private editor DOM; a stylesheet
 * keyed to DOM structure rots silently, as this repo learned when 66 selectors
 * written against a deleted editor's contract stopped matching anything while
 * the whole test suite stayed green; and an arbitrary rule can hide the UI,
 * including the settings entry needed to change the theme back.
 *
 * The contract names are ours (`--mdx-theme-*`) rather than daisyUI's
 * (`--color-base-100`). Exposing the framework's names would promote "which UI
 * framework we currently use" into a promise we could never take back.
 */

/** Every property a theme file may set. Adding is additive; renaming is not. */
export const THEME_CONTRACT_PROPERTIES = [
    "--mdx-theme-name",
    "--mdx-theme-appearance",
    "--mdx-theme-bg",
    "--mdx-theme-surface",
    "--mdx-theme-chrome",
    "--mdx-theme-text",
    "--mdx-theme-border",
    "--mdx-theme-accent",
    "--mdx-theme-link",
    "--mdx-theme-code-bg",
    "--mdx-theme-selection",
    "--mdx-theme-highlight",
    "--mdx-theme-body-font",
    "--mdx-theme-mono-font",
] as const;

export type ThemeContractProperty = (typeof THEME_CONTRACT_PROPERTIES)[number];

/** What kind of value a contract property takes. */
type ValueKind = "color" | "appearance" | "name" | "font";

const PROPERTY_KINDS: Record<ThemeContractProperty, ValueKind> = {
    "--mdx-theme-name": "name",
    "--mdx-theme-appearance": "appearance",
    "--mdx-theme-bg": "color",
    "--mdx-theme-surface": "color",
    "--mdx-theme-chrome": "color",
    "--mdx-theme-text": "color",
    "--mdx-theme-border": "color",
    "--mdx-theme-accent": "color",
    "--mdx-theme-link": "color",
    "--mdx-theme-code-bg": "color",
    "--mdx-theme-selection": "color",
    "--mdx-theme-highlight": "color",
    "--mdx-theme-body-font": "font",
    "--mdx-theme-mono-font": "font",
};

/**
 * Which internal properties each contract property drives.
 *
 * This table is the whole reason the contract can outlive its implementation.
 * The names on the left are promised to users; the names on the right are ours
 * to change, and changing them is an edit to this table rather than a break for
 * everyone's theme file.
 */
const PROPERTY_TARGETS: Partial<Record<ThemeContractProperty, string[]>> = {
    "--mdx-theme-bg": ["--color-base-100", "--mdx-content-bg"],
    "--mdx-theme-surface": [
        "--color-base-200",
        "--mdx-sidebar-bg",
        "--mdx-chrome-bg",
    ],
    // Listed after surface so a theme that sets both wins on the more specific
    // one; `themeDeclarations` relies on that order.
    "--mdx-theme-chrome": ["--mdx-chrome-bg"],
    "--mdx-theme-text": ["--color-base-content"],
    "--mdx-theme-border": ["--color-base-300", "--mdx-separator"],
    "--mdx-theme-accent": ["--color-primary"],
    "--mdx-theme-link": ["--color-info"],
    "--mdx-theme-code-bg": ["--mdx-code-bg"],
    "--mdx-theme-selection": ["--mdx-selection-bg"],
    "--mdx-theme-highlight": ["--color-warning"],
    "--mdx-theme-body-font": ["--mdx-editor-font"],
    "--mdx-theme-mono-font": ["--mdx-mono-font"],
};

/** Longest value accepted, before any other check. */
const MAX_VALUE_LENGTH = 200;
/** Longest theme file read at all. Not a place for a CSS framework. */
export const MAX_THEME_FILE_BYTES = 64 * 1024;

/**
 * Words and characters refused in every value.
 *
 * A denylist would be the wrong instrument for CSS values on its own — the
 * allowlisted shapes below are what actually decide — but these are checked
 * first so that a value which merely *looks* like a colour cannot smuggle one
 * of them through.
 */
const FORBIDDEN = /[{}@\\<>;]|url|javascript|expression|image-set|element|var\(/i;

const NAMED_COLORS = new Set([
    "transparent",
    "currentcolor",
    "black",
    "white",
    "red",
    "green",
    "blue",
    "yellow",
    "orange",
    "purple",
    "gray",
    "grey",
    "brown",
    "pink",
    "cyan",
    "magenta",
    "teal",
    "navy",
    "olive",
    "maroon",
    "silver",
    "gold",
    "beige",
    "ivory",
    "khaki",
    "coral",
    "salmon",
    "crimson",
    "indigo",
    "violet",
    "turquoise",
    "lavender",
]);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/i;
const FONT_STACK = /^[A-Za-z0-9\u00c0-\u024f\s,.'"-]+$/;
const QUOTED_NAME = /^(?:"([^"\\]*)"|'([^'\\]*)')$/;

/** A contract property whose value was refused, and why. */
export interface IgnoredDeclaration {
    property: string;
    reason: string;
}

export interface ParsedUserTheme {
    /** `user:<file stem>`. Disjoint from built-in ids by construction. */
    id: string;
    name: string;
    appearance: ThemeAppearance;
    /** Internal custom properties to set, already validated. */
    declarations: Record<string, string>;
    /**
     * Contract properties that were present but refused. Surfaced to the user:
     * a silently dropped colour is one they will stare at wondering why it did
     * nothing.
     */
    ignored: IgnoredDeclaration[];
}

export type UserThemeParse =
    | { ok: true; theme: ParsedUserTheme }
    | { ok: false; reason: string };

/** Turns `kraft.css` into the id `user:kraft`. */
export function userThemeId(fileName: string): string {
    return `user:${fileName.replace(/\.css$/i, "")}`;
}

/**
 * Reads a theme file.
 *
 * Selectors are not parsed and not honoured — a declaration counts wherever it
 * appears in the file. That keeps a ColaMD-shaped file partly usable, and it
 * means we never have to answer "which selector wins", a question whose answers
 * are exactly the ones that let a theme reach into the DOM.
 */
export function parseUserTheme(fileName: string, text: string): UserThemeParse {
    if (text.length > MAX_THEME_FILE_BYTES) {
        return {
            ok: false,
            reason: `文件超过 ${String(Math.floor(MAX_THEME_FILE_BYTES / 1024))} KiB 上限`,
        };
    }

    const found = new Map<ThemeContractProperty, string>();
    const ignored: IgnoredDeclaration[] = [];

    for (const property of THEME_CONTRACT_PROPERTIES) {
        const raw = lastDeclaredValue(text, property);
        if (raw === null) continue;

        const checked = checkValue(PROPERTY_KINDS[property], raw);
        if (checked === null) {
            ignored.push({ property, reason: `值不是合法的 ${describeKind(PROPERTY_KINDS[property])}` });
            continue;
        }
        found.set(property, checked);
    }

    if (found.size === 0 && ignored.length === 0) {
        return {
            ok: false,
            reason: "未找到任何 --mdx-theme-* 声明",
        };
    }

    const appearance = found.get("--mdx-theme-appearance");
    if (appearance !== "light" && appearance !== "dark") {
        // The only field whose absence rejects the whole theme. Scrollbars, form
        // controls, syntax colours and the native title bar all read it, so a
        // guess would be wrong in four places at once — and a dark theme with
        // light scrollbars is harder to diagnose than a theme that says why it
        // did not load.
        return {
            ok: false,
            reason: "缺少 --mdx-theme-appearance: light 或 dark",
        };
    }

    return {
        ok: true,
        theme: {
            id: userThemeId(fileName),
            name:
                found.get("--mdx-theme-name") ??
                fileName.replace(/\.css$/i, ""),
            appearance,
            declarations: themeDeclarations(found),
            ignored,
        },
    };
}

/** The internal properties a parsed theme sets, in application order. */
function themeDeclarations(
    found: Map<ThemeContractProperty, string>,
): Record<string, string> {
    const declarations: Record<string, string> = {};
    // Contract order, so a later property overrides an earlier one's target —
    // which is how `chrome` refines what `surface` set.
    for (const property of THEME_CONTRACT_PROPERTIES) {
        const value = found.get(property);
        if (value === undefined) continue;
        for (const target of PROPERTY_TARGETS[property] ?? []) {
            declarations[target] = value;
        }
    }
    return declarations;
}

/**
 * The stylesheet text for a set of parsed themes.
 *
 * Built property by property from validated values rather than by pasting the
 * user's text, so there is no string for a value to break out of.
 */
export function userThemesCss(themes: ParsedUserTheme[]): string {
    return themes
        .map((theme) => {
            const body = Object.entries(theme.declarations)
                .map(([property, value]) => `  ${property}: ${value};`)
                .join("\n");
            return `[data-theme="${cssIdentifierSafe(theme.id)}"] {\n${body}\n}`;
        })
        .join("\n\n");
}

/**
 * The id as it may appear inside a selector string.
 *
 * Ids come from file names, which the user controls, so the one place a name
 * reaches CSS is narrowed to characters that cannot end the attribute selector.
 */
function cssIdentifierSafe(id: string): string {
    return id.replace(/[^A-Za-z0-9_:.-]/g, "-");
}

/**
 * The last value declared for `property` anywhere in the file.
 *
 * Last rather than first, because that is what the cascade would have done for
 * two declarations at equal specificity, and it is what a user editing their own
 * file down the page expects.
 */
function lastDeclaredValue(text: string, property: string): string | null {
    const pattern = new RegExp(`${escapeRegExp(property)}\\s*:([^;}\\n]*)`, "gi");
    let value: string | null = null;
    for (const match of text.matchAll(pattern)) {
        const candidate = match[1]?.trim();
        if (candidate) value = candidate;
    }
    return value;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describeKind(kind: ValueKind): string {
    switch (kind) {
        case "color":
            return "颜色";
        case "appearance":
            return "light / dark";
        case "name":
            return "带引号的名称";
        case "font":
            return "字体族";
    }
}

/** The value to use, or null when it is refused. */
function checkValue(kind: ValueKind, raw: string): string | null {
    const value = raw.replace(/\s*!important$/i, "").trim();
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return null;

    if (kind === "name") {
        // Returned unquoted: the name is shown in the theme list, not written
        // into CSS, so the quotes are the file's syntax rather than part of the
        // value. Requiring them is still how a name is told apart from a
        // stray keyword.
        const quoted = QUOTED_NAME.exec(value);
        const name = quoted?.[1] ?? quoted?.[2];
        if (name === undefined || name.length === 0 || name.length > 40) {
            return null;
        }
        return name;
    }

    if (FORBIDDEN.test(value)) return null;

    switch (kind) {
        case "appearance":
            return value === "light" || value === "dark" ? value : null;
        case "color":
            if (HEX.test(value)) return value;
            if (COLOR_FUNCTION.test(value)) return value;
            return NAMED_COLORS.has(value.toLowerCase()) ? value : null;
        case "font":
            return FONT_STACK.test(value) ? value : null;
    }
}
