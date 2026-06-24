# MDX macOS Native Feel Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [MDX macOS原生质感与编辑阅读体验第一阶段需求设计文档](/Users/zhangyukun/project/mdx/docs/loopx/design/MDX%20macOS%E5%8E%9F%E7%94%9F%E8%B4%A8%E6%84%9F%E4%B8%8E%E7%BC%96%E8%BE%91%E9%98%85%E8%AF%BB%E4%BD%93%E9%AA%8C%E7%AC%AC%E4%B8%80%E9%98%B6%E6%AE%B5%E9%9C%80%E6%B1%82%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md)

**Goal:** Build the first-phase macOS-first shell and reading baseline for MDX without changing Markdown truth, editor kernel contracts, or workspace/document information architecture.

**Architecture:** Keep the existing Workspace Mode and Document Mode behavior, but insert one shared macOS-first appearance layer across Rust/Tauri window construction, root app session rendering, global theme tokens, shared control surfaces, and editor content styling. macOS gets title bar and effect enhancements with explicit fallback; non-macOS keeps current compatibility behavior. All editor changes stay in shell/layout/CSS territory and must not alter parser, serializer, fallback, draft recovery, file-system semantics, or LLM Wiki / Memory workflows.

**Tech Stack:** Tauri 2.10.3, Rust 2021, Next 16, React 19, Tailwind CSS 4, daisyUI 5, Vitest 4, jsdom, lucide-react

**Support lenses:** `architecture-designer`

## Global Constraints

- 用户明确将 MDX 定位为 macOS 桌面应用，希望具备 macOS 原生质感。
- 当前产品已经定位为 desktop-first Markdown workspace，但现有窗口壳层与界面仍偏跨平台 Web 桌面工具风格。
- 用户同时提出更长远的 TeX 风格排版愿景，但已确认不纳入第一阶段。
- 本期范围：
  - macOS 窗口壳层增强
  - Workspace / Document Mode 共享视觉语言
  - toolbar / sidebar / tab strip / panel / empty state / status block 的 macOS-first 重塑
  - 正文编辑/阅读体验基线：版心、行高、留白、块级节奏、内容块层次
  - light / dark / system 三主题统一
  - 菜单与快捷键轻量统一
- 非目标：
  - Knuth–Plass、OpenType MATH、自研公式排版、阅读模式、信息架构重构、命令系统重构
- 决策边界：
  - Markdown 仍是唯一文档真相
  - 不改 Workspace / Document 的主流程语义
  - macOS-first，其他平台仅保证可用
  - 允许 Tauri/Rust 平台隔离改动
- 约束条件：
  - 遵守产品“calm, precise, local-first”与“避免 heavy glass panels”约束
  - 不破坏 editor spec 中现有 DOM contract、fallback、round-trip 行为
  - 验收需覆盖浅/深色和两种窗口模式
- 来自 `PRODUCT.md` 的原文约束：
  - “Calm, precise, local-first.”
  - “Avoid decorative SaaS dashboards, marketing-style hero layouts, playful editor chrome, heavy gradients, glass panels, and modal-heavy flows.”
  - “Prefer desktop conventions over invented affordances.”
- 来自 `docs/loopx/specs/editor.md` 的原文约束：
  - “Markdown text remains the authoritative document format.”
  - “Integrations that map Markdown source to rendered editor nodes must use the stable MDX editor DOM contract, not implementation-private classes.”
  - “If the editor encounters Markdown that cannot be represented by the visual block model, it must preserve that content in an explicit fallback block instead of dropping, normalizing, or silently rewriting it.”
- 测试与验证约束：
  - `ref/` 必须继续排除在 lint、typecheck、Vitest 和 build 之外。
  - 验证至少覆盖 Workspace Mode / Document Mode + light / dark。
