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
- Font family selection now consumes `StyleContext.default_font_family` and emits that value in `TextRunPosition.font_family`; later shaping work can replace this with per-run resolved families.
- Adjacent token coalescing now preserves source `InlineRun` and style boundaries, with a regression test for contiguous runs.

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

Fix update:
- Threaded `StyleContext` through `ParagraphInput`.
- Preserved input `InlineRun` boundaries by carrying source-run and style identity into token merging.
- Added a regression test for adjacent inline runs that must remain separate `TextRunPosition` values.

Fix verification:
- `cd src-tauri && cargo test --package layout-core --test paragraph_tests` -> pass
- `cd src-tauri && cargo test --package layout-core` -> pass

P1 Task 3 Fix Addendum

Summary
- Fixed line-building so trimming only affects break evaluation, not emitted `text_runs`; boundary whitespace now stays in output runs and PM ranges.
- Added a hard assertion that every `InlineRun` satisfies `run.to == run.from + run.text.len()`, so malformed spans fail fast instead of leaking invalid layout ranges.
- Strengthened paragraph tests to assert concrete line/run boundaries for greedy, Knuth-Plass, and Auto behavior, including whitespace-at-boundary coverage and a panic regression for invalid UTF-8 span fixtures.

Files Changed
- `src-tauri/crates/layout-core/src/paragraph.rs`
- `src-tauri/crates/layout-core/tests/paragraph_tests.rs`
- `.loopx/subagent-exec/p1-task-3-report.md`

Fix verification
- `cd src-tauri && cargo fmt --all -- --check` -> failed before formatting, then `cd src-tauri && cargo fmt --all` -> pass
- `cd src-tauri && cargo test --package layout-core --test paragraph_tests` -> pass
- `cd src-tauri && cargo test --package layout-core` -> pass

Controller follow-up:
- Strengthened the Auto/Knuth-Plass/Greedy fallback regression to assert complete line signatures for all modes.
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package layout-core --test paragraph_tests` -> pass
- `cd src-tauri && cargo test --package layout-core` -> pass

Controller follow-up 2:
- Switched boundary whitespace back to source-faithful visual width so geometry matches emitted text and PM ranges.
- Replaced the malformed-span panic check with a non-panicking layout regression.
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package layout-core --test paragraph_tests` -> pass
- `cd src-tauri && cargo test --package layout-core` -> pass

P1 Task 3 Fix Addendum 2

Summary
- Fixed hard break handling so consecutive and trailing `InlineKind::HardBreak` inputs can emit explicit blank `LayoutLine` rows instead of being dropped.
- Fixed boundary whitespace handling so line-fit evaluation can keep leading/trailing whitespace in emitted text/PM ranges while excluding that whitespace from visual width and `left` advancement.
- Added regression coverage for consecutive hard breaks, trailing hard breaks, and boundary whitespace width accounting.

Files Changed
- `src-tauri/crates/layout-core/src/paragraph.rs`
- `src-tauri/crates/layout-core/tests/paragraph_tests.rs`
- `.loopx/subagent-exec/p1-task-3-report.md`

Fix verification
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package layout-core --test paragraph_tests` -> pass
- `cd src-tauri && cargo test --package layout-core` -> pass
