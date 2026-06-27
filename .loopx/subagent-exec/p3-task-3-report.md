# P3 Task 3 Report

- Task: Emit real-text PDF output
- Brief: `/Users/zhangyukun/project/mdx/.loopx/subagent-exec/p3-task-3-brief.md`
- Baseline SHA: `4aa730170ff995921609b559ef9845ed5aff730e`

## Scope executed

- Added a new `export` module in `pdf-core` with a minimal native PDF writer.
- Added an `export_tests.rs` smoke test that writes a PDF to a temp path and asserts a non-empty file plus `page_count == 1`.
- Wired `pdf_core::export_pdf` into the crate root and added the minimal crate dependencies required to compile the new path (`lopdf` and test-only `tempfile`).

## Implementation notes

- Followed the required red-green sequence:
  1. Added the smoke test.
  2. Ran `cd src-tauri && cargo test -p pdf-core --test export_tests writes_non_empty_pdf_file -- --exact` and captured the failing state once the test target existed: `no export_pdf in the root`.
  3. Implemented the minimal writer and reran the export tests to green.
- `export_pdf` now:
  - deserializes the layout snapshot payload,
  - paginates it via `paginate_snapshot`,
  - emits a basic PDF 1.5 document with Helvetica text runs,
  - strokes simple rectangle outlines for `TableGrid` and `Decoration` draw ops,
  - saves the file to `request.output_path`,
  - returns `PdfExportResult` with measured elapsed time.
- The incoming snapshot JSON in the brief uses camelCase keys, while `layout-core`'s Rust structs currently deserialize snake_case by default. To keep this task self-contained, the exporter includes a local camelCase compatibility layer and converts into `layout_core::LayoutSnapshot` before pagination.
- The pagination baseline can produce zero pages for an empty snapshot. The exporter intentionally emits one blank page in that case so the smoke test and the export contract remain stable.

## Verification

1. Failing test first:
   - Command: `cd src-tauri && cargo test -p pdf-core --test export_tests writes_non_empty_pdf_file -- --exact`
   - Result: failed with `no export_pdf in the root`
2. Passing focused export test:
   - Command: `cd src-tauri && cargo test -p pdf-core --test export_tests`
   - Result: `1 passed`
3. Regression check for the crate:
   - Command: `cd src-tauri && cargo test -p pdf-core`
   - Result: `4 passed`

## Files changed

- `src-tauri/crates/pdf-core/Cargo.toml`
- `src-tauri/crates/pdf-core/src/lib.rs`
- `src-tauri/crates/pdf-core/src/export.rs`
- `src-tauri/crates/pdf-core/tests/export_tests.rs`

## Commit

- Planned commit message: `feat(pdf-core): emit native pdf files from layout snapshots`

## Concerns

- The task ownership listed only `export.rs` and `export_tests.rs`, but `Cargo.toml` and `src/lib.rs` also required minimal wiring so the new test target and exported API could compile at all.
- The local camelCase compatibility parser is intentionally narrow. If later tasks standardize serde naming in `layout-core`, this compatibility layer should be removed in favor of the canonical shared structs.


## Review Follow-up Fix

- Rebased page-2+ text positioning by subtracting each page's starting line y before emitting PDF text operators.
- Strengthened the export smoke test into a true multi-page regression by using document-global y values and asserting `Tj` operators plus a positive page-local `Td` y on page 2.

### Verification

- Command: `cd src-tauri && cargo test -p pdf-core --test export_tests`
- Result: pass, `2 passed`


## Review Follow-up Fix 3

- Rebased page-local text positions before emitting PDF `Td` operators, so every page now uses page-relative coordinates.
- Added a multi-page regression fixture that asserts `Tj` operators exist on both pages and that page-2 `Td` coordinates are positive in page-local space.

### Verification

- Command: `cd src-tauri && cargo test -p pdf-core --test export_tests`
- Result: pass, `2 passed`