- 平台与依赖约束：
  - Tauri 版本固定为 `2.10.3`
  - Rust edition `2021`, rust-version `1.77.2`
  - 不新增替代图标系统；继续使用 `lucide-react`
  - 不引入第二阶段排版引擎依赖

---

## Surface Inventory

- Public commands/API/routes/events/config:
  - Tauri window creation paths in `src-tauri/src/lib.rs`
  - menu ids: `open-folder`, `new-markdown-file`, `new-folder`, `rename`, `trash`, `refresh`, `save`, `close-tab`
  - theme preference keys: `themePreference`, legacy `theme`
- Exported functions/types/modules:
  - `AppShell`
  - `WorkspaceShell`
  - `DocumentShell`
  - shared button controls in `common/components/ui-controls.tsx`
- Runtime/generated artifacts and templates:
  - Next app root HTML/body classes
  - Tauri-created workspace/document windows
  - CSS token surfaces in `app/globals.css`
- Installer/package/deployment surface:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- Hooks/background jobs/automation:
  - theme initialization in `app/layout.tsx`
  - window session loading in `features/app/components/app-shell.tsx`
- Current product docs:
  - `PRODUCT.md`
  - `docs/loopx/design/MDX macOS原生质感与编辑阅读体验第一阶段需求设计文档.md`
- Tests/governance checks:
  - `features/workspace/components/workspace-shell.test.tsx`
  - `features/document/components/document-shell.test.tsx`
  - `features/workspace/lib/theme-preference.test.ts`
  - `src-tauri/src/window_sessions_tests.rs`
- Compatibility/migration paths:
  - macOS appearance must degrade safely on unsupported OS/runtime combinations
  - non-macOS must remain usable without visual corruption
  - existing draft recovery, menu routing, and document/workspace role logic must stay intact

**Caller Proof**

Run:

```bash
rg "themePreference|get_window_session|WorkspaceShell|DocumentShell|TabStrip|PanelHeader|MenuItem::with_id|window_role_for_label|title_bar_style|hidden_title" app common features src-tauri README.md PRODUCT.md docs/loopx/specs
```

Decision rule:

- retained caller exists in current source/runtime code -> keep it and name the caller in the task
- only historical docs or old plans reference it -> do not count that as a retained caller
- no retained caller -> delete it or remove it from strict current surface docs

## File Structure

### Rust / Tauri files

- Modify: `src-tauri/src/lib.rs`
  - Extract a shared window appearance helper around `WebviewWindowBuilder`
  - Centralize macOS-only `title_bar_style`, `hidden_title`, `transparent`, `effects`, `background_color`
  - Keep window role/session/menu routing logic intact
- Modify: `src-tauri/tauri.conf.json`
  - Only if static config needs aligning with helper defaults; prefer runtime builder code first
- Modify: `src-tauri/Cargo.toml`
  - Only if an explicit dependency/import adjustment is required for Tauri effect helpers already present in lockfile/runtime
- Test: `src-tauri/src/window_sessions_tests.rs`
  - Add unit-level guardrails where practical around helper selection boundaries without weakening existing session semantics

### App/root files

- Modify: `app/layout.tsx`
  - Preserve current theme bootstrap
  - Add root attributes/classes needed for macOS-first surfaces and system-font defaults
- Modify: `app/globals.css`
  - Rebuild token hierarchy and shell/content/editor baseline styles
  - Add macOS-first chrome/surface/typography variables

### Frontend shared shell files

- Modify: `features/app/components/app-shell.tsx`
  - Apply root-level mode attributes/classes so Workspace / Document / DocumentError can share shell styling
- Modify: `common/components/ui-controls.tsx`
  - Refine toolbar buttons, text buttons, primary buttons, panel headers, empty states
- Modify: `features/workspace/components/tab-strip.tsx`
  - Shift from web-ish strip to macOS-first document tab feel

### Workspace mode files

- Modify: `features/workspace/components/workspace-shell.tsx`
  - Rework toolbar, sidebar/header surfaces, panel chrome, right-panel tabs, resize-handle visual treatment
