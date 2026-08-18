import { describe, expect, it } from "vitest";

import {
    MAX_THEME_FILE_BYTES,
    THEME_CONTRACT_PROPERTIES,
    parseUserTheme,
    userThemeId,
    userThemesCss,
} from "./theme-contract";

/**
 * Reading a user's theme file.
 *
 * The security position under test is one sentence: a theme is data, not code.
 * These cover what that means in practice — that a selector cannot reach the
 * page, that a value cannot break out of the rule we build around it, and that
 * nothing in the file can make a request or hide the interface.
 *
 * They also cover the boundary the product side cares about: a file with a typo
 * still works minus that line, and a file missing the one mandatory field is
 * refused with a reason rather than half-applied.
 */

function theme(text: string, fileName = "kraft.css") {
    const parsed = parseUserTheme(fileName, text);
    if (!parsed.ok) throw new Error(`expected a theme, got: ${parsed.reason}`);
    return parsed.theme;
}

const MINIMAL = `:root {
  --mdx-theme-name: "牛皮纸";
  --mdx-theme-appearance: light;
  --mdx-theme-bg: #f3ece1;
}`;

describe("reading a theme file", () => {
    it("takes the declarations it knows", () => {
        const parsed = theme(MINIMAL);

        expect(parsed.id).toBe("user:kraft");
        expect(parsed.name).toBe("牛皮纸");
        expect(parsed.appearance).toBe("light");
        expect(parsed.declarations["--color-base-100"]).toBe("#f3ece1");
    });

    it("names the theme after its file when it does not name itself", () => {
        const parsed = theme(
            ":root { --mdx-theme-appearance: dark; --mdx-theme-bg: #101014; }",
            "midnight-ish.css",
        );

        expect(parsed.name).toBe("midnight-ish");
    });

    it("refuses a theme that does not say whether it is light or dark", () => {
        // The one field whose absence rejects everything: four separate things
        // read the appearance, so guessing it is wrong in four places at once.
        const parsed = parseUserTheme(
            "x.css",
            ":root { --mdx-theme-bg: #ffffff; }",
        );

        expect(parsed).toEqual({
            ok: false,
            reason: "缺少 --mdx-theme-appearance: light 或 dark",
        });
    });

    it("refuses a file with nothing of ours in it", () => {
        // The likeliest user error: an unmodified ColaMD theme. It deserves a
        // reason, not silence.
        const parsed = parseUserTheme(
            "colamd-notion.css",
            ":root { --bg-color: #ffffff; --text-color: #37352f; }",
        );

        expect(parsed).toEqual({
            ok: false,
            reason: "未找到任何 --mdx-theme-* 声明",
        });
    });

    it("refuses a file too large to be a theme", () => {
        const parsed = parseUserTheme(
            "huge.css",
            `:root { --mdx-theme-appearance: light; }${" ".repeat(MAX_THEME_FILE_BYTES)}`,
        );

        expect(parsed.ok).toBe(false);
    });
});

