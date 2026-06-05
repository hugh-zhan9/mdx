# MDX Memory

## Active Decisions

- LLM Wiki workspaces are independent from the repo-level `AGENT.md`; knowledge-base instructions live in workspace `AGENTS.md`.
- LLM Wiki ingest is raw-first: user-authored knowledge belongs under `raw/`; scans compare raw file hashes against `.llm-wiki/cache.json` and only pending or changed raw files are sent to LLM ingest.
- LLM provider credentials are app configuration, not knowledge-base files.
- `mdx-cli llm-wiki` is a Workspace Mode query/search surface only: it uses the active app workspace root, rejects blank query/question input at both binary and socket-server boundaries, emits no UI events, and must not expose init/scan/ingest/lint/graph/digest operations.
- The `ref/` directory contains pulled reference implementations. It is analysis material and must be excluded from project lint, typecheck, tests, and build inputs.
- Document Mode only accepts `.md` and `.markdown` files; invalid supported-file opens should surface a Document error window, document sessions must preserve distinct `displayPath` and `realPath`, and focused Document windows must disable workspace-only menu items.
- Editor Mermaid previews must align Markdown fence parsing with the bundled `@do-md/react` kernel: only column-zero backtick fences are mapped to `.DOMD-Pre`; generated preview DOM is excluded from visible-text search; invalid Mermaid renders suppress Mermaid's own error DOM.