- Test: `features/workspace/components/workspace-shell.test.tsx`
  - Assert structural classes/markers for memory/editor view and macOS shell affordances

### Document mode files

- Modify: `features/document/components/document-shell.tsx`
  - Bring document window header/body/outline/editor shell into the shared macOS language
- Test: `features/document/components/document-shell.test.tsx`
  - Assert editor body/grid/stage containment and new root markers/classes

### Theme/system files

- Test: `features/workspace/lib/theme-preference.test.ts`
  - Preserve light/dark/system behavior while shell visuals change

### Optional focused additions if tests become unwieldy

- Create: `src-tauri/src/window_appearance.rs`
  - If `src-tauri/src/lib.rs` becomes too noisy, move helper selection and builder decoration here
- Create: `common/lib/window-chrome.ts`
  - Only if root mode/macOS runtime class derivation needs its own testable function

## Task 1: Add a shared macOS window appearance helper with safe fallback

**Files:**
- Create: `src-tauri/src/window_appearance.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/window_sessions_tests.rs`

**Interfaces:**
- Consumes:
  - `WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))`
  - `tauri::TitleBarStyle`
  - `tauri::window::{Effect, EffectState, EffectsBuilder}`
  - window role context: workspace/document/document error
- Produces:
  - `configure_workspace_window(builder: WebviewWindowBuilder<'_, Wry, AppHandle>) -> WebviewWindowBuilder<'_, Wry, AppHandle>`
  - `configure_document_window(builder: WebviewWindowBuilder<'_, Wry, AppHandle>) -> WebviewWindowBuilder<'_, Wry, AppHandle>`
  - `configure_document_error_window(builder: WebviewWindowBuilder<'_, Wry, AppHandle>) -> WebviewWindowBuilder<'_, Wry, AppHandle>`
  - optional pure helper `macos_window_effects_enabled() -> bool`

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Write the failing Rust tests for helper boundaries**

Add focused tests to `src-tauri/src/window_sessions_tests.rs` for pure helper decisions only. If the helper lives in a new file, expose pure functions such as:

```rust
#[test]
fn macos_workspace_window_prefers_overlay_titlebar() {
    #[cfg(target_os = "macos")]
    {
        assert_eq!(
            crate::window_appearance::workspace_title_bar_style(),
            tauri::TitleBarStyle::Overlay
        );
        assert!(crate::window_appearance::workspace_hidden_title());
    }
}

#[test]
fn non_macos_windows_keep_visible_titlebar_defaults() {
    #[cfg(not(target_os = "macos"))]
    {
        assert_eq!(
            crate::window_appearance::workspace_title_bar_style(),
            tauri::TitleBarStyle::Visible
        );
        assert!(!crate::window_appearance::workspace_hidden_title());
    }
}
```

- [ ] **Step 2: Run the Rust tests to verify the new helper references fail**

Run:

```bash
cargo test window_sessions_tests --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with unresolved `window_appearance` module or missing helper functions.

- [ ] **Step 3: Implement the minimal helper module**

Create `src-tauri/src/window_appearance.rs` with explicit platform-isolated helpers using Tauri 2 APIs that exist in the local dependency source:

```rust
use tauri::{
    AppHandle, TitleBarStyle, Wry,
    WebviewWindowBuilder,
    window::{Effect, EffectState, EffectsBuilder},
};

#[cfg(target_os = "macos")]
fn macos_effects() -> tauri::utils::config::WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(EffectState::FollowsWindowActiveState)
        .build()
}

pub fn workspace_title_bar_style() -> TitleBarStyle {
    #[cfg(target_os = "macos")]
    {
        TitleBarStyle::Overlay
    }
    #[cfg(not(target_os = "macos"))]
    {
        TitleBarStyle::Visible
    }
}

pub fn workspace_hidden_title() -> bool {
    cfg!(target_os = "macos")
}

