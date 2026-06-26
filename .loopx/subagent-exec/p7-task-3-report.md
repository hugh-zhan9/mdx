# P7 Task 3 Report

## Scope

- Task: Add manual verification and performance scripts for the new editor
- Brief: `.loopx/subagent-exec/p7-task-3-brief.md`
- Branch: `main`

## Files Changed

- `scripts/verify-editor-browser.mjs`
- `scripts/measure-tex-canvas-layout.mjs`
- `features/editor/lib/tex-canvas-performance.test.ts`
- `.loopx/subagent-exec/p7-task-3-report.md`

## Red Phase

Command:

```bash
npm test -- features/editor/lib/tex-canvas-performance.test.ts
```

Observed failing baseline:

```text
FAIL  features/editor/lib/tex-canvas-performance.test.ts [ features/editor/lib/tex-canvas-performance.test.ts ]
Error: Cannot find module '../../../scripts/measure-tex-canvas-layout.mjs'
```

This was the expected red signal after adding the smoke test before the measurement helper existed.

## Implementation

### `features/editor/lib/tex-canvas-performance.test.ts`

- Added a focused Vitest smoke that uses `TEX_CANVAS_FIXTURES`.
- Targets the `mixed-layout` corpus entry so the smoke covers paragraph, inline math, Mermaid, fallback HTML, and table normalization together.
- Asserts both structural output (`blockCount`, `inlineCount`) and a conservative local elapsed-time budget.

### `scripts/measure-tex-canvas-layout.mjs`

- Added a reusable `measureTexCanvasLayoutPerformance` helper for tests and local CLI use.
- Reuses the real `normalizeLayoutDocument` implementation and the shared fixture corpus instead of duplicating fixture data.
- Prints a human-readable local smoke report with fixture id, iteration count, elapsed time, average time, normalized block count, inline count, and budget result.
- Defaults to the `mixed-layout` fixture and a conservative `80 ms / 200 iterations` threshold for local smoke stability.

### `scripts/verify-editor-browser.mjs`

- Expanded the manual verification checklist to explicitly cover:
  - hybrid editor visibility as the only markdown editing surface
  - save and reopen verification
  - IME input
  - PDF export rendering for math, Mermaid, tables, and fallback HTML
  - the new local layout performance smoke command

## Verification

1. Focused test after implementation:

```bash
npm test -- features/editor/lib/tex-canvas-performance.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
```

2. Local performance smoke:

```bash
node scripts/measure-tex-canvas-layout.mjs
```

Result:

```text
fixture: mixed-layout
iterations: 200
elapsed: 1.96 ms
average: 0.0098 ms/iteration
normalized blocks: 4
inline runs: 4
budget: <= 80 ms
result: PASS
```

3. Manual verification checklist output:

```bash
node scripts/verify-editor-browser.mjs
```

Result: pass; checklist prints the updated hybrid-editor, PDF export, and performance-smoke steps.

## Self Review

- Scope stayed within the four allowed files.
- The smoke test reuses the real normalizer and shared fixture corpus, matching the brief's no-duplication guidance.
- The threshold is intentionally generous relative to the measured local baseline to reduce flake risk while still catching obvious regressions.

## Review Follow-up

- Addressed review feedback that `scripts/measure-tex-canvas-layout.mjs` depended on the caller's current working directory for runtime TypeScript source paths.
- The measurement helper now resolves repository source files relative to `import.meta.url`, and converts URL inputs to filesystem paths for the TypeScript `fileName` option.
- Strengthened the performance smoke structure checks from non-zero output to the stable `mixed-layout` summary: `4` normalized blocks and `4` inline runs.
- Re-ran the measurement helper from `/tmp` using its absolute script path to verify it is cwd-independent.
- Guarded the CLI entrypoint check so importing the helper in environments without `process.argv[1]` does not execute `pathToFileURL(undefined)`.

Follow-up verification:

```bash
node -e "import('./scripts/measure-tex-canvas-layout.mjs').then(() => console.log('import ok'))"
npm test -- features/editor/lib/tex-canvas-performance.test.ts
node scripts/measure-tex-canvas-layout.mjs
node scripts/verify-editor-browser.mjs
cd /tmp && node /Users/zhangyukun/project/mdx/scripts/measure-tex-canvas-layout.mjs
```

Result: all commands passed; the import-only check printed `import ok`, and both measurement invocations reported `mixed-layout`, `4` normalized blocks, `4` inline runs, and `PASS` within the `80 ms` budget.

## Concerns

- The measurement helper transpiles the current TypeScript sources into temporary ESM modules at runtime so `node scripts/measure-tex-canvas-layout.mjs` can execute without adding a new package script. That keeps the smoke local and dependency-light, but the helper should remain scoped to verification usage rather than production paths.
- The budget is a local smoke threshold, not a cross-machine benchmark. Large environment variance could still require later threshold tuning if the normalizer grows materially more expensive.

## Anchor Context

```yaml
anchor_context:
  task_classification: test/verification infrastructure
  anchor_coverage:
    P7-T3: implemented
  implemented_anchor_ids:
    - P7-T3
  tests_for_anchor_ids:
    - P7-T3
  extra_behavior: none
  missing_context: none
```

## Surface Change Context

```yaml
surface_change_context:
  surface_being_changed: developer/manual verification script output and local performance smoke helper
  strict_current_product_paths_to_scan:
    - scripts/verify-editor-browser.mjs
    - scripts/measure-tex-canvas-layout.mjs
    - features/editor/lib/tex-canvas-performance.test.ts
    - packages/mdx-editor/test/tex-canvas-fixtures.ts
    - packages/mdx-editor/layout-ir/normalizer.ts
  historical_frozen_paths: old docs/plans do not count as current callers
  caller_proof_commands:
    - npm test -- features/editor/lib/tex-canvas-performance.test.ts
    - node scripts/verify-editor-browser.mjs
  negative_assertions:
    - manual script output mentions hybrid editor
    - manual script output mentions PDF export
    - performance smoke asserts the fixture layout stays under a local threshold
  package_governance_checks: not_applicable
```