describe("selectors are not honoured", () => {
    it("reads a declaration wherever it appears", () => {
        // A ColaMD-shaped file puts variables on `body` and rules on
        // `#editor .ProseMirror`. The variables still count; the rule does not
        // exist as far as this is concerned.
        const parsed = theme(`body {
  --mdx-theme-appearance: dark;
  --mdx-theme-bg: #1a1f2b;
}
#editor .ProseMirror h1 { border-bottom: none; font-weight: 900; }`);

        expect(parsed.declarations["--color-base-100"]).toBe("#1a1f2b");
    });

    it("addresses a theme whose name is not ASCII", () => {
        // The `data-theme` attribute carries the id itself, so a selector built
        // by replacing the characters it disliked matched no element at all: the
        // theme was listed, was selectable, and painted nothing.
        const css = userThemesCss([
            {
                id: "user:暖沙",
                name: "暖沙",
                appearance: "light",
                declarations: { "--color-base-100": "#ffffff" },
                ignored: [],
            },
        ]);

        expect(css).toContain('[data-theme="user:暖沙"]');
    });

    it("keeps a name from ending the string it sits in", () => {
        // The one place a user-controlled name reaches CSS. A quote that closed
        // the attribute selector would let a file name write a rule.
        const css = userThemesCss([
            {
                id: 'user:x"] { display: none } [data-theme="y',
                name: "x",
                appearance: "light",
                declarations: { "--color-base-100": "#ffffff" },
                ignored: [],
            },
        ]);

        expect(oneRule(css)).not.toBeNull();
        expect(oneRule(css)?.body).toContain("--color-base-100: #ffffff;");
    });

    it("carries no selector or at-rule into the generated stylesheet", () => {
        const css = userThemesCss([
            theme(`@import url("http://evil.example/x.css");
:root { --mdx-theme-appearance: light; --mdx-theme-bg: #fff; }
body { display: none }
.mdx-markdown-editor { visibility: hidden }`),
        ]);

        expect(css).not.toContain("@import");
        expect(css).not.toContain("display");
        expect(css).not.toContain("visibility");
        expect(css).not.toContain("evil.example");
        // What it does contain is one rule, addressed to this theme alone.
        expect(css).toContain('[data-theme="user:kraft"]');
        expect(css).toContain("--color-base-100: #fff;");
    });
});

describe("values are checked, not filtered", () => {
    const cases: Array<{ name: string; value: string }> = [
        { name: "外联请求", value: 'url("http://evil.example/pixel.png")' },
        { name: "javascript 伪协议", value: "javascript:alert(1)" },
        { name: "image-set 外联", value: "image-set('http://evil.example/a')" },
        { name: "var 间接引用", value: "var(--something-else)" },
        { name: "at 规则", value: "@media print" },
        { name: "不是颜色", value: "3px solid" },
    ];

    it.each(cases)("refuses a $name value", ({ value }) => {
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-bg: ${value};
}`);

        // Refused, and said so — not applied, and not silently vanished.
        expect(parsed.declarations["--color-base-100"]).toBeUndefined();
        expect(parsed.ignored.map((entry) => entry.property)).toContain(
            "--mdx-theme-bg",
        );
    });

    it("stops a value at the declaration that contains it", () => {
        // The classic escape: close the declaration, then open a rule of your
        // own. It cannot work here, and not because it is filtered — a value is
        // read only as far as the `;` or `}` that ends it, so the part after is
        // never a value in the first place and never reaches the stylesheet.
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-bg: #fff; } body { display: none;
}`);

        expect(parsed.declarations["--color-base-100"]).toBe("#fff");
        const css = userThemesCss([parsed]);
        expect(css).not.toContain("display");
        expect(css).not.toContain("body");
    });

    it("keeps the rest of a theme when one value is a typo", () => {
        // A single mistake废掉整个主题 is a bad deal for someone hand-writing
        // CSS, so the good lines still apply.
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-bg: #f3ece1;
  --mdx-theme-text: #not-a-color;
  --mdx-theme-accent: #8a5a2b;
}`);

        expect(parsed.declarations["--color-base-100"]).toBe("#f3ece1");
        expect(parsed.declarations["--color-primary"]).toBe("#8a5a2b");
        expect(parsed.declarations["--color-base-content"]).toBeUndefined();
        expect(parsed.ignored).toHaveLength(1);
        expect(parsed.ignored[0].property).toBe("--mdx-theme-text");
    });

    it("accepts the colour shapes a theme is actually written with", () => {
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-bg: #fff;
  --mdx-theme-surface: #f5f3efaa;
  --mdx-theme-text: rgb(43, 39, 36);
  --mdx-theme-border: hsl(30 20% 88%);
  --mdx-theme-selection: rgba(35, 131, 226, 0.14);
  --mdx-theme-highlight: gold;
}`);

        expect(parsed.ignored).toEqual([]);
        expect(parsed.declarations["--mdx-selection-bg"]).toBe(
            "rgba(35, 131, 226, 0.14)",
        );
        expect(parsed.declarations["--color-warning"]).toBe("gold");
    });

    it("accepts a font stack and refuses one carrying a payload", () => {
        const good = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-body-font: "Iowan Old Style", Georgia, serif;
}`);
        expect(good.declarations["--mdx-editor-font"]).toBe(
            '"Iowan Old Style", Georgia, serif',
        );

        const bad = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-mono-font: local("x"); } body { display: none;
}`);
        expect(bad.declarations["--mdx-mono-font"]).toBeUndefined();
    });

    it("refuses a name that is not a plain quoted string", () => {
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-name: unquoted;
}`);

        expect(parsed.name).toBe("kraft");
        expect(parsed.ignored.map((entry) => entry.property)).toContain(
            "--mdx-theme-name",
        );
    });
});

describe("the contract itself", () => {
    it("keeps every property under the reserved prefix", () => {
        // The prefix is what keeps a theme from setting an internal variable
        // directly, which would make our own names the contract.
        for (const property of THEME_CONTRACT_PROPERTIES) {
            expect(property.startsWith("--mdx-theme-")).toBe(true);
        }
    });

    it("lets a more specific property refine a broader one", () => {
        // `surface` sets the sidebar and the toolbar; `chrome` then refines the
        // toolbar alone. Order in the contract list is what decides this.
        const parsed = theme(`:root {
  --mdx-theme-appearance: light;
  --mdx-theme-surface: #eeeeee;
  --mdx-theme-chrome: #dddddd;
}`);

        expect(parsed.declarations["--mdx-sidebar-bg"]).toBe("#eeeeee");
        expect(parsed.declarations["--mdx-chrome-bg"]).toBe("#dddddd");
    });

    it("takes the last declaration when a file sets one twice", () => {
        const parsed = theme(`:root { --mdx-theme-appearance: light; --mdx-theme-bg: #111111; }
:root { --mdx-theme-bg: #222222; }`);

        expect(parsed.declarations["--color-base-100"]).toBe("#222222");
    });

    it("cannot be addressed outside its own theme id", () => {
        const css = userThemesCss([theme(MINIMAL, 'evil"] , [data-x="y.css')]);

        // The file name reaches a selector string, so every quote in it is
        // escaped and the string it sits in still ends where we put its end.
        // One rule, addressed to one theme, whatever the name tried to open —
        // and the palette still inside it.
        expect(oneRule(css)).not.toBeNull();
        expect(oneRule(css)?.body).toContain("--color-base-100: #f3ece1;");
    });
});

