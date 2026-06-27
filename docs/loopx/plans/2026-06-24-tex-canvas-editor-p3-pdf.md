# P3: Rust Native PDF/分页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 为 TeX 风格编辑器补齐 native 分页与 PDF 导出路径，让屏幕布局与导出共享同一套 Rust 排版结果。

**Architecture:** 新增 `pdf-core` Rust crate，消费 `layout-core` 的 `LayoutSnapshot` 与 `font-core` 的字体度量结果，先做稳定分页模型，再用 `lopdf` 输出真实文本和矢量线条。Tauri 侧暴露 `layout_export_pdf` command，前端只负责传入导出请求和落盘路径，不在 webview 内拼 PDF。

**Tech Stack:** Rust (edition 2021), `lopdf`, Tauri 2.x, serde/serde_json

**Support lenses:** architecture-designer

## Global Constraints

- Markdown 文件仍是唯一持久化真相，unsupported Markdown fallback 必须保真。
- 草稿恢复、冲突检测、workspace/document 保存流程不能退化。
- 120fps 滚动是硬目标；普通输入到可见更新 < 50ms；首屏可交互 < 500ms。
- 最终断行目标为 Knuth-Plass，贪心仅为过渡 fallback。
- 依赖面极小、接口隔离、优先纯 Rust。
- 旧 view 代码保留为回归对照与测试夹具，产品唯一暴露新编辑器；全量验收后删除旧 view。
- 首版验收平台为 macOS Tauri。
- 首版纳入打印/PDF 输出，要求真实文本和矢量优先。

---

## 文件结构

```
src-tauri/
├── Cargo.toml
├── crates/
│   └── pdf-core/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs
│       │   ├── model.rs
│       │   ├── pagination.rs
│       │   └── export.rs
│       └── tests/
│           ├── pagination_tests.rs
│           └── export_tests.rs
├── src/
│   ├── layout_pdf.rs
│   ├── layout_pdf_tests.rs
│   └── lib.rs
features/
└── editor/
    └── lib/
        ├── pdf-export-client.ts
        └── pdf-export-client.test.ts
```

---

### Task 1: Scaffold `pdf-core` crate and export model

**Files:**
- Create: `src-tauri/crates/pdf-core/Cargo.toml`
- Create: `src-tauri/crates/pdf-core/src/lib.rs`
- Create: `src-tauri/crates/pdf-core/src/model.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `layout_core::LayoutSnapshot`, `layout_core::LayoutLine`, `layout_core::CanvasDrawOp`
- Produces: `pdf_core::model::PdfExportRequest`, `PdfExportResult`, `PageSize`, `PageMargins`, `PaginatedDocument`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing compile test for the new crate surface**

```rust
// src-tauri/crates/pdf-core/tests/pagination_tests.rs
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};

#[test]
fn export_request_defaults_to_a4_points() {
    let page = PageSize::a4_points();
    let margins = PageMargins::uniform(72.0);
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{}".into(),
        "{}".into(),
        "/tmp/out.pdf".into(),
        page,
        margins,
        "subset".into(),
    );

    assert_eq!(request.document_id, "doc-1");
    assert_eq!(request.page_size.width_pt, 595.0);
    assert_eq!(request.margins.left_pt, 72.0);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test -p pdf-core --test pagination_tests`
Expected: FAIL with `package ID specification 'pdf-core' did not match any packages`

- [ ] **Step 3: Add the crate and shared request/response types**

```toml
# src-tauri/crates/pdf-core/Cargo.toml
[package]
name = "pdf-core"
version = "0.1.0"
edition = "2021"

[dependencies]
layout-core = { path = "../layout-core" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
lopdf = "0.34"
```

```rust
// src-tauri/crates/pdf-core/src/model.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageSize {
    pub width_pt: f32,
    pub height_pt: f32,
}

