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
