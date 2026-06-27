# TeX Canvas Editor Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `exec` to execute this plan. Do not implement from this plan without first loading the `exec` skill instructions.

## Source Material

- Design source: `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
- Product specs: `docs/loopx/specs/editor.md`, `docs/loopx/specs/testing.md`
- Existing implementation plans: `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`, `docs/loopx/plans/2026-06-24-tex-canvas-editor-p1-wasm.md`, `docs/loopx/plans/2026-06-24-tex-canvas-editor-p2-font.md`, `docs/loopx/plans/2026-06-24-tex-canvas-editor-p8-cleanup.md`
- Gap audit basis: final-review findings from 2026-06-26 against the TeX-style Canvas self-drawn editor implementation.

## Goal

Close the product-level gaps that keep the current implementation from satisfying the TeX-style Canvas editor design:

- The product editing path must no longer depend on a hidden ProseMirror DOM editor root.
- The screen path must use the real Rust/WASM layout bridge instead of TypeScript fallback layout.
- Layout IR must be produced from ProseMirror document structure, not markdown regex/string normalization.
- Rust/WASM snapshots must include hit testing, selection geometry, and Canvas mirror block data required by the hybrid host.
- Native font metrics and OpenType MATH constants must come from real font data.
- PDF export must emit text/vector/image content instead of placeholder rectangles and warnings.
- Runtime verification must exercise the real browser/editor path and 120fps-oriented performance budget, not only isolated normalizer smoke tests.

## Architecture Binding

This plan does not introduce a new editor architecture. It finishes the already-approved one:

- Markdown remains the only persisted source of truth.
- ProseMirror remains the editing state/transaction engine.
- The visible product surface is the hybrid DOM text-run plus Canvas/SVG host.
- The legacy visible DOM editor is allowed only as a test fixture until full acceptance, then removed from product exports.
- Rust `layout-core` is the authoritative layout engine, compiled to WASM for the webview and used by native export paths.
- Tauri/native commands provide one-time or explicit native services such as font discovery, font metrics, OpenType MATH, PDF export, and file IO.
- No per-frame IPC is allowed for layout or hit testing.

## Global Constraints

- Markdown files are the single source of truth for document persistence.
- Unsupported Markdown must round-trip exactly enough to preserve user content.
- Draft recovery, save conflict handling, file rename/delete handling, and table pipe round-trip behavior must not regress.
- Target interactive typing path: input latency under 50ms on typical documents.
- Target scroll/paint path: 120fps-oriented budget, with a frame smoke gate below 8.3ms for the measured editor render loop.
- First interactive editor load should remain under 500ms for ordinary notes.
- Knuth-Plass is the final paragraph layout model; greedy layout is acceptable only as a transition fallback behind explicit tests.
- Keep dependencies minimal and isolated. New dependencies in this plan are test/build tooling only unless explicitly listed under product files.
- macOS Tauri is the first full acceptance target.
- PDF export is vector/text-first.
- Existing user work in the repository must not be reverted. Treat dirty worktree changes as user-owned unless this plan explicitly changes the same file.

## Scope Check

This is a gap-closure plan, not a new master plan. It should be executed after P1-P8 scaffolding has landed. It intentionally focuses on the missing acceptance evidence identified by final-review:

- Replace product fallbacks with real paths.
- Add regression guards so the same fallback paths cannot silently return.
- Add runtime verification scripts that fail when product behavior is only manually checklisted.

Out of scope for this plan:

- Rebranding or redesigning the editor UI.
- Changing persisted document format away from Markdown.
- Replacing ProseMirror as the editing state engine.
- Adding cloud collaboration or multi-user editing.

## Surface Inventory

Before implementation, capture the current public and private surfaces. These commands are caller proof and must be run before Task 1:

```bash
rg "CurrentProductEditorRoot|data-mdx-editor-root|registerRoot\(|MdxEditorView|DOMD|data-legacy-editor-fixture" packages features scripts docs/loopx/specs
rg "fallbackLayoutBridgeModule|snapshotFromRustDocumentBytes|layout_core_bg|wasm-bindgen|wasm-pack|layout-bridge-runtime" packages scripts src-tauri package.json
rg "font_get_glyph_metrics|font_get_math_constants|fallback_math_constants|fallback_glyph_metrics" src-tauri packages features
rg "exportPdf|layout_export_pdf|CanvasDrawKind::Math|placeholder|exported as placeholder" src-tauri packages features
rg "normalizeLayoutDocument|LayoutNormalizationSource|proseMirrorNode|math_inline" packages/mdx-editor features
```

Expected current result before implementation:

- Matches exist for `CurrentProductEditorRoot`, `fallbackLayoutBridgeModule`, font fallback functions, PDF placeholder warnings, and string-based layout normalization.

Expected final negative assertions after all tasks:

```bash
! rg "CurrentProductEditorRoot|opacity-0 caret-transparent|data-legacy-editor-fixture|MdxEditorView|DOMD" packages features scripts docs/loopx/specs
! rg "fallbackLayoutBridgeModule|snapshotFromRustDocumentBytes" packages/mdx-editor/react
! rg "fallback_math_constants|fallback_glyph_metrics" src-tauri/src src-tauri/crates/font-core/src
! rg "exported as placeholder" src-tauri/crates/pdf-core/src
```

## File Plan

Create:

- `features/editor/lib/tex-canvas-gap-governance.test.ts`
- `packages/mdx-editor/layout-ir/from-prosemirror.ts`
- `packages/mdx-editor/layout-ir/from-prosemirror.test.ts`
- `packages/mdx-editor/react/layout-wasm-loader.ts`
- `packages/mdx-editor/react/layout-wasm-loader.test.ts`
- `packages/mdx-editor/react/dom-text-run-layer.tsx`
- `packages/mdx-editor/react/dom-text-run-layer.test.tsx`
- `scripts/build-layout-wasm.mjs`
- `scripts/verify-layout-wasm.mjs`
- `scripts/verify-tex-canvas-runtime.mjs`
- `scripts/measure-tex-canvas-runtime.mjs`
- `src-tauri/crates/layout-core/tests/wasm_bridge_snapshot_tests.rs`
- `src-tauri/crates/pdf-core/tests/export_vector_tests.rs`

Modify:

- `package.json`
- `features/editor/components/editor-pane.tsx`
- `features/editor/hooks/use-editor-bridge.ts`
- `features/editor/components/editor-pane.test.tsx`
- `packages/mdx-editor/layout-ir/types.ts`
- `packages/mdx-editor/layout-ir/normalizer.ts`
- `packages/mdx-editor/layout-ir/index.ts`
- `packages/mdx-editor/react/index.ts`
- `packages/mdx-editor/react/layout-bridge-runtime.ts`
- `packages/mdx-editor/react/wasm-layout-bridge.ts`
- `packages/mdx-editor/react/hybrid-editor-host.tsx`
- `packages/mdx-editor/react/mdx-editor-context.tsx`
- `packages/mdx-editor/react/mdx-editor-provider.tsx`
- `src-tauri/crates/layout-core/src/lib.rs`
- `src-tauri/crates/layout-core/src/wasm_bridge.rs`
- `src-tauri/crates/layout-core/src/paragraph.rs`
- `src-tauri/crates/layout-core/src/font_api.rs`
- `src-tauri/crates/font-core/src/discovery.rs`
- `src-tauri/crates/font-core/src/glyph.rs`
- `src-tauri/crates/font-core/src/math_table.rs`
- `src-tauri/src/layout_fonts.rs`
- `src-tauri/crates/pdf-core/src/export.rs`

Remove when final guards pass:

- Hidden product editor root code inside `features/editor/components/editor-pane.tsx`.
- TypeScript fallback layout bridge module inside `packages/mdx-editor/react/layout-bridge-runtime.ts`.
- Native hard-coded glyph and MATH fallback helpers.

## Task 1: Add Gap Governance Tests

### Purpose

Install failing tests first so the final-review gaps become executable regression gates.

### Steps

1. Create `features/editor/lib/tex-canvas-gap-governance.test.ts` with file-level assertions:

```ts
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("TeX canvas gap governance", () => {
  it("does not mount the hidden ProseMirror DOM root in the product editor", () => {
    const source = read("features/editor/components/editor-pane.tsx");
    expect(source).not.toContain("CurrentProductEditorRoot");
    expect(source).not.toContain("opacity-0 caret-transparent");
    expect(source).not.toContain('aria-hidden="true"');
    expect(source).not.toContain("data-mdx-editor-root");
  });

  it("does not ship the TypeScript fallback layout bridge in the product runtime", () => {
    const source = read("packages/mdx-editor/react/layout-bridge-runtime.ts");
    expect(source).not.toContain("fallbackLayoutBridgeModule");
    expect(source).not.toContain("snapshotFromRustDocumentBytes");
  });

  it("does not use native hard-coded font metric fallbacks", () => {
    const layoutFonts = read("src-tauri/src/layout_fonts.rs");
    expect(layoutFonts).not.toContain("fallback_glyph_metrics");
    expect(layoutFonts).not.toContain("fallback_math_constants");
  });

  it("does not export PDF placeholders for unsupported draw ops", () => {
    const pdfExport = read("src-tauri/crates/pdf-core/src/export.rs");
    expect(pdfExport).not.toContain("exported as placeholder");
  });
});
```

2. Add a focused runtime bridge test in `packages/mdx-editor/react/layout-wasm-loader.test.ts` that verifies the loader has an explicit not-built error:

```ts
import { createLayoutWasmNotBuiltError } from "./layout-wasm-loader";

