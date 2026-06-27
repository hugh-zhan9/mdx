# P5: Lightweight DOM Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 为 Canvas-only blocks 补齐可搜索文本、ARIA、copy/find/range 桥接，同时保证正文仍直接使用 DOM text run 的原生浏览器能力。

**Architecture:** 在 `packages/mdx-editor/react` 增加 `LightMirror` 组件和稳定 range map，在 `features/editor` 侧把 mirror 接进 find/replace、visible-text-search、clipboard 和 accessibility 辅助逻辑。Mirror 只覆盖公式、表格、代码块、Mermaid、图片装饰等 Canvas block，不复制正文的视觉布局。

**Tech Stack:** TypeScript, React 19, DOM Range APIs, current editor visible-text-search utilities

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
  browser find, copy/paste, screen-reader traversal for Canvas blocks
- Exported functions/types/modules:
  `visible-text-search.ts`, `use-editor-find-replace.ts`, `packages/mdx-editor/react/index.ts`
- Runtime/generated artifacts and templates:
  hidden mirror DOM, stable range ids, canvas highlight overlays
- Installer/package/deployment surface:
  none
- Hooks/background jobs/automation:
  `useEditorFindReplace`, clipboard and selection helpers
- Current product docs:
  `docs/loopx/specs/editor.md`
- Tests/governance checks:
  `npm test`, `npm run lint`
- Compatibility/migration paths:
 正文查找仍直接使用 DOM text run；mirror 仅补 Canvas block

Caller Proof:

```bash
rg "visible-text-search|useEditorFindReplace|clipboard|aria|mirror" features packages docs
```

Decision rule:

- retained caller exists in current source/runtime code -> keep it and name the caller in the plan
- only historical docs, release notes, old plans, or frozen external content reference it -> do not count that as a retained caller
- no retained caller -> delete it or remove it from current governance/package/docs

---

### Task 1: Build mirror block types and stable range mapping

**Files:**
- Create: `features/editor/lib/canvas-range-map.ts`
- Create: `features/editor/lib/canvas-range-map.test.ts`
- Create: `packages/mdx-editor/react/light-mirror.tsx`
- Create: `packages/mdx-editor/react/light-mirror.test.tsx`

**Interfaces:**
- Consumes: `snapshot.mirrorBlocks`, `snapshot.selectionGeometries`
- Produces: `buildCanvasRangeMap(mirrorBlocks)`, `LightMirror`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing range-map test**

```ts
import { describe, expect, it } from "vitest";
import { buildCanvasRangeMap } from "./canvas-range-map";

describe("buildCanvasRangeMap", () => {
  it("indexes mirror blocks by stable range id", () => {
    const map = buildCanvasRangeMap([
      { blockId: "math-1", pmFrom: 12, pmTo: 18, semanticText: "x squared", ariaLabel: "math x squared" },
    ]);

    expect(map.get("math-1")?.pmFrom).toBe(12);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- features/editor/lib/canvas-range-map.test.ts`
Expected: FAIL with `Cannot find module './canvas-range-map'`

- [ ] **Step 3: Implement the range map and hidden mirror DOM**

```ts
// features/editor/lib/canvas-range-map.ts
export interface CanvasMirrorBlock {
  blockId: string;
  pmFrom: number;
  pmTo: number;
  semanticText: string;
  ariaLabel: string;
}

export function buildCanvasRangeMap(blocks: CanvasMirrorBlock[]) {
  return new Map(blocks.map((block) => [block.blockId, block]));
}
```

