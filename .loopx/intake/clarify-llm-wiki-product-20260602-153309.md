# Clarify Bundle: MDX LLM Wiki Product Vision

## Intent And Desired Outcome

The product vision in `AGENT.md` is to turn MDX into a local-first LLM Wiki Markdown workspace. The user wants the app to automatically process a user-opened folder as an LLM Wiki, using the Karpathy LLM Wiki method as the source of truth and `/ref` implementations as implementation references.

The first version must deliver complete LLM Wiki capabilities, not a minimal source-summary-only slice.

Important user wording:

- "项目自动在后台可以针对编辑器打开的文件夹做 llm"
- "按照 llm-wiki 的思路来，应该是只会处理 raw 目录才对吧？我写的文档应该也维护在 raw 目录中"
- "我希望完整的按照 llm-wiki 来，第一版是需要具备完整的llm-wiki 能力，这是必须拥有的能力。"
- "以 llm-wiki 为准则，llm-wiki 中没有提到的内容，默认当前先不需要。"
- "这个软件理论上不需要web端。"

## Source Requirements And References

- Product vision: `AGENT.md`
- Canonical method: Karpathy LLM Wiki gist in `ref/karpathy-llm-wiki-gist/llm-wiki.md`
- Reference implementations:
  - `ref/llm-wiki-agent`
  - `ref/llm_wiki`
  - `ref/llm-wiki-skill`

Karpathy LLM Wiki is the source of product truth. Features not present in the original LLM Wiki idea are out of scope by default unless required to make the core flows work.

## In-Scope Work

- LLM Wiki mode for a local workspace.
- Initialization of a LLM Wiki structure in the opened folder.
- Background ingest for `raw/` content.
- In-app LLM configuration and calls.
- Full LLM Wiki core capabilities:
  - `init`
  - `ingest`
  - `query`
  - `lint`
  - `digest`
  - lightweight knowledge graph page
- LLM Wiki panel integrated with the existing file tree/editor.
- Root progress document generated during knowledge-base initialization.
- Default automatic writes to generated wiki files.
- macOS desktop support as the first-version acceptance target.

## Non-Goals

- No web product. The web dev shell may remain for development, but LLM Wiki capability is desktop/Tauri only.
- No embedding/vector search in first version.
- No web clipper.
- No multimodal/image understanding.
- No complex interactive graph system such as Sigma/Graphology.
- No real-time file system watcher. Use open-scan, save-trigger, and manual rescan.
- No automatic migration of existing Markdown files outside `raw/`.
- No Windows/Linux acceptance requirement for first version.

## Key Decisions

### Workspace Modes

MDX keeps ordinary Markdown workspace mode. LLM Wiki behavior only activates after the workspace is initialized or recognized as a LLM Wiki workspace.

### LLM Wiki Directory Structure

Use:

```text
raw/
  notes/
  articles/
  assets/
wiki/
  sources/
  entities/
  concepts/
  syntheses/
index.md
log.md
purpose.md
AGENTS.md
llm-wiki-progress.md
.llm-wiki/
  cache.json
  config.json or ignore state
```

The user selected `concepts/syntheses` over `topics/synthesis`.

### Schema File Name

User knowledge-base schema file is `AGENTS.md`. This is independent from the product repository's `AGENT.md`.

### Raw As Source Of Truth

Only `raw/` content is processed as first-party source material. User-authored source documents should live under `raw/`. Generated `wiki/` pages must not be re-ingested as first-party raw sources.

### Existing Markdown Migration

When opening a folder without LLM Wiki structure, MDX may initialize the structure but must not automatically migrate existing Markdown files into `raw/`.

### Background Ingest Triggers

Use:

- scan on opening a LLM Wiki workspace
- save-trigger for files under `raw/`
- manual "rescan raw" action

Do not implement live file-system watching in first version.

### Default Writes

Background LLM writes are allowed by default.

Source pages can be regenerated/overwritten from their corresponding raw file. Entity and concept pages must be updated through merge-style logic rather than simple overwrite.

The user said wiki pages are theoretically maintained by LLM, so conflicts with user manual edits to generated wiki pages are not a first-version concern.

### Progress Document

`llm-wiki-progress.md` is generated in the user knowledge-base root during initialization. It tracks parsing/ingest progress for that directory, including current progress, completed items, pending items, failures, and next work.

This is not a development progress document.