it("reports missing layout wasm as a build error", () => {
  expect(createLayoutWasmNotBuiltError().message).toContain("npm run build:layout-wasm");
});
```

3. Run the test subset and record expected failures:

```bash
npm test -- features/editor/lib/tex-canvas-gap-governance.test.ts packages/mdx-editor/react/layout-wasm-loader.test.ts
```

Expected output at this point:

- `layout-wasm-loader.test.ts` passes after the new helper is created.
- `tex-canvas-gap-governance.test.ts` fails until later tasks remove hidden DOM root, fallback layout bridge, font fallbacks, and PDF placeholders.

## Task 2: Produce Layout IR From ProseMirror Documents

### Purpose

Stop using markdown string regexes as the product layout source. The product layout source must come from ProseMirror state.

### Steps

1. Extend `packages/mdx-editor/layout-ir/types.ts` with structured inline and mark support:

```ts
export type LayoutInlineKind =
  | "text"
  | "math_inline"
  | "hard_break"
  | "image_inline"
  | "html_inline"
  | "unsupported_inline";

export interface LayoutInlineMark {
  type: "bold" | "italic" | "code" | "link" | "strike" | "underline";
  href?: string;
}

export interface LayoutInlineRun {
  id: string;
  kind: LayoutInlineKind;
  text: string;
  marks: LayoutInlineMark[];
  sourceFrom: number;
  sourceTo: number;
}

