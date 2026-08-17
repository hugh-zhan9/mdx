# ColaMD 复用与第三方许可证审计

Author(s): Claude
Last updated: 2026-08-14
Status: Complete
Slice: `P-007` deliverable 4
Design contracts discharged: `D-013`（provenance manifest / third-party notice），`D-012`（dependency boundary）
Canonical design: `docs/loopx/design/2026-08-12-milkdown-editor-migration/需求设计文档.md` §4.8
Notices artifact: `THIRD_PARTY_NOTICES`（repo root）

---

## 一、结论 / Conclusion

**ColaMD is a behaviour reference only. No file under `packages/mdx-editor/**` substantively copies ColaMD code.**

No provenance table is required, because there is no copied file to list. Under `D-013` this
audit records the "behavior reference only" finding instead, together with the measurements
that support it. `THIRD_PARTY_NOTICES` credits ColaMD as a behaviour reference at commit
`4c986a4e0920cf0598fb2a47cec2966fc5340c77` and deliberately does **not** assert a ColaMD
copyright over any MDX file, because asserting one would misstate the evidence below.

Headline measurements (each backed by a command in §七):

| Measurement | Result |
|---|---|
| Maximal shared runs of ≥3 non-trivial normalized lines | **0** |
| Distinct non-trivial normalized ColaMD lines also present in MDX | **22 / 2217 (0.99%)**, all generic boilerplate |
| ColaMD-original identifiers (not in any shared library API) also present in MDX | **38 / 660 (5.76%)**, all adjudicated non-copies |
| Curated ColaMD-distinctive tokens (class names, plugin keys, brand strings) found in MDX | **2 / 70**, both independent convergence |
| Longest shared token n-gram | **27 tokens**, reducible to 3 public-API idioms |
| ColaMD comment lines (≥15 chars) shared with MDX | **0 / 189** |
| ColaMD CJK prose strings shared with MDX | **0 / 9** |

Separately: **ColaMD is not redistributed by this repository at all.** `ref/` is gitignored and
zero files under `ref/` are tracked, so the MIT obligation to carry ColaMD's notice with
"copies or substantial portions" is not triggered by distribution either.

Dependency inventory conclusion: every production dependency resolves to a permissive
licence (MIT / ISC / BSD / Apache-2.0). **Three packages needed manual resolution and are
called out in §5.3** — `dompurify` (dual MPL-2.0 OR Apache-2.0), `caniuse-lite` (CC-BY-4.0,
build-time only), and `khroma` (no `license` field; its licence *file* is MIT). None is a
copyleft obligation on MDX's own source.

---

## 二、审计范围 / Scope and exclusions

### 2.1 Compared corpora

| Side | Paths | Files | Raw lines |
|---|---|---|---|
| Upstream | `ref/ColaMD/{src,themes,scripts,vscode-extension}/**` | 27 | 4 247 |
| Ours | `packages/mdx-editor/**` | 193 | 41 906 |

### 2.2 Exclusions and why

- **`ref/ColaMD/node_modules` (660 MB, 404 top-level packages) — excluded.** These are
  third-party packages ColaMD installed, not code ColaMD authored. Including them would
  compare MDX against Milkdown/ProseMirror/KaTeX themselves and manufacture overlap that
  says nothing about copying *from ColaMD*. They exist on disk and are noted here so the
  exclusion is explicit rather than silent.
- **`ref/ColaMD/dist` (2.7 MB, 64 files) — excluded.** Build output derived from `src/`;
  scanning it would double-count the same authored lines in minified form.
- **`packages/mdx-editor/react/wasm/**` (5 files, 276 KB) — excluded.** Generated
  wasm-bindgen output. It is machine-emitted glue, not human-authored editor code, and
  ColaMD has no WASM component for it to have been copied from.

### 2.3 What this audit can and cannot establish

- It **can** bound literal copying: identical lines, identical token runs, identical names,
  identical comments. Those are what a copy leaves behind, and they are absent.
- It **cannot** prove that no ColaMD *idea* influenced MDX — that influence is the declared
  purpose of the reference checkout under §4.8, and `D-013` explicitly says general ideas
  need no line-by-line copyright mapping. Behaviour convergence is expected and permitted.
- It compares against **one commit**. If `ref/ColaMD` is later advanced, the scans must be
  re-run before relying on this conclusion.

---

## 三、ColaMD 来源核对 / Upstream identity

Verified by command (`git -C ref/ColaMD rev-parse HEAD`, `git log -1`, `git status --short`,
`git remote -v`):

