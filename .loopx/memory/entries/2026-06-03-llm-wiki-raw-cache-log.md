# LLM Wiki Raw/Cache/Log Decision

LLM Wiki implementation in MDX follows a raw-first model:

- User-authored source material belongs under `raw/`.
- Generated wiki pages are written under managed wiki paths such as `wiki/sources`, `wiki/entities`, `wiki/concepts`, and `wiki/syntheses`.
- Scans compare raw file hashes against `.llm-wiki/cache.json`; unchanged cached raw files are completed, not pending.
- Ingest, query, lint, and digest operations should be reflected in workspace `log.md`.
- LLM API credentials live in app-level settings, not inside the knowledge base.

