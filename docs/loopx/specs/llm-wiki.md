# LLM Wiki Workflow Contracts

## Layers

- `raw/` is the immutable source layer. Raw documents are read during ingest only.
- `wiki/` is the maintained knowledge layer used by query and digest.
- `index.md` is the navigation entry point for humans and LLM page selection.
- `AGENTS.md` defines workspace-local wiki rules; it is independent from repo-level agent instructions.

## Wikilinks And Context

- New generated wikilinks should use stable path links with aliases, such as `[[entities/example|Readable Label]]`.
- Query and digest must build context from `index.md` page selection and validated `wiki/{sources,entities,concepts,syntheses}/*.md` paths, not query-time raw-document retrieval.
- Selected wiki pages may expand stable wikilinks one hop, bounded by selected-page, expanded-page, and context-byte limits.

## Operations

- Ingest may read one raw source plus purpose, agents, index, and related wiki context, then update multiple managed wiki pages.
- Query writes `log.md` but must not automatically create new wiki pages.
- Digest explicitly persists a synthesis under `wiki/syntheses/*.md` and updates `index.md` and `log.md`.
- Mechanical lint must run without LLM config; semantic lint is optional when LLM config exists.

## Cancellation And Timeouts

- Long LLM Wiki operations with an operation id must route LLM calls through cancellable control.
- Cancellation should return `cancelled` to the caller before later write stages.
- Streaming timeout must not trigger a second non-stream fallback timeout for the same logical LLM step.

## CLI

- `mdx-cli llm-wiki` uses the active running Workspace Mode root.
- Current commands are `status`, `ingest`, `query`, `digest`, `lint`, and `search`.
- CLI input validation belongs at both the binary boundary and socket-server boundary.
