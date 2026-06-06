# LLM Wiki CLI Workspace Constraint

`mdx-cli llm-wiki` is Workspace Mode only and uses the active running app workspace root.

- It exposes `status`, `ingest <raw-path>`, `query [--json] <question...>`, `digest --title <slug> <prompt...>`, `lint [--json]`, and `search <query...>`.
- It must not add headless `--root` support unless the product explicitly changes the CLI model.
- Blank question, query, title, and prompt input must be rejected at both the binary argument-validation boundary and the socket-server protocol boundary.
- Server handlers call the existing LLM Wiki services and return CLI protocol responses. When a successful operation updates `log.md`, the app should emit a file-updated event so clean open log tabs can refresh.
