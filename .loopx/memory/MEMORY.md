# MDX Memory

## Active Decisions

- LLM Wiki workspaces are independent from the repo-level `AGENT.md`; knowledge-base instructions live in workspace `AGENTS.md`.
- LLM Wiki ingest is raw-first: user-authored knowledge belongs under `raw/`; scans compare raw file hashes against `.llm-wiki/cache.json` and only pending or changed raw files are sent to LLM ingest.
- LLM Wiki processing updates preserve existing failed rows in `llm-wiki-progress.md` while refreshing the current processing state.
- LLM Wiki current raw progress is owned by backend rescan: `pendingTotal` means all not-completed, not-failed raw files; `pending` is only the bounded next batch; failed files stay visible with reasons until the raw file succeeds.
- LLM provider credentials are app configuration, not knowledge-base files.
- `mdx-cli llm-wiki` is a Workspace Mode surface for the active app workspace root. It covers `status`, `ingest`, `query`, `digest`, `lint`, and `search`; blank user input is rejected at binary and socket-server boundaries.
- Long LLM Wiki operations with an operation id must route LLM calls through cancellable control. Cancellation returns `cancelled` before later write stages, and streaming timeout must not trigger a second non-stream fallback timeout.
- The `ref/` directory contains pulled reference implementations. It is analysis material and must be excluded from project lint, typecheck, tests, and build inputs.
- Document Mode only accepts `.md` and `.markdown` files; invalid supported-file opens should surface a Document error window, document sessions must preserve distinct `displayPath` and `realPath`, and focused Document windows must disable workspace-only menu items.
- Editor Mermaid previews must align Markdown fence parsing with the bundled `@do-md/react` kernel: only column-zero backtick fences are mapped to `.DOMD-Pre`; generated preview DOM is excluded from visible-text search; invalid Mermaid renders suppress Mermaid's own error DOM.
- The self-owned Markdown editor persists Markdown as the only document truth: advanced blocks are structural when supported, unsupported Markdown uses exact source fallback blocks, global source mode is removed, and table pipe characters must round-trip in both plain cell text and inline syntax.
