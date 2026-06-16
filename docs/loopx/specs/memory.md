# Memory Layer Workflow Contracts

> Memory 层与 LLM Wiki 层 **并列**。本文档只描述 Memory 层契约；Wiki 契约见 [llm-wiki.md](./llm-wiki.md)。
>
> 使用说明见 [memory-usage.md](../../memory-usage.md)。

## Layers

| 层 | 路径 | 职责 |
|---|---|---|
| **Memory — Threads** | `memory/threads/` | 完整 AI 对话原文；按全量快照替换；Agent recall 默认 **不** 注入全文 |
| **Memory — Memories** | `memory/memories/` | 原子记忆；Agent recall 的主检索对象 |
| **Memory — Working** | `memory/working.md` | 当前关注；session 启动优先读取 |
| **Memory — Inbox** | `memory/inbox/` | 待确认记忆（自动蒸馏时使用） |
| **Memory — Rules** | `memory/MEMORY.md` | Memory 层 schema 与 Agent 规则 |
| **LLM Wiki — Raw** | `raw/` | 一手素材；ingest 时读取；**query 时不读** |
| **LLM Wiki — Wiki** | `wiki/` | 长期知识页；`llm-wiki query` 读取 |

## Boundary Rules

1. `mdx-cli memory *` 与 `mdx-cli llm-wiki *` 命令 **平级**，无包含关系。
2. `llm-wiki query` **不得** 默认读取 `memory/threads/` 全文。
3. `memory recall` **不得** 默认读取 `wiki/` 全文；需要深度/wiki 知识时调用方显式调用 `llm-wiki query`。
4. Thread → Wiki 只能通过 `memory promote`（复制到 `raw/promoted/` 后可选 ingest）。
5. In agent-backend mode, the runtime database is the source of truth; Markdown under `memory/**` is an async readable projection and import/export compatibility layer.
6. MDX Memory is an external agent backend for Codex, Claude, and Cursor. Manual UI editing is a fallback and review surface, not the primary product workflow.
7. Hard shutdown must stop new writes for the disabled feature without deleting historical DB records or Markdown projection files.

## Thread Contract

### Path

```
memory/threads/{source}/{yyyy-mm-dd}-{thread_id}.md
```

`source`: `codex` | `cursor` | `claude-code` | `import` | `manual`

### Required Frontmatter

```yaml
schema_version: 1
kind: thread
thread_id: string        # stable id, e.g. "cursor:abc123"
source: string
title: string
content_hash: string     # sha256 of normalized body
```

### Optional Frontmatter

```yaml
started_at, ended_at, message_count, model, workspace_root, tags
distilled: bool
promoted_to_wiki: bool
archived: bool
continues_from: string   # previous thread file path
```

### Body

- Messages as `## Message N — role — timestamp` sections.
- Full conversation content must be preserved (product requirement).

### Write Semantics

- New `thread_id` -> create file.
- Existing `thread_id` + new `content_hash` -> overwrite the indexed snapshot file in place.
- Same `thread_id` + same `content_hash` -> skip (idempotent).
- Updates must append to `log.md` with event `thread_save`.
- Unknown sources must fail with `invalid_thread_source`.

## Memory Contract

### Path

```
memory/memories/{yyyy-mm-dd}-{slug}[-n].md
```

When a same-day slug collision exists, writers must allocate the next numeric suffix using atomic create-new semantics. Existing memory records must not be overwritten by `memory add`.

### Required Frontmatter

```yaml
schema_version: 1
kind: memory
memory_id: string
title: string
status: active | inbox | archived
created_at: ISO8601
```

### Recommended Frontmatter

```yaml
source_thread: string    # path to thread file when one exists; manual memories may omit it
importance: float        # 0.0–1.0
tags: [string]
evolves_from: string     # prior memory_id
confidence: float
```

### Body

- Short, prompt-injectable prose.
- May include wikilinks to wiki pages; must not auto-create wiki files.

## Working Memory Contract

- Single file: `memory/working.md`
- Updated via `memory working get|set|append`
- Included in `memory recall` when `include_working: true` (default)

