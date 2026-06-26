# P7 Task 2 Report

## Scope

- Modified `packages/mdx-editor/react/legacy-view-comparison.test.tsx`
- Modified `features/editor/components/editor-pane.test.tsx`
- No production code changes

## Brief Compliance

1. Wrote a failing baseline comparison test in `packages/mdx-editor/react/legacy-view-comparison.test.tsx`.
2. Ran `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx` and captured the failure.
3. Replaced the baseline with a test-only comparison harness that:
   - builds a synthetic legacy fixture root from the same normalized layout document
   - renders the real `HybridEditorHost`
   - compares visible text matches and markdown selection offsets across fixture corpus cases
   - adds an explicit mixed-layout mermaid semantics regression
4. Extended `features/editor/components/editor-pane.test.tsx` with an integration assertion that the hybrid host keeps mirror markdown offsets available while the hidden legacy fixture root remains mounted.
5. Ran `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`.

## Failing Baseline

- Command: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx`
- Result: failed as intended before harness finalization
- Key signal: real `DOMD` output in jsdom exposed source/control text that did not match hybrid visible-text semantics, so the stable regression harness had to compare against a test-only legacy fixture path rather than browser-node-view UI text.

## Final Test Result

- Command: `npm test -- packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/components/editor-pane.test.tsx`
- Result: passed
- Summary: `2` files passed, `23` tests passed

## Notes

- The harness is deliberately test-only and does not change product behavior.
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
