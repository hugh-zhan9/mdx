# Editor Integration Notes

## Mermaid Preview And MDX Editor DOM Contract

The shared Markdown editor's rendered DOM is owned by the self-owned MDX editor kernel under `packages/mdx-editor/`. Integrations that map Markdown source to rendered editor nodes must use the stable MDX editor DOM contract, not implementation-private classes.

For Mermaid live preview:

- Treat Markdown source as the single source of truth.
- Map Mermaid fences only to rendered code blocks marked with `data-mdx-code-block`.
- Count only column-zero backtick fenced code blocks for rendered code-block order mapping unless the parser explicitly adds support for more fence forms.
- Exclude generated preview UI marked with `data-mdx-mermaid-preview` from visible-text search and find/replace.
- Exclude Markdown syntax elements marked with `data-mdx-syntax` from visible-text search and find/replace.
- Invalidate find/replace indexes when Mermaid source visibility changes.
- Initialize Mermaid with strict security and `suppressErrorRendering: true`; the app owns invalid-diagram error UI.

## Unsupported Markdown Fallbacks

Markdown text remains the authoritative document format. If the editor encounters Markdown that cannot be represented by the visual block model, it must preserve that content in an explicit fallback block instead of dropping, normalizing, or silently rewriting it. Saving must round-trip the original Markdown for those fallback blocks until the editor gains structured support for that construct.

## Markdown Syntax Plugin Kernel

The self-owned Markdown editor is composed through `createMdxEditorKernel(...)` and `defaultMarkdownSyntax()`. Current app and feature callers must use the kernel API rather than the old direct parser, serializer, schema, or editor-plugin factory exports from `packages/mdx-editor`.

Syntax families that have been extracted into independent plugins own their schema contribution, parser contribution, serializer, NodeView, clipboard behavior, and focused tests. The first extracted syntax families are fallback/source blocks, HTML, footnotes, code fences/frontmatter, and Mermaid.

Mermaid fence parsing is intentionally independent from ordinary code-fence parsing. Clipboard HTML must be sanitized before it can rehydrate raw Markdown HTML or syntax-owned clipboard metadata.

## Recovery And External Change Safety

Unsaved recovery data must stay under explicit user control. If a draft recovery banner is visible, automatic clean reloads from disk may update the editor's clean baseline, but they must not delete the draft; only save success or an explicit discard action may remove it.

Draft recovery prompts in both Document Mode and Workspace Mode must provide a read-only diff before the user decides whether to restore the draft or keep the disk version.

Workspace saves must carry the tab's last clean disk fingerprint to the backend. The backend must reject writes when the current file fingerprint differs, so conflict detection does not depend solely on file watcher delivery.

When the user confirms a discard flow that exits a dirty workspace context, such as switching workspaces or closing the window, plaintext workspace drafts for dirty Markdown tabs must be deleted before continuing. If cleanup fails, the discard flow must stop and report the error.