pub fn configure_workspace_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    #[cfg(target_os = "macos")]
    {
        return builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true)
            .effects(macos_effects());
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder
    }
}
```

Mirror the same pattern for document/document error windows, but keep differences limited to sizing/title in `lib.rs`.

- [ ] **Step 4: Wire the helper into Tauri window creation**

Modify `src-tauri/src/lib.rs`:

1. Add `mod window_appearance;`
2. Replace the raw builder chains in:
   - `new_workspace_window_with_route`
   - `new_document_window`
   - `new_document_error_window`
3. Keep all existing `.title(...)`, `.inner_size(...)`, `.min_inner_size(...)`, `.resizable(true)` calls after helper application if they remain shared.

Target structure:

```rust
let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
    .title("MDX")
    .inner_size(1480.0, 860.0)
    .min_inner_size(1100.0, 640.0)
    .resizable(true);

let window = window_appearance::configure_workspace_window(builder).build()?;
```

- [ ] **Step 5: Run the Rust tests to verify they pass**

Run:

```bash
cargo test window_sessions_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS for existing session tests and new helper-boundary tests.

- [ ] **Step 6: Run a focused cargo check**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS with no unresolved imports for `TitleBarStyle`, `EffectsBuilder`, or helper generics.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/window_appearance.rs src-tauri/Cargo.toml src-tauri/src/window_sessions_tests.rs
git commit -m "feat: add macos window appearance helper"
```

## Task 2: Rebuild root theme tokens and shared control surfaces for macOS-first chrome

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `common/components/ui-controls.tsx`
- Modify: `features/app/components/app-shell.tsx`
- Test: `features/workspace/lib/theme-preference.test.ts`

**Interfaces:**
- Consumes:
  - `themePreference` / legacy `theme`
  - `AppWindowSession.kind`
  - shared button components: `IconButton`, `TextControlButton`, `PrimaryTextControlButton`, `PanelHeader`, `EmptyState`
- Produces:
  - root shell markers such as `data-mdx-window-kind`, `data-mdx-platform`, `data-mdx-shell`
  - macOS-first CSS variables for chrome/sidebar/content/editor surfaces
  - updated shared control class contracts reused by workspace/document shells

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Write the failing tests for root shell mode markers**

Add tests in `features/app/components/app-shell.test.tsx` or expand it if already present. Assert that workspace/document/documentError sessions render distinct root markers so shell CSS can target them without reading router state in every component.

Example:

```tsx
it("adds a workspace root marker", async () => {
  // mock get_window_session -> { kind: "workspace" }
  // render <AppShell />
  expect(document.querySelector("[data-mdx-window-kind='workspace']")).not.toBeNull();
});
```

- [ ] **Step 2: Run the app-shell test to verify it fails**

Run:

```bash
npx vitest run features/app/components/app-shell.test.tsx
```

Expected: FAIL because the root marker is missing.

- [ ] **Step 3: Add root shell markers and system-font root classes**

Modify `features/app/components/app-shell.tsx` so each rendered mode is wrapped in a root element:

```tsx
return (
  <div
    data-mdx-shell=""
    data-mdx-window-kind="workspace"
    data-mdx-platform={isLikelyMacPlatform() ? "macos" : "other"}
    className="h-full min-h-0"
  >
    <WorkspaceApp />
  </div>
);
```

Add a tiny helper in the same file or a new `common/lib/window-chrome.ts` only if needed:

```ts
function isLikelyMacPlatform() {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}
```

- [ ] **Step 4: Update layout and global tokens**

Modify `app/layout.tsx`:

- keep the existing theme bootstrap script
- set body classes to a macOS-friendly font stack and overflow baseline:

```tsx
<body className="h-full bg-base-100 text-base-content antialiased">
```

Modify `app/globals.css`:

1. redefine `light` and `dark` token values toward Finder/Xcode-like neutrals
2. add custom CSS variables such as:

```css
html {
  --mdx-ui-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --mdx-editor-font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif;
  --mdx-mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --mdx-window-toolbar-height: 52px;
  --mdx-editor-max-width: 52rem;
  --mdx-chrome-bg: color-mix(in srgb, var(--color-base-200) 92%, white 8%);
  --mdx-sidebar-bg: color-mix(in srgb, var(--color-base-200) 96%, white 4%);
}

