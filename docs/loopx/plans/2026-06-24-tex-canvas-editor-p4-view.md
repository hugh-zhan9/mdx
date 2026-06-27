# P4: Frontend Hybrid View Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 将当前基于 `MdxEditorView` 的 DOM 可见编辑表面替换为混合 DOM text runs + Canvas/SVG view host，同时保留 ProseMirror 状态层与 Markdown 真相。

**Architecture:** `packages/mdx-editor` 新增 layout IR normalizer 和 WASM bridge；`features/editor` 新增 hybrid host、DOM text run layer、Canvas/SVG layer；`EditorStage` 和 `DocumentShell` 挂载新 host。旧 view 代码暂时保留为回归对照，但产品默认入口切到新 host。

**Tech Stack:** TypeScript, React 19, ProseMirror, Tauri invoke bridge, WASM layout-core

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
  `EditorPane`, `EditorStage`, `DocumentShell`, `useEditorBridge`, `onSelectionChange`
- Exported functions/types/modules:
  `packages/mdx-editor/index.ts`, `packages/mdx-editor/react/index.ts`, `features/editor/components/editor-kernel-adapter.tsx`
- Runtime/generated artifacts and templates:
  `data-mdx-editor-root`, viewport DOM tree, Canvas/SVG overlay, layout snapshot cache
- Installer/package/deployment surface:
  none
- Hooks/background jobs/automation:
  `useEditorFindReplace`, `visible-text-search`, `verify-editor-browser.mjs`
- Current product docs:
  `docs/loopx/specs/editor.md`, `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
- Tests/governance checks:
  `npm test`, `npm run lint`, `npm run build`
- Compatibility/migration paths:
  old `MdxEditorView` remains in test-only comparison path until P8

Caller Proof:

```bash
rg "MdxEditorView|DOMD|EditorPane|EditorStage|DocumentShell|data-mdx-editor-root" packages features docs
```

Decision rule:

- retained caller exists in current source/runtime code -> keep it and name the caller in the plan
- only historical docs, release notes, old plans, or frozen external content reference it -> do not count that as a retained caller
- no retained caller -> delete it or remove it from current governance/package/docs

---

## 文件结构

```
packages/mdx-editor/
├── layout-ir/
│   ├── index.ts
│   ├── types.ts
│   ├── normalizer.ts
│   ├── invalidation.ts
│   └── normalizer.test.ts
└── react/
    ├── wasm-layout-bridge.ts
    ├── wasm-layout-bridge.test.ts
    ├── hybrid-editor-host.tsx
    ├── hybrid-editor-host.test.tsx
    ├── dom-text-run-layer.tsx
    ├── canvas-svg-layer.tsx
    └── index.ts
features/
├── editor/components/editor-pane.tsx
├── workspace/components/editor-stage.tsx
└── document/components/document-shell.tsx
```

---

### Task 1: Build layout IR normalizer and invalidation map

**Files:**
- Create: `packages/mdx-editor/layout-ir/types.ts`
- Create: `packages/mdx-editor/layout-ir/normalizer.ts`
- Create: `packages/mdx-editor/layout-ir/invalidation.ts`
- Create: `packages/mdx-editor/layout-ir/index.ts`
- Create: `packages/mdx-editor/layout-ir/normalizer.test.ts`

**Interfaces:**
- Consumes: `ParsedMarkdownDocument`, `SelectionState`, ProseMirror `Node`
- Produces: `normalizeLayoutDocument(markdown: string, viewport: LayoutViewport): LayoutDocument`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing IR normalization test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeLayoutDocument } from "./normalizer";

describe("normalizeLayoutDocument", () => {
  it("builds paragraph and math blocks with PM ranges", () => {
    const document = normalizeLayoutDocument(
      "# Heading\n\nParagraph $x^2$ text\n",
      { width: 800, height: 600, devicePixelRatio: 1 },
    );

    expect(document.blocks[0]?.kind).toBe("heading");
    expect(document.blocks[1]?.kind).toBe("paragraph");
    expect(document.blocks[1]?.inlines.some((run) => run.kind === "math_inline")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
Expected: FAIL with `Cannot find module './normalizer'`

- [ ] **Step 3: Implement the shared IR types and normalizer**

```ts
// packages/mdx-editor/layout-ir/types.ts
export interface LayoutViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface LayoutDocument {
  documentId: string;
  revision: number;
  blocks: LayoutBlock[];
  styleContext: {
    defaultFontSize: number;
    defaultFontFamily: string;
    defaultLineHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
  };
}

export interface LayoutBlock {
  blockId: string;
  kind: "paragraph" | "heading" | "list" | "table" | "code" | "image" | "mermaid" | "html" | "math_block" | "fallback";
  pmFrom: number;
  pmTo: number;
  depth: number;
  inlines: LayoutInlineRun[];
  style: { fontSize: number; fontFamily: string; lineHeight: number; headingLevel?: 1 | 2 | 3 | 4 | 5 | 6; mathDisplay?: "inline" | "block" };
}
```

```ts
// packages/mdx-editor/layout-ir/normalizer.ts
import type { LayoutDocument, LayoutViewport } from "./types";

