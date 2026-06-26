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
    - strict current product paths no longer reference MdxEditorView, DOMD, data-mdx-editor-view, or data-legacy-editor-fixture
    - manual verification wording is hybrid-only
  retained_with_caller_proof:
    - item: historical plans/designs may still mention the removed legacy view
      caller: allowed historical paths only
  negative_assertions:
    - command: ! rg "\\bMdxEditorView\\b|\\bDOMD\\b|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs -g '!features/editor/lib/editor-kernel-removal.test.ts'
      result: pass (no output)
    - command: npm test
      result: failed outside scope; owned files passed, but full suite failed in features/editor/components/editor-pane-mermaid-regression.test.tsx because it still expects a default visible Mermaid source textarea
    - command: npm run lint
      result: failed outside scope; existing errors in features/editor/hooks/use-editor-find-replace.ts and packages/mdx-editor/react/wasm-layout-bridge.ts
    - command: npm run build
      result: failed outside scope; existing type error in features/editor/lib/visible-text-search.ts
    - command: cd src-tauri && cargo test
      result: pass
  package_or_governance_checks:
    - command: rg "\\bMdxEditorView\\b|\\bDOMD\\b|data-mdx-editor-view|data-legacy-editor-fixture" packages features scripts docs/loopx/specs -g '!features/editor/lib/editor-kernel-removal.test.ts'
      result: no matches
```

Implemented within owned scope:
- Rewrote current-product React tests away from the removed visible editor component and onto the supported registered-root contract via `useMdxEditor().registerRoot(...)`.
- Updated hybrid/manual-verification wording to describe the hybrid editor as the only visible editor surface.
- Removed remaining banned legacy visible-editor assertions from owned current-product tests and spec text.

Files changed:
- docs/loopx/specs/editor.md
- scripts/verify-editor-browser.mjs
- features/editor/hooks/use-editor-bridge.test.tsx
- features/editor/components/editor-kernel-adapter.test.tsx
- packages/mdx-editor/react/mdx-editor-browser.test.tsx
- packages/mdx-editor/react/mdx-editor-provider.test.tsx

Verification notes:
- Corrected negative assertion passed with the governance-guard exclusion and without treating `DOMDProvider` as a violation.
- Targeted owned-suite verification passed:
  `npm test -- --run packages/mdx-editor/react/mdx-editor-provider.test.tsx packages/mdx-editor/react/mdx-editor-browser.test.tsx packages/mdx-editor/react/legacy-view-comparison.test.tsx features/editor/hooks/use-editor-bridge.test.tsx features/editor/components/editor-kernel-adapter.test.tsx features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx features/document/components/document-shell.test.tsx`
  Result: 8 files passed, 60 tests passed.

Self-review:
- The fixture replacement stays within the intended post-acceptance cleanup: tests now exercise the current provider/root contract instead of reviving the deleted visible editor surface.
- I did not edit out-of-scope files that still block full repo `npm test`, `lint`, and `build`.
