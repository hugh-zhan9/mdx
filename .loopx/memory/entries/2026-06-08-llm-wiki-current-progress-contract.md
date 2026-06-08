# LLM Wiki Current Progress Contract

LLM Wiki current raw progress is owned by backend rescan state (`RawScanResult` plus `llm-wiki-progress.md`):

- `pendingTotal` is the count of all not-completed, not-failed raw files.
- `pending` is only the bounded next batch to process.
- `excludedPendingPaths` suppresses files from the next `pending` batch, but it is not failed state and does not reduce `pendingTotal`.
- Failed files are returned as `{ path, reason }`, rendered in the panel, and remain visible until the raw file later succeeds and has a valid completed cache entry.
- Background task join/panic failures must be logged at the async ingest command boundary because the blocking ingest task may not reach normal stage-level logging.

Evidence: commits `aa0b97e`, `e3c65a2`, `1b9961d`, `2aa9c05`, `55f3317`, and `17474da`.