/**
 * The generated rule, split at the quote that really ends the theme id.
 *
 * Walked rather than searched: the id is a user-controlled string, so a brace or
 * a quote inside it means nothing to CSS but everything to a naive split. An
 * escaped pair is skipped whole and a raw newline is a failure, which is exactly
 * how a browser reads a quoted string — so if this finds one selector and one
 * body, so does the browser.
 */
function oneRule(css: string): { selector: string; body: string } | null {
    const opening = '[data-theme="';

    if (!css.startsWith(opening)) {
        return null;
    }

    let index = opening.length;

    for (; index < css.length; index += 1) {
        const character = css[index];

        if (character === "\\") {
            index += 1;
            continue;
        }

        if (character === '"') {
            break;
        }

        if (character === "\n" || character === "\r" || character === "\f") {
            // A CSS string cannot span lines, so the rule would already be broken.
            return null;
        }
    }

    if (index >= css.length) {
        return null;
    }

    const after = css.slice(index + 1);
    const body = after.slice(after.indexOf("{"));

    if (!after.startsWith("] {") || !body.endsWith("}")) {
        return null;
    }

    // One body, and nothing outside it: a name that opened a rule of its own
    // would leave a second brace here, outside the string it was written in.
    if (
        (body.match(/\{/g) ?? []).length !== 1 ||
        (body.match(/\}/g) ?? []).length !== 1
    ) {
        return null;
    }

    return { selector: css.slice(0, index + 1), body };
}

describe("ids", () => {
    it("prefixes every user theme, so it cannot shadow a built-in one", () => {
        expect(userThemeId("light.css")).toBe("user:light");
        expect(userThemeId("dark.CSS")).toBe("user:dark");
    });
});
