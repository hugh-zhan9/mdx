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