body {
  font-family: var(--mdx-ui-font);
}
```

3. add `@media (prefers-reduced-motion: reduce)` overrides for transitions

- [ ] **Step 5: Refine shared controls**

Modify `common/components/ui-controls.tsx` classes:

- tighten icon button radius and background behavior
- make toolbar text buttons look like macOS toolbar pills without loud borders
- make `PanelHeader` less like a generic bordered row and more like a quiet sidebar section header
- keep accessible outlines

Concrete examples:

```ts
const baseButtonClass =
  "inline-flex items-center justify-center rounded-md border border-transparent outline-none transition-[background-color,color,border-color,box-shadow] duration-150 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";
```

and:

```tsx
<div className="flex h-10 min-w-0 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.02em] text-base-content/55">
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
npx vitest run features/app/components/app-shell.test.tsx features/workspace/lib/theme-preference.test.ts
```

Expected: PASS, including existing theme resolution tests.

- [ ] **Step 7: Run lint on touched frontend files**

Run:

```bash
npx eslint app/layout.tsx app/globals.css common/components/ui-controls.tsx features/app/components/app-shell.tsx
```

Expected: PASS with no class-name or TS lint errors.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx app/globals.css common/components/ui-controls.tsx features/app/components/app-shell.tsx features/app/components/app-shell.test.tsx features/workspace/lib/theme-preference.test.ts
git commit -m "feat: add macos theme tokens and shell markers"
```

## Task 3: Reshape Workspace Mode shell chrome without changing workflow behavior

**Files:**
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/components/tab-strip.tsx`
- Modify: `common/components/ui-controls.tsx`
- Test: `features/workspace/components/workspace-shell.test.tsx`

**Interfaces:**
- Consumes:
  - `WorkspaceShellProps`
  - `TabStripProps`
  - `IconButton`, `TextControlButton`
  - `buildRightPanelTabs()`
- Produces:
  - a toolbar/header with explicit draggable-safe spacing and calmer chrome
  - a document-tab row with macOS-first visual hierarchy
  - panel containers and right-panel tabs that share the new chrome tokens

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Write failing component assertions for shell structure**

Extend `features/workspace/components/workspace-shell.test.tsx` with structural checks only. Add `data-testid` or `data-mdx-*` markers in implementation so tests can assert shell regions without depending on long class strings.

Example assertions:

```tsx
expect(host.querySelector("[data-mdx-workspace-toolbar]")).not.toBeNull();
expect(host.querySelector("[data-mdx-workspace-main-tabs]")).not.toBeNull();
expect(host.querySelector("[data-mdx-right-panel-tabs]")).not.toBeNull();
```

- [ ] **Step 2: Run the workspace-shell test to verify it fails**

Run:

```bash
npx vitest run features/workspace/components/workspace-shell.test.tsx
```

Expected: FAIL because the new markers are missing.

- [ ] **Step 3: Rebuild the workspace toolbar/header**

Modify `features/workspace/components/workspace-shell.tsx`:

1. change the outer grid header height from fixed `44px` to a CSS variable-backed toolbar height
2. add a left-side spacer/drag region marker for macOS:

```tsx
<header
  data-mdx-workspace-toolbar=""
  className="flex min-w-0 items-center justify-between border-b border-base-300/70 bg-[var(--mdx-chrome-bg)] px-3"
>
  <div data-tauri-drag-region className="flex min-w-0 items-center gap-2 pl-18">
