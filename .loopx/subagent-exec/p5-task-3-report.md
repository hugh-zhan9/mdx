P5 Task 3 mounted the existing `LightMirror` under the hybrid host so `snapshot.mirrorBlocks` now produce the semantic DOM subtree used for copy/find/accessibility on Canvas-only blocks, while the ordinary DOM text-run layer remains in place.

Code evidence:
- `packages/mdx-editor/react/hybrid-editor-host.tsx` mounts `<LightMirror blocks={snapshot.mirrorBlocks} />` alongside `DomTextRunLayer` and `CanvasSvgLayer`.
- `packages/mdx-editor/react/hybrid-editor-host.test.tsx` proves the host renders both `"Hello"` from normal text runs and the `"x squared"` mirror subtree for a Canvas block.
- `features/editor/components/editor-pane.test.tsx` proves rendering the hybrid host snapshot does not call `onMarkdownChange`, so markdown persistence/save-recovery remains on the existing bridge callback flow only.

Test evidence:
- Red step: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx` failed before the runtime change because `data-layout-light-mirror` was absent.
- Green step: `npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx features/editor/components/editor-pane.test.tsx` passed with 2 files and 15 tests green.

```yaml
anchor_coverage:
  infrastructure: implemented
implemented_anchor_ids:
  - infrastructure
tests_for_anchor_ids:
  - infrastructure
extra_behavior: none
missing_context: none
```

```yaml
surface_change:
  removed_or_changed:
    - hybrid editor host now mounts LightMirror from snapshot.mirrorBlocks for Canvas-block semantic DOM surface
  retained_with_caller_proof:
    - item: ordinary DOM text-run rendering remains mounted through DomTextRunLayer
      caller: packages/mdx-editor/react/hybrid-editor-host.tsx
    - item: markdown persistence/save-recovery flow remains unchanged
      caller: features/editor/components/editor-pane.tsx uses bridge/onMarkdownChange flow only
  negative_assertions:
    - command: focused host/editor pane tests proving mirror mount does not replace ordinary text content or persistence flow
      result: PASS - hybrid-editor-host.test.tsx asserts both Hello text runs and light mirror content; editor-pane.test.tsx asserts rendering the hybrid host snapshot does not call onMarkdownChange
  package_or_governance_checks:
    - command: npm test -- packages/mdx-editor/react/hybrid-editor-host.test.tsx features/editor/components/editor-pane.test.tsx
      result: PASS - 2 files, 15 tests
```
