# Theme Contract

Long-lived contract for how MDX is themed, and what a user-written theme file
may do. The variable names here are a public promise: people write files against
them. Adding a property is additive; renaming or removing one breaks every theme
that used it and must go through `spec`.

## Two attributes, two questions

`data-theme` on the root element names the palette. `data-mdx-appearance` says
whether that palette sits on a light or a dark ground.

They are separate because different things need different answers. Scrollbars,
form controls, the syntax-highlighting palette and the macOS window chrome only
need to know light-or-dark and do not care which palette is in use — so adding a
theme means adding a palette, not editing every rule that ever asked "is it
dark".

A theme declares its own appearance. Nothing infers it from the background
colour: four separate surfaces read the answer, so a wrong guess is wrong in
four places at once, and a dark palette with light scrollbars is harder to
diagnose than a theme that refuses to load and says why.

## A theme is data, not code

User themes are read from `~/.mdx/themes/*.css`, the same `~/.mdx` the product
already uses for drafts and assets. The file is **never given to the browser to
execute**. Rust reads the text, the front end extracts the declarations it
recognises, checks each value, and generates one rule per theme.

Consequences, stated plainly:

- **Selectors in the file are ignored.** A declaration counts wherever it
  appears. `:root`, `body` and `#editor .ProseMirror` are all the same to the
  parser.
- **A theme cannot change layout, hide an element, or load anything.** No
  `@import`, no `url()`, no properties other than the ones listed below.
- **A theme cannot depend on editor internals.** `docs/loopx/specs/editor.md`
  forbids third-party theme classes from reaching implementation-private editor
  DOM, and this is how that is enforced rather than merely requested.

This is deliberately less expressive than ColaMD, whose themes carry direct
selectors. Three reasons, in order of weight: the editor spec forbids it; a
stylesheet keyed to DOM structure rots silently — this repository lost every
block-level style when 66 selectors written against a deleted editor's DOM
contract stopped matching anything while the whole test suite stayed green; and
one `display: none` in a theme can hide the settings entry needed to change the
theme back.

## The properties

Every property is optional except `--mdx-theme-appearance`. An omitted property
falls back to the built-in default for that appearance, so three lines are a
usable theme.

| Property | Meaning | Value |
|---|---|---|
| `--mdx-theme-name` | Name shown in the theme list | Quoted string, ≤ 40 chars |
| `--mdx-theme-appearance` | **Required.** `light` or `dark` | Keyword |
| `--mdx-theme-bg` | Content background | Colour |
| `--mdx-theme-surface` | Sidebar and panel background | Colour |
| `--mdx-theme-chrome` | Toolbar and tab-bar background | Colour |
| `--mdx-theme-text` | Body text | Colour |
| `--mdx-theme-border` | Separators and borders | Colour |
| `--mdx-theme-accent` | Primary buttons, selected state | Colour |
| `--mdx-theme-accent-text` | Text on top of the accent | Colour |
| `--mdx-theme-link` | Links and wikilinks | Colour |
| `--mdx-theme-code-bg` | Inline code and code block background | Colour |
| `--mdx-theme-selection` | Selection background | Colour |
| `--mdx-theme-highlight` | Find-match background | Colour |
| `--mdx-theme-body-font` | Body font stack | Font family list |
| `--mdx-theme-mono-font` | Monospace font stack | Font family list |

Secondary text is not a property of its own. It is derived from
`--mdx-theme-text` by opacity throughout the product, so setting the text colour
moves it too.

Sizes — line measure, corner radius, spacing — are **not** themeable. Those are
layout, and "a theme cannot change layout" is the promise that makes an
unfamiliar theme safe to try. Opening them up later is additive; taking them
back would not be.

The names are MDX's own rather than the UI framework's. Exposing
`--color-base-100` would turn "which UI framework we currently use" into a
promise we could never take back.

### Accepted values

Colours: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`,
`hsla()`, or a common CSS colour keyword. Fonts: letters, digits, spaces,
commas, dots, hyphens and quotes. Everything else in a value — `url`, `var()`,
`@`, braces, backslashes — is refused.

A refused value is dropped and reported in settings as an ignored count; the
rest of the theme still applies, because one typo废掉整个主题 is a poor deal for
someone hand-writing CSS. A missing or invalid `--mdx-theme-appearance` is the
one exception and rejects the whole file.

## Example

```css
/* ~/.mdx/themes/kraft.css */
:root {
  --mdx-theme-name: "牛皮纸";
  --mdx-theme-appearance: light;

  --mdx-theme-bg: #f3ece1;
  --mdx-theme-surface: #eae1d2;
  --mdx-theme-text: #2f2a24;
  --mdx-theme-border: #d8cbb6;
  --mdx-theme-accent: #8a5a2b;
  --mdx-theme-link: #7a4a22;
  --mdx-theme-code-bg: #e8dfd0;
  --mdx-theme-body-font: "Iowan Old Style", Georgia, serif;
}
```

## Failure behaviour

| Situation | Result |
|---|---|
| `~/.mdx/themes/` does not exist | No error. Empty list. The directory is not created. |
| File is not `.css`, or is a directory | Skipped silently. |
| File is a symlink | Not followed. Listed with a reason. |
| File is not UTF-8, or over 64 KiB | Listed with a reason. |
| No `--mdx-theme-*` declaration found | Rejected with a reason. This is what an unmodified ColaMD theme does. |
| Missing `--mdx-theme-appearance` | Rejected with a reason. |
| One value invalid | Ignored, counted, rest applies. |
| Selected theme's file deleted or broken | Falls back to following the system. |

Themes are discovered at startup and when the user presses refresh. There is no
file watching: this is a setting changed a few times a year, and a watcher is a
standing cost for that.

Custom theme ids are prefixed `user:`, so they cannot collide with or shadow a
built-in theme.

## Licensing

ColaMD is a **behaviour reference only** for this design, consistent with
`docs/loopx/design/2026-08-12-milkdown-editor-migration/P-007-license-provenance-audit.md`.
No ColaMD colour values or CSS are copied. Shipping any ColaMD palette as a
built-in theme would require updating `THIRD_PARTY_NOTICES` and accepting MIT
attribution obligations, which changes that audit's conclusion and is a separate
decision.