## Recall Contract

### Input

```json
{
  "query": "string",
  "limit": 10,
  "byte_budget": 65536,
  "include_working": true,
  "include_threads": false,
  "tag": "optional string",
  "since": "optional ISO8601"
}
```

### Output

```json
{
  "working": "string or null",
  "memories": [
    {
      "memory_id": "string",
      "title": "string",
      "path": "string",
      "snippet": "string",
      "score": 0.0,
      "importance": 0.0
    }
  ],
  "threads": [
    {
      "path": "string",
      "memory_id": "thread_id",
      "title": "string",
      "status": "active | archived",
      "created_at": "string",
      "tags": []
    }
  ],
  "truncated": false,
  "byte_count": 0
}
```

### Retrieval

- Scan `memory/memories/` with substring match + tag filter.
- When `limit` or `byte_budget` is omitted, read defaults from `.mdx/memory-config.json`.
- Sort by score (importance × recency decay).
- Do **not** scan thread bodies.
- Use `.mdx/search.sqlite` as a rebuildable projection when available; fallback scan must return a degraded warning instead of failing recall.
- When `include_threads: true`, return matching thread summaries by title, thread id, or path. Thread body text is not injected into recall output by default.
- Optional vector rerank may be enabled by config, using the configured runtime source of truth.

## Agent-Time Extraction Contract

- Agent integrations must treat Memory extraction as part of the active conversation turn, not only as a background distill or thread-archival workflow.
- At the start of a conversation or task, agents should call `memory_recall` when prior context may affect the answer or implementation.
- During the turn, agents may call `memory_add` for clear, durable, low-risk user preferences, facts, decisions, project constraints, or reusable lessons.
- Agents should call `memory_search` before `memory_add` when duplicate risk exists.
- Sensitive, private, uncertain, speculative, or low-confidence candidates must not be written directly as durable memories. Agents should ask the user first or call `memory_inbox_add` to create a review candidate.
- Inbox review is explicit: `memory_inbox_add` creates a candidate, `memory_inbox_list` reviews candidates, and `memory_inbox_accept` promotes a reviewed candidate to durable memory.
- `memory_distill` remains a thread/background workflow and fallback safety net. It is not the only valid Memory extraction path.

## Agent Backend Contract

- Supported agent ids are `codex`, `claude`, and `cursor`.
- Agent integrations may use hooks, MCP tools, CLI commands, or the local daemon. All surfaces must route through the Memory facade and preserve workspace path guards and locks.
- Hook capture persists raw hook payloads as agent events. Distilled memories are derived records; they must not replace full thread/event archival.
- Hook execution must stay lightweight. Provider calls and distill work happen outside the hook path through queued/background work.
- If capture is disabled, hook handling must not write DB records, spool files, queue jobs, or projection files.
- If recall injection is disabled, hook handling may still capture events but must return empty additional context.
- If a per-agent integration is disabled, that agent must not create new capture/distill writes through automatic hooks.

## Inbox Contract

- Path: `memory/inbox/{yyyy-mm-dd}-{slug}[-n].md`
- Distill and capture write candidates to inbox by default.
- `memory inbox list` excludes reviewed records unless requested.
- `memory inbox accept <inbox_id>` creates an active memory, marks the inbox record accepted, and is idempotent for an already accepted record.
- `memory inbox reject <inbox_id>` marks the inbox record rejected without creating active memory.

## Index Contract

- Rebuild command: `mdx-cli memory index rebuild`.
- Status command: `mdx-cli memory index status`.
- SQLite path: `.mdx/search.sqlite`.
- In agent-backend mode, the runtime database is the source of truth; Markdown under `memory/**` is an async readable projection and import/export compatibility layer.
- Existing Markdown-first workspaces must be imported into the runtime database before DB-first writes begin.
- If DB records and Markdown projection disagree, repair/rebuild uses DB records as canonical and reports projection conflicts.
- Rebuild scans canonical sources and can restore a missing or dirty projection.
- If a Markdown source write succeeds but SQLite projection sync fails, persist an out-of-band dirty marker outside SQLite.
- Recall/search/status must treat a dirty marker or non-clean index status as degraded even when `.mdx/search.sqlite` is readable, and recall must fallback to Markdown with `index_degraded=true`.
- A successful index rebuild clears the dirty marker.

