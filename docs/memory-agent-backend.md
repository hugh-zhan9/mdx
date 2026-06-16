# MDX Memory Agent Backend

## Positioning

MDX Memory is a local-first external memory backend for Codex, Claude, and Cursor. Agents use hooks, CLI, MCP, and local daemon APIs to recall, capture, and distill memory automatically.

The primary caller is the agent. The desktop UI is for inspection, review, correction, setup, and diagnostics; it is not the primary write path.

## Storage

SQLite is the default local runtime database. PostgreSQL is available for advanced service-style deployments. Markdown under `memory/**` is a readable projection and can be rebuilt from the database.

The runtime database is the source of truth in agent-backend mode. Markdown remains useful for human inspection, compatibility, import, and export, but DB records win when projection content disagrees.

## Hard Shutdown

Turning off a Memory feature stops new writes for that feature. It does not delete historical data.

Hard shutdown applies at the feature boundary:

- `memory.enabled=false` stops capture, queue writes, spool writes, recall injection, distill, and projection writes.
- Capture shutdown stops new event/session writes and fallback spool writes.
- Recall-injection shutdown still allows capture, but returns empty injected context.
- Projection shutdown stops new Markdown projection writes while preserving existing files.
- Per-agent shutdown stops that agent integration without removing historical records.

## Agent Integrations

Use `mdx-cli memory --root <workspace> install --agent codex`, `claude`, `cursor`, or omit `--agent` to configure all supported agents.

Useful checks:

```bash
mdx-cli memory --root <workspace> install --agent codex --dry-run
mdx-cli memory --root <workspace> doctor --agent codex --json
mdx-cli memory --root <workspace> daemon --port 14243
```

Hooks are intentionally lightweight. They call the local daemon, capture raw hook payloads, optionally request recall context, and return successfully even when the backend is degraded.

## Migration

Run a dry run before switching runtime storage:

```bash
mdx-cli memory --root <workspace> migrate storage \
  --to postgresql \
  --target <url> \
  --dry-run
```

SQLite and PostgreSQL are selectable runtime backends. Migration copies the runtime records and validates counts before the storage config is switched.

## Diagnostics

Use diagnostics to check daemon health, agent install status, queue pressure, spool backlog, projection state, and recent integration errors:

```bash
mdx-cli memory --root <workspace> doctor --json
```

The daemon also exposes `/health`, `/diagnostics`, `/hook/events`, recall, memory, inbox, capture, migration, and config routes for local automation.
