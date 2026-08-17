# UI Style Contract

Where visual decisions live, so that changing one is one edit rather than forty.

This exists because the opposite happened. The same card pattern had been written
by hand eleven times, the same segmented control six times, the same field a
dozen; none of the copies had stayed identical, and the drift is most of what
made the interface look assembled rather than designed. Fixing it meant touching
forty files, which is exactly the cost this contract is meant to remove.

## Three layers, and what belongs in each

**1. Design variables — `app/globals.css`, `:root`**

Colour, shape, weight and font. The single source for every visual constant:

| Group | Variables |
|---|---|
| Palette | daisyUI's `--color-*`, set per theme |
| Surfaces | `--mdx-content-bg`, `--mdx-sidebar-bg`, `--mdx-chrome-bg`, `--mdx-card-bg`, `--mdx-track-bg`, `--mdx-code-bg` |
| Lines | `--mdx-separator`, `--mdx-field-border`, `--mdx-field-border-focus` |
| Shape | `--mdx-control-radius`, `--mdx-panel-radius` |
| Depth | `--mdx-raised-shadow`, `--mdx-panel-shadow` |
| Type | `--mdx-ui-font`, `--mdx-editor-font`, `--mdx-mono-font` |
| Metrics | `--mdx-editor-max-width`, `--mdx-window-toolbar-height`, `--mdx-traffic-light-inset` |

A theme changes the application by overriding these and nothing else. See
`theme.md` for which of them a user-written theme may set.

**2. Shared controls — `common/components/ui-controls.tsx`**

The shapes. `IconButton`, `TextControlButton`, `PrimaryTextControlButton`,
`SegmentedControl`, `TextInput`, `TextArea`, `Card`, `LogBlock`, `EmptyState`,
`PanelHeader`.

These are the only place that reads the variables above, and the only place a
radius, a border weight or a focus ring is written down. A control needing a
variant takes a prop; it does not get a second implementation somewhere else.

**3. Feature components — `features/**`**

Layout and data. Which controls, in what arrangement, holding what — never how a
control looks.

## Rules

- **A feature component does not write a radius, a border colour, a shadow, or a
  focus ring.** If it needs a field, it uses `TextInput`. If it needs a group of
  facts, it uses `Card`. Spacing and layout classes (`flex`, `gap-*`, `space-y-*`,
  `min-w-0`, `truncate`) are its business and stay inline.
- **No bare pixel values in components.** `rounded-[7px]` is how six different
  radii ended up in one window. Use the variable.
- **Focus is `focus-visible:ring-2 focus-visible:ring-primary/20`**, and it comes
  from the shared control. Nothing writes `focus:outline-2` any more.
- **Groups are tinted, not outlined.** A border around every group draws more
  lines than there are groupings. `Card` is a tint; `--mdx-separator` is for the
  one line that genuinely divides two regions.
- **Destructive actions are neutral at rest** and red on hover. A toolbar that is
  red before anything is selected warns about nothing.
- **A new visual constant goes in layer 1**, even when only one component needs
  it today. That is the difference between one edit later and a search.

## How to make a change

| Change | Where |
|---|---|
| Every border a shade lighter | `--mdx-field-border` |
| Rounder controls everywhere | `--mdx-control-radius` |
| Cards more distinct from the page | `--mdx-card-bg` |
| Buttons taller | `ui-controls.tsx`, the relevant control |
| A new kind of control | `ui-controls.tsx`, once |
| A new theme | A `@plugin "daisyui/theme"` block plus a row in `themes.ts` |
| This panel needs a different layout | The feature component |

If a change means editing more than one file in `features/**`, it is in the
wrong layer.

## What is deliberately not themeable

Sizes — line measure, radius, spacing — are variables but **not** part of the
user-facing theme contract. A theme changes how the application looks, never how
it is laid out; that is what makes an unfamiliar theme safe to try. Opening a
metric up later is additive, taking it back is not.

## Where this is not enforced by tests

`editor-style-contract.test.tsx` pins the editor's stylesheet against the DOM it
renders, because that join broke silently once. Nothing yet asserts that a
feature component has not hand-rolled a control, and jsdom cannot see any of it
anyway — it implements no layout. The review that produced this contract was
manual, and the next drift will be found the same way unless a lint rule is
added for bare radii and colour literals under `features/**`.