## Distill Contract

- Command: `mdx-cli memory distill --thread <thread_id|path> [--accept] [--force]`.
- Default output is inbox candidates.
- If `auto_accept=true` and confidence meets `distill.confidence_threshold`, candidates may be written directly to active memory.
- Distill preserves source thread and message refs when available.
- Re-running distill without `--force` must be idempotent for the same source thread content and candidate set; it should return existing inbox/active results instead of duplicating candidates.
- `--force` intentionally creates a new distill run.

## Capture Contract

- Commands: `memory capture scan --source <source> [--import] [--distill]` and `memory capture import --source <source> --file <path> [--distill]`.
- Supported capture sources are `codex`, `cursor`, `claude-code`, and `manual`.
- Import writes a thread snapshot first. If optional distill fails, the saved thread remains visible and the result reports partial distill failure.
- Codex scan discovers local `rollout-*.jsonl` transcripts under `MDX_CODEX_SESSION_DIRS`, `~/.codex/sessions`, and `~/.codex/archived_sessions`.
- Codex scan returns both legacy `paths` and structured `candidates`. Candidate paths are importable external file paths, not workspace-relative paths.
- `memory capture scan --source codex --import` imports every discovered transcript as a thread snapshot. With `--distill`, distill failure must make the scan/import command fail instead of silently returning scan success.
- Codex thread imports must preserve readable `## Message N` sections and the complete original source under `## Raw Codex JSONL`.
- Codex scan/import is explicit thread archival over local transcript files. It is not a Codex pre-compact hook and must not be documented as automatic compression-time capture.

## HTTP And MCP Contract

- HTTP daemon: `mdx-cli serve --workspace <workspace> --port 14243`.
- Health endpoint reports top-level `ok`, `has_memory`, `can_initialize`, `mode`, `missing_paths`, and `workspace`.
- Memory daemon command: `mdx-cli memory --root <workspace> daemon --port 14243`.
- Memory daemon endpoints include `/health`, `/diagnostics`, `/hook/events`, `/memory/recall`, `/memory/add`, `/memory/search`, inbox review routes, capture routes, storage migration dry-run, and `/config/set`.
- MCP stdio server: `mdx-mcp --workspace <workspace>`.
- CLI, HTTP, MCP, and Tauri/UI call the same Memory facade and must not bypass locks or path guards.
- The Tauri/UI command surface must expose the same complete Memory capability set as the daemon facade, not only the subset currently used by the visible panel.

## Bundle Contract

- Export: `mdx-cli memory export --output <dir> [--include-log]`.
- Import: `mdx-cli memory import --input <dir> [--dry-run] [--strategy skip]`.
- Bundles include manifest, `memory/**`, required metadata, and optional `log.md`.
- Bundles do not include `.mdx/search.sqlite`; import/rebuild recreates the projection.
- Export/import must reject path traversal and unsafe symlink writes.
- Export and import must acquire the workspace memory lock. Export is a read snapshot, but it copies multiple source directories and must not run concurrently with multi-file memory mutations.

## Promote Contract

```bash
mdx-cli memory promote <thread_id|memory_id|path> [--ingest] [--title "..."]
```

1. Copy a thread or memory record to `raw/promoted/{date}-{slug}[-n].md` with provenance frontmatter.
2. Allocate promoted raw files with atomic create-new semantics; existing promoted files must not be overwritten by `memory promote`.
3. If `--ingest`, require an initialized LLM Wiki workspace before invoking ingest; otherwise fail with `llm_wiki_not_ready`.
4. Set thread `promoted_to_wiki: true` only after a thread copy succeeds and, when `--ingest` is set, ingest succeeds. Promoting a memory record does not mutate LLM Wiki state unless ingest succeeds.
5. Append `log.md` event `memory_promote` after successful promotion.
6. `MemoryPromoteResult.thread_path` is retained for wire compatibility and contains the promoted source path, which can be a thread path or memory record path.

