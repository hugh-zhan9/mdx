# Editor Mermaid Preview Kernel Boundary

The shared editor uses the bundled `@do-md/react` kernel as the rendered DOM authority. Mermaid preview mapping must follow what that kernel renders as `pre.DOMD-Pre`, not broader CommonMark behavior.

For Mermaid preview integration:

- Count only column-zero backtick fenced code blocks for `.DOMD-Pre` order mapping.
- Ignore tilde fences and indented Mermaid-looking fences unless the kernel is proven to render them as `.DOMD-Pre`.
- Exclude generated Mermaid preview DOM (`data-mdx-mermaid-preview`) from visible-text search and find/replace.
- Initialize Mermaid with `suppressErrorRendering: true` because the app owns invalid-diagram error UI.