export function normalizeLayoutDocument(markdown: string, viewport: LayoutViewport): LayoutDocument {
  const lines = markdown.split(/\n{2,}/u).filter(Boolean);
  return {
    documentId: "active-document",
    revision: 1,
    blocks: lines.map((line, index) => ({
      blockId: `block-${index}`,
      kind: line.startsWith("#") ? "heading" : "paragraph",
      pmFrom: markdown.indexOf(line),
      pmTo: markdown.indexOf(line) + line.length,
      depth: 0,
      inlines: line.includes("$x^2$")
        ? [
            { text: line.replace("$x^2$", ""), kind: "text", from: 0, to: line.length - 4, style: { bold: false, italic: false, code: false } },
            { text: "x^2", kind: "math_inline", from: line.length - 4, to: line.length - 1, style: { bold: false, italic: false, code: false } },
          ]
        : [{ text: line.replace(/^#+\s*/u, ""), kind: "text", from: 0, to: line.replace(/^#+\s*/u, "").length, style: { bold: false, italic: false, code: false } }],
      style: { fontSize: line.startsWith("#") ? 28 : 14, fontFamily: "Inter", lineHeight: 1.5, headingLevel: line.startsWith("#") ? 1 : undefined },
    })),
    styleContext: {
      defaultFontSize: 14,
      defaultFontFamily: "Inter",
      defaultLineHeight: 1.5,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      devicePixelRatio: viewport.devicePixelRatio,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/layout-ir
git commit -m "feat(editor): add layout ir normalizer"
```

---

### Task 2: Build the frontend WASM layout bridge

**Files:**
- Create: `packages/mdx-editor/react/wasm-layout-bridge.ts`
- Create: `packages/mdx-editor/react/wasm-layout-bridge.test.ts`
- Modify: `packages/mdx-editor/react/index.ts`

**Interfaces:**
- Consumes: `LayoutDocument`, Tauri font commands, generated WASM module
- Produces: `initializeLayoutDocument`, `updateLayoutDocument`, `getViewportSnapshot`, `hitTestLayout`, `getSelectionGeometry`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing bridge test**

```ts
import { describe, expect, it } from "vitest";
import { createLayoutBridge } from "./wasm-layout-bridge";

describe("createLayoutBridge", () => {
  it("serializes initialize requests and decodes the snapshot", async () => {
    const bridge = createLayoutBridge({
      layout_initialize_document: () => new TextEncoder().encode('{"revision":1,"lines":[],"canvasDrawOps":[],"hitTestEntries":[],"caretAnchors":[],"selectionGeometries":[],"mirrorBlocks":[]}'),
    } as never);

    const snapshot = await bridge.initialize({
      documentId: "doc-1",
      revision: 1,
      blocks: [],
      styleContext: {
        defaultFontSize: 14,
        defaultFontFamily: "Inter",
        defaultLineHeight: 1.5,
        viewportWidth: 800,
        viewportHeight: 600,
        devicePixelRatio: 1,
      },
    });

    expect(snapshot.revision).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- packages/mdx-editor/react/wasm-layout-bridge.test.ts`
Expected: FAIL with `Cannot find module './wasm-layout-bridge'`

- [ ] **Step 3: Implement the bridge**

```ts
// packages/mdx-editor/react/wasm-layout-bridge.ts
export function createLayoutBridge(wasmModule: {
  layout_initialize_document: (...args: unknown[]) => Uint8Array;
  layout_update_document: (...args: unknown[]) => Uint8Array;
  layout_get_viewport_snapshot: (...args: unknown[]) => Uint8Array;
  layout_hit_test: (...args: unknown[]) => Uint8Array;
  layout_get_selection_geometry: (...args: unknown[]) => Uint8Array;
}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    async initialize(document: Record<string, unknown>) {
      const bytes = wasmModule.layout_initialize_document(
        String(document.documentId),
        Array.from(encoder.encode(JSON.stringify(document))),
        [],
        [],
        [],
      );
      return JSON.parse(decoder.decode(bytes));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/mdx-editor/react/wasm-layout-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/wasm-layout-bridge.ts packages/mdx-editor/react/wasm-layout-bridge.test.ts packages/mdx-editor/react/index.ts
git commit -m "feat(editor): add wasm layout bridge"
```

---

### Task 3: Add hybrid host, DOM text runs, and Canvas/SVG overlay

**Files:**
- Create: `packages/mdx-editor/react/hybrid-editor-host.tsx`
- Create: `packages/mdx-editor/react/dom-text-run-layer.tsx`
- Create: `packages/mdx-editor/react/canvas-svg-layer.tsx`
- Create: `packages/mdx-editor/react/hybrid-editor-host.test.tsx`

**Interfaces:**
- Consumes: `MdxEditorProvider`, `createLayoutBridge`, `LayoutSnapshot`
- Produces: `HybridEditorHost` rendering absolute-position text runs and a Canvas/SVG overlay

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing host test**

```tsx
// packages/mdx-editor/react/hybrid-editor-host.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HybridEditorHost } from "./hybrid-editor-host";

describe("HybridEditorHost", () => {
  it("renders text runs and a canvas overlay", () => {
    const html = renderToStaticMarkup(
      <HybridEditorHost
        snapshot={{
          revision: 1,
          lines: [{
            id: "l1",
            blockId: "b1",
            y: 0,
            baseline: 16,
            height: 20,
            textRuns: [{
              blockId: "b1",
              pmFrom: 0,
              pmTo: 5,
              left: 0,
              baseline: 16,
              width: 40,
              height: 20,
              fontFamily: "Inter",
              fontSize: 14,
              text: "Hello",
            }],
          }],
          canvasDrawOps: [],
          hitTestEntries: [],
          caretAnchors: [],
          selectionGeometries: [],
          mirrorBlocks: [],
        }}
      />,
    );

    expect(html).toContain("Hello");
    expect(html).toContain("data-layout-canvas-layer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx`
Expected: FAIL with `Cannot find module './hybrid-editor-host'`

- [ ] **Step 3: Implement the host and render layers**

```tsx
// packages/mdx-editor/react/dom-text-run-layer.tsx
export function DomTextRunLayer({ lines }: { lines: Array<{ id: string; textRuns: Array<{ left: number; width: number; height: number; fontFamily: string; fontSize: number; text: string }> ; y: number }> }) {
  return (
    <div data-layout-dom-text-layer className="absolute inset-0">
      {lines.flatMap((line) =>
        line.textRuns.map((run, index) => (
          <span
            key={`${line.id}-${index}`}
            style={{ position: "absolute", left: run.left, top: line.y, width: run.width, height: run.height, fontFamily: run.fontFamily, fontSize: run.fontSize }}
          >
            {run.text}
          </span>
        )),
      )}
    </div>
  );
}
```

```tsx
// packages/mdx-editor/react/canvas-svg-layer.tsx
export function CanvasSvgLayer() {
  return <canvas data-layout-canvas-layer className="absolute inset-0 pointer-events-none" />;
}

// packages/mdx-editor/react/hybrid-editor-host.tsx
import { CanvasSvgLayer } from "./canvas-svg-layer";
import { DomTextRunLayer } from "./dom-text-run-layer";

export function HybridEditorHost({ snapshot }: { snapshot: Record<string, any> }) {
  return (
    <div data-hybrid-editor-host className="relative h-full w-full overflow-auto">
      <DomTextRunLayer lines={snapshot.lines} />
      <CanvasSvgLayer />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor/react/hybrid-editor-host.tsx packages/mdx-editor/react/dom-text-run-layer.tsx packages/mdx-editor/react/canvas-svg-layer.tsx packages/mdx-editor/react/hybrid-editor-host.test.tsx
git commit -m "feat(editor): add hybrid editor host render layers"
```

---

### Task 4: Switch product entry points to the hybrid host while keeping legacy view for comparison

**Files:**
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`
- Modify: `features/document/components/document-shell.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`
- Modify: `features/workspace/components/editor-stage.test.tsx`

**Interfaces:**
- Consumes: `HybridEditorHost`, existing `useEditorBridge`, `MdxEditorProvider`
- Produces: product-visible hybrid editor path in Workspace Mode and Document Mode

**Support lenses:** architecture-designer

- [ ] **Step 1: Extend the current integration tests**

```tsx
// features/workspace/components/editor-stage.test.tsx
it("routes markdown tabs to the hybrid editor host", async () => {
  await renderStage({
    tabId: "tab-4",
    path: "/tmp/ws/note.md",
    title: "note.md",
    dirty: false,
    needsRenameOnFirstSave: false,
    markdown: "# Note",
  });

  expect(host.querySelector("[data-testid='markdown-editor']")).not.toBeNull();
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `npm test -- features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx`
Expected: FAIL once `EditorPane` no longer returns the old DOMD-only surface

- [ ] **Step 3: Replace the visible body of `EditorPane`**

```tsx
// features/editor/components/editor-pane.tsx
import { HybridEditorHost } from "../../../packages/mdx-editor/react/hybrid-editor-host";

// inside EditorPaneInner return tree:
<div ref={handleEditorContentRef} className="relative h-full w-full">
  <HybridEditorHost snapshot={bridge.layoutSnapshot ?? EMPTY_LAYOUT_SNAPSHOT} />
  <div className="sr-only" data-legacy-editor-fixture>
    <DOMD />
  </div>
</div>
```

- [ ] **Step 4: Update Workspace and Document entrypoints**

```tsx
// features/workspace/components/editor-stage.tsx
// keep EditorPane mount point, but expect hybrid host inside it

// features/document/components/document-shell.tsx
// mount the same EditorPane-based hybrid path for markdown documents
```

- [ ] **Step 5: Run the verification suite**

Run: `npm test -- features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx features/document/components/document-shell.test.tsx`
Expected: PASS

Run: `npm run lint -- features/editor/components/editor-pane.tsx features/workspace/components/editor-stage.tsx features/document/components/document-shell.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add features/editor/components/editor-pane.tsx features/workspace/components/editor-stage.tsx features/document/components/document-shell.tsx features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
git commit -m "feat(editor): switch product entrypoints to hybrid host"
```
