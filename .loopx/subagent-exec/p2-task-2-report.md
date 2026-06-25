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

Implemented macOS-first system font discovery in `font-core`, with `font-kit` fallback for non-macOS or empty CoreText results. Discovery now returns `FontDescriptor` values with family, PostScript name, CSS-ish style, weight, and `math_available` derived from real font data when accessible.

Default font lookup now selects from discovered system fonts instead of relying on brittle CoreText family lookup paths.

Tests:
- `cargo test --package font-core --test discovery_tests`

Concern:
- MATH-table presence is environment-dependent; the test asserts correctness for any detected math fonts and skips hard failure when the local machine exposes none.

Update:
- Restored a hard assertion for MATH-table discovery so the test fails if discovery never marks any font as math-enabled.
- Added deterministic default-face selection that prefers regular/normal style, then weight closest to 400, then stable tie-breaks.
- Added a synthetic test covering the face-selection order so the selection logic is exercised without depending on host fonts.

Test results:
- `cd src-tauri && cargo test --package font-core --test discovery_tests` -> pass
- `cd src-tauri && cargo test --package font-core` -> pass

Update:
- Reworked discovery so CoreText enumeration now yields basic `FontDescriptor` values directly, without requiring `font_kit::SystemSource::select_by_postscript_name` to succeed.
- Moved MATH detection behind a limited candidate probe path, so initial discovery no longer opens and reads every system font file.
- Added pure tests for descriptor retention when a math probe fails, plus deterministic default-font selection coverage.

Test results:
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package font-core --test discovery_tests` -> pass
- `cd src-tauri && cargo test --package font-core` -> pass

Controller follow-up:
- Kept `font-kit` weights as already-normalized CSS weights and limited CoreText normalized weight conversion to CoreText descriptors.
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package font-core --test discovery_tests` -> pass
- `cd src-tauri && cargo test --package font-core` -> pass

Controller follow-up 2:
- Removed the heuristic MATH candidate filter and probe cap so every discovered font can be checked against actual MATH-table evidence.
- `cd src-tauri && cargo fmt --all -- --check` -> pass
- `cd src-tauri && cargo test --package font-core --test discovery_tests` -> pass
- `cd src-tauri && cargo test --package font-core` -> pass
