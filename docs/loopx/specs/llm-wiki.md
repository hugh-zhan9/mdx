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
- Ingest processing progress updates must preserve previously recorded failed rows in `llm-wiki-progress.md` while refreshing the current Processing section.
- Backend raw rescan owns current progress classification. `RawScanResult.pendingTotal` means all not-completed, not-failed raw files; `RawScanResult.pending` is only the bounded next batch.
- Persisted or current failed raw files must be excluded from pending candidates and from `pendingTotal`, returned with `{ path, reason }`, and shown in the panel until that raw file later succeeds with a valid completed cache entry.
- `excludedPendingPaths` is a transient batch-selection exclusion and must not be treated as failed state or subtracted from `pendingTotal`.
- Background ingest task join/panic failures must be logged at the async command boundary because the blocking task may not reach normal ingest-stage logging.
- Query writes `log.md` but must not automatically create new wiki pages.
- Digest explicitly persists a synthesis under `wiki/syntheses/*.md` and updates `index.md` and `log.md`.
- Mechanical lint must run without LLM config; semantic lint is optional when LLM config exists.

## Cancellation And Timeouts

- Long LLM Wiki operations with an operation id must route LLM calls through cancellable control.
- Cancellation should return `cancelled` to the caller before later write stages.
- Incomplete chat streams that end without `[DONE]` or a non-null `finish_reason` must be treated as transport failures, not parsed as complete LLM output.
- Streaming timeout and partial-stream failures may retry once through non-streaming chat; cancellation must not fallback and must remain visible as `cancelled`.
- Providers with unreliable streaming may use the canonical `chatNoStream` API mode, including config aliases `chat-no-stream` and `chat_non_stream`.

## Ingest File-Block Output

- Ingest generation output must parse as strict file blocks and pass managed output path validation before any generated wiki file or cache entry is written.
- The parser may strip one whole-output markdown fence around otherwise valid file blocks, but prose before or after file blocks remains invalid.
- A malformed ingest generation may run one repair prompt. If repair output is invalid or repair transport fails, ingest should report the original parse error; user cancellation during repair remains `cancelled`.

## CLI

- `loam-cli llm-wiki` uses the active running Workspace Mode root.
- Current commands are `status`, `ingest`, `query`, `digest`, `lint`, and `search`.
- CLI input validation belongs at both the binary boundary and socket-server boundary.
