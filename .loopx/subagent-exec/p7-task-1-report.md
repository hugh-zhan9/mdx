# P7 Task 1 Report

## Scope

- Task: create the minimal shared tex-canvas fixture corpus for TS and Rust validation.
- Allowed code files changed:
  - `packages/mdx-editor/test/tex-canvas-fixtures.ts`
  - `packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
  - `src-tauri/crates/layout-core/tests/golden_layout_tests.rs`

## What changed

- Added `TEX_CANVAS_FIXTURES` in TypeScript with five fixture ids required by the plan:
  - `paragraph-cjk`
  - `math-inline`
  - `table-basic`
  - `mermaid-basic`
  - `html-fallback`
- Kept the corpus intentionally small and local to `packages/mdx-editor/test` to avoid coupling it to other suites.
- Included minimal expectation fields shared in intent across stacks:
  - `blockKinds`
  - `canvasBlockKinds`
  - `lineSnippets`
  - `mirrorText`
  - optional `hasMathInline`
- Added a Vitest file that:
  - first encoded the required failing baseline via missing module
  - now verifies required fixture ids and fixture snapshot shape
- Added a Rust integration test scaffold that mirrors the same fixture ids and snapshot intent, while staying compile-only and self-contained:
  - covers required block families
  - asserts newline preservation and non-empty snapshot fields

## Failing baseline

- Ran `npm test -- packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
- Observed expected failure:
  - `Cannot find module './tex-canvas-fixtures'`

## Verification

- Passed `npm test -- packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
- Passed `cargo test -p layout-core golden_fixture_scaffold --test golden_layout_tests`

## Constraints respected

- Did not modify files outside the allowed code files plus this report.
- Did not revert or touch unrelated worktree changes.
- Rust scaffold is not an empty placeholder; it compiles and encodes reusable fixture intent without expanding into a full golden engine.

## Concerns

- TS and Rust fixture data are duplicated by intent today; there is not yet a single generated source shared across languages.
- The TS `canvasBlockKinds` field uses a placeholder non-empty entry for the paragraph-only fixture so the current shape stays uniform; this is acceptable for scaffold stage but should be tightened once an actual renderer snapshot consumer exists.

## Fix loop 2026-06-26

- Reworked `packages/mdx-editor/test/tex-canvas-fixtures.ts` so the shared corpus now lives in one JSON string export, `TEX_CANVAS_FIXTURE_CORPUS_JSON`, with the typed TS fixtures parsed from that source.
- Updated Rust `golden_layout_tests.rs` to consume the same corpus via `include_str!` plus `serde_json`, removing the separate hand-written Rust fixture copy.
- Corrected `html-fallback` to a real source-fallback case using block `<div ...>` HTML, matching existing repo tests that already prove `<details>` is `html_block`.
- Corrected `math-inline` semantics so the corpus expresses inline math as a `paragraph` fixture with `hasMathInline: true`, not as a block-level `math` fixture.
- Removed the fake paragraph canvas placeholder: `paragraph-cjk` now has `canvasBlockKinds: []`, and tests explicitly allow paragraph-only fixtures to have no canvas block.
- Tightened TS and Rust assertions to pin the reviewed semantics instead of only checking non-empty fields, so these regressions fail if reintroduced.

## Latest verification

- Passed `npm test -- packages/mdx-editor/test/tex-canvas-fixtures.test.ts`
- Passed `cargo test -p layout-core --test golden_layout_tests`

## Current concerns

- The Rust test extracts JSON from a TypeScript source export rather than from a dedicated `.json` artifact. This satisfies the shared-corpus requirement within the allowed file set, but it remains format-coupled to that export wrapper.