## Config

Path: `.mdx/memory-config.json`

```json
{
  "version": 2,
  "memory": { "enabled": true },
  "storage": { "backend": "sqlite" },
  "projection": { "enabled": true },
  "agent_backend": {
    "enabled": true,
    "capture_enabled": false,
    "recall_injection_enabled": true,
    "distill_enabled": true,
    "auto_accept": false,
    "context_byte_budget": 4096
  },
  "agents": {
    "codex": { "enabled": false, "paused": false },
    "claude": { "enabled": false, "paused": false },
    "cursor": { "enabled": false, "paused": false }
  },
  "provider": { "mode": "reuse_llm" },
  "recall": {
    "default_limit": 10,
    "context_byte_budget": 65536,
    "half_life_days": 30,
    "embeddings": { "enabled": false }
  },
  "distill": {
    "enabled": false,
    "min_messages": 4,
    "skip_patterns": ["^Running terminal command"],
    "auto_accept": false,
    "confidence_threshold": 85
  },
  "capture": { "enabled": false, "sources": [] }
}
```

`memory recall` reads `.mdx/memory-config.json` for omitted `limit`, omitted `byte_budget`, and recency `half_life_days`.

Config fields use snake_case in JSON. Missing nested V2 fields use defaults. `confidence_threshold` is serialized as an integer percentage (`85` means 0.85).

## CLI Commands

| Command | Writes log.md | Notes |
|---|---|---|
| `memory init` | yes, `memory_init` | creates structure |
| `memory thread save` | yes, `thread_save` | idempotent by hash |
| `memory add` | yes | |
| `memory archive` | yes | soft delete |
| `memory working set/append` | yes | |
| `memory recall` | no | read-only |
| `memory search` | no | read-only |
| `memory inbox accept/reject` | yes | review candidate |
| `memory distill` | yes | may write inbox or active memory |
| `memory capture import` | yes | saves thread first |
| `memory index rebuild` | no | rebuildable projection |
| `memory promote` | yes | may trigger ingest |
| `memory export/import` | import only | portable bundle |
| `memory daemon` | no | local agent backend API |
| `memory hook` | yes, when capture writes | hook adapter entry point |
| `memory install/doctor/repair-agent/uninstall` | no | agent integration management |
| `memory migrate storage` | no for dry run | runtime DB migration |

## CLI Runtime

- `mdx-cli memory *` supports two runtimes:
  - Workspace Mode socket runtime against the current active root.
  - Explicit headless runtime via `mdx-cli memory --root <workspace> ...`.
- `--root` wins when both `--root` and a running GUI are present.
- `llm-wiki *` remains socket-only and targets the active Workspace Mode root.

## MCP Tools

| Tool | Maps to |
|---|---|
| `memory_status` | `memory status` |
| `memory_recall` | `memory recall` |
| `memory_add` | `memory add` |
| `memory_working_get` | `memory working get` |
| `memory_thread_save` | `memory thread save` |
| `memory_thread_show` | `memory thread show` |
| `memory_inbox_add` | Memory facade inbox candidate create; MCP-only in current CLI |
| `memory_inbox_list` | `memory inbox list` |
| `memory_inbox_accept` | `memory inbox accept` |
| `memory_distill` | `memory distill` |
| `memory_search` | `memory search` |
| `memory_promote` | `memory promote` |
| `memory_hook_status` | `memory doctor` |
| `memory_diagnostics` | `memory doctor --json` |

## Agent Session Startup (Recommended)

1. `memory_working_get`
2. `memory_recall` with task-related query
3. On completion: `memory_thread_save` (if full transcript available) + `memory_add` for durable takeaways

## Relationship to LLM Wiki

| User intent | Use |
|---|---|
| Quick context for coding agent | `memory recall` |
| Deep question over curated wiki | `llm-wiki query` |
| Preserve full chat | `memory thread save` |
| Turn chat into long-term knowledge pages | `memory promote [--ingest]` |
| Bulk document digestion | place in `raw/` + LLM Wiki ingest |
