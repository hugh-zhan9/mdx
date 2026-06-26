# P7 Task 2 Report

## Scope

- Modified `packages/mdx-editor/react/legacy-view-comparison.test.tsx`
- Modified `features/editor/components/editor-pane.test.tsx`
- Modified `features/editor/components/editor-pane.tsx`
- Modified `packages/mdx-editor/layout-ir/normalizer.ts`
- Modified `packages/mdx-editor/layout-ir/normalizer.test.ts`
- Modified `packages/mdx-editor/react/canvas-svg-layer.tsx`
- Modified `features/editor/lib/visible-text-search.ts`
- Modified `features/editor/lib/visible-text-search.test.ts`
- Product-path changes are limited to hybrid snapshot semantics, mermaid/fallback block normalization, mirror visible-text offset mapping, and removal of the obsolete DOMD-based mermaid preview layer from the current hybrid `EditorPane` path.

## Brief Compliance

1. Wrote a failing baseline comparison test in `packages/mdx-editor/react/legacy-view-comparison.test.tsx`.
2. Ran `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx` and captured the failure.
3. Replaced the baseline with a real-path comparison harness that:
   - renders the real legacy provider/root-registration path through `EditorKernelProvider` and `useMdxEditor().registerRoot(...)`
   - renders the real `HybridEditorHost` from `snapshotFromMarkdown(...)`
   - compares paragraph and mermaid visible-text matches between legacy and hybrid paths
   - asserts mermaid mirror selection offsets map back to the markdown code body, not the fence marker
4. Extended `features/editor/components/editor-pane.test.tsx` and `features/editor/lib/visible-text-search.test.ts` with hybrid mirror/offset regression coverage.
5. Ran focused tests covering normalizer, comparison, EditorPane, mermaid regression, and visible-text search.

## Failing Baseline

- Command: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx`
- Result: failed as intended before harness finalization
- Key signal: real `DOMD` output in jsdom exposed source/control text that did not match hybrid visible-text semantics, so the stable regression harness had to compare against a test-only legacy fixture path rather than browser-node-view UI text.

## Final Test Result

- Command: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
- Result: passed
- Summary: `2` files passed, `23` tests passed

## Notes

- Earlier fix-loop sections below are chronological records of rejected intermediate implementations; the current effective result is described in `Scope`, `Brief Compliance`, `Expanded Scope Fix`, and the latest fix-review section.
- `features/editor/components/editor-pane.test.tsx` already contained unrelated local edits in the worktree; commit staging must stay scoped to the Task 2 hunks only.

## Fix Loop

- Removed the synthetic `buildLegacyFixtureRoot(...)` comparison path from `packages/mdx-editor/react/legacy-view-comparison.test.tsx`.
- Rebuilt the comparison harness on the real legacy path by rendering `DOMDProvider + DOMD` beside the real `HybridEditorHost`.
- Narrowed the matrix to two stable, real-path cases:
  - paragraph visible-text parity between legacy DOMD and hybrid host
  - mermaid source semantics using legacy DOMD as the visible-text oracle, while asserting hybrid-side markdown offsets directly
- Updated helper lookup so required nodes are queried from the current rendered host subtree instead of global `document`.
- Removed the `editor-pane.test.tsx` assertion that treated legacy absence of `x^2` as the correct semantic outcome; the test now only guards shell/fixture coexistence plus hybrid mirror markdown-offset availability.

## Fix Loop Result

- Command: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
- Result: passed
- Summary: `2` files passed, `18` tests passed

## Residual Concern

- The real legacy DOMD mermaid visible text excludes the opening fence marker, while the current hybrid visible text still includes `````mermaid````` before the source lines. The fix-loop tests now capture this with a real-path oracle instead of papering it over with a synthetic fixture.

## Expanded Scope Fix

- Scope expanded to allow the minimum product-path changes needed for Task 2.
- `packages/mdx-editor/layout-ir/normalizer.ts`
  - added minimal mermaid fence recognition using existing `isMermaidFenceLanguage(...)`
  - normalizes mermaid fences into `kind: "mermaid"` blocks whose source range starts at the code body, not the opening fence
- `features/editor/components/editor-pane.tsx`
  - exported the real `snapshotFromMarkdown(...)` helper so comparison tests consume the product snapshot path directly
  - taught the snapshot path to render mermaid blocks as hybrid complex-block overlays plus light-mirror semantic text, instead of plain paragraph text runs
  - aligned hybrid mermaid mirror text with real legacy visible-text semantics, including the trailing newline visible in the old path
- `packages/mdx-editor/react/canvas-svg-layer.tsx`
  - hid mermaid overlay text from visible-text indexing so semantic text comes from the mirror only and is not double-counted
- `packages/mdx-editor/react/legacy-view-comparison.test.tsx`
  - removed synthetic legacy-root construction entirely
  - comparison harness now mounts the real legacy provider path and a real registered legacy root contract div, then compares that real old DOM path against the real hybrid snapshot path
  - paragraph and mermaid cases now assert visible-text semantic alignment rather than tolerating divergence
- `features/editor/components/editor-pane.test.tsx`
  - kept integration scope narrow: hybrid shell/snapshot smoke and hybrid markdown-offset coverage, without blessing legacy/hybrid divergence
- `packages/mdx-editor/layout-ir/normalizer.test.ts`
  - added a focused mermaid normalization regression

## Expanded Scope Result

- Command: `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
- Result: passed
- Summary: `3` files passed, `23` tests passed

