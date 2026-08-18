"use client";

import { tauriCore } from "@/common/lib/tauri";

import type { ThemeAppearance } from "./themes";

/**
 * Making a theme inside the application.
 *
 * A theme is still only a file of `--mdx-theme-*` declarations — the same public
 * contract a hand-written one uses, read back by the same parser. This module
 * writes that file; it invents no second format and no private channel. What is
 * made here can be opened in an editor afterwards, and what was written by hand
 * can be opened here.
 *
 * Everything it produces is checked again on the way back in, by
 * `theme-contract.ts`. That is deliberate: this side is a convenience, not the
 * authority, and a value that slipped through here would still have to satisfy
 * the contract before it reached the page.
 */

/** One colour the designer offers, in contract order. */
export interface ThemeDesignerField {
    /** The contract property this writes. */
    property: string;
    /** What the field is called, in the product's language. */
    label: string;
    /** One line on what it paints, so a choice is not a guess. */
    hint: string;
    /** The internal property to read a starting value from. */
    seed: string;
}

/**
 * The colours a theme is made of, and where each one lands.
 *
 * Ten, because that is what the contract has: fewer would leave parts of the
 * window unreachable, and offering a field that paints nothing would be worse
 * than the length of the list. Every one starts from the theme already on
 * screen, so a new theme is an edit rather than a blank canvas.
 */
export const THEME_DESIGNER_FIELDS: readonly ThemeDesignerField[] = [
    {
        property: "--mdx-theme-bg",
        label: "正文底色",
        hint: "文档所在的那张纸。",
        seed: "--color-base-100",
    },
    {
        property: "--mdx-theme-surface",
        label: "侧栏底色",
        hint: "文件树、笔记列表这些围着文档的区域。",
        seed: "--color-base-200",
    },
    {
        property: "--mdx-theme-chrome",
        label: "标题栏底色",
        hint: "窗口最上面那条。留同侧栏色也行。",
        seed: "--mdx-chrome-bg",
    },
    {
        property: "--mdx-theme-text",
        label: "正文颜色",
        hint: "文字本身。与底色的对比决定了能不能久看。",
        seed: "--color-base-content",
    },
    {
        property: "--mdx-theme-border",
        label: "分隔线",
        hint: "栏与栏之间、代码块四周的那道线。",
        seed: "--color-base-300",
    },
    {
        property: "--mdx-theme-accent",
        label: "强调色",
        hint: "按钮、选中项、当前笔记的标记。",
        seed: "--color-primary",
    },
    {
        property: "--mdx-theme-link",
        label: "链接",
        hint: "文档里的超链接与 wiki 链接。",
        seed: "--color-info",
    },
    {
        property: "--mdx-theme-code-bg",
        label: "代码底色",
        hint: "代码块与表头的底。",
        seed: "--mdx-code-bg",
    },
    {
        property: "--mdx-theme-selection",
        label: "选中",
        hint: "拖选文字时盖上去的那层。",
        seed: "--mdx-selection-bg",
    },
    {
        property: "--mdx-theme-highlight",
        label: "高亮 / 提醒",
        hint: "搜索命中、未保存这类需要被看见的地方。",
        seed: "--color-warning",
    },
] as const;

/** A theme being made: a name, a ground, and the colours. */
export interface ThemeDraft {
    name: string;
    appearance: ThemeAppearance;
    /** Contract property to `#rrggbb`. */
    colors: Record<string, string>;
}

/**
 * Characters a file name may not carry, and what a name may not start with.
 *
 * Rust refuses these too — this is not the check that matters, it is the one
 * that keeps the user from being told no. Refusing on this side and repairing on
 * that side would be the wrong way round: the name shown in the list is the name
 * of the file, and the user should see what they are getting.
 */
