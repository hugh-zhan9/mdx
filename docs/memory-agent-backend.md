# MDX Memory Agent Backend

## Positioning

MDX Memory is a local-first memory backend for Codex, Claude, and Cursor. Agents reach it through hooks, the CLI, and MCP; the desktop panel is for review, correction, setup, and diagnostics.

The panel is not a secondary write path — it is where the one decision the agent cannot make gets made. An agent can store material and propose conclusions; only a person adopts one.

## Two layers

Material is what happened, stored verbatim with its source. Conclusions are what someone takes material to mean; they reference the material they rest on, start as candidates, and reach an agent's runtime context only after a human adopts them.

There is no holding area in front of the library. Material an agent stores is stored; the review that used to happen before a write now happens before a promotion, and it leaves an audit record of its own.

## Storage

One SQLite library at `~/.mdx/memory/palace.db` serves every workspace, keyed by project. There is no second backend and no Markdown projection. A library newer than the running application is refused rather than migrated, and an unwritable one disables memory without touching the editor.

## Embedding model

Every write embeds. Without the model at `~/.mdx/models/<slug>/`, writes and semantic search fail with `embedding_model_missing` — deliberately, rather than silently degrading to keyword-only ranking and filling the vector table with noise. Downloading is an explicit, user-confirmed action.

## Turning things off

Disabling a feature stops new writes for it. It never deletes what is already stored.

- Memory disabled: nothing is captured, queued, or spooled.
- Capture disabled, or an agent not listed in `capture.sources`: hooks return successfully and write nothing at all.
- Per-agent integration removed: that agent stops writing; its history stays.

Because capture cannot be undone after the fact, it is off by default and accepts only explicitly listed sources.

## Agent integrations

```bash
mdx-cli memory --root <workspace> install --agent codex   # or claude, cursor, or all
mdx-cli memory --root <workspace> doctor --agent codex --json
```

Hooks stay lightweight: they capture, optionally ask for context, and succeed even when the backend is degraded.

**Upgrading from the previous model requires reinstalling the skills.** The text installed on a machine before this change still instructs agents to call tools that no longer exist (`memory_working_get`, `memory_inbox_add`, `memory_thread_save`). Calling them now returns an unknown-tool error. The panel detects stale skill text and offers the repair.

## Tools an agent has

`memory_recall` for task context, `memory_search` / `memory_context` / `memory_brief` for narrower reads, `memory_add` to store material, `memory_distill` to propose a conclusion from stored material, `memory_gate` to see whether one could be adopted, `memory_adopt` to adopt it (ask the user first), `memory_show`, `memory_promote`, `memory_status`, `memory_hook_status`, `memory_diagnostics`.
