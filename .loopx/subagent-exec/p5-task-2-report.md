P5 Task 2 report

Summary:
Bridged visible text indexing across Canvas mirror blocks by allowing `data-layout-light-mirror` subtrees through the existing hidden-element skip gate. Added regression coverage at both the raw visible-text index layer and the find/replace hook layer to prove mirror semantic text is searchable, generated preview text stays excluded, ordinary DOM text does not gain duplicate matches, and markdown fallback behavior remains intact.

Files changed:
- `features/editor/lib/visible-text-search.ts`
- `features/editor/lib/visible-text-search.test.ts`
- `features/editor/hooks/use-editor-find-replace.test.ts`

Implementation details:
- Updated `shouldSkipElement` in `features/editor/lib/visible-text-search.ts` to return `false` for elements marked with `data-layout-light-mirror` before applying the normal hidden/style/preview/syntax exclusions.
- Left `features/editor/hooks/use-editor-find-replace.ts` unchanged because the existing `buildVisibleTextIndexForMarkdown(editorRoot, markdown)` path already indexes the live editor DOM first and only falls back to markdown when that DOM index is empty.
- Added a visible-text regression proving a hidden mirror subtree contributes semantic text while Mermaid preview content remains excluded.
- Added a visible-text regression proving ordinary DOM text runs are still matched once even when a mirror subtree exists nearby.
- Added a hook-level regression proving `buildVisibleTextIndexForMarkdown` sees hidden mirror semantic text, still excludes generated preview text, and does not duplicate ordinary DOM matches.

TDD evidence:
- Added failing test first: `includes hidden mirror text for canvas blocks while excluding preview garbage`.
- Ran `npm test -- features/editor/lib/visible-text-search.test.ts`.
- Observed expected failure before implementation: mirror text was missing from `index.text` because the hidden subtree was skipped.
- Implemented the targeted mirror exception.
- Re-ran the focused package tests until green.

Self-review:
- Confirmed the new exception is narrow to `data-layout-light-mirror` and does not relax `data-mdx-syntax`, Mermaid preview, `aria-hidden`, `display:none`, or `visibility:hidden` behavior for ordinary elements.
- Confirmed no fallback regression: `buildVisibleTextIndexForMarkdown` still returns the markdown-derived index when the DOM index is empty and the editor root has no child nodes.
- Confirmed no duplicate ordinary DOM matches from mirror content with explicit test coverage.
- Confirmed no changes were made outside the owned file set, except this required report file.

Test evidence:
- `npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts`
  - Result: PASS (`2` files, `31` tests)

Negative assertion evidence:
- `rg -n "mdx-mermaid-preview|data-mdx-syntax|aria-hidden=\"true\"|display = \"none\"|visibility = \"hidden\"" features/editor/lib/visible-text-search.ts features/editor/lib/visible-text-search.test.ts`
  - Result: exclusions and related regression coverage remain present; new tests also cover preview exclusion with a hidden mirror subtree.
- Focused visible-text-search and find-replace tests covering preview/syntax exclusion and non-duplicate DOM matches
  - Result: PASS

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
    - browser find / visible text indexing now includes LightMirror semantic text for Canvas blocks
  retained_with_caller_proof:
    - item: generated preview and syntax-marker exclusions remain active
      caller: features/editor/lib/visible-text-search.ts shouldSkipElement
    - item: markdown fallback remains active when DOM index is empty
      caller: features/editor/hooks/use-editor-find-replace.ts buildVisibleTextIndexForMarkdown
  negative_assertions:
    - command: focused visible-text-search and find-replace tests covering preview/syntax exclusion and non-duplicate DOM matches
      result: PASS
  package_or_governance_checks:
    - command: npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts
      result: PASS (2 files, 31 tests)
```

## Review fix follow-up

Summary:
Addressed the review finding that `data-layout-light-mirror` content was indexed unconditionally and could duplicate ordinary DOM matches. The indexer now builds ordinary visible text first, then includes mirror content only when it contributes text not already represented by ordinary searchable DOM. This preserves Canvas-only semantic text searchability without changing markdown fallback behavior in `use-editor-find-replace.ts`.

Files changed:
- `features/editor/lib/visible-text-search.ts`
- `features/editor/lib/visible-text-search.test.ts`
- `features/editor/hooks/use-editor-find-replace.test.ts`

Implementation details:
- Refactored `buildVisibleTextIndex` into an ordinary-first pass plus a selective mirror pass.
- Kept `data-layout-light-mirror` searchable even when hidden, but only admitted mirror child text when it adds new searchable content beyond the ordinary DOM index.
- Left `features/editor/hooks/use-editor-find-replace.ts` unchanged because the focused hook regression passed against the indexer fix and markdown fallback behavior remained intact.
- Updated both prior “no duplicate” regressions so the visible paragraph text is actually duplicated inside the mirror subtree, and asserted that only one ordinary-body match is returned while Canvas-only mirror text remains searchable.

Verification:
- `npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts`
  - Result: PASS (`2` files, `31` tests)