```tsx
// packages/mdx-editor/react/light-mirror.tsx
export function LightMirror({ blocks }: { blocks: Array<{ blockId: string; semanticText: string; ariaLabel: string }> }) {
  return (
    <div data-layout-light-mirror className="sr-only" aria-hidden="false">
      {blocks.map((block) => (
        <div key={block.blockId} data-mirror-block-id={block.blockId} aria-label={block.ariaLabel}>
          {block.semanticText}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- features/editor/lib/canvas-range-map.test.ts packages/mdx-editor/react/light-mirror.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/editor/lib/canvas-range-map.ts features/editor/lib/canvas-range-map.test.ts packages/mdx-editor/react/light-mirror.tsx packages/mdx-editor/react/light-mirror.test.tsx
git commit -m "feat(editor): add canvas mirror range map"
```

---

### Task 2: Bridge browser find and visible text indexing across Canvas blocks

**Files:**
- Modify: `features/editor/lib/visible-text-search.ts`
- Modify: `features/editor/lib/visible-text-search.test.ts`
- Modify: `features/editor/hooks/use-editor-find-replace.ts`
- Modify: `features/editor/hooks/use-editor-find-replace.test.ts`

**Interfaces:**
- Consumes: visible DOM text plus `LightMirror` DOM
- Produces: continuous search matches spanning正文和 Canvas blocks

**Support lenses:** architecture-designer

- [ ] **Step 1: Add the failing search test for mirror content**

```ts
it("includes hidden mirror text for canvas blocks while excluding preview garbage", () => {
  const root = editorRoot();
  const mirror = child(root, "div");
  mirror.setAttribute("data-layout-light-mirror", "");
  child(mirror, "div", "", "x squared");

  const index = buildVisibleTextIndex(root);
  expect(findVisibleTextMatches(index, "x squared", { caseSensitive: false })).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- features/editor/lib/visible-text-search.test.ts`
Expected: FAIL because the current skip rules hide the mirror subtree or never include it

- [ ] **Step 3: Modify visible-text-search and find/replace to honor mirror blocks**

```ts
// features/editor/lib/visible-text-search.ts
function shouldSkipElement(element: Element): boolean {
  if (element.hasAttribute("data-layout-light-mirror")) {
    return false;
  }
  // keep existing hidden/preview/syntax exclusions
  ...
}
```

```ts
// features/editor/hooks/use-editor-find-replace.ts
// keep using buildVisibleTextIndex(editorRoot), but pass the mirror-attached root
// so matches include Canvas block semantic text.
```

- [ ] **Step 4: Run the updated tests**

Run: `npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/editor/lib/visible-text-search.ts features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.ts features/editor/hooks/use-editor-find-replace.test.ts
git commit -m "feat(editor): bridge browser find through canvas mirror text"
```

---

### Task 3: Mount mirror blocks in the hybrid host and preserve clipboard/a11y behavior

**Files:**
- Modify: `packages/mdx-editor/react/hybrid-editor-host.tsx`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`

**Interfaces:**
- Consumes: `snapshot.mirrorBlocks`
- Produces: mounted `LightMirror` subtree under the hybrid host

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing host integration test**

```tsx
it("mounts the light mirror for canvas blocks", () => {
  const html = renderToStaticMarkup(
    <HybridEditorHost
      snapshot={{
        revision: 1,
        lines: [],
        canvasDrawOps: [],
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks: [{ blockId: "math-1", pmFrom: 0, pmTo: 4, semanticText: "x squared", ariaLabel: "math x squared" }],
      }}
    />,
  );

  expect(html).toContain("data-layout-light-mirror");
  expect(html).toContain("x squared");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx`
Expected: FAIL because the host does not render the mirror subtree yet

- [ ] **Step 3: Mount the mirror subtree**

```tsx
// packages/mdx-editor/react/hybrid-editor-host.tsx
import { LightMirror } from "./light-mirror";

...
<DomTextRunLayer lines={snapshot.lines} />
<CanvasSvgLayer />
<LightMirror blocks={snapshot.mirrorBlocks} />
```

- [ ] **Step 4: Run the integration tests**

Run: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx features/editor/components/editor-pane.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/hybrid-editor-host.tsx features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx
git commit -m "feat(editor): mount light mirror with hybrid host"
```
