Implemented Task 1 as a refactor-only governance step without deleting legacy modules. The current-product spec now states that the shipped editor surface is hybrid-only, and the focused regression test now proves the public React index still exports the legacy visible editor symbol so later cleanup has a concrete guard.

Files changed:
- [docs/loopx/specs/editor.md](/Users/zhangyukun/project/mdx/docs/loopx/specs/editor.md:21)
- [features/editor/lib/editor-kernel-removal.test.ts](/Users/zhangyukun/project/mdx/features/editor/lib/editor-kernel-removal.test.ts:1)

TDD evidence:
- Replaced the previous closed-kernel artifact assertion with a governance test that reads `packages/mdx-editor/react/index.ts` and asserts it must not contain `MdxEditorView`.
- Ran `npm test -- features/editor/lib/editor-kernel-removal.test.ts`.
- Result: failed as expected because `packages/mdx-editor/react/index.ts` still contains `export { MdxEditorView } from "./mdx-editor-view";`.

Caller proof:
- Ran `rg -n "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs`.
- Result: current references are concentrated in `features/editor/components/editor-kernel-adapter.tsx`, `features/editor/components/editor-pane.tsx`, related tests, `packages/mdx-editor/react/mdx-editor-view.tsx`, browser/provider comparison tests, and `packages/mdx-editor/react/index.ts`.
- This matches the cleanup target for later deletion work and shows the current product surface still carries legacy symbols even though the spec now declares them non-product.

Self-review:
- Stayed within owned implementation files for code changes.
- Did not remove legacy modules or alter product callers outside the governed spec/test surface.
- Confirmed the new spec wording and test align with the task brief: document hybrid-only current product surface, and add a regression guard that currently fails while the public export remains.

```yaml
anchor_coverage:
  refactor-only: implemented
implemented_anchor_ids:
  - refactor-only
tests_for_anchor_ids:
  - refactor-only
extra_behavior: none
missing_context: none
```

```yaml
surface_change:
  removed_or_changed:
    - current-product spec now declares hybrid-only editor surface and governance guard targets legacy public editor exposure
  retained_with_caller_proof:
    - item: legacy symbols still exist in current source before deletion
      caller: rg caller proof output in report
  negative_assertions:
    - command: npm test -- features/editor/lib/editor-kernel-removal.test.ts
      result: fails as expected because packages/mdx-editor/react/index.ts still exports MdxEditorView
  package_or_governance_checks:
    - command: rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs
      result: confirms remaining legacy symbol references are still present in current source and tests, including the public react index export and editor-pane legacy fixture paths
```
