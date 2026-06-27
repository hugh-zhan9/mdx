# P8: Legacy View Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 在 P7 全量验收通过后删除旧 DOM visible editor 对照代码和当前产品面上的历史兼容层，只保留 hybrid editor 相关实现。

**Architecture:** 先做 surface inventory 和 caller proof，确认旧 `MdxEditorView` / `DOMD` / legacy comparison-only wiring 已经不再被当前产品入口依赖，再删除代码、测试和文档中的当前产品引用。历史计划文档可以保留旧名称；严格 current product surface 不允许再引用这些遗留符号。

**Tech Stack:** TypeScript, React, Rust workspace checks, ripgrep-based governance checks

**Support lenses:** architecture-designer

## Global Constraints

- Markdown 文件仍是唯一持久化真相，unsupported Markdown fallback 必须保真。
- 草稿恢复、冲突检测、workspace/document 保存流程不能退化。
- 120fps 滚动是硬目标；普通输入到可见更新 < 50ms；首屏可交互 < 500ms。
- 最终断行目标为 Knuth-Plass，贪心仅为过渡 fallback。
- 依赖面极小、接口隔离、优先纯 Rust。
- 旧 view 代码保留为回归对照与测试夹具，产品唯一暴露新编辑器；全量验收后删除旧 view。
- 首版验收平台为 macOS Tauri。

---

## Surface Inventory

- Public commands/API/routes/events/config:
  `EditorPane`, `EditorStage`, `DocumentShell`, `packages/mdx-editor/react/index.ts`
- Exported functions/types/modules:
  `MdxEditorView`, `DOMD`, `useEditor`, `useEditorStoreApi`, old fixture-only wrappers
- Runtime/generated artifacts and templates:
  `data-mdx-editor-view`, `data-legacy-editor-fixture`
- Installer/package/deployment surface:
  none
- Hooks/background jobs/automation:
  legacy comparison tests, manual verification script wording
- Current product docs:
  `docs/loopx/specs/editor.md`, `README`-style current product docs if added later
- Tests/governance checks:
  `npm test`, `npm run lint`, `npm run build`, `cd src-tauri && cargo test`
- Compatibility/migration paths:
  strict current product paths must no longer reference old view; historical plans may still mention it

Strict current product paths:

- `packages/mdx-editor/`
- `features/editor/`
- `features/workspace/`
- `features/document/`
- `scripts/verify-editor-browser.mjs`
- `docs/loopx/specs/`

Historical paths allowed to mention removed behavior:

- `docs/loopx/plans/`
- `docs/loopx/design/`
- `.loopx/subagent-exec/`

Caller Proof:

```bash
rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs
```

Decision rule:

- retained caller exists in current source/runtime code -> keep it and name the caller in the plan
- only historical docs, release notes, old plans, or frozen external content reference it -> do not count that as a retained caller
- no retained caller -> delete it or remove it from current governance/package/docs

Negative Assertions:

```bash
test ! -e packages/mdx-editor/react/mdx-editor-view.tsx
! rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs
npm run build
```

---

### Task 1: Prove no current product caller still requires the legacy visible editor

**Files:**
- Modify: `docs/loopx/specs/editor.md`
- Create: `features/editor/lib/editor-kernel-removal.test.ts`

**Interfaces:**
- Consumes: caller proof search results
- Produces: a documented removal decision and a regression test guarding against accidental legacy reintroduction

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing governance test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("legacy editor removal governance", () => {
  it("does not expose legacy editor-view symbols from the public react index", () => {
    const source = readFileSync("packages/mdx-editor/react/index.ts", "utf8");
    expect(source).not.toContain("MdxEditorView");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- features/editor/lib/editor-kernel-removal.test.ts`
Expected: FAIL because `MdxEditorView` is still exported

- [ ] **Step 3: Update the current-product spec to describe the hybrid-only surface**

```md
<!-- docs/loopx/specs/editor.md -->
- The current product editor surface is the hybrid DOM text-run + Canvas/SVG host.
- Legacy DOM visible editor code is not part of the current product surface.
```

- [ ] **Step 4: Run caller proof before deletion**

Run: `rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs`
Expected: only current product callers that this cleanup task is about to remove

- [ ] **Step 5: Commit**

```bash
git add docs/loopx/specs/editor.md features/editor/lib/editor-kernel-removal.test.ts
git commit -m "test(editor): add legacy view removal governance guard"
```

---

### Task 2: Delete the old visible-editor module and remove its exports

**Files:**
- Delete: `packages/mdx-editor/react/mdx-editor-view.tsx`
- Modify: `packages/mdx-editor/react/index.ts`
- Modify: `features/editor/components/editor-kernel-adapter.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`

**Interfaces:**
- Consumes: hybrid host path already live from P4-P7
- Produces: no public `MdxEditorView`/`DOMD` export in current product code

**Support lenses:** architecture-designer

- [ ] **Step 1: Delete the module and remove its exports**

```ts
// packages/mdx-editor/react/index.ts
export {
  MdxEditorContext,
  useMdxEditor,
  type MdxEditorContextValue,
} from "./mdx-editor-context";
export {
  MdxEditorProvider,
  type MdxEditorProviderProps,
} from "./mdx-editor-provider";
export { EditorToolbar } from "./editor-toolbar";
```

```ts
// features/editor/components/editor-kernel-adapter.tsx
// remove DOMD alias; keep provider/store helpers only
```

- [ ] **Step 2: Run the focused tests**

Run: `npm test -- features/editor/lib/editor-kernel-removal.test.ts features/editor/components/editor-pane.test.tsx`
Expected: PASS

- [ ] **Step 3: Run the negative assertion**

Run: `test ! -e packages/mdx-editor/react/mdx-editor-view.tsx`
Expected: exit code 0

- [ ] **Step 4: Commit**

```bash
git add packages/mdx-editor/react/index.ts features/editor/components/editor-kernel-adapter.tsx features/editor/components/editor-pane.test.tsx
git rm packages/mdx-editor/react/mdx-editor-view.tsx
git commit -m "refactor(editor): remove legacy visible editor module"
```

---

### Task 3: Remove remaining current-product references and prove clean governance

**Files:**
- Modify: `scripts/verify-editor-browser.mjs`
- Modify: `features/workspace/components/editor-stage.test.tsx`
- Modify: `features/document/components/document-shell.test.tsx`

**Interfaces:**
- Consumes: current-product strict paths
- Produces: a codebase where only historical paths mention the old view

**Support lenses:** architecture-designer

- [ ] **Step 1: Remove legacy wording from tests and manual verification**

```js
// scripts/verify-editor-browser.mjs
console.log([
  "Manual editor verification:",
  "1. Run npm run dev and open the app.",
  "2. Confirm the hybrid editor surface is the only visible markdown editor.",
  "3. Verify text, math, Mermaid, table, fallback, and PDF export flows.",
].join("\\n"));
```

- [ ] **Step 2: Run current-product negative assertions**

Run: `! rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs`
Expected: no output

- [ ] **Step 3: Run full verification**

Run: `npm test`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-editor-browser.mjs features/workspace/components/editor-stage.test.tsx features/document/components/document-shell.test.tsx
git commit -m "chore(editor): remove remaining current-product legacy view references"
```