```

3. keep all existing buttons and behaviors, but regroup them into quieter toolbar segments
4. ensure message text truncates and does not push critical controls off-screen

- [ ] **Step 4: Rebuild the tab strip**

Modify `features/workspace/components/tab-strip.tsx`:

- add `data-mdx-workspace-main-tabs`
- switch tab visuals from bordered blocks to flatter document-tab pills or quieter segmented tabs
- keep `tab.dirty ? " *" : ""` behavior unchanged
- keep close action and `tab/activated` dispatch unchanged

Suggested structural shape:

```tsx
<div
  data-mdx-workspace-main-tabs=""
  className="flex h-11 min-w-0 items-center overflow-hidden border-b border-base-300/70 bg-base-100/80 px-2"
>
```

- [ ] **Step 5: Re-skin side panels and right-panel tabs**

Still in `workspace-shell.tsx`:

- left tree/search container: reduce harsh borders, apply sidebar background token
- right outline/LLM Wiki container: add `data-mdx-right-panel-tabs`
- update right-panel tab button classes to look like subdued segmented controls
- keep resize handles functional, but change visual hover to a quieter accent:

```tsx
className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-base-content/10"
```

- [ ] **Step 6: Run the workspace-shell tests**

Run:

```bash
npx vitest run features/workspace/components/workspace-shell.test.tsx
```

Expected: PASS, including existing draft-recovery and memory-view assertions.

- [ ] **Step 7: Run a focused lint pass**

Run:

```bash
npx eslint features/workspace/components/workspace-shell.tsx features/workspace/components/tab-strip.tsx common/components/ui-controls.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add features/workspace/components/workspace-shell.tsx features/workspace/components/tab-strip.tsx features/workspace/components/workspace-shell.test.tsx common/components/ui-controls.tsx
git commit -m "feat: restyle workspace shell for macos chrome"
```

## Task 4: Bring Document Mode into the same shell language

**Files:**
- Modify: `features/document/components/document-shell.tsx`
- Modify: `common/components/ui-controls.tsx`
- Test: `features/document/components/document-shell.test.tsx`

**Interfaces:**
- Consumes:
  - `AppWindowSession` of kind `document`
  - existing `DocumentShell` draft recovery/conflict flows
  - `TextControlButton`, `OutlinePanel`, `EditorPane`
- Produces:
  - document-mode shell markers and macOS-first header/body chrome
  - unchanged save/recovery/close-request behavior

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Write failing tests for document shell markers**

Extend `features/document/components/document-shell.test.tsx` with assertions like:

```tsx
expect(host.querySelector("[data-mdx-document-toolbar]")).not.toBeNull();
expect(host.querySelector("[data-mdx-document-shell]")).not.toBeNull();
```

Keep the existing height/overflow assertions; do not delete them.

- [ ] **Step 2: Run the document-shell tests to verify they fail**

Run:

```bash
npx vitest run features/document/components/document-shell.test.tsx
```

Expected: FAIL on missing shell markers.

- [ ] **Step 3: Rework document header and body chrome**

Modify `features/document/components/document-shell.tsx`:

- wrap the main document area with `data-mdx-document-shell`
- add a macOS-first toolbar header region using `data-tauri-drag-region` on non-interactive spaces only
- keep save/sidebar toggle buttons and outline collapse logic unchanged
- preserve all draft/conflict banners and dialogs

Suggested wrapper:

```tsx
<main
  data-mdx-document-shell=""
  className="flex h-full min-h-0 flex-col bg-base-100 text-base-content"
>
```

Header marker:

```tsx
<header
  data-mdx-document-toolbar=""
  className="flex min-w-0 items-center justify-between border-b border-base-300/70 bg-[var(--mdx-chrome-bg)] px-3"
