# Editor Integration Notes

## Mermaid Preview And `@do-md/react`

The shared Markdown editor's rendered DOM is owned by the bundled `@do-md/react` kernel. Integrations that map Markdown source to rendered editor nodes must align with the kernel's actual rendered surface.

For Mermaid live preview:

- Treat Markdown source as the single source of truth.
- Map Mermaid fences only to rendered `pre.DOMD-Pre` nodes produced by the editor kernel.
- Count only column-zero backtick fenced code blocks for `pre.DOMD-Pre` order mapping.
- Do not count tilde fences or indented Mermaid-looking fences unless the kernel is first proven to render them as `pre.DOMD-Pre`.
- Exclude generated preview UI from visible-text search and find/replace.
- Invalidate find/replace indexes when Mermaid source visibility changes.
- Initialize Mermaid with strict security and `suppressErrorRendering: true`; the app owns invalid-diagram error UI.