| Field | Value | Source |
|---|---|---|
| Commit | `4c986a4e0920cf0598fb2a47cec2966fc5340c77` | `git rev-parse HEAD` |
| Commit date / author | `Wed Aug 12 17:01:02 2026 +0800`, `orange.ai` | `git log -1` |
| Working tree | clean (no local modifications) | `git status --short` → empty |
| Remote | `https://github.com/marswaveai/ColaMD.git` | `git remote -v` |
| Package name / version | `colamd` `1.8.2` | `ref/ColaMD/package.json` |
| Declared licence | `MIT` | `ref/ColaMD/package.json` `"license"` |
| Author | `marswave.ai <hello@marswave.ai>` | `ref/ColaMD/package.json` `"author"` |
| Copyright holder | `Copyright (c) 2026 marswave.ai` | `ref/ColaMD/LICENSE` line 3 |

The clean working tree matters: the scans below compare against unmodified upstream code, so
a match could not have been hidden by a local edit to the reference checkout.

`ref/ColaMD/vscode-extension/LICENSE` carries the same MIT text and the same
`Copyright (c) 2026 marswave.ai` holder.

### 3.1 ColaMD's authored surface

| File | Lines |
|---|---|
| `src/main/index.ts` | 1 007 |
| `src/renderer/themes/base.css` | 836 |
| `src/renderer/editor/editor.ts` | 375 |
| `src/renderer/themes/premium.css` | 340 |
| `src/renderer/main.ts` | 336 |
| `src/renderer/editor/search-panel.ts` | 244 |
| `src/renderer/editor/math-modal.ts` | 169 |
| `vscode-extension/extension.js` | 123 |
| `src/preload/index.ts` | 117 |
| `src/renderer/editor/highlight.ts` | 87 |
| `src/renderer/index.html` | 59 |
| `themes/*.css` (13 files) | 507 |
| `src/renderer/themes/theme-manager.ts` | 49 |
| `src/renderer/editor/html-view.ts` | 36 |
| `scripts/afterPack.js`, `src/renderer/env.d.ts` | 21 |
| **Total** | **4 247** |

---

## 四、比对方法与结果 / Techniques and measurements

Six independent techniques were run. Numbers are raw output, not summaries.

### 4.1 Technique A — curated distinctive-token grep

70 tokens were hand-extracted from ColaMD's source: plugin keys (`searchPluginKey`),
CSS class names (`code-copy-btn`, `math-modal-overlay`, `search-match-current`,
`milkdown-html-inline`), DOM ids (`source-editor`, `math-is-block`), storage keys
(`colamd-theme`), Electron bridge names (`electronAPI`, `openExternal`), brand strings
(`ColaMD`, `marswave`), Chinese UI strings (`复制代码`, `已复制`), and ColaMD-only exports
(`remarkHighlight`, `highlightStringifyHandler`, `setupCodeBlockCopy`, `toggleTaskListItem`,
`BLOCKED_TAGS`, `MathModal`, `SearchPanel`).

**Result: 2 of 70 tokens appear in `packages/mdx-editor`.** Both adjudicated:

| Token | MDX hits | Verdict |
|---|---|---|
| `toggleStrongMark` | 5 | **Not a copy.** In MDX it is `export const toggleStrongMark: Command = toggleMarkByName("strong")` (`commands/editor-commands.ts:19`) — one of a generated family of four (`strong` / `emphasis` / `strike` / `inline_code`) bound in `plugins/editor-keymap.ts:39` as `"Mod-b"`. In ColaMD it is `function toggleStrongMark(): void` that calls `editorInstance.action(ctx => …)` and dispatches by hand, with no `Command` signature, no family, and no keymap table. Same obvious name for "toggle the strong mark"; different signature, different mechanism. |
| `createTracker` | 2 | **Not a copy.** `state.createTracker(info)` is the public serializer API of `mdast-util-to-markdown`, which both projects call because both write a remark-stringify handler. MDX uses it in `syntax/milkdown/callout/remark.ts:92` for a `> [!NOTE]` callout; ColaMD uses it in `highlight.ts:81` for a `==mark==` span. Different node types, different output. |

The 68 misses include every ColaMD-original class name, DOM id, plugin key, storage key and
brand string. A copy of any ColaMD UI or plugin file would necessarily have dragged at least
one of these along.

### 4.2 Technique B — mechanical ColaMD-original identifier overlap

Technique A relies on my judgement about what counts as "distinctive". Technique B removes
that judgement. Script: `scratchpad/original_idents.py`.

