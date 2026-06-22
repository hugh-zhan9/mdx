# Editor Regression Guardrails

These editor regressions have happened before and must stay covered by tests
when touching parser, serializer, document-window layout, or preview layers.

- Standalone document windows must keep recovery banners clickable and editor
  content scrollable.
- Confirmed document close events must not be blocked by `preventDefault()`.
- Four-backtick fenced code blocks that contain triple-backtick examples must not
  swallow following Markdown sections.
- Mermaid previews must only attach to code block DOM nodes whose
  `data-mdx-language` is `mermaid`; never hide or decorate ordinary code blocks.
- The Mermaid preview layer may only remove preview nodes it created itself; it
  must not clean up previews owned by React node views.
- Mermaid blocks must use one preview path only; do not render both a React node
  view preview and the global preview layer for the same block.
- Bare `http://`, `https://`, and email text should render as editable links.
- Outline heading clicks should jump immediately, not smooth-scroll slowly.
