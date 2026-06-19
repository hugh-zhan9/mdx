# Markdown WYSIWYG Kernel Contract

## Summary

The self-owned Markdown editor persists Markdown as the only document truth. Advanced blocks are structural when supported, unsupported Markdown is preserved through explicit source fallback blocks, and there is no global source mode UI.

## Details

- Use `data-mdx-*` attributes for editor integration; do not depend on legacy DOMD classes.
- Source fallback blocks must serialize their raw Markdown exactly until structured support exists.
- Table parser and serializer must preserve pipe characters in both plain cell text and inline Markdown syntax such as wikilinks, links, images, inline math, and code spans.
- Final regression for this area should include parser/serializer/provider coverage plus negative assertions for removed global source mode and legacy DOMD selectors.

## Evidence

- `docs/loopx/specs/editor.md`
- `3571bbc fix(editor): preserve inline pipes in tables`
- `65befdf fix(editor): preserve table pipes and html fallback`
- `dad9e3f feat(editor): remove global source mode`
