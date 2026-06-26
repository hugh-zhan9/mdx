Implemented Task 2 under the widened scope by removing the live legacy visible-editor module from current product code while retaining the hybrid host path.

What changed:

- Deleted [packages/mdx-editor/react/mdx-editor-view.tsx](/Users/zhangyukun/project/mdx/packages/mdx-editor/react/mdx-editor-view.tsx:1).
- Removed the public `MdxEditorView` export from [packages/mdx-editor/react/index.ts](/Users/zhangyukun/project/mdx/packages/mdx-editor/react/index.ts:1).
- Removed the `MdxEditorView` import and `DOMD` alias from [features/editor/components/editor-kernel-adapter.tsx](/Users/zhangyukun/project/mdx/features/editor/components/editor-kernel-adapter.tsx:1), leaving only provider/store compatibility helpers.
- Removed the hidden legacy fixture render path from [features/editor/components/editor-pane.tsx](/Users/zhangyukun/project/mdx/features/editor/components/editor-pane.tsx:1). The current product pane now mounts only `HybridEditorHost` inside the content shell.
- Updated [features/editor/components/editor-pane.test.tsx](/Users/zhangyukun/project/mdx/features/editor/components/editor-pane.test.tsx:1) so the focused assertions validate the hybrid-only shell and no longer depend on `DOMD` or `data-legacy-editor-fixture`.

Validation:

- `npm test -- features/editor/lib/editor-kernel-removal.test.ts features/editor/components/editor-pane.test.tsx`
  - passed: `2` files, `17` tests
- `test ! -e packages/mdx-editor/react/mdx-editor-view.tsx`
  - passed with exit code `0`
- `rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs`
  - current product path is clean for this task target: `features/editor/components/editor-pane.tsx` no longer imports/renders `DOMD`, `packages/mdx-editor/react/index.ts` no longer exports `MdxEditorView`, and the deleted module file no longer exists
  - remaining matches are governance text plus historical/test-only references outside the focused task gate

Self-review:

- The hybrid host path remains the current product entrypoint in `editor-pane.tsx`.
- No out-of-scope files were edited.
- There are still non-product test/comparison references to `MdxEditorView` and `DOMD` elsewhere in the repo; they were not part of this task's owned set and did not block the required focused checks.

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
    - public react index no longer exports MdxEditorView and the legacy visible-editor module file is deleted
    - editor-kernel-adapter no longer aliases DOMD to the deleted visible-editor module
    - editor-pane no longer renders the hidden legacy DOMD fixture or data-legacy-editor-fixture path
  retained_with_caller_proof:
    - item: hybrid host path remains current product entrypoint
      caller: features/editor/components/editor-pane.tsx imports HybridEditorHost
  negative_assertions:
    - command: test ! -e packages/mdx-editor/react/mdx-editor-view.tsx
      result: pass
    - command: npm test -- features/editor/lib/editor-kernel-removal.test.ts features/editor/components/editor-pane.test.tsx
      result: pass
  package_or_governance_checks:
    - command: rg "MdxEditorView|DOMD|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs
      result: current product path clean for Task 2 targets; remaining matches are governance text and test-only/historical references outside the focused gate
```