export interface LayoutNormalizationOptions {
  documentId: string;
  revision: number;
  viewport: { width: number; height: number };
}
```

2. Create `packages/mdx-editor/layout-ir/from-prosemirror.ts`:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { LayoutDocument, LayoutNormalizationOptions } from "./types";

export function normalizeProseMirrorLayoutDocument(
  doc: ProseMirrorNode,
  options: LayoutNormalizationOptions,
): LayoutDocument {
  // Implementation walks descendants with ProseMirror positions, maps block nodes
  // to LayoutBlock entries, and maps inline content to LayoutInlineRun entries.
  // It must never parse markdown strings or use regular expressions.
}
```

The implementation requirements are exact:

- Use `doc.descendants((node, pos) => ...)` for source positions.
- Map paragraphs, headings, blockquotes, lists, list items, code blocks, tables, images, math blocks, Mermaid blocks, and unknown nodes.
- Preserve unsupported nodes as `unsupported_*` layout nodes with enough source metadata to keep markdown round-trip behavior intact.
- For inline text, collect marks from `node.marks` and preserve link `href`.
- Do not special-case literal strings such as `$x^2$`.

3. Modify `packages/mdx-editor/layout-ir/normalizer.ts` so `normalizeLayoutDocument(markdown, viewport)` is retained only as a non-product compatibility helper. It may parse markdown through the kernel, then call `normalizeProseMirrorLayoutDocument(...)`; it must not include regex-based block or inline parsing.

4. Export `normalizeProseMirrorLayoutDocument` from `packages/mdx-editor/layout-ir/index.ts`.

5. Modify `packages/mdx-editor/react/mdx-editor-context.tsx`:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";

export interface MdxEditorLayoutSource {
  doc: ProseMirrorNode;
  revision: number;
}

export interface MdxEditorContextValue {
  // existing fields remain
  getLayoutSource: () => MdxEditorLayoutSource | null;
}
```

6. Modify `packages/mdx-editor/react/mdx-editor-provider.tsx`:

- Maintain a `layoutRevision` counter.
- Increment it inside `dispatchTransaction`, `resetMarkdown`, and any command that changes the ProseMirror document.
- Return the current ProseMirror `state.doc` through `getLayoutSource()`.

7. Modify `features/editor/hooks/use-editor-bridge.ts` to expose the layout source:

```ts
export interface EditorBridge {
  // existing fields remain
  getLayoutSource: () => MdxEditorLayoutSource | null;
}
```

8. Add `packages/mdx-editor/layout-ir/from-prosemirror.test.ts`:

```ts
import { createMdxEditorKernel, defaultMarkdownSyntax } from "../core";
import { normalizeProseMirrorLayoutDocument } from "./from-prosemirror";