1. Extract every identifier of length ≥5 from ColaMD's authored source → **1 527**.
2. Extract every identifier from the public API surface of the libraries both projects share
   (`node_modules/@milkdown/**`, all `node_modules/prosemirror-*`, `katex`, `remark-breaks`,
   `unist-util-visit`, `mdast-util-*`, `remark-*`, plus TypeScript's DOM lib) → **29 023**.
3. `ColaMD-original = (1) − (2)` → **660** identifiers that could only be shared by copying.
4. Grep each of the 660 in `packages/mdx-editor` (excluding `react/wasm`).

**Result: 38 of 660 (5.76%).** Every one was inspected. They fall into four buckets, none of
which is a copy:

| Bucket | Identifiers | Why it is not a copy |
|---|---|---|
| Ordinary English words appearing in comments/strings | `light`, `stale`, `theme`, `Theme`, `survives`, `rewritten`, `round-trips`, `workspace`, `unsaved`, `drives`, `exporting`, `stars`, `Teach`, `Fresh`, `replays`, `Persist`, `Obsidian`, `notion`, `Documents`, `AFTER`, `SEARCH`, `Light`, `Helvetica` | The `[A-Za-z_$][\w$-]{4,}` extractor does not distinguish code from prose. Two English-commented Markdown editors share English vocabulary. |
| Substring artifacts of the extractor | `ember` (inside "remember"), `nStart`, `sourceEl` (MDX's identifier is `sourceElement`, `source-preservation/index.ts:58`) | Not real shared identifiers. |
| `@milkdown/plugin-math` public API names | `math_inline`, `math_block`, `math-inline`, `math-block`, `mathInlineSchema`, `mathBlockSchema` | **Upstream API names, not ColaMD's.** They surfaced as "original" only because `@milkdown/plugin-math` is **not installed in MDX** — `D-012` bans it, verified: `ls node_modules/@milkdown/ \| grep -i math` → not present, and `"@milkdown/plugin-math"` appears **0 times** in `package-lock.json`. So step 2 could not filter them out. ColaMD *imports* these names (`editor.ts:11`); MDX *declares its own* (`syntax/milkdown/math/index.ts:38,93` build them with Milkdown's `$nodeSchema` factory, over node names defined in `syntax/milkdown/math/syntax.ts:8-9` with the comment "ProseMirror node names, matching the ones the rest of MDX already uses"). Importing a name and independently defining a same-named constant are not the same act. |
| Natural names for the same concept | `MdastNode`, `setMarkdown`, `toggleStrongMark` | `MdastNode` is a locally-declared structural interface in both (`callout/remark.ts:18` vs `highlight.ts:40`) with different fields — the obvious name for "a node in an mdast tree". MDX's `setMarkdown` is a React `useState` setter (`react/mdx-editor-provider.tsx:90`), not an exported API like ColaMD's. |

### 4.3 Technique C — normalized line-run scan

Script: `scratchpad/overlap_scan.py`. Lines are trimmed and internal whitespace collapsed, so
reindentation and reformatting cannot hide a match. A line is "non-trivial" if it is ≥8 chars,
contains a letter, and is not brace/keyword boilerplate.

**Result C1 — single shared lines: 22 of 2 217 distinct non-trivial ColaMD lines (0.99%).**
The complete list, with how many times each occurs in MDX:

```
[  2x] ...node.attrs,                    [  1x] init() {
[  2x] .config((ctx) => {                [  1x] interface Window {
[  7x] </button>                         [ 10x] parseMarkdown: {
[  1x] checked: !node.attrs.checked,     [  3x] props: {
[  2x] content,                          [  2x] return (tree) => {
[  2x] decorations(state) {              [  4x] return new Plugin({
[  8x] for (const attribute of Array.from(element.attributes)) {
[  3x] if (view) {                       [  1x] return src
[ 10x] toMarkdown: {                     [  3x] return value
[144x] return {                          [  1x] state: {
[  1x] view.state.doc.descendants((node, pos) => {
[ 14x] } catch {                         [ 10x] } finally {
```

Every entry is either language boilerplate (`return {` — 144 occurrences in MDX, `} catch {`,
`props: {`) or the literal required spelling of a Milkdown/ProseMirror API
(`parseMarkdown: {` and `toMarkdown: {` are mandatory keys of Milkdown's `$nodeSchema`
descriptor; `return new Plugin({` and `decorations(state) {` are mandatory ProseMirror plugin
shape). None carries authorship.

**Result C2 — maximal shared runs of ≥3 non-trivial consecutive lines: 0.**

This is the strongest single result in the audit. Copied code — even reformatted, even
renamed — preserves *statement order*. Across 4 247 upstream lines and 41 906 of ours there is
not one place where three substantive lines run in the same sequence.

### 4.4 Technique D — token n-gram scan and manual adjudication

Same script. Source is tokenized (identifiers and punctuation as separate tokens, whitespace
and line structure discarded), then every shared n-gram of length ≥12 is extended maximally.

**Result: 209 match sites; longest shared n-gram = 27 tokens.** The 209 sites collapse to
**three distinct idioms** (the long tail is the same three idioms re-counted at every shifted
start offset — a 27-token match also reports as 26, 25, 24 … tokens). All three inspected:

**Idiom 1 — 27 tokens, the longest match.**
`for (const attribute of Array.from(element.attributes)) { if (attribute.name.toLowerCase().startsWith(`
ColaMD `html-view.ts:17` vs MDX `source-preservation/source-preservation.test.ts:136`.

**Not a copy.** This is the canonical DOM idiom for stripping `on*` event-handler attributes;
there is no other way to iterate a live `NamedNodeMap` safely while removing from it. Evidence
it is generic: it occurs in **10 files in this repo's own `node_modules`** (`mermaid.min.js`,
`axe-core`, `playwright-core`, `next`, `cytoscape`, …), and in **7 independent places in MDX
alone** (`kernel/clipboard.ts:178`, `plugins/editor-clipboard.ts:507`,
`source-preservation/sanitize.ts:210` and `:313`, `react/html-block-node-view.tsx:188`,
`react/source-fallback-node-view.tsx:164`, plus two test helpers), each with different
surrounding logic.