const UNSAFE_IN_FILE_NAME = /[/\\:*?"<>|\u0000-\u001f]/g;

/** Characters the contract's own name check would refuse in a quoted value. */
const UNSAFE_IN_THEME_NAME = /["'\;{}<>@]/g;

/** The file a draft is saved as, or null when the name gives nothing to use. */
export function themeFileName(name: string): string | null {
    const cleaned = name
        .replace(UNSAFE_IN_FILE_NAME, " ")
        .replace(/\s+/g, " ")
        .replace(/^[.\s]+/, "")
        .trim();

    if (cleaned.length === 0) {
        return null;
    }

    return `${cleaned.slice(0, 60)}.css`;
}

/**
 * The file text for a draft.
 *
 * Written as a plain `:root` block with a header saying where it came from,
 * because this file belongs to the user from the moment it is written: they will
 * open it, and it should read like something a person could have typed.
 */
export function buildThemeCss(draft: ThemeDraft): string {
    const name = draft.name.replace(UNSAFE_IN_THEME_NAME, "").trim();
    const lines = [
        "/*",
        " * 在 Loam 的「外观」里做的主题。",
        " *",
        " * 这就是一份普通的 CSS 文件，可以直接用编辑器改。属性名是公开契约的一部分",
        " * （--mdx-theme-*），改完保存，在「外观」里点刷新即可。选择器、@import、",
        " * url() 一律不会被读取，所以这里只有颜色。",
        " */",
        ":root {",
        `  --mdx-theme-name: "${name}";`,
        `  --mdx-theme-appearance: ${draft.appearance};`,
    ];

    for (const field of THEME_DESIGNER_FIELDS) {
        const value = draft.colors[field.property];

        if (value !== undefined) {
            lines.push(`  ${field.property}: ${value};`);
        }
    }

    const accent = draft.colors["--mdx-theme-accent"];

    if (accent !== undefined) {
        lines.push(`  --mdx-theme-accent-text: ${readableTextOn(accent)};`);
    }

    lines.push("}", "");

    return lines.join("\n");
}

/**
 * Black or white, whichever can be read on `background`.
 *
 * Not a field in the form: the text on a button is not a decision, it is a
 * consequence of the accent, and offering it would invite the one combination
 * nobody wants. Hand-written themes can still set `--mdx-theme-accent-text`
 * themselves — this only means a theme made here never ships unreadable.
 *
 * The threshold is on relative luminance rather than on lightness, because a
 * saturated yellow and a saturated blue of the same lightness need opposite text.
 */
export function readableTextOn(background: string): string {
    const hex = toHexColor(background);

    if (hex === null) {
        return "#ffffff";
    }

    const channels = [1, 3, 5].map((start) => {
        const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;

        return value <= 0.03928
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
        0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];

    return luminance > 0.4 ? "#101010" : "#ffffff";
}

/**
 * Whatever a browser reports a colour as, in the `#rrggbb` a colour input needs.
 *
 * Four shapes, because they are the four a computed value comes back as: a hex
 * from a stylesheet, `rgb()`/`rgba()` from most properties, and `color(srgb …)`
 * from anything the browser had to compute — which is what `color-mix()` becomes.
 * Alpha is dropped rather than refused: a colour input holds no alpha, and the
 * hue is still the right place to start from.
 */
export function toHexColor(value: string): string | null {
    const text = value.trim().toLowerCase();
    const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(text);

    if (srgb) {
        return hexFromChannels(splitNumbers(srgb[1]), 255);
    }
    const hex = /^#([0-9a-f]{3,8})$/.exec(text);

    if (hex) {
        const digits = hex[1];

        if (digits.length === 3 || digits.length === 4) {
            const [r, g, b] = [digits[0], digits[1], digits[2]];
            return `#${r}${r}${g}${g}${b}${b}`;
        }

        if (digits.length === 6 || digits.length === 8) {
            return `#${digits.slice(0, 6)}`;
        }

        return null;
    }

    const numbers = /^rgba?\(([^)]+)\)$/.exec(text);

    if (!numbers) {
        return null;
    }

    return hexFromChannels(splitNumbers(numbers[1]), 1);
}

/** The first three numbers in a colour function's argument list. */
function splitNumbers(text: string): number[] {
    return text
        .split(/[\s,/]+/)
        .filter((part) => part.length > 0)
        .slice(0, 3)
        .map((part) => Number.parseFloat(part));
}

/** Three channels as `#rrggbb`, `scale` turning their unit into bytes. */
function hexFromChannels(channels: number[], scale: number): string | null {
    if (channels.length !== 3 || channels.some((part) => !Number.isFinite(part))) {
        return null;
    }

    return `#${channels
        .map((part) =>
            Math.max(0, Math.min(255, Math.round(part * scale)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

/**
 * The colour a value paints with, or null when it does not paint one.
 *
 * A theme property is not always a colour literal: half of ours are
 * `color-mix()` over another variable, and reading those as text gave a colour
 * input nothing it could show — two of the ten fields opened grey and would have
 * been saved grey by anyone who did not touch them.
 *
 * So the browser resolves it, by being asked to paint with it. The sentinel is
 * how a value it rejects is told apart from one it accepts: an invalid colour
 * leaves the property where it was, and an inherited black would otherwise look
 * like an answer.
 */
export function resolvedColor(value: string): string | null {
    const sentinel = "rgb(1, 2, 3)";
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = sentinel;
    probe.style.color = value;
    document.body.append(probe);

    const used = getComputedStyle(probe).color;
    probe.remove();

    return used === sentinel || toHexColor(used) === "#010203"
        ? null
        : toHexColor(used);
}

/**
 * A draft that starts from the theme currently on screen.
 *
 * Read from the live computed values rather than from a table of our own, so it
 * starts from whatever is actually there — including another user theme, which is
 * how one gets copied and adjusted.
 *
 * A colour that cannot be read as one is left out rather than guessed; the field
 * then falls back to `fallback`, which keeps a colour input from showing black
 * and calling it the theme's.
 */
export function draftFromCurrentTheme(
    name: string,
    appearance: ThemeAppearance,
    fallback = "#808080",
): ThemeDraft {
    const styles = getComputedStyle(document.documentElement);
    const colors: Record<string, string> = {};

    for (const field of THEME_DESIGNER_FIELDS) {
        const raw = styles.getPropertyValue(field.seed).trim();
        colors[field.property] =
            resolvedColor(raw) ?? toHexColor(raw) ?? fallback;
    }

    return { name, appearance, colors };
}

/** Writes a draft into the user's theme directory, answering with its path. */
export async function saveThemeDraft(draft: ThemeDraft): Promise<string> {
    const fileName = themeFileName(draft.name);

    if (fileName === null) {
        throw new Error("主题名称不能为空");
    }

    const { invoke } = await tauriCore();

    return invoke<string>("save_user_theme", {
        fileName,
        css: buildThemeCss(draft),
    });
}

/** Opens the theme directory, answering with the path that was opened. */
export async function revealUserThemesDir(): Promise<string> {
    const { invoke } = await tauriCore();

    return invoke<string>("reveal_user_themes_dir", {});
}
