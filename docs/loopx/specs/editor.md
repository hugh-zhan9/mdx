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

## Recovery And External Change Safety

Unsaved recovery data must stay under explicit user control. If a draft recovery banner is visible, automatic clean reloads from disk may update the editor's clean baseline, but they must not delete the draft; only save success or an explicit discard action may remove it.

Draft recovery prompts in both Document Mode and Workspace Mode must provide a read-only diff before the user decides whether to restore the draft or keep the disk version.

Workspace saves must carry the tab's last clean disk fingerprint to the backend. The backend must reject writes when the current file fingerprint differs, so conflict detection does not depend solely on file watcher delivery.

When the user confirms a discard flow that exits a dirty workspace context, such as switching workspaces or closing the window, plaintext workspace drafts for dirty Markdown tabs must be deleted before continuing. If cleanup fails, the discard flow must stop and report the error.