## Remaining Concern

- The real legacy mermaid comparison still emits React `flushSync` warnings during mount/unmount in jsdom, but the semantic assertions now pass and the warnings did not fail the test run.

## Fix Review Follow-up

- Verified the reviewer feedback against the current codebase before editing:
  - `features/editor/components/editor-kernel-adapter.tsx` no longer exports `DOMD`, so the comparison test was importing an undefined component and failing before it could exercise the legacy path.
  - `packages/mdx-editor/layout-ir/normalizer.ts` depended upward on `features/editor/lib/mermaid-code-fences`, creating the cross-layer dependency identified in review.
- Replaced the comparison harness with the real legacy provider/root registration contract:
  - renders `EditorKernelProvider`
  - registers a local `[data-mdx-editor-root]` through `useMdxEditor().registerRoot(...)`
  - asserts the mermaid node view actually mounted via `textarea[aria-label='Mermaid source']` and `[data-mdx-mermaid-preview]`
- Removed the upward normalizer dependency by keeping the minimal mermaid fence-language predicate local to `packages/mdx-editor/layout-ir/normalizer.ts`.

## Fix Review Result

- Command: `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
- Result: passed
- Summary: `3` files passed, `23` tests passed

## Fix Review Follow-up 2

- Verified reviewer feedback:
  - `EditorPane` no longer renders the hidden DOMD root, while `EditorMermaidPreviewLayer` still depended on DOMD `<pre>` nodes; leaving it mounted in the hybrid product path was stale and misleading.
  - Mermaid visible-text parity was covered, but partial mirror matches did not map back to markdown offsets, so `graph TD` and `A --> B` offset drift could pass undetected.
- Removed the obsolete `EditorMermaidPreviewLayer` mount and its related visibility-revision state from `EditorPane`.
- Added comparison-test assertions for mermaid partial-match markdown offsets.
- Updated `visible-text-search` so substring matches inside one mirror segment can map to markdown offsets while cross-segment mirror matches remain unsafe.
- Added a direct visible-text-search regression for mermaid-style mirror substring offsets.

## Fix Review Follow-up 2 Result

- Command: `npm test -- features/editor/lib/visible-text-search.test.ts packages/mdx-editor/layout-ir/normalizer.test.ts packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx features/editor/components/editor-pane-mermaid-regression.test.tsx`
- Result: passed
- Summary: `5` files passed, `45` tests passed

## Fix Review Follow-up 3

- Verified reviewer feedback against the parser implementation:
  - the real mermaid parser accepts opening fences with `0..3` leading spaces
  - the real parser treats an unclosed mermaid fence as running through EOF
- Updated `packages/mdx-editor/layout-ir/normalizer.ts` to match those parser boundaries for hybrid snapshot semantics.
- Added normalizer regressions for indented mermaid fences and unclosed mermaid fences through EOF.

## Fix Review Follow-up 3 Result

- Command: `npm test -- packages/mdx-editor/layout-ir/normalizer.test.ts`
- Result: passed
- Summary: `1` file passed, `7` tests passed
- Command: `npm test -- features/editor/lib/visible-text-search.test.ts packages/mdx-editor/layout-ir/normalizer.test.ts packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx features/editor/components/editor-pane-mermaid-regression.test.tsx`
- Result: passed
- Summary: `5` files passed, `48` tests passed
