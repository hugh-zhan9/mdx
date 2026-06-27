# P7: Validation, Golden Fixtures, And Performance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 建立新编辑器上线前必须通过的验证体系，覆盖 roundtrip、golden、interaction、IME/find/accessibility smoke、性能基线、旧 view 对照。

**Architecture:** 测试资产分成三层：Rust crate tests、TypeScript/Vitest fixtures、人工/浏览器验证脚本。旧 view 保留为只读对照 fixture，直到 cleanup 阶段才删除。

**Tech Stack:** Rust tests, Vitest, Next/React test harnesses, existing manual browser verification script

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

### Task 1: Create a shared tex-canvas fixture corpus

**Files:**
- Create: `packages/mdx-editor/test/tex-canvas-fixtures.ts`
- Create: `packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
- Create: `src-tauri/crates/layout-core/tests/golden_layout_tests.rs`

**Interfaces:**
- Consumes: Markdown fixture strings and expected line/canvas/mirror snapshots
- Produces: shared fixtures reused by Rust and TS tests

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing fixture test**

```ts
import { describe, expect, it } from "vitest";
import { TEX_CANVAS_FIXTURES } from "./tex-canvas-fixtures";

describe("TEX_CANVAS_FIXTURES", () => {
  it("covers paragraph, math, table, mermaid, and fallback scenarios", () => {
    expect(TEX_CANVAS_FIXTURES.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining(["paragraph-cjk", "math-inline", "table-basic", "mermaid-basic", "html-fallback"]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
Expected: FAIL with `Cannot find module './tex-canvas-fixtures'`

- [ ] **Step 3: Implement the shared fixture file**

```ts
export const TEX_CANVAS_FIXTURES = [
  { id: "paragraph-cjk", markdown: "中文 English 混排\\n", expectations: { blockKinds: ["paragraph"] } },
  { id: "math-inline", markdown: "公式 $x^2$\\n", expectations: { blockKinds: ["paragraph"], hasMathInline: true } },
  { id: "table-basic", markdown: "| a | b |\\n| - | - |\\n| 1 | 2 |\\n", expectations: { blockKinds: ["table"] } },
  { id: "mermaid-basic", markdown: "```mermaid\\ngraph TD\\n  A --> B\\n```\\n", expectations: { blockKinds: ["mermaid"] } },
  { id: "html-fallback", markdown: "<details><summary>x</summary></details>\\n", expectations: { blockKinds: ["fallback"] } },
];
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/test/tex-canvas-fixtures.ts packages/mdx-editor/test/tex-canvas-fixtures.test.ts src-tauri/crates/layout-core/tests/golden_layout_tests.rs
git commit -m "test(editor): add tex-canvas fixture corpus"
```

---

### Task 2: Add comparison tests between old view semantics and new hybrid output

**Files:**
- Create: `packages/mdx-editor/react/legacy-view-comparison.test.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`

**Interfaces:**
- Consumes: old `DOMD` fixture path and new `HybridEditorHost`
- Produces: regression guard that Markdown, selection, and visible text semantics stay aligned

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing comparison test**

```tsx
import { describe, expect, it } from "vitest";

describe("legacy/new editor comparison", () => {
  it("keeps visible text semantics aligned for paragraph and mermaid markdown", () => {
    expect("placeholder").toBe("replace-with-comparison");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx`
Expected: FAIL by assertion

- [ ] **Step 3: Implement the comparison harness**

```tsx
// render the same markdown through the legacy fixture path and the hybrid path,
// normalize the visible text via buildVisibleTextIndex, then compare text output
// and selected markdown offsets for a small fixture matrix.
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx
git commit -m "test(editor): compare hybrid semantics against legacy fixture path"
```

---

### Task 3: Add manual verification and performance scripts for the new editor

**Files:**
- Modify: `scripts/verify-editor-browser.mjs`
- Create: `scripts/measure-tex-canvas-layout.mjs`
- Create: `features/editor/lib/tex-canvas-performance.test.ts`

**Interfaces:**
- Consumes: development server/manual test flow and fixture corpus
- Produces: updated manual checklist plus automated budget smoke for layout timing

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing performance smoke test**

```ts
import { describe, expect, it } from "vitest";

describe("tex-canvas performance budget", () => {
  it("keeps the fixture layout under the local smoke threshold", () => {
    expect(Number.POSITIVE_INFINITY).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- features/editor/lib/tex-canvas-performance.test.ts`
Expected: FAIL by assertion

- [ ] **Step 3: Implement the measurement helper and manual checklist update**

```js
// scripts/verify-editor-browser.mjs
console.log([
  "Manual editor verification:",
  "1. Run npm run dev and open the app.",
  "2. Open a Markdown file with headings, bold text, table, task list, math, Mermaid, callout, and footnote.",
  "3. Confirm the hybrid editor renders DOM text and Canvas blocks together.",
  "4. Type Chinese text with IME into a paragraph and a math-adjacent paragraph.",
  "5. Run browser find across text and a Canvas block mirror.",
  "6. Export PDF and verify text is selectable.",
].join("\\n"));
```

- [ ] **Step 4: Run the tests and manual-script smoke**

Run: `npm test -- features/editor/lib/tex-canvas-performance.test.ts`
Expected: PASS

Run: `node scripts/verify-editor-browser.mjs`
Expected: prints six updated manual verification steps mentioning hybrid editor and PDF export

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-editor-browser.mjs scripts/measure-tex-canvas-layout.mjs features/editor/lib/tex-canvas-performance.test.ts
git commit -m "test(editor): add hybrid editor validation and performance smoke"
```