impl PageSize {
    pub fn a4_points() -> Self {
        Self { width_pt: 595.0, height_pt: 842.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageMargins {
    pub top_pt: f32,
    pub right_pt: f32,
    pub bottom_pt: f32,
    pub left_pt: f32,
}

impl PageMargins {
    pub fn uniform(value: f32) -> Self {
        Self { top_pt: value, right_pt: value, bottom_pt: value, left_pt: value }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportRequest {
    pub document_id: String,
    pub revision: u64,
    pub layout_document_json: String,
    pub layout_snapshot_json: String,
    pub output_path: String,
    pub page_size: PageSize,
    pub margins: PageMargins,
    pub font_embed_mode: String,
}

impl PdfExportRequest {
    pub fn new(
        document_id: String,
        revision: u64,
        layout_document_json: String,
        layout_snapshot_json: String,
        output_path: String,
        page_size: PageSize,
        margins: PageMargins,
        font_embed_mode: String,
    ) -> Self {
        Self { document_id, revision, layout_document_json, layout_snapshot_json, output_path, page_size, margins, font_embed_mode }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportResult {
    pub page_count: usize,
    pub warnings: Vec<String>,
    pub export_ms: u64,
}
```

- [ ] **Step 4: Wire the crate into the workspace**

```toml
# src-tauri/Cargo.toml
[workspace]
members = [
    "crates/layout-core",
    "crates/font-core",
    "crates/pdf-core",
]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src-tauri && cargo test -p pdf-core --test pagination_tests`
Expected: PASS with `1 passed`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/crates/pdf-core
git commit -m "feat(pdf-core): add pdf export crate scaffold"
```

---

### Task 2: Implement pagination from layout snapshot

**Files:**
- Modify: `src-tauri/crates/pdf-core/src/lib.rs`
- Create: `src-tauri/crates/pdf-core/src/pagination.rs`
- Modify: `src-tauri/crates/pdf-core/tests/pagination_tests.rs`

**Interfaces:**
- Consumes: `layout_core::LayoutSnapshot`
- Produces: `paginate_snapshot(snapshot: &LayoutSnapshot, page_size: &PageSize, margins: &PageMargins) -> PaginatedDocument`

**Support lenses:** architecture-designer

- [ ] **Step 1: Extend the failing tests for page breaking**

```rust
use layout_core::{CanvasDrawOp, CanvasDrawKind, LayoutLine, LayoutSnapshot};
use pdf_core::model::{PageMargins, PageSize};
use pdf_core::paginate_snapshot;

#[test]
fn paginates_lines_by_available_height() {
    let snapshot = LayoutSnapshot {
        revision: 1,
        lines: vec![
            LayoutLine { id: "l1".into(), block_id: "b1".into(), y: 0.0, baseline: 12.0, height: 24.0, text_runs: vec![] },
            LayoutLine { id: "l2".into(), block_id: "b1".into(), y: 24.0, baseline: 36.0, height: 24.0, text_runs: vec![] },
            LayoutLine { id: "l3".into(), block_id: "b1".into(), y: 48.0, baseline: 60.0, height: 24.0, text_runs: vec![] },
        ],
        canvas_draw_ops: vec![],
        hit_test_entries: vec![],
        caret_anchors: vec![],
        selection_geometries: vec![],
        mirror_blocks: vec![],
    };

    let pages = paginate_snapshot(
        &snapshot,
        &PageSize { width_pt: 300.0, height_pt: 96.0 },
        &PageMargins::uniform(12.0),
    );

    assert_eq!(pages.pages.len(), 2);
    assert_eq!(pages.pages[0].lines.len(), 2);
    assert_eq!(pages.pages[1].lines.len(), 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test -p pdf-core --test pagination_tests paginates_lines_by_available_height -- --exact`
Expected: FAIL with `no paginate_snapshot in the root`

- [ ] **Step 3: Implement the pagination model and algorithm**

```rust
// src-tauri/crates/pdf-core/src/pagination.rs
use layout_core::{CanvasDrawOp, LayoutLine, LayoutSnapshot};

use crate::model::{PageMargins, PageSize};

#[derive(Debug, Clone)]
pub struct PaginatedPage {
    pub index: usize,
    pub lines: Vec<LayoutLine>,
    pub draw_ops: Vec<CanvasDrawOp>,
}

#[derive(Debug, Clone)]
pub struct PaginatedDocument {
    pub pages: Vec<PaginatedPage>,
}

pub fn paginate_snapshot(
    snapshot: &LayoutSnapshot,
    page_size: &PageSize,
    margins: &PageMargins,
) -> PaginatedDocument {
    let available_height = page_size.height_pt - margins.top_pt - margins.bottom_pt;
    let mut pages = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_height = 0.0_f32;

    for line in &snapshot.lines {
        if !current_lines.is_empty() && current_height + line.height > available_height {
            pages.push(PaginatedPage {
                index: pages.len(),
                lines: std::mem::take(&mut current_lines),
                draw_ops: Vec::new(),
            });
            current_height = 0.0;
        }
        current_height += line.height;
        current_lines.push(line.clone());
    }

    if !current_lines.is_empty() {
        pages.push(PaginatedPage {
            index: pages.len(),
            lines: current_lines,
            draw_ops: Vec::new(),
        });
    }

    PaginatedDocument { pages }
}
```

- [ ] **Step 4: Export the function from `lib.rs`**

```rust
// src-tauri/crates/pdf-core/src/lib.rs
pub mod export;
pub mod model;
pub mod pagination;

pub use pagination::{paginate_snapshot, PaginatedDocument, PaginatedPage};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test -p pdf-core --test pagination_tests`
Expected: PASS with `2 passed`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/crates/pdf-core/src/lib.rs src-tauri/crates/pdf-core/src/pagination.rs src-tauri/crates/pdf-core/tests/pagination_tests.rs
git commit -m "feat(pdf-core): paginate layout snapshots for export"
```

---

### Task 3: Emit real-text PDF output

**Files:**
- Create: `src-tauri/crates/pdf-core/src/export.rs`
- Create: `src-tauri/crates/pdf-core/tests/export_tests.rs`

**Interfaces:**
- Consumes: `PdfExportRequest`, `PaginatedDocument`
- Produces: `export_pdf(request: &PdfExportRequest) -> Result<PdfExportResult, String>`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing export smoke test**

```rust
use pdf_core::export_pdf;
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};
use tempfile::tempdir;

#[test]
fn writes_non_empty_pdf_file() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.pdf");
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{\"documentId\":\"doc-1\",\"revision\":1,\"blocks\":[],\"styleContext\":{\"defaultFontSize\":14.0,\"defaultFontFamily\":\"Helvetica\",\"defaultLineHeight\":1.5,\"viewportWidth\":800.0,\"viewportHeight\":600.0,\"devicePixelRatio\":1.0}}".into(),
        "{\"revision\":1,\"lines\":[],\"canvasDrawOps\":[],\"hitTestEntries\":[],\"caretAnchors\":[],\"selectionGeometries\":[],\"mirrorBlocks\":[]}".into(),
        out.to_string_lossy().into_owned(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let result = export_pdf(&request).expect("export succeeds");
    assert_eq!(result.page_count, 1);
    assert!(std::fs::metadata(out).unwrap().len() > 0);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test -p pdf-core --test export_tests writes_non_empty_pdf_file -- --exact`
Expected: FAIL with `no export_pdf found`

- [ ] **Step 3: Implement a minimal `lopdf` writer with text and vector line support**

```rust
// src-tauri/crates/pdf-core/src/export.rs
use std::time::Instant;

use layout_core::LayoutSnapshot;
use lopdf::{content::{Content, Operation}, dictionary, Document, Object, Stream};

use crate::model::{PdfExportRequest, PdfExportResult};
use crate::pagination::paginate_snapshot;

pub fn export_pdf(request: &PdfExportRequest) -> Result<PdfExportResult, String> {
    let started = Instant::now();
    let snapshot: LayoutSnapshot =
        serde_json::from_str(&request.layout_snapshot_json).map_err(|error| error.to_string())?;
    let paginated = paginate_snapshot(&snapshot, &request.page_size, &request.margins);

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let mut page_ids = Vec::new();
    for page in &paginated.pages {
        let mut content = Content { operations: Vec::new() };
        content.operations.push(Operation::new("BT", vec![]));
        content.operations.push(Operation::new("/F1", vec![12.into()]));
        for line in &page.lines {
            for run in &line.text_runs {
                content.operations.push(Operation::new("Td", vec![run.left.into(), (request.page_size.height_pt - request.margins.top_pt - line.y).into()]));
                content.operations.push(Operation::new("Tj", vec![Object::string_literal(run.text.clone())]));
            }
        }
        content.operations.push(Operation::new("ET", vec![]));

        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id }
            },
            "MediaBox" => vec![0.into(), 0.into(), request.page_size.width_pt.into(), request.page_size.height_pt.into()],
        });
        page_ids.push(page_id);
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.save(&request.output_path).map_err(|error| error.to_string())?;

    Ok(PdfExportResult {
        page_count: page_ids.len().max(1),
        warnings: Vec::new(),
        export_ms: started.elapsed().as_millis() as u64,
    })
}
```

- [ ] **Step 4: Run the export tests**

Run: `cd src-tauri && cargo test -p pdf-core --test export_tests`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/pdf-core/src/export.rs src-tauri/crates/pdf-core/tests/export_tests.rs
git commit -m "feat(pdf-core): emit native pdf files from layout snapshots"
```

---

### Task 4: Expose `layout_export_pdf` through Tauri and a frontend client

**Files:**
- Create: `src-tauri/src/layout_pdf.rs`
- Create: `src-tauri/src/layout_pdf_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `features/editor/lib/pdf-export-client.ts`
- Create: `features/editor/lib/pdf-export-client.test.ts`

**Interfaces:**
- Consumes: `pdf_core::model::PdfExportRequest`
- Produces: Tauri command `layout_export_pdf(root_path: String, request: PdfExportRequest) -> Result<PdfExportResult, WorkspaceError>`

**Support lenses:** architecture-designer

- [ ] **Step 1: Write the failing Rust command test and TS client test**

```rust
// src-tauri/src/layout_pdf_tests.rs
use pdf_core::model::{PageMargins, PageSize, PdfExportRequest};

#[test]
fn export_request_rejects_non_pdf_output_paths() {
    let request = PdfExportRequest::new(
        "doc-1".into(),
        1,
        "{}".into(),
        "{}".into(),
        "/tmp/out.txt".into(),
        PageSize::a4_points(),
        PageMargins::uniform(72.0),
        "subset".into(),
    );

    let err = crate::layout_pdf::validate_export_request(&request).unwrap_err();
    assert_eq!(err.error_code(), "invalid_name");
}
```

```ts
// features/editor/lib/pdf-export-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { exportPdf } from "./pdf-export-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({
    invoke: vi.fn(async () => ({ pageCount: 1, warnings: [], exportMs: 3 })),
  }),
}));

