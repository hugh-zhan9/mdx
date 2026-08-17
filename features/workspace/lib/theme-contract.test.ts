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

        // The file name reaches a selector string, so it is narrowed to
        // characters that cannot close the attribute selector.
        expect(css).not.toContain('"] ,');
        expect(css.match(/\[data-theme=/g)).toHaveLength(1);
    });
});

describe("ids", () => {
    it("prefixes every user theme, so it cannot shadow a built-in one", () => {
        expect(userThemeId("light.css")).toBe("user:light");
        expect(userThemeId("dark.CSS")).toBe("user:dark");
    });
});