>
```

- [ ] **Step 4: Ensure editor stage and outline inherit the shared shell spacing**

Adjust the document body/grid classes so:

- content area uses the shared toolbar offset and sidebar visual language
- outline panel looks like the workspace outline sibling, not a separate product
- no `h-full` regressions return in the standalone document body

- [ ] **Step 5: Run the document-shell tests**

Run:

```bash
npx vitest run features/document/components/document-shell.test.tsx
```

Expected: PASS, including existing close-request and diff-view assertions.

- [ ] **Step 6: Commit**

```bash
git add features/document/components/document-shell.tsx features/document/components/document-shell.test.tsx common/components/ui-controls.tsx
git commit -m "feat: align document shell with macos workspace chrome"
```

## Task 5: Add the editor reading baseline without touching editor truth or workflows

**Files:**
- Modify: `app/globals.css`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`
- Test: `features/editor/components/editor-pane.test.tsx`
- Test: `features/workspace/components/editor-stage.test.tsx`

**Interfaces:**
- Consumes:
  - `[data-mdx-editor-root]` contract
  - `EditorPane` props and root `DOMDProvider`
  - `EditorStage` markdown/image/text/html switching
- Produces:
  - a max-width editor reading column for markdown content
  - stable wide-content overflow handling for code blocks, tables, images, Mermaid, math
  - unchanged editor command, image storage, and preview routing behavior

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Write failing tests for the editor reading shell wrapper**

Extend `features/editor/components/editor-pane.test.tsx` to assert that markdown editor content is wrapped in a shell marker such as:

```tsx
expect(container.querySelector("[data-mdx-editor-shell]")).not.toBeNull();
expect(container.querySelector("[data-mdx-editor-column]")).not.toBeNull();
```

Extend `features/workspace/components/editor-stage.test.tsx` to assert the markdown path still renders `EditorPane` and non-markdown branches remain unchanged.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
```

Expected: FAIL on missing wrapper markers.

- [ ] **Step 3: Add a non-invasive reading shell in EditorPane**

Modify `features/editor/components/editor-pane.tsx` to wrap the content root without touching markdown logic:

```tsx
<div data-mdx-editor-shell="" className="flex h-full min-h-0 justify-center overflow-auto">
  <div data-mdx-editor-column="" className="w-full max-w-[var(--mdx-editor-max-width)] px-8 py-8">
    <div ref={handleEditorContentRef}>
      <DOMD />
    </div>
  </div>
</div>
```

Requirements:

- do not change `DOMDProvider`, bridge logic, image insertion, find/replace, or mermaid hooks
- keep root refs and selection logic wired to the actual content node

- [ ] **Step 4: Update globals.css for typography rhythm and wide-content handling**

Modify `app/globals.css` with shell-aware rules:

```css
[data-mdx-editor-shell] {
  background: var(--color-base-100);
}

[data-mdx-editor-column] {
  font-family: var(--mdx-editor-font);
}

[data-mdx-editor-root] {
  line-height: 1.75;
  font-size: 0.98rem;
}

[data-mdx-editor-root] [data-mdx-node-type="paragraph"] {
  margin: 0.7rem 0;
}
```

Also adjust:

- headings to slightly calmer sizing and spacing
- blockquotes, code blocks, tables, callouts, Mermaid previews, math nodes to share the new rhythm
- wide blocks to keep `max-width: 100%` plus overflow rather than breaking layout

- [ ] **Step 5: Verify non-markdown stage branches stay unchanged**

Review `features/workspace/components/editor-stage.tsx` and keep:

- image preview
- text preview
- HTML preview
- unsupported preview

unchanged except for any wrapper class alignment needed around the markdown branch.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run a broader frontend test sweep for editor regressions**

Run:

```bash
npx vitest run features/editor/components/editor-pane-mermaid-regression.test.tsx features/editor/components/editor-mermaid-preview-layer.test.tsx features/document/components/document-shell.test.tsx features/workspace/components/workspace-shell.test.tsx
```

Expected: PASS, proving shell/layout changes did not break existing editor/mermaid/document/workspace behavior.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.tsx features/workspace/components/editor-stage.test.tsx
git commit -m "feat: add macos reading baseline to editor surfaces"
```