it("normalizes mixed markdown from the ProseMirror document", () => {
  const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
  const parsed = kernel.parseMarkdown("# Title\n\nHello **world** [link](https://example.com)\n\n```mermaid\ngraph TD\nA-->B\n```");

  const doc = normalizeProseMirrorLayoutDocument(parsed.doc, {
    documentId: "doc-1",
    revision: 1,
    viewport: { width: 960, height: 720 },
  });

  expect(doc.blocks.map((block) => block.kind)).toContain("heading");
  expect(doc.blocks.map((block) => block.kind)).toContain("paragraph");
  expect(doc.blocks.map((block) => block.kind)).toContain("mermaid");
  expect(JSON.stringify(doc)).toContain("https://example.com");
});
```

9. Run:

```bash
npm test -- packages/mdx-editor/layout-ir/from-prosemirror.test.ts
npm test -- features/editor/hooks/use-editor-bridge.test.ts
```

Expected output:

- Tests pass.
- `rg "hard-coded|\\$x\\^2\\$|match\\(|split\\(\"\\n\"\\)" packages/mdx-editor/layout-ir/normalizer.ts` returns no product parser matches.

## Task 3: Build And Load Real Layout WASM

### Purpose

Replace the TypeScript fallback layout bridge with a real generated WASM module from `src-tauri/crates/layout-core`.

### Steps

1. Create `scripts/build-layout-wasm.mjs`:

```js
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("packages/mdx-editor/react/wasm/layout-core");
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  "npx",
  [
    "wasm-pack",
    "build",
    "src-tauri/crates/layout-core",
    "--target",
    "web",
    "--release",
    "--out-dir",
    "../../../packages/mdx-editor/react/wasm/layout-core",
  ],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  throw new Error("layout wasm build failed");
}
```

2. Create `packages/mdx-editor/react/layout-wasm-loader.ts`:

```ts
import type { WasmLayoutBridgeModule } from "./wasm-layout-bridge";

export function createLayoutWasmNotBuiltError(): Error {
  return new Error("Layout WASM artifact is missing. Run npm run build:layout-wasm before using the TeX canvas editor.");
}

export async function loadLayoutWasmModule(): Promise<WasmLayoutBridgeModule> {
  try {
    const module = await import("./wasm/layout-core/layout_core.js");
    await module.default();
    return module as WasmLayoutBridgeModule;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to fetch|404/.test(error.message)) {
      throw createLayoutWasmNotBuiltError();
    }
    throw error;
  }
}
```

3. Modify `packages/mdx-editor/react/layout-bridge-runtime.ts`:

```ts
import { createLayoutBridge } from "./wasm-layout-bridge";
import { loadLayoutWasmModule } from "./layout-wasm-loader";

let bridgePromise: Promise<ReturnType<typeof createLayoutBridge>> | null = null;

export function getRuntimeLayoutBridge() {
  bridgePromise ??= loadLayoutWasmModule().then(createLayoutBridge);
  return bridgePromise;
}
```

Remove `fallbackLayoutBridgeModule` and `snapshotFromRustDocumentBytes` from this file.

4. Update `package.json` scripts:

```json
{
  "scripts": {
    "build:layout-wasm": "node scripts/build-layout-wasm.mjs",
    "verify:layout-wasm": "npm run build:layout-wasm && node scripts/verify-layout-wasm.mjs"
  }
}
```

5. Create `scripts/verify-layout-wasm.mjs`:

```js
const mod = await import("../packages/mdx-editor/react/wasm/layout-core/layout_core.js");
await mod.default();

if (typeof mod.layout_document_to_snapshot !== "function") {
  throw new Error("layout wasm export layout_document_to_snapshot is missing");
}

console.log("layout wasm smoke: PASS");
```

6. Run:

```bash
npm run verify:layout-wasm
npm test -- packages/mdx-editor/react/layout-wasm-loader.test.ts
```

Expected output:

- `layout wasm smoke: PASS`
- Loader tests pass.
- `rg "fallbackLayoutBridgeModule|snapshotFromRustDocumentBytes" packages/mdx-editor/react/layout-bridge-runtime.ts` returns no matches.

## Task 4: Complete Rust/WASM Snapshot Contract

### Purpose

Make the WASM snapshot contract contain enough data for product hit testing, selections, DOM text runs, and Canvas mirror blocks.

### Steps

1. In `src-tauri/crates/layout-core/src/wasm_bridge.rs`, extend the JSON snapshot emitted by `layout_document_to_snapshot` with:

```rust
#[derive(Serialize)]
pub struct LayoutHitTestEntry {
    pub block_id: String,
    pub run_id: Option<String>,
    pub source_from: u32,
    pub source_to: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize)]
pub struct LayoutSelectionGeometry {
    pub block_id: String,
    pub source_from: u32,
    pub source_to: u32,
    pub rects: Vec<LayoutRect>,
}

