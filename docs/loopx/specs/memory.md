# Memory Layer Workflow Contracts

> Memory 层与 LLM Wiki 层 **并列**。本文档只描述 Memory 层契约；Wiki 契约见 [llm-wiki.md](./llm-wiki.md)。

## Layers

| 层 | 路径 | 职责 |
|---|---|---|
| **Memory — Threads** | `memory/threads/` | 完整 AI 对话原文；Phase 1 按全量快照替换；Agent recall 默认 **不** 注入全文 |
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
5. Markdown 文件是 source of truth；`.mdx/search.sqlite` 是可选投影。

## Thread Contract

### Path

```
memory/threads/{source}/{yyyy-mm-dd}-{thread_id}.md
```

`source`: `cursor` | `claude-code` | `import` | `manual`

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

## Memory Contract

### Path

```
memory/memories/{yyyy-mm-dd}-{slug}.md
```

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
  "thread_ids": [],
  "tags": [],
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
  "threads": [],
  "truncated": false,
  "byte_count": 0
}
```

### Phase 1 Retrieval

- Scan `memory/memories/` with substring match + tag filter.
- Sort by score (importance × recency decay).
- Do **not** scan thread bodies unless `include_threads: true` and `thread_ids` is non-empty.

### Phase 2 Retrieval

- Add FTS5 from `.mdx/search.sqlite`; optional vector rerank.

## Promote Contract

```bash
mdx-cli memory promote --thread <thread_id|path> [--ingest] [--title "..."]
```

1. Copy thread to `raw/promoted/{date}-{slug}.md` with provenance frontmatter.
2. Set thread `promoted_to_wiki: true`.
3. If `--ingest`, require an initialized LLM Wiki workspace before invoking ingest; otherwise fail with `llm_wiki_not_ready`.
4. Append `log.md` event `memory_promote`.

## Config

Path: `.mdx/memory-config.json`

```json
{
  "version": 1,
  "recall": { "defaultLimit": 10, "contextByteBudget": 65536 },
  "distill": { "enabled": false, "minMessages": 4, "skipPatterns": [] },
  "capture": { "enabled": false, "sources": [] }
}
```

## CLI Commands (Phase 1)

| Command | Writes log.md | Notes |
|---|---|---|
| `memory init` | yes | creates structure |
| `memory thread save` | yes | idempotent by hash |
| `memory add` | yes | |
| `memory archive` | yes | soft delete |
| `memory working set/append` | yes | |
| `memory recall` | no | read-only |
| `memory search` | no | read-only |
| `memory promote` | yes | may trigger ingest |

## CLI Runtime

- `mdx-cli memory *` supports two runtimes:
  - Workspace Mode socket runtime against the current active root.
  - Explicit headless runtime via `mdx-cli memory --root <workspace> ...`.
- `--root` wins when both `--root` and a running GUI are present.
- `llm-wiki *` remains socket-only in Phase 1.

## MCP Tools (Phase 3)

| Tool | Maps to |
|---|---|
| `memory_recall` | `memory recall` |
| `memory_add` | `memory add` |
| `memory_working_get` | `memory working get` |
| `memory_thread_save` | `memory thread save` |
| `memory_thread_show` | `memory thread show` |
| `memory_search` | `memory search` |

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
