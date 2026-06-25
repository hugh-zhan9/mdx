# P4 Task 1 Report

## Scope

- Implemented only the requested `packages/mdx-editor/layout-ir/*` surface.
- Added the required task report at `.loopx/subagent-exec/p4-task-1-report.md`.
- Did not modify unrelated in-progress files elsewhere in the repository.

## Files Added

- `packages/mdx-editor/layout-ir/types.ts`
- `packages/mdx-editor/layout-ir/normalizer.ts`
- `packages/mdx-editor/layout-ir/invalidation.ts`
- `packages/mdx-editor/layout-ir/index.ts`
- `packages/mdx-editor/layout-ir/normalizer.test.ts`

## What Was Implemented

### `types.ts`

- Added `LayoutViewport`, `LayoutDocument`, `LayoutBlock`, `LayoutBlockStyle`, `LayoutInlineRun`, `LayoutInlineStyle`, and `LayoutStyleContext`.
- Added a small `LayoutNormalizationSource` type to reflect the brief's stated upstream inputs (`ParsedMarkdownDocument`, `SelectionState`, ProseMirror `Node`) without widening the required `normalizeLayoutDocument(markdown, viewport)` API.

### `normalizer.ts`

- Implemented `normalizeLayoutDocument(markdown, viewport)`.
- Behavior matches the brief's scaffold:
  - splits blocks on blank lines
  - classifies `# ...` as `heading`, otherwise `paragraph`
  - assigns `pmFrom`/`pmTo` from source offsets in the markdown string
  - emits a `math_inline` run for the sample `$x^2$` content
  - fills `styleContext` from the viewport

### `invalidation.ts`

- Added a minimal invalidation map surface:
  - `LayoutInvalidationEntry`
  - `LayoutInvalidationMap`
  - `createLayoutInvalidationMap(document)`
- This keeps the requested module boundary in place for downstream tasks without inventing extra behavior not specified in Task 1.

### `index.ts`

- Exported the normalizer, invalidation helper, and related types from the new package surface.

### `normalizer.test.ts`

- Added the exact test shape from the brief, formatted to match local TypeScript style.

## Red/Green Verification

### Red

1. Ran the exact command from the brief before files existed:
   - `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
2. Result:
   - initial repo state failed with `No test files found` because the requested test file had not been created yet
3. Added only `normalizer.test.ts`
4. Re-ran:
   - `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
5. Result:
   - failed with `Cannot find module './normalizer'`, matching the brief's expected red state

### Green

1. Implemented the requested layout IR files
2. Ran:
   - `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
3. Result:
   - `Test Files  1 passed (1)`
   - `Tests  1 passed (1)`

## Spec Check

- Implemented everything explicitly requested by Task 1.
- Kept edits scoped to the owned module plus the required report file.
- Did not expand behavior beyond the initial normalizer surface and minimal invalidation helper.
- Output shape matches what downstream P4 tasks expect: a shared `layout-ir` package boundary with a `normalizeLayoutDocument` entry point.

## Commit

- Commit message used: `feat(editor): add layout ir normalizer`
