# MDX Memory

## Active Decisions

- LLM Wiki workspaces are independent from the repo-level `AGENT.md`; knowledge-base instructions live in workspace `AGENTS.md`.
- LLM Wiki ingest is raw-first: user-authored knowledge belongs under `raw/`; scans compare raw file hashes against `.llm-wiki/cache.json` and only pending or changed raw files are sent to LLM ingest.
- LLM provider credentials are app configuration, not knowledge-base files.
- The `ref/` directory contains pulled reference implementations. It is analysis material and must be excluded from project lint, typecheck, tests, and build inputs.