#[derive(Serialize)]
pub struct LayoutMirrorBlock {
    pub block_id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub data: serde_json::Value,
}
```

2. Populate:

- `hit_test_entries` for every visible text run and every Canvas block.
- `selection_geometries` for text-run ranges and whole Canvas blocks.
- `mirror_blocks` for math display, Mermaid preview, image, table canvas segments, and unsupported block fallbacks.

3. Modify `packages/mdx-editor/react/wasm-layout-bridge.ts` snapshot type guards so missing arrays are hard errors:

```ts
if (!Array.isArray(snapshot.hitTestEntries)) throw new Error("layout snapshot missing hitTestEntries");
if (!Array.isArray(snapshot.selectionGeometries)) throw new Error("layout snapshot missing selectionGeometries");
if (!Array.isArray(snapshot.mirrorBlocks)) throw new Error("layout snapshot missing mirrorBlocks");
```

4. Create `src-tauri/crates/layout-core/tests/wasm_bridge_snapshot_tests.rs`:

```rust
use layout_core::wasm_bridge::layout_document_to_snapshot;
use serde_json::Value;

#[test]
fn snapshot_contains_hit_selection_and_mirror_entries() {
    let input = serde_json::json!({
        "id": "doc-1",
        "revision": 1,
        "viewport": { "width": 960.0, "height": 720.0 },
        "blocks": [
            { "id": "p1", "kind": "paragraph", "runs": [
                { "id": "r1", "kind": "text", "text": "Hello", "marks": [], "sourceFrom": 0, "sourceTo": 5 }
            ]},
            { "id": "m1", "kind": "math_display", "text": "x^2", "sourceFrom": 6, "sourceTo": 13 }
        ]
    });

    let bytes = serde_json::to_vec(&input).unwrap();
    let snapshot_bytes = layout_document_to_snapshot(&bytes).unwrap();
    let snapshot: Value = serde_json::from_slice(&snapshot_bytes).unwrap();

    assert!(snapshot["hit_test_entries"].as_array().unwrap().len() >= 2);
    assert!(snapshot["selection_geometries"].as_array().unwrap().len() >= 2);
    assert!(snapshot["mirror_blocks"].as_array().unwrap().iter().any(|block| block["block_id"] == "m1"));
}
```

5. Run:

```bash
cd src-tauri && cargo test -p layout-core --test wasm_bridge_snapshot_tests
npm test -- packages/mdx-editor/react/wasm-layout-bridge.test.ts
```

Expected output:

- Rust snapshot test passes.
- TypeScript bridge rejects incomplete snapshots.

## Task 5: Make Hybrid Surface Own Product Input

### Purpose

Remove the hidden ProseMirror root from the product path. The visible hybrid surface must accept text input, pointer selection, hit testing, and composition events.

### Steps

1. Create `packages/mdx-editor/react/dom-text-run-layer.tsx`:

```tsx
import type { LayoutTextRunSnapshot } from "./wasm-layout-bridge";

export interface DomTextRunInput {
  runId: string;
  sourceFrom: number;
  sourceTo: number;
  text: string;
}

export interface DomTextRunLayerProps {
  runs: LayoutTextRunSnapshot[];
  onInput: (input: DomTextRunInput) => void;
  onPointerDown: (input: { runId: string; sourceOffset: number }) => void;
}