Decisive structural counter-evidence: the two sanitizers take **opposite security designs**.
ColaMD uses a **block-list** — `const BLOCKED_TAGS = new Set(['audio','embed','form','iframe',
'link','meta','object','script','style','video'])` (`html-view.ts:5`) — removing named bad
tags. MDX uses an **allow-list** — `const ALLOWED_TAGS` (`sanitize.ts:35`), unwrapping anything
not named — plus an `assertInert()` post-condition (`sanitize.ts:306`) that throws
`SanitizeError` if the sanitizer's own output still contains a forbidden tag, an `on*`
attribute, or an unsafe URL. ColaMD has no such post-condition. A copy does not invert the
threat model of the file it copied.

**Idiom 2 — 22 tokens.**
`Editor.make().config((ctx) => { ctx.set(rootCtx, root)`
ColaMD `editor.ts:233` vs MDX `milkdown/editor-host.ts:384` and `adapter/source-offsets.test.ts:240`.

**Not a copy.** This is Milkdown's documented bootstrap sequence — the only supported way to
construct an editor. Verified against upstream's own code: `node_modules/@milkdown/preset-gfm/
src/__test__/keep-table-align.spec.ts:13-18` contains `Editor.make()`, `ctx.set(rootCtx, root)`,
`ctx.set(defaultValueCtx, markdown)` in exactly this order. Two callers of the same required
constructor are not evidence of contact. What follows the shared prefix diverges immediately:
MDX continues into `ctx.update(editorViewOptionsCtx, …)` for editable gating and a commented
`remarkStringifyOptionsCtx` policy; ColaMD continues into `remarkPluginsCtx` with
`remark-breaks` and its `mark` stringify handler. (`remark-breaks` — a ColaMD dependency —
appears **0 times** in `packages/mdx-editor`.)

**Idiom 3 — 22 tokens.**
`setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked })`
ColaMD `editor.ts:314` vs MDX `commands/editor-commands.ts:105`.

**Not a copy.** This is the only way to express "toggle this node's `checked` attribute" with
ProseMirror's `setNodeMarkup(pos, type, attrs)` signature: spread the existing attrs, negate
one. The surrounding code is unrelated — MDX is a ProseMirror `Command`
(`(state, dispatch) => boolean`) that resolves its target through helpers
`selectedTaskItem(state) ?? activeTaskItem(state)` on a `task_item` node; ColaMD is a DOM
`click`/`keydown` listener that calls `editorInstance.action(ctx => …)` and hand-walks
`$pos.depth` downward looking for a `list_item` with a non-null `checked` attr. Different node
name, different dispatch path, different entry point.

### 4.5 Technique E — comment and prose overlap

Comments are the highest-signal copy indicator: they carry no functional constraint, so
identical comments cannot be explained by a shared API.

- **189** distinct ColaMD comment lines of ≥15 characters were extracted and each grepped in
  `packages/mdx-editor`. **Shared: 0.**
- **9** distinct CJK prose strings in ColaMD's source (its UI strings, e.g. `复制代码`,
  `已复制`, `欢迎使用 ColaMD`) were each grepped. **Shared: 0.**

This is notable because ColaMD's most distinctive comments describe non-obvious engineering
decisions that a copier would have had strong reason to keep — e.g. `editor.ts:124-129`
explaining that the code-block copy button must live outside ProseMirror-managed DOM because
"inserting UI nodes inside `<pre>` gets wiped (or previously triggered an infinite rebuild
loop — observed as 100% CPU with any fenced code block)". No trace of that reasoning, or its
wording, exists in MDX.

### 4.6 Technique F — structural comparison of the likeliest copy candidates

Each ColaMD file that plausibly maps onto MDX work was compared against its nearest MDX
counterpart. Grep counts are from `rg -F -c` over `packages/mdx-editor` excluding `react/wasm`.

| ColaMD file (lines) | Nearest MDX counterpart | Marker grep | Structural verdict |
|---|---|---|---|
| `editor/editor.ts` (375) | `milkdown/editor-host.ts` (883) | `electronAPI` → **0**, `code-copy-btn` → **0** | Both bootstrap Milkdown (Idiom 2). ColaMD is a module-level singleton (`let editorInstance`) bound to `document.getElementById('editor')`, with a Chinese-labelled copy button, `window.electronAPI.openExternal` link handling, and Electron lifecycle. MDX is a factory returning a host object with editable gating, revision tracking and a source-preservation remark stack, driven by React. §4.8 forbids wholesale copying of this file; **0** shared line runs confirm it was not. |
| `editor/highlight.ts` (87) | *none* | — | ColaMD's most distinctive original plugin implements a `==text==` highlight mark (`$markSchema('highlight')`, `remarkHighlight`, `highlightStringifyHandler`). **MDX does not implement this syntax at all.** Every `highlight` hit in MDX is *code syntax highlighting* (`plugins/editor-code-highlight.ts`, `CodeHighlightPluginOptions`, Prism tokenizing) — an unrelated feature. Nothing to copy from, nothing copied. |
| `editor/math-modal.ts` (169) | `syntax/milkdown/math/node-view.ts` (211) | `math-modal` → **0**, `MathModal` → **0** | Opposite architectures. ColaMD edits math in a global DOM modal singleton appended to `document.body`, with an "is block" checkbox and a `#source-editor` textarea fallback. MDX edits math through a ProseMirror `NodeView` (imports `NodeView`, `NodeViewConstructor`, `ViewMutationRecord` from `prosemirror-view`) rendered in place. Also see §4.2: MDX defines its own math schema because `@milkdown/plugin-math` is banned, while ColaMD imports it. |
| `editor/search-panel.ts` (244) | `adapter/**` find surface | `search-panel` → **0**, `SearchPanel` → **0**, `search-match` → **0** | ColaMD builds a global DOM panel appended to `document.body` with `search-input` / `search-count` / `search-btn` elements. MDX routes find/replace through the stable adapter (`test/adapter-find.test.tsx`) over Markdown source offsets. The only same-named thing in the repo is `features/workspace/components/workspace-search-panel.tsx`, a React *workspace file-search* component outside `packages/mdx-editor` and unrelated in purpose. |
| `editor/html-view.ts` (36) | `syntax/milkdown/source-preservation/sanitize.ts` (359) | `BLOCKED_TAGS` → **0**, `milkdown-html-inline` → **0** | Shares Idiom 1 only. Inverted design (block-list vs allow-list + `assertInert` post-condition), 36 lines vs 359. See §4.4. |
| `themes/base.css` (836), `themes/premium.css` (340), `themes/*.css` (13 files, 507) | *none* | — | **`packages/mdx-editor` contains 0 CSS files** (`find packages/mdx-editor -name '*.css'` → 0). There is no artifact into which ColaMD's ~1 683 lines of theme CSS could have been copied. `colamd-theme`, `theme-custom`, `theme-elegant`, `theme-solarized-dark` → **0** hits each. |
| `src/main/index.ts` (1 007), `src/preload/index.ts` (117) | *none* | `electronAPI` → **0** | Electron main/preload: IPC, file watcher, dirty/reload, browser-print PDF. §2.2 lists all of these as explicit non-goals; MDX keeps Tauri + Rust publishing. No counterpart exists. |

