# LLM Wiki CLI Query/Search Constraint

`mdx-cli llm-wiki` is intentionally narrow and Workspace Mode only.

- It exposes `query [--json] <question...>` and `search <query...>` for the active running app workspace root.
- It must not add headless `--root` support or operation commands such as init, scan, ingest, lint, graph, or digest.
- Blank question/query input must be rejected at both the binary argument-validation boundary and the socket-server protocol boundary.
- Query/search server handlers should not emit UI events or mutate UI state; they call the existing LLM Wiki services and return CLI protocol responses.