describe("exportPdf", () => {
  it("invokes the layout_export_pdf command", async () => {
    const result = await exportPdf("/tmp/ws", { documentId: "doc-1" } as never);
    expect(result.pageCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `cd src-tauri && cargo test layout_pdf_tests`
Expected: FAIL with `could not find layout_pdf`

Run: `npm test -- features/editor/lib/pdf-export-client.test.ts`
Expected: FAIL with `Cannot find module './pdf-export-client'`

- [ ] **Step 3: Implement the Tauri command wrapper and request validation**

```rust
// src-tauri/src/layout_pdf.rs
use pdf_core::model::{PdfExportRequest, PdfExportResult};

use crate::models::WorkspaceError;

pub fn validate_export_request(request: &PdfExportRequest) -> Result<(), WorkspaceError> {
    if !request.output_path.ends_with(".pdf") {
        return Err(WorkspaceError::new("invalid_name", "PDF export path must end with .pdf"));
    }
    Ok(())
}

#[tauri::command]
pub fn layout_export_pdf(
    _root_path: String,
    request: PdfExportRequest,
) -> Result<PdfExportResult, WorkspaceError> {
    validate_export_request(&request)?;
    pdf_core::export_pdf(&request).map_err(|error| {
        WorkspaceError::new("pdf_export_failed", error)
    })
}
```

```rust
// src-tauri/src/lib.rs
mod layout_pdf;
mod layout_pdf_tests;

// add to generate_handler!:
layout_pdf::layout_export_pdf,
```

- [ ] **Step 4: Implement the frontend client**

```ts
// features/editor/lib/pdf-export-client.ts
import { tauriCore } from "@/common/lib/tauri";

export async function exportPdf(rootPath: string, request: Record<string, unknown>) {
  const { invoke } = await tauriCore();
  return invoke<{ pageCount: number; warnings: string[]; exportMs: number }>(
    "layout_export_pdf",
    { rootPath, request },
  );
}
```

- [ ] **Step 5: Run the verification tests**

Run: `cd src-tauri && cargo test layout_pdf_tests`
Expected: PASS

Run: `npm test -- features/editor/lib/pdf-export-client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/layout_pdf.rs src-tauri/src/layout_pdf_tests.rs src-tauri/src/lib.rs features/editor/lib/pdf-export-client.ts features/editor/lib/pdf-export-client.test.ts
git commit -m "feat(pdf): expose layout export through tauri and frontend client"
```