## Task 6: Final menu polish, regression sweep, and manual macOS verification

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `README.md`
- Test: no new dedicated test file; use existing suites and manual verification notes

**Interfaces:**
- Consumes:
  - existing Tauri menu ids and role-based enablement
  - current README product positioning
- Produces:
  - lightly normalized menu labels/shortcuts if needed
  - final verification evidence that strict current behavior remains intact

**Support lenses:** `architecture-designer`

- [ ] **Step 1: Add a tiny menu-focused regression if labels or role gating changed**

If implementation changed role-based menu logic in `src-tauri/src/lib.rs`, add or extend a Rust unit test near current role/session tests to assert that document windows remain non-workspace role surfaces. Do not invent a new menu architecture.

- [ ] **Step 2: Adjust README language only if the shipped UI surface meaning changed**

If the final implementation introduces visible macOS-first behavior worth documenting, update the current product surface in `README.md` with one concise note, for example under the desktop/workspace overview. Do not mention second-phase typography or speculative features.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run the full frontend test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Run a production-ish frontend build**

Run:

```bash
npm run build
```

Expected: PASS with a successful Next build.

- [ ] **Step 7: Run the desktop app locally for manual verification**

Run:

```bash
npm run dev
```

Then, in a separate terminal if needed:

```bash
npx tauri dev
```

Expected manual checks on macOS:

- Workspace window shows macOS-first titlebar behavior and working drag region
- traffic-light area does not overlap toolbar controls
- Workspace light/dark/system all look coherent
- Document window uses the same shell language
- file tree, tabs, editor, outline, LLM Wiki / Memory still work
- markdown editing, draft recovery, conflict banners, Mermaid, math, code blocks still render and behave

- [ ] **Step 8: Negative assertions for forbidden scope creep**

Run:

```bash
! rg "Knuth|Plass|OpenType MATH|reading mode|focus mode" app common features src-tauri README.md
```

Expected: no new strict-current-product references to second-phase typography engine or out-of-scope modes.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs README.md
git commit -m "chore: verify macos shell rollout and docs"
```

## Self-Review

### Spec coverage

- macOS window shell enhancement -> Task 1
- Workspace / Document shared visual language -> Tasks 3 and 4
- toolbar / sidebar / tab strip / panel / empty state / status block restyle -> Tasks 2, 3, 4
- editor reading baseline -> Task 5
- light/dark/system continuity -> Tasks 2 and 6
- menu and shortcut light polish -> Task 6
- regression and fallback validation -> Tasks 1, 5, 6

No uncovered requirement anchors remain.

### Placeholder scan

- No `TBD`, `TODO`, “implement later”, or “similar to Task N” placeholders remain.

### Type consistency

- Rust helper names are defined before use in later tasks.
- Frontend shell markers are introduced in Tasks 2–5 before later verification relies on them.

### Design drift

- No new reading mode, focus mode, parser change, or typography engine was introduced.
- No new product workflow, menu architecture, or data model was introduced.

### Anchor coverage

- Every clarified first-phase anchor maps to a task, test, or explicit negative assertion.

### Surface-change coverage

- This is a compatibility-sensitive shell replacement, so the plan includes a Surface Inventory, Caller Proof, and Negative Assertions.

### Support lens coverage

- Every task lists `architecture-designer`, because each task touches shell boundaries, platform fallback, or long-lived structure decisions.

### Subagent handoff readiness

- Each task includes exact files, interfaces, commands, expected failure/pass states, and commit slices.

## Execution Handoff

Plan complete and saved to `docs/loopx/plans/2026-06-24-mdx-macos-native-feel-phase-one.md`.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, use one combined task reviewer per task, then final-review
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