### LLM Configuration

LLM calls are application-internal, not delegated to an external agent session.

LLM API key and provider config belong to the software configuration, not the knowledge base. Keys must not be written into workspace files.

### Privacy Boundary

When LLM Wiki is enabled and LLM config exists, content under `raw/` may be sent to the configured LLM endpoint for ingest/query/digest. The app should make this clear. It does not need to implement automatic sensitive-data filtering in first version.

### Pause And Exclusion Controls

First version supports:

- pause/resume background ingest
- skip a raw file
- skip a raw subdirectory

These controls belong to the knowledge base, not global app config.

### Language

Default generated wiki language is Chinese. Store the language decision in `AGENTS.md`.

### Purpose

If `purpose.md` exists but is still default or not filled in, background ingest may continue with generic knowledge organization and should prompt the user to refine `purpose.md`.

### Query And Digest Persistence

`query` is immediate Q&A against the wiki and should not save answers by default.

`digest` creates durable synthesis reports under `wiki/syntheses/`.

Query may offer "save as synthesis" later, but this is not the default.

### Knowledge Graph

First version includes a lightweight Mermaid graph page:

- scan `[[wikilink]]` from `wiki/`
- generate/update `wiki/knowledge-graph.md`
- provide a refresh action in the LLM Wiki panel
- auto-refresh once after a background ingest batch completes
- do not infer relation labels with LLM

### Platform

First version acceptance target is macOS desktop/Tauri.

## Rejected Alternatives

- Treating arbitrary workspace Markdown as ingest source: rejected. Only `raw/` is source of truth.
- Source-summary-only MVP: rejected. User requires complete LLM Wiki core ability in first version.
- Default review queue for all writes: rejected. User wants default writes.
- `topics/synthesis`: rejected in favor of `concepts/syntheses`.
- `.wiki-schema.md`: rejected in favor of `AGENTS.md`.
- Web product: rejected.
- Vector/embedding search: rejected as not part of core LLM Wiki.
- Live file-system watching: rejected for first version.
- Automatic migration of existing Markdown into `raw/`: rejected.

## Brownfield Evidence

Current project already has:

- Tauri desktop shell.
- Local Markdown workspace UI with file tree, tabs, outline.
- Markdown editor integration via `@do-md/react`.
- Rust workspace file-system commands.
- App state persistence.
- Image asset handling.
- `mdx-cli` and local Unix socket automation.

Relevant files:

- `features/workspace/components/workspace-app.tsx`
- `features/workspace/components/workspace-shell.tsx`
- `features/workspace/lib/workspace-reducer.ts`
- `features/workspace/lib/cli-sync.ts`
- `src-tauri/src/workspace_fs.rs`
- `src-tauri/src/cli_server.rs`
- `src-tauri/src/state_store.rs`

Inference: existing workspace and CLI foundations are a strong base for LLM Wiki mode, but there is currently no LLM config, background task queue, LLM Wiki schema initialization, ingest/query/lint/digest service, or LLM Wiki panel.

## Success Criteria

- A user can open a folder and initialize it as a LLM Wiki workspace.
- Initialization creates the agreed directory/file structure.
- LLM config is stored in app/software config, not workspace files.
- Opening a LLM Wiki workspace scans `raw/` and updates `llm-wiki-progress.md`.
- Background ingest processes changed or unprocessed raw Markdown files using cache.
- Ingest writes source/entity/concept pages and updates index/log/progress.
- Query answers questions using wiki pages and citations.
- Digest saves synthesis reports.
- Lint performs mechanical checks and LLM-assisted wiki health checks as appropriate.
- Mermaid knowledge graph page can be generated and refreshed.
- Ordinary Markdown workspace mode still works without LLM Wiki activation.
- First-version verification targets macOS desktop.

## Residual Risks

- "Complete LLM Wiki ability" is broad and will need a careful design split before planning.
- Automatic writes require robust path safety, task recovery, cache correctness, and prompt-output validation.
- Entity/concept merge quality may become the hardest correctness problem.
- LLM API key storage mechanism must be selected according to existing Tauri capabilities.
- Background task cancellation and app-close behavior need explicit state design.

## Handoff Recommendation

`needs_spec`

This touches product behavior, UI architecture, background tasks, LLM provider configuration, file-system contracts, workspace state, cache/state model, security/privacy, and verification. It needs a design document before implementation planning.
