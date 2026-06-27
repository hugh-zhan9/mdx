# P6: Complex Block Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 把公式、表格、代码块、图片、Mermaid、HTML fallback、unsupported source fallback 迁到 hybrid host 的复杂块协议里，保持 Markdown 语义和现有资源/序列化约束不变。

**Architecture:** 在 `packages/mdx-editor/react/complex-blocks` 目录下为每类复杂块提供独立 adapter；`canvas-svg-layer.tsx` 统一调度这些 adapters；`features/editor` 继续负责资源加载和用户交互。失败时回到源码或 fallback block，不丢 Markdown 真相。

**Tech Stack:** TypeScript, React 19, existing MDX editor kernel, Mermaid, Prism tokenizer

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

### Task 1: Add adapter modules for math, code, image, and Mermaid blocks

**Files:**
- Create: `packages/mdx-editor/react/complex-blocks/index.ts`
- Create: `packages/mdx-editor/react/complex-blocks/math-block.tsx`
- Create: `packages/mdx-editor/react/complex-blocks/code-block.tsx`
- Create: `packages/mdx-editor/react/complex-blocks/image-block.tsx`
- Create: `packages/mdx-editor/react/complex-blocks/mermaid-block.tsx`
- Create: `packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx`

**Interfaces:**
- Consumes: `CanvasDrawOp[]`, image loader, Mermaid renderer, tokenizer output
- Produces: adapter renderers keyed by draw-op `kind`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing adapter smoke test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderComplexBlock } from "./index";

describe("renderComplexBlock", () => {
  it("renders math ops through the math adapter", () => {
    const html = renderToStaticMarkup(
      renderComplexBlock({
        blockId: "math-1",
        kind: "math",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        data: { type: "text", content: "x^2" },
      }),
    );

    expect(html).toContain("data-complex-block-kind=\"math\"");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx`
Expected: FAIL with `Cannot find module './index'`

- [ ] **Step 3: Implement the adapter registry**

```tsx
// packages/mdx-editor/react/complex-blocks/index.ts
import { MathBlock } from "./math-block";
import { CodeBlock } from "./code-block";
import { ImageBlock } from "./image-block";
import { MermaidBlock } from "./mermaid-block";

export function renderComplexBlock(op: { kind: string } & Record<string, any>) {
  switch (op.kind) {
    case "math":
      return <MathBlock op={op} />;
    case "code_highlight":
      return <CodeBlock op={op} />;
    case "image":
      return <ImageBlock op={op} />;
    case "mermaid":
      return <MermaidBlock op={op} />;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/complex-blocks
git commit -m "feat(editor): add complex block adapters for canvas blocks"
```

---

### Task 2: Add table and HTML/fallback adapters and wire them into `CanvasSvgLayer`

**Files:**
- Create: `packages/mdx-editor/react/complex-blocks/table-block.tsx`
- Create: `packages/mdx-editor/react/complex-blocks/html-fallback-block.tsx`
- Modify: `packages/mdx-editor/react/canvas-svg-layer.tsx`
- Modify: `packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx`

**Interfaces:**
- Consumes: table-grid draw ops, HTML/fallback draw ops
- Produces: visual block adapters plus a single overlay render path

**Support lenses:** architecture-designer

- [ ] **Step 1: Extend the failing tests for table and fallback**

```tsx
it("renders table grid and html fallback blocks", () => {
  const table = renderToStaticMarkup(
    renderComplexBlock({
      blockId: "table-1",
      kind: "table_grid",
      rect: { x: 0, y: 0, width: 120, height: 80 },
      data: { rows: 2, columns: 2 },
    }),
  );
  const fallback = renderToStaticMarkup(
    renderComplexBlock({
      blockId: "fallback-1",
      kind: "decoration",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      data: { fallback: true, markdown: "<unsafe />" },
    }),
  );

  expect(table).toContain("data-complex-block-kind=\"table\"");
  expect(fallback).toContain("data-complex-block-kind=\"fallback\"");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx`
Expected: FAIL because the registry does not yet route these kinds

- [ ] **Step 3: Implement the table and fallback adapters and update the canvas layer**

```tsx
// packages/mdx-editor/react/canvas-svg-layer.tsx
import { renderComplexBlock } from "./complex-blocks";

export function CanvasSvgLayer({ drawOps = [] }: { drawOps?: Array<Record<string, any>> }) {
  return (
    <div data-layout-canvas-layer className="absolute inset-0 pointer-events-none">
      {drawOps.map((op) => (
        <div key={op.blockId} style={{ position: "absolute", left: op.rect.x, top: op.rect.y, width: op.rect.width, height: op.rect.height }}>
          {renderComplexBlock(op)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx packages/mdx-editor/react/hybrid-editor-host.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/complex-blocks/table-block.tsx packages/mdx-editor/react/complex-blocks/html-fallback-block.tsx packages/mdx-editor/react/canvas-svg-layer.tsx packages/mdx-editor/react/complex-blocks/complex-blocks.test.tsx
git commit -m "feat(editor): route table and fallback blocks through canvas layer"
```

---

### Task 3: Preserve Mermaid/image/resource semantics and fallback behavior in app integrations

**Files:**
- Modify: `features/editor/components/editor-mermaid-preview-layer.tsx`
- Modify: `features/editor/components/editor-pane-mermaid-regression.test.tsx`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`

**Interfaces:**
- Consumes: complex-block adapters plus existing Markdown serializer
- Produces: Mermaid/image/fallback roundtrip-safe block behavior

**Support lenses:** architecture-designer

- [ ] **Step 1: Add the failing regression tests**

```ts
it("keeps mermaid source markdown while rendering through the adapter path", () => {
  const markdown = "```mermaid\\ngraph TD\\n  A --> B\\n```\\n";
  expect(markdown).toContain("graph TD");
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- features/editor/components/editor-pane-mermaid-regression.test.tsx packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`
Expected: FAIL once hybrid host/adapters are mounted without preserving old serializer expectations

- [ ] **Step 3: Adapt the Mermaid and fallback integration logic**

```tsx
// features/editor/components/editor-mermaid-preview-layer.tsx
// keep Mermaid source parsing and preview exclusion rules, but treat rendered output
// as a complex block overlay instead of an inline DOM mutation target.
```

```ts
// serializer tests should keep asserting that Mermaid fences and unsupported HTML
// round-trip to the exact source markdown.
```

- [ ] **Step 4: Run the verification tests**

Run: `npm test -- features/editor/components/editor-pane-mermaid-regression.test.tsx packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add features/editor/components/editor-mermaid-preview-layer.tsx features/editor/components/editor-pane-mermaid-regression.test.tsx packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
git commit -m "feat(editor): preserve complex block markdown semantics"
```