---

## 五、依赖许可证清单 / Dependency licence inventory

Resolved by `scratchpad/dep_licenses.py`, which reads the `license` field from each installed
`node_modules/<pkg>/package.json` and cross-checks the package's own licence *file* where one
is present. Copyright holders below are quoted from those files — none is inferred.

### 5.1 Direct production dependencies

All 36 entries of `"dependencies"` in `/Users/zhangyukun/project/mdx/package.json`.
"Source" is the file the determination was read from, relative to `node_modules/<pkg>/`.

| Package | Version | Licence | Source | Copyright holder (quoted) |
|---|---|---|---|---|
| `@codemirror/commands` | 6.10.3 | MIT | `package.json` + `LICENSE` | Copyright (C) 2018-2021 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `@codemirror/lang-markdown` | 6.5.0 | MIT | `package.json` + `LICENSE` | Copyright (C) 2018-2021 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `@codemirror/search` | 6.7.1 | MIT | `package.json` + `LICENSE` | Copyright (C) 2018-2021 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `@codemirror/state` | 6.6.0 | MIT | `package.json` + `LICENSE` | Copyright (C) 2018-2021 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `@codemirror/view` | 6.43.1 | MIT | `package.json` + `LICENSE` | Copyright (C) 2018-2021 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `@milkdown/kit` | 7.22.1 | MIT | `package.json` + `LICENSE` | Copyright (c) 2020-present Mirone |
| `@tauri-apps/api` | 2.10.1 | Apache-2.0 OR MIT | `package.json` + `LICENSE_MIT` | Copyright (c) 2017 - Present Tauri Apps Contributors |
| `@tauri-apps/plugin-dialog` | 2.7.0 | MIT OR Apache-2.0 | `package.json` + `LICENSE.spdx` | 2019-2022, The Tauri Programme in the Commons Conservancy |
| `daisyui` | 5.5.19 | MIT | `package.json` + `LICENSE` | Copyright (c) 2020 Pouya Saadeghi |
| `immer` | 11.1.4 | MIT | `package.json` + `LICENSE` | Copyright (c) 2017 Michel Weststrate |
| `katex` | 0.17.0 | MIT | `package.json` + `LICENSE` | Copyright (c) 2013-2020 Khan Academy and other contributors |
| `lucide-react` | 1.17.0 | ISC | `package.json` + `LICENSE` | Copyright (c) 2026 Lucide Icons and Contributors |
| `mdast-util-from-markdown` | 2.0.3 | MIT | `package.json` + `license` | Copyright (c) Titus Wormer \<tituswormer@gmail.com\> |
| `mdast-util-frontmatter` | 2.0.1 | MIT | `package.json` + `license` | Copyright (c) 2020 Titus Wormer \<tituswormer@gmail.com\> |
| `mdast-util-gfm` | 3.1.0 | MIT | `package.json` + `license` | Copyright (c) Titus Wormer \<tituswormer@gmail.com\> |
| `mdast-util-math` | 3.0.0 | MIT | `package.json` + `license` | Copyright (c) 2020 Titus Wormer \<tituswormer@gmail.com\> |
| `mermaid` | 11.15.0 | MIT | `package.json` + `LICENSE` | Copyright (c) 2014 - 2022 Knut Sveidqvist |
| `micromark` | 4.0.2 | MIT | `package.json` + `license` | Copyright (c) Titus Wormer \<tituswormer@gmail.com\> |
| `micromark-extension-frontmatter` | 2.0.0 | MIT | `package.json` + `license` | Copyright (c) 2020 Titus Wormer \<tituswormer@gmail.com\> |
| `micromark-extension-gfm` | 3.0.0 | MIT | `package.json` + `license` | Copyright (c) 2020 Titus Wormer \<tituswormer@gmail.com\> |
| `micromark-extension-math` | 3.1.0 | MIT | `package.json` + `license` | Copyright (c) 2020 Titus Wormer \<tituswormer@gmail.com\> |
| `nanoid` | 5.1.7 | MIT | `package.json` + `LICENSE` | Copyright 2017 Andrey Sitnik \<andrey@sitnik.ru\> |
| `next` | 16.2.3 | MIT | `package.json` + `license.md` | Copyright (c) 2025 Vercel, Inc. |
| `prismjs` | 1.30.0 | MIT | `package.json` + `LICENSE` | Copyright (c) 2012 Lea Verou |
| `prosemirror-commands` | 1.7.1 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-history` | 1.5.0 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-inputrules` | 1.5.1 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-keymap` | 1.2.3 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-model` | 1.25.9 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-schema-list` | 1.5.1 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-state` | 1.4.4 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-tables` | 1.8.5 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2016 by Marijn Haverbeke \<marijnh@gmail.com\> and others |
| `prosemirror-transform` | 1.12.0 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-view` | 1.41.9 | MIT | `package.json` + `LICENSE` | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `react` | 19.2.4 | MIT | `package.json` + `LICENSE` | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-dom` | 19.2.4 | MIT | `package.json` + `LICENSE` | Copyright (c) Meta Platforms, Inc. and affiliates. |

KaTeX, Mermaid and Prism were **verified, not assumed**: all three read MIT from both their
`package.json` `license` field and their own licence file, with the holders quoted above.

### 5.2 `@milkdown/kit` and `prosemirror-*` transitive closure

`@milkdown/kit` is a meta-package; the code that actually ships comes from its transitive
`@milkdown/*` packages. All **22** resolved `@milkdown/*` packages are version `7.22.1`,
licence **MIT**, holder **`Copyright (c) 2020-present Mirone`**, each with its own `LICENSE`:

`@milkdown/components`, `core`, `ctx`, `exception`, `kit`, `plugin-block`, `plugin-clipboard`,
`plugin-cursor`, `plugin-diff`, `plugin-history`, `plugin-indent`, `plugin-listener`,
`plugin-slash`, `plugin-streaming`, `plugin-tooltip`, `plugin-trailing`, `plugin-upload`,
`preset-commonmark`, `preset-gfm`, `prose`, `transformer`, `utils`.

All **14** resolved `prosemirror-*` packages are **MIT**. Twelve carry the Marijn Haverbeke
lines quoted in §5.1; two carry different holders:

| Package | Version | Licence | Copyright holder (quoted from `LICENSE`) |
|---|---|---|---|
| `prosemirror-changeset` | 2.4.1 | MIT | Copyright (C) 2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-drop-indicator` | 0.1.4 | MIT | Copyright (c) 2025 ocavue |
| `prosemirror-dropcursor` | 1.8.3 | MIT | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-gapcursor` | 1.4.1 | MIT | Copyright (C) 2015-2017 by Marijn Haverbeke \<marijn@haverbeke.berlin\> and others |
| `prosemirror-safari-ime-span` | 1.0.2 | MIT | Copyright (c) 2024 ocavue |

**`@milkdown/plugin-math` is absent from the tree**, satisfying `D-012`: it is not in
`node_modules/@milkdown/`, and the string `"@milkdown/plugin-math"` occurs **0 times** in
`package-lock.json`. (ColaMD depends on it at `^7.5.9`; MDX ships its own math syntax instead.)

### 5.3 Full closure and flagged findings

The transitive closure of installed production packages is **292**. Licence histogram:

| Licence | Packages |
|---|---|
| MIT | 243 |
| ISC | 34 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 3 |
| Apache-2.0 OR MIT | 1 |
| MIT OR Apache-2.0 | 1 |
| BSD-2-Clause | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| UNDECLARED in `package.json` | 1 |

**Three packages did not resolve to a plain permissive licence from the `license` field alone
and are called out prominently. All three resolve safely; none imposes copyleft on MDX
source.**

| Package | Version | Declared | Resolution | Reasoning |
|---|---|---|---|---|
| **`dompurify`** | 3.4.8 | `(MPL-2.0 OR Apache-2.0)` | **Apache-2.0 elected — permissive** | Dual-licensed; the licensee chooses. The file the package actually ships, `node_modules/dompurify/LICENSE`, is the **Apache License 2.0** text, so Apache-2.0 is the natural election and MPL-2.0's file-level copyleft never attaches. Reaches the app only as a transitive dependency of `mermaid` (`node_modules/mermaid/package.json:63` → `"dompurify": "^3.3.1"`); no MDX source imports it (`rg 'dompurify' packages/mdx-editor app features src-tauri` → 0 hits). It **is** shipped at runtime inside Mermaid, so it is listed in `THIRD_PARTY_NOTICES`. |
| **`caniuse-lite`** | 1.0.30001787 | `CC-BY-4.0` | **Not runtime-bundled — attribution noted** | CC-BY-4.0 is a content licence requiring attribution on redistribution, and it is the one non-software licence in the tree. It is browser-support *data*, reachable only via `browserslist` and `next` (verified: those are the only two packages whose `dependencies` name it), i.e. build-time toolchain. No MDX source imports it (`rg 'caniuse' packages/mdx-editor app features src-tauri` → 0 hits). Recorded in `THIRD_PARTY_NOTICES` under build-time tooling so the attribution exists regardless. |
| **`khroma`** | 2.1.0 | *no `license` field* | **MIT — permissive** | `node_modules/khroma/package.json` has no `license` key, so a metadata-only scan reports it as unlicensed. Its shipped licence *file* `node_modules/khroma/license` reads: "The MIT License (MIT) / Copyright (c) 2019-present Fabio Spampinato, Andrew Maney". Determination is from the file, not the metadata. Transitive dependency of `mermaid`. |

**No GPL, LGPL, AGPL, SSPL, or other strong-copyleft licence appears anywhere in the
292-package closure.** The only weak-copyleft appearance is MPL-2.0 as one arm of `dompurify`'s
dual licence, which is avoided by electing Apache-2.0.

---

## 六、未验证事项 / Explicitly not verified

Stated so no reader over-reads the conclusion:

1. **Bundler output was not inspected.** "Runtime-bundled" in §5 is inferred from dependency
   position and the import graph, not from a built artifact. No production build was run and no
   shipped bundle was opened. Whether tree-shaking drops a given package from the final
   artifact is unverified — the notices file therefore errs toward over-inclusion.
2. **A fresh `npm install` was not performed.** Versions and licences are read from
   `node_modules` as it exists on this machine at audit time. `@milkdown/kit` was confirmed to
   match its `package.json` pin (`7.22.1`); the other 291 packages were not individually
   re-resolved against `package-lock.json`.
3. **Only devDependencies' production-relevance was assumed, not proved.** The inventory covers
   `"dependencies"` and their transitive closure. `"devDependencies"` (Playwright, Vitest,
   ESLint, Tailwind, TypeScript, wasm-pack, jsdom) were not inventoried, on the basis that they
   are not shipped. That basis was not verified against a build.
4. **Rust/Cargo dependencies were not audited.** This deliverable covers
   `packages/mdx-editor/**` and the npm tree. `src-tauri/` crate licences are out of scope here
   and remain to be covered separately before release.
5. **Copy detection is textual.** §2.3 applies: the scans bound literal copying, not
   paraphrase. A sufficiently rewritten port would not be detected by any of the six
   techniques — though a rewrite that leaves zero shared 3-line runs, zero shared comments and
   zero shared original identifiers is, on the ordinary meaning of the word, not a copy.
6. **Single-commit comparison.** Results apply to ColaMD at
   `4c986a4e0920cf0598fb2a47cec2966fc5340c77` only.

---

## 七、复现命令 / Reproduction

Every number in this document comes from one of these. Scripts are in the audit scratchpad and
are throwaway; they read only and write nothing into the repository.

```bash
# §三 upstream identity
git -C ref/ColaMD rev-parse HEAD
git -C ref/ColaMD log -1 --format='%H %ad %an %s'
git -C ref/ColaMD status --short          # empty => clean tree
git -C ref/ColaMD remote -v
cat ref/ColaMD/LICENSE ref/ColaMD/package.json

# §二 corpus sizes and exclusions
find ref/ColaMD/{src,themes,scripts,vscode-extension} -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.css' -o -name '*.html' \) | xargs wc -l
du -sh ref/ColaMD/node_modules ref/ColaMD/dist
find packages/mdx-editor -type f -not -path 'packages/mdx-editor/react/wasm/*' | xargs wc -l

# §4.1 curated distinctive-token grep (70 tokens)
rg -F -c -g '!packages/mdx-editor/react/wasm/**' -- "<token>" packages/mdx-editor

# §4.2 mechanical ColaMD-original identifier overlap
python3 scratchpad/original_idents.py

# §4.3 + §4.4 normalized line-run and token n-gram scan
python3 scratchpad/overlap_scan.py

# §4.4 idiom-1 genericity check
rg -l 'Array\.from\(.*\.attributes\)' node_modules -g '*.js' -g '*.ts' | wc -l   # -> 10
# §4.4 idiom-2 upstream-canonical check
sed -n '1,25p' node_modules/@milkdown/preset-gfm/src/__test__/keep-table-align.spec.ts

# §4.5 comment / CJK prose overlap
rg -o '(//|/\*|\*)\s*(.{15,})' -r '$2' ref/ColaMD/{src,themes,scripts,vscode-extension} | sort -u
rg -o '[\x{4e00}-\x{9fff}]+' ref/ColaMD/{src,themes,vscode-extension} | sort -u

# §4.6 structural marker counts (each -> 0)
for p in search-panel SearchPanel search-match math-modal MathModal BLOCKED_TAGS \
         milkdown-html-inline code-copy-btn colamd electronAPI remark-breaks; do
  rg -F -c -g '!packages/mdx-editor/react/wasm/**' -- "$p" packages/mdx-editor
done
find packages/mdx-editor -name '*.css' -not -path '*/react/wasm/*' | wc -l   # -> 0

# §五 dependency licence inventory
python3 scratchpad/dep_licenses.py

# §4.2 / §5.2 D-012 banned-package check
ls node_modules/@milkdown/ | grep -i math          # -> no match
rg -c '"@milkdown/plugin-math"' package-lock.json  # -> no match

# §一 ColaMD not redistributed
git ls-files ref/ | wc -l    # -> 0
rg -n 'ref' .gitignore       # -> line 43: ref/
```

Scratchpad location for this audit run:
`/private/tmp/claude-501/-Users-zhangyukun-project-mdx/ee046629-6370-40a4-b5bb-4ba50860b707/scratchpad/`
(`overlap_scan.py`, `original_idents.py`, `dep_licenses.py`, and their captured output).
