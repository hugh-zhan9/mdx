P1 Task 3 Report: Paragraph Layout

Summary
- Implemented paragraph layout scaffolding in `layout-core` with a public paragraph layout entrypoint, a simplified Knuth-Plass style optimizer, and greedy fallback.
- Added a font metrics trait plus a mock provider for deterministic width estimation in tests and early integration.
- Added focused paragraph tests covering single-line layout, multi-line wrapping, UTF-8 byte offset preservation, positioned output runs, and the auto/Knuth-Plass surface.

Files Changed
- `src-tauri/crates/layout-core/src/paragraph.rs`
- `src-tauri/crates/layout-core/src/font_api.rs`
- `src-tauri/crates/layout-core/tests/paragraph_tests.rs`

Implementation Notes
- `ParagraphInput` now drives layout using `InlineRun` slices, width, font sizing, line-height, and code-mode hints.
- `layout_paragraph_with_mode` exposes `Auto`, `KnuthPlass`, and `Greedy` modes. `Auto` and `KnuthPlass` both fall back to greedy if optimization cannot produce break candidates.
- Tokenization uses the existing break model and preserves UTF-8 byte-offset mapping into `TextRunPosition.pm_from` and `pm_to`.
- Layout trims leading and trailing whitespace at line boundaries, positions runs left-to-right, and emits stable `LayoutLine` ids and y offsets.
- The current Knuth-Plass implementation is a lightweight dynamic-programming optimizer over discovered breakpoints. It is intentionally bootstrap-grade rather than final TeX-quality justification logic.

Verification
- `cargo test --package layout-core --test paragraph_tests`
- `cargo test --package layout-core --test break_model_tests`
- `cargo test --package layout-core`

Truthful Concerns
- The Knuth-Plass path is a minimal optimization scaffold, not a complete TeX box/glue/penalty implementation. It satisfies the bootstrap surface and fallback contract, but later tasks will still need to deepen justification quality.
- Font family selection is still placeholder-only because the current task brief does not provide shaped-run or style-context family data on this surface.
- Multi-run styling is preserved only via PM ranges and text content today; `TextRunPosition.font_family` remains `"default"` until later font and shaping work lands.

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