export function DomTextRunLayer({ runs, onInput, onPointerDown }: DomTextRunLayerProps) {
  return (
    <div data-tex-dom-text-layer>
      {runs.map((run) => (
        <span
          key={run.id}
          contentEditable
          suppressContentEditableWarning
          data-run-id={run.id}
          data-source-from={run.sourceFrom}
          data-source-to={run.sourceTo}
          onInput={(event) => {
            onInput({
              runId: run.id,
              sourceFrom: run.sourceFrom,
              sourceTo: run.sourceTo,
              text: event.currentTarget.textContent ?? "",
            });
          }}
          onPointerDown={() => onPointerDown({ runId: run.id, sourceOffset: run.sourceFrom })}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
}
```

2. Modify `packages/mdx-editor/react/hybrid-editor-host.tsx`:

- Render `DomTextRunLayer` for text runs.
- Render Canvas/SVG layer for mirror blocks.
- Forward text-run input and pointer events through explicit props:

```ts
export interface HybridEditorHostProps {
  snapshot: LayoutSnapshot;
  onTextRunInput: (input: DomTextRunInput) => void;
  onTextRunPointerDown: (input: { runId: string; sourceOffset: number }) => void;
}
```

3. Modify `features/editor/components/editor-pane.tsx`:

- Delete `CurrentProductEditorRoot`.
- Stop rendering `<CurrentProductEditorRoot />` beside `<HybridEditorHost />`.
- Wire `HybridEditorHost.onTextRunInput` to ProseMirror commands from `useEditorBridge()`:

```ts
const handleTextRunInput = useCallback((input: DomTextRunInput) => {
  editorBridge.replaceRange({
    from: input.sourceFrom,
    to: input.sourceTo,
    text: input.text,
  });
}, [editorBridge]);
```

4. If `replaceRange` does not exist, add it to `MdxEditorContextValue`, `MdxEditorProvider`, `EditorBridge`, and `use-editor-bridge.ts`:

```ts
replaceRange: (input: { from: number; to: number; text: string }) => void;
```

The provider implementation must dispatch a ProseMirror transaction with `state.tr.insertText(input.text, input.from, input.to)`.

5. Add `packages/mdx-editor/react/dom-text-run-layer.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { DomTextRunLayer } from "./dom-text-run-layer";

it("reports edited text with source positions", () => {
  const onInput = vi.fn();
  render(
    <DomTextRunLayer
      runs={[{ id: "r1", text: "Hello", sourceFrom: 3, sourceTo: 8, x: 0, y: 0, width: 40, height: 16 }]}
      onInput={onInput}
      onPointerDown={vi.fn()}
    />,
  );

  const run = screen.getByText("Hello");
  run.textContent = "Hello!";
  fireEvent.input(run);

  expect(onInput).toHaveBeenCalledWith({ runId: "r1", sourceFrom: 3, sourceTo: 8, text: "Hello!" });
});
```

6. Update `features/editor/components/editor-pane.test.tsx` so the editor pane test renders the real `HybridEditorHost` and verifies no hidden root is mounted:

```ts
expect(container.querySelector("[data-mdx-editor-root]")).toBeNull();
expect(container.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
```

7. Run:

```bash
npm test -- packages/mdx-editor/react/dom-text-run-layer.test.tsx features/editor/components/editor-pane.test.tsx features/editor/lib/tex-canvas-gap-governance.test.ts
```

Expected output:

- DOM text-run layer test passes.
- Editor pane test passes without mocking `HybridEditorHost`.
- Governance hidden-root assertions pass.

## Task 6: Use Real Native Font Metrics And OpenType MATH

### Purpose

Replace hard-coded native font values with real font discovery, glyph metrics, and OpenType MATH constants.

### Steps

1. Extend `src-tauri/crates/font-core/src/discovery.rs`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FontDescriptor {
    pub id: String,
    pub postscript_name: String,
    pub family_name: String,
    pub style_name: String,
    pub path: Option<PathBuf>,
    pub has_math_table: bool,
}

pub fn discover_system_fonts() -> Result<Vec<FontDescriptor>, FontError>;
pub fn load_font_bytes(descriptor: &FontDescriptor) -> Result<Vec<u8>, FontError>;
```

2. Add `src-tauri/crates/font-core/src/glyph.rs` if missing, or extend it:

```rust
pub struct GlyphMetricRequest {
    pub font_id: String,
    pub glyph_ids: Vec<u16>,
    pub units_per_em: u16,
}

pub fn glyph_metrics(font_bytes: &[u8], glyph_ids: &[u16]) -> Result<Vec<GlyphMetrics>, FontError>;
```

Use `ttf-parser` bounding boxes and horizontal advances from the parsed face. Do not synthesize metrics when parsing fails.

3. Extend `src-tauri/crates/font-core/src/math_table.rs`:

```rust
pub fn math_constants(font_bytes: &[u8]) -> Result<MathConstants, FontError>;
```

If the font does not contain a MATH table, return `FontError::MathTableUnavailable`.

4. Modify `src-tauri/src/layout_fonts.rs`:

- `font_get_glyph_metrics` must resolve the requested font descriptor and call `font_core::glyph::glyph_metrics`.
- `font_get_math_constants` must resolve the requested font descriptor and call `font_core::math_table::math_constants`.
- Remove `fallback_glyph_metrics`.
- Remove `fallback_math_constants`.
- Unknown font IDs and missing MATH tables must return typed errors to TypeScript.

5. Modify `src-tauri/crates/layout-core/src/font_api.rs` so layout can accept a font metrics cache loaded from native data:

```rust
pub struct FontMetricCache {
    pub font_id: String,
    pub units_per_em: u16,
    pub glyph_metrics: HashMap<u16, GlyphMetrics>,
    pub math_constants: Option<MathConstants>,
}
```

6. Add or update Rust tests:

```rust
#[test]
fn unknown_font_id_returns_error_instead_of_fallback() {
    let result = resolve_font_descriptor("__missing_font__");
    assert!(result.is_err());
}

#[test]
fn math_constants_report_unavailable_when_font_has_no_math_table() {
    let font = discover_system_fonts().unwrap().into_iter().find(|font| !font.has_math_table);
    if let Some(font) = font {
        let bytes = load_font_bytes(&font).unwrap();
        assert!(matches!(math_constants(&bytes), Err(FontError::MathTableUnavailable)));
    }
}
```

7. Run:

```bash
cd src-tauri && cargo test -p font-core
cd src-tauri && cargo test --lib layout_fonts
rg "fallback_glyph_metrics|fallback_math_constants" src-tauri/src src-tauri/crates/font-core/src
```

Expected output:

- Font tests pass.
- Final `rg` returns no matches.

## Task 7: Replace PDF Placeholders With Text/Vector Export

### Purpose

Make exported PDFs contain actual editor content for text, math, Mermaid SVG subset, images, and vector shapes.

### Steps

1. Modify `src-tauri/crates/pdf-core/src/export.rs` so `CanvasDrawKind` dispatch is explicit:

```rust
match op.kind {
    CanvasDrawKind::Text => write_text_operator(document, page, &op)?,
    CanvasDrawKind::Rect => write_rect_operator(document, page, &op)?,
    CanvasDrawKind::Line => write_line_operator(document, page, &op)?,
    CanvasDrawKind::Path => write_path_operator(document, page, &op)?,
    CanvasDrawKind::Math => write_math_operator(document, page, &op)?,
    CanvasDrawKind::Image => write_image_xobject(document, page, &op)?,
    CanvasDrawKind::Svg => write_svg_subset(document, page, &op)?,
}
```

2. Implement math export:

- Parse `op.data` as JSON math draw commands.
- Emit PDF text operators for glyph/text segments.
- Emit path/line operators for radicals, fraction bars, delimiters, and stretch glyph outlines when available.
- Return an export error for malformed math data instead of drawing a placeholder.

3. Implement SVG subset export for Mermaid:

- Support `<svg>`, `<g>`, `<path>`, `<line>`, `<polyline>`, `<polygon>`, `<rect>`, `<circle>`, and `<text>`.
- Convert supported SVG nodes into PDF path/text operators.
- Return a warning for unsupported SVG elements, but do not draw a placeholder rectangle.
- Include warning metadata in the export result so UI can show “partial vector export” when needed.

4. Implement image export:

- Embed PNG/JPEG as PDF image XObjects.
- Scale by the draw op rectangle while preserving aspect ratio metadata.
- Missing image bytes return a typed error.

5. Create `src-tauri/crates/pdf-core/tests/export_vector_tests.rs`:

```rust
use pdf_core::{export_pdf, CanvasDrawKind, CanvasDrawOp, PdfExportRequest};

#[test]
fn exports_text_math_and_svg_without_placeholder_warning() {
    let request = PdfExportRequest {
        title: "vector test".into(),
        pages: vec![page_with_ops(vec![
            CanvasDrawOp::text("Hello", 24.0, 48.0),
            CanvasDrawOp::new(CanvasDrawKind::Math, 24.0, 80.0, 120.0, 32.0, r#"{"segments":[{"text":"x2","x":0,"y":0}]}"#.into()),
            CanvasDrawOp::new(CanvasDrawKind::Svg, 24.0, 120.0, 160.0, 80.0, r#"<svg><rect x="0" y="0" width="40" height="20"/><text x="4" y="14">A</text></svg>"#.into()),
        ])],
    };

    let result = export_pdf(request).unwrap();
    assert!(result.bytes.len() > 1024);
    assert!(result.warnings.iter().all(|warning| !warning.message.contains("placeholder")));
}
```

6. Run:

```bash
cd src-tauri && cargo test -p pdf-core --test export_vector_tests
rg "exported as placeholder|placeholder rectangle" src-tauri/crates/pdf-core/src/export.rs
```

Expected output:

- PDF vector tests pass.
- Final `rg` returns no matches.

## Task 8: Add Real Runtime And Performance Verification

### Purpose

Replace manual checklist-only runtime validation and normalizer-only perf smoke with automated browser checks against the product editor path.

### Steps

1. Add dev-only browser verification tooling to `package.json`:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.0.0"
  },
  "scripts": {
    "verify:editor:runtime": "node scripts/verify-tex-canvas-runtime.mjs",
    "measure:editor:runtime": "node scripts/measure-tex-canvas-runtime.mjs"
  }
}
```

Use the repository package manager lockfile to resolve the exact installed version. This is test tooling only.

2. Create `scripts/verify-tex-canvas-runtime.mjs`:

```js
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer(page) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded", timeout: 1000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("dev server did not start on http://127.0.0.1:3000");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await waitForServer(page);

  await page.waitForSelector("[data-tex-dom-text-layer]", { timeout: 10_000 });

  const hiddenRootCount = await page.locator("[data-mdx-editor-root]").count();
  if (hiddenRootCount !== 0) {
    throw new Error(`hidden ProseMirror product root found: ${hiddenRootCount}`);
  }

  await page.keyboard.type(" runtime");
  await page.screenshot({ path: "artifacts/tex-canvas-runtime.png", fullPage: true });

  console.log("tex canvas runtime: PASS");
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
```

3. Create `scripts/measure-tex-canvas-runtime.mjs`:

```js
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-tex-dom-text-layer]", { timeout: 10_000 });

  const result = await page.evaluate(async () => {
    const frames = [];
    let previous = performance.now();
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
    }
    frames.sort((a, b) => a - b);
    return {
      p50: frames[Math.floor(frames.length * 0.5)],
      p95: frames[Math.floor(frames.length * 0.95)],
      max: frames[frames.length - 1],
    };
  });

  if (result.p95 > 8.3) {
    throw new Error(`editor frame budget exceeded: p95=${result.p95.toFixed(2)}ms`);
  }

  console.log(`tex canvas runtime frames: PASS p50=${result.p50.toFixed(2)} p95=${result.p95.toFixed(2)} max=${result.max.toFixed(2)}`);
} finally {
  await browser.close();
}
```

4. Update existing `scripts/verify-editor-browser.mjs` so it runs or delegates to `verify:editor:runtime` instead of printing only manual checks.

5. Run:

```bash
npm run build:layout-wasm
npm run verify:editor:runtime
npm run dev -- --host 127.0.0.1
npm run measure:editor:runtime
```

Expected output:

- `tex canvas runtime: PASS`
- `tex canvas runtime frames: PASS ... p95=<8.30 ...`
- No hidden editor root is found in browser DOM.

## Task 9: Final Integration Verification

### Purpose

Run the complete acceptance gate and make the next final-review evidence concrete.

### Steps

1. Run TypeScript and frontend checks:

```bash
npm run lint
npm test
npm run build:layout-wasm
npm run verify:layout-wasm
npm run verify:editor:runtime
```

Expected output:

- All commands exit 0.

2. Run Rust checks:

```bash
cd src-tauri && cargo test
```

Expected output:

- All Rust tests exit 0.

3. Run final negative assertions:

```bash
! rg "CurrentProductEditorRoot|opacity-0 caret-transparent|data-legacy-editor-fixture|MdxEditorView|DOMD" packages features scripts docs/loopx/specs
! rg "fallbackLayoutBridgeModule|snapshotFromRustDocumentBytes" packages/mdx-editor/react
! rg "fallback_math_constants|fallback_glyph_metrics" src-tauri/src src-tauri/crates/font-core/src
! rg "exported as placeholder" src-tauri/crates/pdf-core/src
```

Expected output:

- All negative assertions exit 0.

4. Run targeted preservation checks:

```bash
npm test -- packages/mdx-editor/layout-ir/from-prosemirror.test.ts features/editor/components/editor-pane.test.ts
cd src-tauri && cargo test -p pdf-core --test export_vector_tests
cd src-tauri && cargo test -p layout-core --test wasm_bridge_snapshot_tests
```

Expected output:

- All targeted preservation checks pass.

5. Record verification evidence in the implementation summary:

- Exact command list.
- Pass/fail result.
- Any runtime screenshot path, such as `artifacts/tex-canvas-runtime.png`.
- Any intentionally accepted residual warning from PDF SVG subset export.

## Task Dependencies

- Task 1 must run first.
- Task 2 must finish before Tasks 3, 4, and 5 consume product Layout IR.
- Task 3 must finish before runtime verification depends on real WASM.
- Task 4 must finish before Task 5 can implement complete hit testing and selection behavior.
- Task 5 must finish before Task 8 runtime validation can pass hidden-root checks.
- Task 6 can run in parallel with Tasks 2-5 after Task 1.
- Task 7 can run in parallel with Task 6 after Task 1.
- Task 9 runs last.

## Review Checklist

- The product editor DOM has no hidden ProseMirror root.
- ProseMirror state remains authoritative for editing transactions.
- The product layout source is ProseMirror document structure.
- The product bridge loads generated Rust/WASM.
- WASM snapshots include text runs, hit test entries, selection geometries, and mirror blocks.
- Native font commands read real font bytes and return typed errors instead of fake values.
- PDF export emits real text/vector/image content and never draws placeholder rectangles.
- Browser runtime verification types into the real editor path and fails on hidden root regression.
- Performance smoke measures browser frame timing rather than normalizer-only execution.

## Execution Recommendation

Use `subagent-exec` or `exec` in this order:

1. Run Task 1 alone and keep its expected failures as the baseline.
2. Run Tasks 2-5 as the editor runtime completion slice.
3. Run Tasks 6-7 as native fidelity slices.
4. Run Tasks 8-9 as acceptance evidence slices.

Do not merge or mark the feature complete until Task 9 passes.
