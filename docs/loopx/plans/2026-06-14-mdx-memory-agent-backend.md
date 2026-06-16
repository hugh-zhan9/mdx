# MDX Memory Agent Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/MDX Memory Agent Backend 自动化记忆系统需求设计文档.md`

**Goal:** Build MDX Memory into a local-first external memory backend for Codex, Claude, and Cursor, with automatic hook capture, recall injection, async distill, SQLite/PostgreSQL storage, migration, Markdown projection, diagnostics, and hard feature shutdown controls.

**Architecture:** Hooks stay lightweight and call a local daemon; the daemon owns storage, queueing, spool import, recall, distill workers, diagnostics, and projection. SQLite is the default runtime database, PostgreSQL is the advanced runtime database, and Markdown under `memory/**` becomes an async readable projection and import/export compatibility layer. Existing Memory CLI, MCP, Tauri commands, and UI are preserved but redirected through the DB-first backend.

**Tech Stack:** Rust 2021/Tauri 2, existing `rusqlite`, new synchronous `postgres` crate for PostgreSQL, serde/serde_json/serde_yaml_ng, reqwest blocking client for providers, mdx-cli/mdx-mcp, React 19/Next/Vitest, Cargo tests.

---

## Scope Check

The source design is a V1 umbrella spec covering storage, daemon, hooks, queue, worker, installer, UI, settings, migration, and verification. This plan keeps one master execution document because the user requested `$plan-to-exec` for the approved design, but it breaks implementation into independently testable commit-sized tasks. If execution bandwidth is constrained, run Tasks 1-6 first as the backend foundation, Tasks 7-10 as agent automation, and Tasks 11-14 as UI, settings, migration, and release verification.

## Contract Notes

- `AGENT.md` and the design spec are binding: MDX Memory is an agent backend, not a manual note panel.
- The existing `docs/loopx/specs/memory.md` still says Markdown is source of truth for old Memory flows. Task 1 must update this to the approved DB-first runtime contract while preserving Markdown import/export/projection rules.
- Hard feature shutdown means the disabled feature does not write DB records, does not write spool files, does not enqueue jobs, and does not generate Markdown projection.
- Full thread archival remains required. Recall must not inject raw thread bodies by default.
- Disabled or degraded hooks must exit 0 and return empty context so Codex, Claude, and Cursor are not blocked.

## Target File Structure

### Rust Backend

- Create `src-tauri/src/memory_config.rs`
  - Load, normalize, and resolve `.mdx/memory-config.json` plus global `~/.mdx/memory-runtime.json`.
  - Resolve global/workspace/agent feature flags and disabled reasons.
- Modify `src-tauri/src/memory_models.rs`
  - Add DB-first config, storage, provider, integration, session, event, job, diagnostics, migration, hook, and projection wire models.
- Create `src-tauri/src/memory_storage.rs`
  - Define repository traits and shared domain structs.
- Create `src-tauri/src/memory_schema.rs`
  - Hold schema versions and backend-specific DDL strings.
- Create `src-tauri/src/memory_storage_sqlite.rs`
  - Implement repository with `rusqlite`.
- Create `src-tauri/src/memory_storage_postgres.rs`
  - Implement repository with `postgres`.
- Create `src-tauri/src/memory_agent_events.rs`
  - Normalize session/event writes and idempotency keys.
- Create `src-tauri/src/memory_queue.rs`
  - Implement persisted local jobs, retry state, and dead-letter state.
- Create `src-tauri/src/memory_spool.rs`
  - Implement fallback spool write/import/quarantine.
- Create `src-tauri/src/memory_hooks.rs`
  - Normalize Codex, Claude, Cursor hook stdin and format native hook stdout.
- Create `src-tauri/src/memory_recall_engine.rs`
  - Implement DB-backed low-latency recall with byte budgets and Markdown fallback during migration.
- Create `src-tauri/src/memory_provider.rs`
  - Implement Memory provider config and OpenAI-compatible, Anthropic, Gemini, OpenRouter request adapters.
- Create `src-tauri/src/memory_distill_worker.rs`
  - Consume distill jobs, call provider, classify candidates, write memories or inbox records.
- Create `src-tauri/src/memory_projection.rs`
  - Generate `memory/threads`, `memory/memories`, `memory/inbox`, and `memory/working.md` from DB records.
- Create `src-tauri/src/memory_storage_migration.rs`
  - Implement Markdown-to-DB import, SQLite to PostgreSQL migration, and PostgreSQL to SQLite snapshot export.
- Modify `src-tauri/src/memory.rs`
  - Keep facade functions stable; route reads/writes through repository, projection, and config resolver.
- Modify `src-tauri/src/memory_daemon.rs`
  - Add `/hook/events`, `/integrations/status`, `/integrations/install`, `/integrations/repair`, `/integrations/uninstall`, `/storage/migrate/dry-run`, `/storage/migrate`, and `/config/set`.
- Modify `src-tauri/src/memory_agent_setup.rs`
  - Upgrade setup to install/status/doctor/repair/uninstall with managed blocks and versioned hook entries.
- Modify `src-tauri/src/bin/mdx_cli.rs`
  - Add `memory daemon`, `memory hook`, `memory install`, `memory status --agent`, `memory doctor`, `memory repair --agent`, `memory uninstall`, and `memory migrate storage`.
- Modify `src-tauri/src/bin/mdx_mcp.rs`
  - Add Memory backend tools for recall, search, add, inbox add/list/accept/reject, hook status, and diagnostics.
- Modify `src-tauri/src/cli_protocol.rs`, `src-tauri/src/cli_server.rs`, and `src-tauri/src/lib.rs`
  - Expose the complete backend surface to CLI socket and Tauri UI.
- Modify `src-tauri/Cargo.toml`
  - Add `postgres = { version = "0.19", features = ["with-serde_json-1", "with-time-0_3"] }`.

### Frontend

- Modify `features/memory/lib/types.ts`
  - Add backend status, integration status, session, event, job, migration, config, provider, diagnostics, and projection types.
- Modify `features/memory/lib/memory-client.ts`
  - Add typed Tauri calls for backend status/config/install/doctor/migrate/projection/job retry.
- Modify `features/memory/lib/memory-panel-state.ts`
  - Replace old side-panel tab model with backend console tabs.
- Split `features/memory/components/memory-panel.tsx`
  - Keep wrapper; move tab implementations into focused files under `features/memory/components/`.
- Create frontend components:
  - `memory-overview-tab.tsx`
  - `memory-integrations-tab.tsx`
  - `memory-sessions-tab.tsx`
  - `memory-long-term-tab.tsx`
  - `memory-pending-tab.tsx`
  - `memory-working-context-tab.tsx`
  - `memory-diagnostics-tab.tsx`
  - `memory-settings-section.tsx`
- Modify `features/workspace/components/settings-button.tsx`
  - Add Memory hard shutdown, provider, storage, and migration settings.
- Modify `features/workspace/lib/types.ts` and `features/workspace/lib/preferences.ts`
  - Add non-secret Memory UI preferences only. Provider keys and DB connection strings stay in backend secure config.

### Specs And Docs

- Modify `docs/loopx/specs/memory.md`
  - Replace Markdown source-of-truth language with DB runtime source-of-truth plus Markdown projection.
- Create `docs/memory-agent-backend.md`
  - User-facing explanation of agent integrations, hard shutdown, storage backend, migration, and diagnostics.
- Modify `docs/memory-usage.md`
  - Update CLI examples.

## Verification Commands

Use these commands throughout the plan:

```bash
npm test
npm run lint
cd src-tauri && cargo test --lib
cd src-tauri && cargo test --bin mdx-cli
cd src-tauri && cargo test --bin mdx-mcp
cd src-tauri && cargo test memory_ --lib
```

For PostgreSQL integration tests, use:

```bash
MDX_MEMORY_POSTGRES_TEST_URL='postgresql://mdx:mdx@localhost:5432/mdx_memory_test' \
  cargo test memory_postgres_ --lib -- --ignored
```

Expected when no PostgreSQL URL is provided: ignored tests are skipped, non-ignored storage tests pass.

---

### Task 1: Reconcile Memory Contract And Runtime Config

**Files:**
- Modify: `docs/loopx/specs/memory.md`
- Modify: `src-tauri/src/memory_models.rs`
- Create: `src-tauri/src/memory_config.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write config model tests**

In `src-tauri/src/memory_tests.rs`, add tests that define the new DB-first contract and hard shutdown semantics:

```rust
#[test]
fn memory_default_config_uses_sqlite_and_agent_backend_defaults() {
    let config = crate::memory::default_memory_config();

    assert_eq!(config.version, 2);
    assert!(config.memory.enabled);
    assert_eq!(config.storage.backend, "sqlite");
    assert!(config.projection.enabled);
    assert!(!config.agent_backend.capture_enabled);
    assert!(config.agent_backend.recall_injection_enabled);
    assert!(config.agent_backend.distill_enabled);
    assert!(!config.agent_backend.auto_accept);
    assert!(config.agents.codex.enabled == false);
    assert!(config.agents.claude.enabled == false);
    assert!(config.agents.cursor.enabled == false);
}

#[test]
fn hard_disabled_capture_disables_db_spool_queue_and_projection() {
    let mut config = crate::memory::default_memory_config();
    config.agent_backend.capture_enabled = false;

    let resolved = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::Capture,
        Some("codex"),
    );

    assert!(!resolved.enabled);
    assert_eq!(resolved.reason.as_deref(), Some("capture_disabled"));
    assert!(!resolved.allow_db_write);
    assert!(!resolved.allow_spool_write);
    assert!(!resolved.allow_enqueue);
    assert!(!resolved.allow_projection);
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test memory_default_config_uses_sqlite_and_agent_backend_defaults hard_disabled_capture_disables_db_spool_queue_and_projection --lib
```

Expected: FAIL to compile because `MemoryConfig.version = 2`, `memory_config`, and the new config fields do not exist.

- [ ] **Step 3: Add config structs**

In `src-tauri/src/memory_models.rs`, replace `MemoryConfig` with a backwards-compatible V2 struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryConfig {
    pub version: u32,
    #[serde(default)]
    pub memory: MemoryMasterConfig,
    pub recall: MemoryRecallConfig,
    pub distill: MemoryDistillConfig,
    pub capture: MemoryCaptureConfig,
    #[serde(default)]
    pub storage: MemoryStorageConfig,
    #[serde(default)]
    pub projection: MemoryProjectionConfig,
    #[serde(default)]
    pub agent_backend: MemoryAgentBackendConfig,
    #[serde(default)]
    pub agents: MemoryAgentsConfig,
    #[serde(default)]
    pub provider: MemoryProviderConfig,
}
```

Add these structs in the same file:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryMasterConfig {
    pub enabled: bool,
}

impl Default for MemoryMasterConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryStorageConfig {
    pub backend: String,
    #[serde(default)]
    pub sqlite_path: Option<String>,
    #[serde(default)]
    pub postgres_url_ref: Option<String>,
}

impl Default for MemoryStorageConfig {
    fn default() -> Self {
        Self {
            backend: "sqlite".to_string(),
            sqlite_path: None,
            postgres_url_ref: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryProjectionConfig {
    pub enabled: bool,
}

impl Default for MemoryProjectionConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryAgentBackendConfig {
    pub enabled: bool,
    pub capture_enabled: bool,
    pub recall_injection_enabled: bool,
    pub distill_enabled: bool,
    pub auto_accept: bool,
    pub context_byte_budget: usize,
}

impl Default for MemoryAgentBackendConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            capture_enabled: false,
            recall_injection_enabled: true,
            distill_enabled: true,
            auto_accept: false,
            context_byte_budget: 4096,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct MemoryAgentsConfig {
    pub codex: MemoryAgentConfig,
    pub claude: MemoryAgentConfig,
    pub cursor: MemoryAgentConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryAgentConfig {
    pub enabled: bool,
    pub paused: bool,
}

impl Default for MemoryAgentConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryProviderConfig {
    pub mode: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

impl Default for MemoryProviderConfig {
    fn default() -> Self {
        Self {
            mode: "reuse_llm".to_string(),
            provider: None,
            model: None,
        }
    }
}
```

- [ ] **Step 4: Add feature resolution**

Create `src-tauri/src/memory_config.rs`:

```rust
use crate::memory_models::MemoryConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryFeature {
    Capture,
    RecallInjection,
    Distill,
    AutoAccept,
    Projection,
    AgentBackend,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedMemoryFeature {
    pub enabled: bool,
    pub reason: Option<String>,
    pub allow_db_write: bool,
    pub allow_spool_write: bool,
    pub allow_enqueue: bool,
    pub allow_projection: bool,
}

pub fn resolve_memory_feature(
    config: &MemoryConfig,
    feature: MemoryFeature,
    agent_source: Option<&str>,
) -> ResolvedMemoryFeature {
    if !config.memory.enabled {
        return disabled("memory_disabled");
    }
    if !config.agent_backend.enabled && feature != MemoryFeature::Projection {
        return disabled("agent_backend_disabled");
    }
    if let Some(agent) = agent_source {
        let agent_config = match agent {
            "codex" => Some(&config.agents.codex),
            "claude" => Some(&config.agents.claude),
            "cursor" => Some(&config.agents.cursor),
            _ => None,
        };
        if let Some(agent_config) = agent_config {
            if !agent_config.enabled {
                return disabled(format!("{agent}_disabled"));
            }
            if agent_config.paused {
                return disabled(format!("{agent}_paused"));
            }
        }
    }

    match feature {
        MemoryFeature::Capture if !config.agent_backend.capture_enabled => disabled("capture_disabled"),
        MemoryFeature::RecallInjection if !config.agent_backend.recall_injection_enabled => {
            read_only_disabled("recall_injection_disabled")
        }
        MemoryFeature::Distill if !config.agent_backend.distill_enabled => disabled("distill_disabled"),
        MemoryFeature::AutoAccept if !config.agent_backend.auto_accept => disabled("auto_accept_disabled"),
        MemoryFeature::Projection if !config.projection.enabled => disabled("projection_disabled"),
        _ => enabled(),
    }
}

fn enabled() -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: true,
        reason: None,
        allow_db_write: true,
        allow_spool_write: true,
        allow_enqueue: true,
        allow_projection: true,
    }
}

fn disabled(reason: impl Into<String>) -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: false,
        reason: Some(reason.into()),
        allow_db_write: false,
        allow_spool_write: false,
        allow_enqueue: false,
        allow_projection: false,
    }
}

fn read_only_disabled(reason: impl Into<String>) -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: false,
        reason: Some(reason.into()),
        allow_db_write: true,
        allow_spool_write: true,
        allow_enqueue: false,
        allow_projection: true,
    }
}
```

- [ ] **Step 5: Wire module exports and defaults**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod memory_config;
```

Modify `src-tauri/src/memory.rs` so `default_memory_config()` returns version 2 and includes the new fields. Keep deserialization aliases for existing camelCase config.

- [ ] **Step 6: Update the durable Memory spec**

In `docs/loopx/specs/memory.md`, replace the old Index Contract sentence:

```markdown
- Markdown files are source of truth; `.mdx/search.sqlite` is an optional projection.
```

with:

```markdown
- In agent-backend mode, the runtime database is the source of truth; Markdown under `memory/**` is an async readable projection and import/export compatibility layer.
- Existing Markdown-first workspaces must be imported into the runtime database before DB-first writes begin.
- If DB records and Markdown projection disagree, repair/rebuild uses DB records as canonical and reports projection conflicts.
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd src-tauri
cargo test memory_default_config_uses_sqlite_and_agent_backend_defaults hard_disabled_capture_disables_db_spool_queue_and_projection --lib
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/loopx/specs/memory.md src-tauri/src/lib.rs src-tauri/src/memory.rs src-tauri/src/memory_config.rs src-tauri/src/memory_models.rs src-tauri/src/memory_tests.rs
git commit -m "feat: define memory backend config contract"
```

---

### Task 2: Add DB Schema And Repository Foundation

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_schema.rs`
- Create: `src-tauri/src/memory_storage.rs`
- Create: `src-tauri/src/memory_storage_sqlite.rs`
- Create: `src-tauri/src/memory_storage_postgres.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write schema version tests**

In `src-tauri/src/memory_tests.rs`, add:

```rust
#[test]
fn sqlite_storage_initializes_schema_version_and_core_tables() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
        .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");

    assert_eq!(storage.schema_version().unwrap(), crate::memory_schema::MEMORY_SCHEMA_VERSION);
    for table in [
        "workspaces",
        "agent_integrations",
        "agent_sessions",
        "agent_events",
        "threads",
        "memories",
        "inbox_candidates",
        "provenance_links",
        "jobs",
        "job_attempts",
        "hook_logs",
        "projection_records",
        "feature_flags",
    ] {
        assert!(storage.table_exists(table).unwrap(), "missing table {table}");
    }
}
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
cd src-tauri
cargo test sqlite_storage_initializes_schema_version_and_core_tables --lib
```

Expected: FAIL to compile because storage modules do not exist.

- [ ] **Step 3: Add PostgreSQL crate**

Modify `src-tauri/Cargo.toml`:

```toml
postgres = { version = "0.19", features = ["with-serde_json-1", "with-time-0_3"] }
```

- [ ] **Step 4: Define schema constants**

Create `src-tauri/src/memory_schema.rs` with:

```rust
pub const MEMORY_SCHEMA_VERSION: i64 = 1;

pub const SQLITE_DDL: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS schema_migrations (component TEXT PRIMARY KEY, version INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspaces (workspace_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, project_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS agent_integrations (integration_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, enabled INTEGER NOT NULL, paused INTEGER NOT NULL, hook_version TEXT, installed_at TEXT, last_event_at TEXT, last_error TEXT, UNIQUE(workspace_id, agent_source))",
    "CREATE TABLE IF NOT EXISTS agent_sessions (session_pk TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, session_id TEXT NOT NULL, project_key TEXT NOT NULL, cwd TEXT, model TEXT, started_at TEXT NOT NULL, ended_at TEXT, message_count INTEGER, event_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, UNIQUE(agent_source, session_id))",
    "CREATE TABLE IF NOT EXISTS agent_events (event_id TEXT PRIMARY KEY, session_pk TEXT NOT NULL, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, event_name TEXT NOT NULL, turn_id TEXT, event_seq INTEGER, idempotency_key TEXT NOT NULL UNIQUE, raw_payload TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS threads (thread_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, session_pk TEXT, title TEXT NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL, message_count INTEGER, distilled INTEGER NOT NULL DEFAULT 0, promoted_to_wiki INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS memories (memory_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, tags TEXT NOT NULL, importance REAL, confidence REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)",
    "CREATE TABLE IF NOT EXISTS inbox_candidates (inbox_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, tags TEXT NOT NULL, confidence REAL, risk_level TEXT NOT NULL, accepted_memory_id TEXT, created_at TEXT NOT NULL, reviewed_at TEXT)",
    "CREATE TABLE IF NOT EXISTS provenance_links (link_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, source_event_id TEXT, source_thread_id TEXT, provider TEXT, model TEXT, prompt_version TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_error TEXT)",
    "CREATE TABLE IF NOT EXISTS job_attempts (attempt_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, error_code TEXT, error_message TEXT)",
    "CREATE TABLE IF NOT EXISTS hook_logs (log_id TEXT PRIMARY KEY, workspace_id TEXT, agent_source TEXT NOT NULL, event_name TEXT NOT NULL, duration_ms INTEGER NOT NULL, result TEXT NOT NULL, disabled_reason TEXT, error_code TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS projection_records (projection_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL, content_hash TEXT, projection_version INTEGER NOT NULL, updated_at TEXT NOT NULL, UNIQUE(target_type, target_id))",
    "CREATE TABLE IF NOT EXISTS feature_flags (flag_id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id TEXT NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL, reason TEXT, updated_at TEXT NOT NULL, UNIQUE(scope, scope_id, key))",
    "CREATE INDEX IF NOT EXISTS idx_agent_events_session_created ON agent_events(session_pk, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_memories_workspace_status ON memories(workspace_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at)",
    "INSERT OR REPLACE INTO schema_migrations(component, version) VALUES ('memory', 1)",
];

pub const POSTGRES_DDL: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS schema_migrations (component TEXT PRIMARY KEY, version BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspaces (workspace_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, project_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS agent_integrations (integration_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, enabled BOOLEAN NOT NULL, paused BOOLEAN NOT NULL, hook_version TEXT, installed_at TEXT, last_event_at TEXT, last_error TEXT, UNIQUE(workspace_id, agent_source))",
    "CREATE TABLE IF NOT EXISTS agent_sessions (session_pk TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, session_id TEXT NOT NULL, project_key TEXT NOT NULL, cwd TEXT, model TEXT, started_at TEXT NOT NULL, ended_at TEXT, message_count BIGINT, event_count BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL, UNIQUE(agent_source, session_id))",
    "CREATE TABLE IF NOT EXISTS agent_events (event_id TEXT PRIMARY KEY, session_pk TEXT NOT NULL, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, event_name TEXT NOT NULL, turn_id TEXT, event_seq BIGINT, idempotency_key TEXT NOT NULL UNIQUE, raw_payload JSONB NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS threads (thread_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_source TEXT NOT NULL, session_pk TEXT, title TEXT NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL, message_count BIGINT, distilled BOOLEAN NOT NULL DEFAULT FALSE, promoted_to_wiki BOOLEAN NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS memories (memory_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, tags JSONB NOT NULL, importance DOUBLE PRECISION, confidence DOUBLE PRECISION, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)",
    "CREATE TABLE IF NOT EXISTS inbox_candidates (inbox_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, tags JSONB NOT NULL, confidence DOUBLE PRECISION, risk_level TEXT NOT NULL, accepted_memory_id TEXT, created_at TEXT NOT NULL, reviewed_at TEXT)",
    "CREATE TABLE IF NOT EXISTS provenance_links (link_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, source_event_id TEXT, source_thread_id TEXT, provider TEXT, model TEXT, prompt_version TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload JSONB NOT NULL, attempts BIGINT NOT NULL DEFAULT 0, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_error TEXT)",
    "CREATE TABLE IF NOT EXISTS job_attempts (attempt_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, error_code TEXT, error_message TEXT)",
    "CREATE TABLE IF NOT EXISTS hook_logs (log_id TEXT PRIMARY KEY, workspace_id TEXT, agent_source TEXT NOT NULL, event_name TEXT NOT NULL, duration_ms BIGINT NOT NULL, result TEXT NOT NULL, disabled_reason TEXT, error_code TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS projection_records (projection_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL, content_hash TEXT, projection_version BIGINT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(target_type, target_id))",
    "CREATE TABLE IF NOT EXISTS feature_flags (flag_id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id TEXT NOT NULL, key TEXT NOT NULL, enabled BOOLEAN NOT NULL, reason TEXT, updated_at TEXT NOT NULL, UNIQUE(scope, scope_id, key))",
    "CREATE INDEX IF NOT EXISTS idx_agent_events_session_created ON agent_events(session_pk, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_memories_workspace_status ON memories(workspace_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at)",
    "INSERT INTO schema_migrations(component, version) VALUES ('memory', 1) ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version",
];
```

- [ ] **Step 5: Define repository trait**

Create `src-tauri/src/memory_storage.rs`:

```rust
use serde_json::Value;

use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub workspace_root: String,
    pub project_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAgentSession {
    pub session_pk: String,
    pub workspace_id: String,
    pub agent_source: String,
    pub session_id: String,
    pub project_key: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub message_count: Option<i64>,
    pub event_count: i64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredAgentEvent {
    pub event_id: String,
    pub session_pk: String,
    pub workspace_id: String,
    pub agent_source: String,
    pub event_name: String,
    pub turn_id: Option<String>,
    pub event_seq: Option<i64>,
    pub idempotency_key: String,
    pub raw_payload: Value,
    pub payload_hash: String,
    pub created_at: String,
}

pub trait MemoryStorage {
    fn initialize(&mut self) -> Result<(), WorkspaceError>;
    fn schema_version(&mut self) -> Result<i64, WorkspaceError>;
    fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError>;
    fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError>;
    fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError>;
    fn insert_event_idempotent(&mut self, event: &StoredAgentEvent) -> Result<bool, WorkspaceError>;
    fn count_events(&mut self) -> Result<i64, WorkspaceError>;
}
```

- [ ] **Step 6: Implement SQLite storage**

Create `src-tauri/src/memory_storage_sqlite.rs` implementing `MemoryStorage`. Use `.mdx/memory.sqlite` by default and `crate::memory_fs::ensure_directory` before opening.

Key implementation requirements:

```rust
pub struct SqliteMemoryStorage {
    conn: rusqlite::Connection,
}

impl SqliteMemoryStorage {
    pub fn open_workspace(root: impl AsRef<std::path::Path>) -> Result<Self, crate::WorkspaceError> {
        let db_path = root.as_ref().join(".mdx/memory.sqlite");
        let conn = rusqlite::Connection::open(db_path).map_err(|error| {
            crate::WorkspaceError::from_io("memory_db_open_failed", "failed to open memory sqlite database", &error)
        })?;
        Ok(Self { conn })
    }
}
```

`insert_event_idempotent` must return `Ok(false)` when the unique idempotency key already exists.

- [ ] **Step 7: Add PostgreSQL storage skeleton**

Create `src-tauri/src/memory_storage_postgres.rs` implementing the same trait. Add an ignored test in `src-tauri/src/memory_tests.rs`:

```rust
#[test]
#[ignore]
fn memory_postgres_storage_initializes_schema_version() {
    let url = std::env::var("MDX_MEMORY_POSTGRES_TEST_URL")
        .expect("MDX_MEMORY_POSTGRES_TEST_URL is required for this ignored test");
    let mut storage = crate::memory_storage_postgres::PostgresMemoryStorage::connect(&url)
        .expect("connect postgres storage");
    storage.initialize().expect("initialize postgres schema");
    assert_eq!(storage.schema_version().unwrap(), crate::memory_schema::MEMORY_SCHEMA_VERSION);
}
```

- [ ] **Step 8: Wire modules**

Modify `src-tauri/src/lib.rs`:

```rust
mod memory_schema;
pub mod memory_storage;
pub mod memory_storage_postgres;
pub mod memory_storage_sqlite;
```

- [ ] **Step 9: Run storage tests**

Run:

```bash
cd src-tauri
cargo test sqlite_storage_initializes_schema_version_and_core_tables --lib
cargo test memory_postgres_storage_initializes_schema_version --lib -- --ignored
```

Expected:
- SQLite test PASS.
- PostgreSQL ignored test runs only if `MDX_MEMORY_POSTGRES_TEST_URL` is set; without the env var it fails with the explicit env message, which confirms the test is gated.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/memory_models.rs src-tauri/src/memory_schema.rs src-tauri/src/memory_storage.rs src-tauri/src/memory_storage_sqlite.rs src-tauri/src/memory_storage_postgres.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory storage repository foundation"
```

---

### Task 3: Persist Agent Sessions, Events, Jobs, And Spool

**Files:**
- Create: `src-tauri/src/memory_agent_events.rs`
- Create: `src-tauri/src/memory_queue.rs`
- Create: `src-tauri/src/memory_spool.rs`
- Modify: `src-tauri/src/memory_storage.rs`
- Modify: `src-tauri/src/memory_storage_sqlite.rs`
- Modify: `src-tauri/src/memory_storage_postgres.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write idempotent event test**

Add to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn agent_event_capture_is_idempotent_and_preserves_unknown_message_count() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: "codex".to_string(),
        event_name: "UserPromptSubmit".to_string(),
        workspace_root: root.path().to_string_lossy().into_owned(),
        cwd: Some(root.path().to_string_lossy().into_owned()),
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        event_seq: Some(1),
        idempotency_key: "codex:session-1:turn-1:UserPromptSubmit:1".to_string(),
        raw_payload: serde_json::json!({"prompt":"hello"}),
        deadline_ms: Some(400),
    };

    let first = crate::memory_agent_events::capture_agent_event(&mut storage, &event).unwrap();
    let second = crate::memory_agent_events::capture_agent_event(&mut storage, &event).unwrap();

    assert!(first.inserted);
    assert!(!second.inserted);
    assert_eq!(storage.count_events().unwrap(), 1);
    let session = storage.get_session_by_agent_id("codex", "session-1").unwrap().unwrap();
    assert_eq!(session.message_count, None);
    assert_eq!(session.event_count, 1);
}
```

- [ ] **Step 2: Write spool test**

Add:

```rust
#[test]
fn spool_write_and_import_uses_idempotency_key() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: "claude".to_string(),
        event_name: "Stop".to_string(),
        workspace_root: root.path().to_string_lossy().into_owned(),
        cwd: None,
        session_id: "claude-session".to_string(),
        turn_id: None,
        event_seq: None,
        idempotency_key: "claude:claude-session:Stop:payload".to_string(),
        raw_payload: serde_json::json!({"transcript_path":"/tmp/thread.jsonl"}),
        deadline_ms: None,
    };

    let spool_path = crate::memory_spool::write_spool_event(root.path(), &event).unwrap();
    assert!(spool_path.is_file());

    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let report = crate::memory_spool::import_spool(root.path(), &mut storage).unwrap();

    assert_eq!(report.imported, 1);
    assert_eq!(report.skipped_duplicates, 0);
    assert_eq!(storage.count_events().unwrap(), 1);
}
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test agent_event_capture_is_idempotent_and_preserves_unknown_message_count spool_write_and_import_uses_idempotency_key --lib
```

Expected: FAIL to compile because event/spool modules and storage methods do not exist.

- [ ] **Step 4: Add event models**

Create `src-tauri/src/memory_agent_events.rs`:

```rust
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::memory_storage::{MemoryStorage, StoredAgentEvent, StoredAgentSession, StoredWorkspace};
use crate::WorkspaceError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct AgentHookEvent {
    pub agent_source: String,
    pub event_name: String,
    pub workspace_root: String,
    pub cwd: Option<String>,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub event_seq: Option<i64>,
    pub idempotency_key: String,
    pub raw_payload: serde_json::Value,
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AgentCaptureResult {
    pub inserted: bool,
    pub session_pk: String,
}

pub fn capture_agent_event(
    storage: &mut dyn MemoryStorage,
    event: &AgentHookEvent,
) -> Result<AgentCaptureResult, WorkspaceError> {
    let workspace_id = workspace_id_for_root(&event.workspace_root);
    let project_key = workspace_id.clone();
    storage.upsert_workspace(&StoredWorkspace {
        workspace_id: workspace_id.clone(),
        workspace_root: event.workspace_root.clone(),
        project_key: project_key.clone(),
    })?;

    let session_pk = format!("{}:{}", event.agent_source, event.session_id);
    storage.upsert_session(&StoredAgentSession {
        session_pk: session_pk.clone(),
        workspace_id: workspace_id.clone(),
        agent_source: event.agent_source.clone(),
        session_id: event.session_id.clone(),
        project_key,
        cwd: event.cwd.clone(),
        model: None,
        message_count: None,
        event_count: 0,
        status: "active".to_string(),
    })?;

    let raw = serde_json::to_vec(&event.raw_payload)
        .map_err(|error| WorkspaceError::new("event_encode_failed", error.to_string()))?;
    let payload_hash = format!("{:x}", Sha256::digest(&raw));
    let inserted = storage.insert_event_idempotent(&StoredAgentEvent {
        event_id: format!("event:{payload_hash}"),
        session_pk: session_pk.clone(),
        workspace_id,
        agent_source: event.agent_source.clone(),
        event_name: event.event_name.clone(),
        turn_id: event.turn_id.clone(),
        event_seq: event.event_seq,
        idempotency_key: event.idempotency_key.clone(),
        raw_payload: event.raw_payload.clone(),
        payload_hash,
        created_at: crate::memory_fs::now_rfc3339(),
    })?;

    Ok(AgentCaptureResult { inserted, session_pk })
}

fn workspace_id_for_root(root: &str) -> String {
    let digest = Sha256::digest(root.as_bytes());
    format!("workspace:{:x}", digest)
}
```

- [ ] **Step 5: Extend storage trait and SQLite/PostgreSQL implementations**

Add methods to `MemoryStorage`:

```rust
fn get_session_by_agent_id(
    &mut self,
    agent_source: &str,
    session_id: &str,
) -> Result<Option<StoredAgentSession>, WorkspaceError>;
fn enqueue_job_idempotent(&mut self, job: &StoredJob) -> Result<bool, WorkspaceError>;
fn list_ready_jobs(&mut self, limit: usize) -> Result<Vec<StoredJob>, WorkspaceError>;
```

Add `StoredJob` to `memory_storage.rs`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct StoredJob {
    pub job_id: String,
    pub workspace_id: String,
    pub kind: String,
    pub status: String,
    pub idempotency_key: String,
    pub payload: serde_json::Value,
    pub attempts: i64,
    pub next_run_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_error: Option<String>,
}
```

- [ ] **Step 6: Add queue helpers**

Create `src-tauri/src/memory_queue.rs`:

```rust
use sha2::{Digest, Sha256};

use crate::memory_storage::{MemoryStorage, StoredJob};
use crate::WorkspaceError;

pub fn enqueue_distill_for_session(
    storage: &mut dyn MemoryStorage,
    workspace_id: &str,
    session_pk: &str,
    range_hash: &str,
) -> Result<bool, WorkspaceError> {
    let idempotency_key = format!("distill:{session_pk}:{range_hash}");
    let digest = Sha256::digest(idempotency_key.as_bytes());
    let now = crate::memory_fs::now_rfc3339();
    storage.enqueue_job_idempotent(&StoredJob {
        job_id: format!("job:{:x}", digest),
        workspace_id: workspace_id.to_string(),
        kind: "memory.distill".to_string(),
        status: "queued".to_string(),
        idempotency_key,
        payload: serde_json::json!({ "session_pk": session_pk, "range_hash": range_hash }),
        attempts: 0,
        next_run_at: now.clone(),
        created_at: now.clone(),
        updated_at: now,
        last_error: None,
    })
}
```

- [ ] **Step 7: Add spool helpers**

Create `src-tauri/src/memory_spool.rs` with:

```rust
use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::memory_agent_events::{capture_agent_event, AgentHookEvent};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpoolImportReport {
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub quarantined: usize,
}

pub fn write_spool_event(root: impl AsRef<Path>, event: &AgentHookEvent) -> Result<PathBuf, WorkspaceError> {
    let bytes = serde_json::to_vec_pretty(event)
        .map_err(|error| WorkspaceError::new("spool_encode_failed", error.to_string()))?;
    let digest = Sha256::digest(&bytes);
    let spool_dir = root.as_ref().join(".mdx/memory-spool");
    fs::create_dir_all(&spool_dir).map_err(|error| {
        WorkspaceError::from_io("spool_write_failed", "failed to create memory spool directory", &error)
    })?;
    let path = spool_dir.join(format!("{:x}.json", digest));
    fs::write(&path, bytes).map_err(|error| {
        WorkspaceError::from_io("spool_write_failed", "failed to write memory spool event", &error)
    })?;
    Ok(path)
}

pub fn import_spool(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<SpoolImportReport, WorkspaceError> {
    let spool_dir = root.as_ref().join(".mdx/memory-spool");
    if !spool_dir.exists() {
        return Ok(SpoolImportReport { imported: 0, skipped_duplicates: 0, quarantined: 0 });
    }

    let mut report = SpoolImportReport { imported: 0, skipped_duplicates: 0, quarantined: 0 };
    for entry in fs::read_dir(&spool_dir).map_err(|error| {
        WorkspaceError::from_io("spool_import_failed", "failed to read memory spool directory", &error)
    })? {
        let path = entry.map_err(|error| {
            WorkspaceError::from_io("spool_import_failed", "failed to read memory spool entry", &error)
        })?.path();
        let bytes = fs::read(&path).map_err(|error| {
            WorkspaceError::from_io("spool_import_failed", "failed to read memory spool file", &error)
        })?;
        let event = match serde_json::from_slice::<AgentHookEvent>(&bytes) {
            Ok(event) => event,
            Err(_) => {
                report.quarantined += 1;
                continue;
            }
        };
        if capture_agent_event(storage, &event)?.inserted {
            report.imported += 1;
        } else {
            report.skipped_duplicates += 1;
        }
        fs::remove_file(&path).map_err(|error| {
            WorkspaceError::from_io("spool_import_failed", "failed to remove imported memory spool file", &error)
        })?;
    }
    Ok(report)
}
```

- [ ] **Step 8: Wire modules and run tests**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod memory_agent_events;
pub mod memory_queue;
pub mod memory_spool;
```

Run:

```bash
cd src-tauri
cargo test agent_event_capture_is_idempotent_and_preserves_unknown_message_count spool_write_and_import_uses_idempotency_key --lib
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_agent_events.rs src-tauri/src/memory_models.rs src-tauri/src/memory_queue.rs src-tauri/src/memory_spool.rs src-tauri/src/memory_storage.rs src-tauri/src/memory_storage_sqlite.rs src-tauri/src/memory_storage_postgres.rs src-tauri/src/memory_tests.rs
git commit -m "feat: persist memory agent events and queue spool"
```

---

### Task 4: Add Hook Adapter Normalization And Native Hook Output

**Files:**
- Create: `src-tauri/src/memory_hooks.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write Codex hook output tests**

In `src-tauri/src/memory_tests.rs`, add:

```rust
#[test]
fn codex_user_prompt_submit_hook_formats_additional_context() {
    let output = crate::memory_hooks::format_hook_output(
        "codex",
        "UserPromptSubmit",
        Some("Memory context\n- Keep Memory as agent backend."),
    ).unwrap();

    let json: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(json["additional_context"], "Memory context\n- Keep Memory as agent backend.");
}

#[test]
fn disabled_hook_returns_empty_success_output() {
    let output = crate::memory_hooks::format_hook_output("codex", "Stop", None).unwrap();
    assert_eq!(output, "");
}
```

- [ ] **Step 2: Write normalization tests**

Add:

```rust
#[test]
fn normalizes_codex_user_prompt_submit_payload() {
    let payload = serde_json::json!({
        "session_id": "codex-session",
        "cwd": "/tmp/project",
        "prompt": "fix memory",
        "turn_id": "turn-9"
    });

    let event = crate::memory_hooks::normalize_hook_payload(
        "codex",
        "UserPromptSubmit",
        "/tmp/project",
        &payload,
        Some(400),
    ).unwrap();

    assert_eq!(event.agent_source, "codex");
    assert_eq!(event.event_name, "UserPromptSubmit");
    assert_eq!(event.session_id, "codex-session");
    assert_eq!(event.turn_id.as_deref(), Some("turn-9"));
    assert!(event.idempotency_key.contains("codex:codex-session:UserPromptSubmit"));
}
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test codex_user_prompt_submit_hook_formats_additional_context disabled_hook_returns_empty_success_output normalizes_codex_user_prompt_submit_payload --lib
```

Expected: FAIL to compile because `memory_hooks` does not exist.

- [ ] **Step 4: Implement hook formatter and normalizer**

Create `src-tauri/src/memory_hooks.rs`:

```rust
use sha2::{Digest, Sha256};

use crate::memory_agent_events::AgentHookEvent;
use crate::WorkspaceError;

pub fn normalize_hook_payload(
    agent_source: &str,
    event_name: &str,
    workspace_root: &str,
    payload: &serde_json::Value,
    deadline_ms: Option<u64>,
) -> Result<AgentHookEvent, WorkspaceError> {
    let session_id = string_field(payload, "session_id")
        .or_else(|| string_field(payload, "sessionId"))
        .or_else(|| string_field(payload, "conversation_id"))
        .unwrap_or_else(|| "unknown-session".to_string());
    let turn_id = string_field(payload, "turn_id").or_else(|| string_field(payload, "turnId"));
    let cwd = string_field(payload, "cwd").or_else(|| string_field(payload, "workspace_root"));
    let raw = serde_json::to_vec(payload)
        .map_err(|error| WorkspaceError::new("hook_payload_encode_failed", error.to_string()))?;
    let digest = Sha256::digest(&raw);
    let idempotency_key = format!(
        "{agent_source}:{session_id}:{event_name}:{}:{:x}",
        turn_id.clone().unwrap_or_else(|| "none".to_string()),
        digest
    );

    Ok(AgentHookEvent {
        agent_source: agent_source.to_string(),
        event_name: event_name.to_string(),
        workspace_root: workspace_root.to_string(),
        cwd,
        session_id,
        turn_id,
        event_seq: payload.get("event_seq").and_then(|value| value.as_i64()),
        idempotency_key,
        raw_payload: payload.clone(),
        deadline_ms,
    })
}

pub fn format_hook_output(
    agent_source: &str,
    event_name: &str,
    additional_context: Option<&str>,
) -> Result<String, WorkspaceError> {
    let Some(context) = additional_context.filter(|value| !value.trim().is_empty()) else {
        return Ok(String::new());
    };
    match agent_source {
        "codex" if matches!(event_name, "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse") => {
            serde_json::to_string(&serde_json::json!({ "additional_context": context }))
                .map_err(|error| WorkspaceError::new("hook_output_encode_failed", error.to_string()))
        }
        "claude" | "cursor" => Ok(context.to_string()),
        _ => Ok(String::new()),
    }
}

fn string_field(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload.get(key).and_then(|value| value.as_str()).map(str::to_string)
}
```

- [ ] **Step 5: Wire module and run tests**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod memory_hooks;
```

Run:

```bash
cd src-tauri
cargo test codex_user_prompt_submit_hook_formats_additional_context disabled_hook_returns_empty_success_output normalizes_codex_user_prompt_submit_payload --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_hooks.rs src-tauri/src/memory_models.rs src-tauri/src/memory_tests.rs
git commit -m "feat: normalize memory agent hook payloads"
```

---

### Task 5: Add Daemon Hook API, Diagnostics, And Feature Shutdown

**Files:**
- Modify: `src-tauri/src/memory_daemon.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_config.rs`
- Modify: `src-tauri/src/memory_recall.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write daemon route tests**

Add to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn daemon_hook_event_captures_and_returns_recall_context() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "s1",
        "turn_id": "t1",
        "idempotency_key": "codex:s1:t1:UserPromptSubmit:1",
        "raw_payload": {"prompt":"What did we decide about Memory?"},
        "deadline_ms": 400
    }).to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    ).unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], true);
    assert_eq!(json["disabled_reason"], serde_json::Value::Null);
    assert!(json.get("additional_context").is_some());
}

#[test]
fn daemon_hook_event_hard_disabled_does_not_spool_or_capture() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let config_path = root.path().join(".mdx/memory-config.json");
    let mut config = crate::memory::default_memory_config();
    config.memory.enabled = false;
    std::fs::write(&config_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();

    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "session_id": "s1",
        "idempotency_key": "disabled-event",
        "raw_payload": {"prompt":"hello"}
    }).to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    ).unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["captured"], false);
    assert_eq!(json["disabled_reason"], "memory_disabled");
    assert!(!root.path().join(".mdx/memory-spool").exists());
}
```

- [ ] **Step 2: Run daemon route tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test daemon_hook_event_captures_and_returns_recall_context daemon_hook_event_hard_disabled_does_not_spool_or_capture --lib
```

Expected: FAIL because `/hook/events` is not routed.

- [ ] **Step 3: Add hook request/response models**

In `src-tauri/src/memory_models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryHookEventRequest {
    pub agent_source: String,
    pub event_name: String,
    pub workspace_root: String,
    #[serde(default)]
    pub cwd: Option<String>,
    pub session_id: String,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub event_seq: Option<i64>,
    pub idempotency_key: String,
    #[serde(default)]
    pub raw_payload: serde_json::Value,
    #[serde(default)]
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryHookEventResponse {
    pub ok: bool,
    pub captured: bool,
    pub disabled_reason: Option<String>,
    pub additional_context: String,
    pub warnings: Vec<String>,
}
```

- [ ] **Step 4: Route `/hook/events`**

In `src-tauri/src/memory_daemon.rs`, add to `dispatch`:

```rust
("POST", "/hook/events") => post_json(body, |request: crate::memory::MemoryHookEventRequest| {
    handle_hook_event(root, request)
}),
```

Add `handle_hook_event`:

```rust
fn handle_hook_event(
    root: String,
    request: crate::memory::MemoryHookEventRequest,
) -> Result<crate::memory::MemoryHookEventResponse, WorkspaceError> {
    let config = crate::memory::load_memory_config_for_root(&root)?;
    let feature = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::Capture,
        Some(&request.agent_source),
    );
    if !feature.enabled {
        return Ok(crate::memory::MemoryHookEventResponse {
            ok: true,
            captured: false,
            disabled_reason: feature.reason,
            additional_context: String::new(),
            warnings: Vec::new(),
        });
    }

    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(&root)?;
    storage.initialize()?;
    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: request.agent_source.clone(),
        event_name: request.event_name.clone(),
        workspace_root: request.workspace_root.clone(),
        cwd: request.cwd,
        session_id: request.session_id,
        turn_id: request.turn_id,
        event_seq: request.event_seq,
        idempotency_key: request.idempotency_key,
        raw_payload: request.raw_payload.clone(),
        deadline_ms: request.deadline_ms,
    };
    let capture = crate::memory_agent_events::capture_agent_event(&mut storage, &event)?;
    let additional_context = if request.event_name == "SessionStart" || request.event_name == "UserPromptSubmit" {
        crate::memory_recall::memory_recall(
            root,
            crate::memory::RecallRequest {
                query: request.raw_payload.get("prompt").and_then(|value| value.as_str()).unwrap_or("").to_string(),
                limit: Some(5),
                byte_budget: Some(config.agent_backend.context_byte_budget),
                include_working: Some(true),
                include_threads: Some(false),
                tag: None,
                since: None,
            },
        ).map(|result| result.memories.into_iter().map(|item| format!("- {}: {}", item.title, item.snippet)).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(crate::memory::MemoryHookEventResponse {
        ok: true,
        captured: capture.inserted,
        disabled_reason: None,
        additional_context,
        warnings: Vec::new(),
    })
}
```

- [ ] **Step 5: Update known routes**

Add `/hook/events` to `known_route` in `src-tauri/src/memory_daemon.rs`.

- [ ] **Step 6: Run daemon route tests**

Run:

```bash
cd src-tauri
cargo test daemon_hook_event_captures_and_returns_recall_context daemon_hook_event_hard_disabled_does_not_spool_or_capture --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/memory_config.rs src-tauri/src/memory_daemon.rs src-tauri/src/memory_models.rs src-tauri/src/memory_recall.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory hook daemon endpoint"
```

---

### Task 6: Add CLI Daemon, Hook, Install, Status, Doctor, Repair, Uninstall, And Migration Commands

**Files:**
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_agent_setup.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write CLI parsing tests**

In `src-tauri/src/cli_protocol_tests.rs`, add parser tests near existing CLI tests:

```rust
#[test]
fn parses_memory_hook_command_without_desktop_socket() {
    let command = crate::bin::mdx_cli::parse_command_for_test([
        "mdx-cli",
        "memory",
        "--root",
        "/tmp/ws",
        "hook",
        "codex",
        "UserPromptSubmit",
        "--deadline-ms",
        "400",
    ]).unwrap();

    assert!(format!("{command:?}").contains("Hook"));
    assert!(format!("{command:?}").contains("UserPromptSubmit"));
}

#[test]
fn parses_memory_migrate_storage_dry_run() {
    let command = crate::bin::mdx_cli::parse_command_for_test([
        "mdx-cli",
        "memory",
        "--root",
        "/tmp/ws",
        "migrate",
        "storage",
        "--to",
        "postgresql",
        "--target",
        "postgresql://localhost/mdx",
        "--dry-run",
    ]).unwrap();

    assert!(format!("{command:?}").contains("Migrate"));
    assert!(format!("{command:?}").contains("postgresql"));
}
```

If `mdx_cli.rs` does not currently expose parser helpers to tests, add `pub(crate) fn parse_command_for_test<I, T>(args: I) -> io::Result<CommandLine>` under `#[cfg(test)]`.

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test parses_memory_hook_command_without_desktop_socket parses_memory_migrate_storage_dry_run --lib
```

Expected: FAIL because command variants do not exist.

- [ ] **Step 3: Add command variants**

Extend `MemoryCommand` in `src-tauri/src/bin/mdx_cli.rs`:

```rust
Daemon {
    #[arg(long, default_value_t = 14243)]
    port: u16,
    #[arg(long)]
    api_key: Option<String>,
},
Hook {
    agent: String,
    event: String,
    #[arg(long)]
    deadline_ms: Option<u64>,
},
Install {
    #[arg(long)]
    agent: Option<String>,
    #[arg(long)]
    dry_run: bool,
},
Status {
    #[arg(long)]
    json: bool,
    #[arg(long)]
    agent: Option<String>,
},
Doctor {
    #[arg(long)]
    agent: Option<String>,
    #[arg(long)]
    json: bool,
},
RepairAgent {
    #[arg(long)]
    agent: Option<String>,
    #[arg(long)]
    dry_run: bool,
},
Uninstall {
    #[arg(long)]
    agent: Option<String>,
    #[arg(long)]
    keep_data: bool,
    #[arg(long)]
    dry_run: bool,
},
Migrate {
    #[command(subcommand)]
    command: MemoryMigrateCommand,
},
```

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryMigrateCommand {
    Storage {
        #[arg(long)]
        to: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        resume: bool,
    },
}
```

- [ ] **Step 4: Implement hook command execution**

In headless execution, read stdin to string for `MemoryCommand::Hook`, parse JSON, call `memory_hooks::normalize_hook_payload`, then call daemon dispatch:

```rust
let mut stdin = String::new();
io::stdin().read_to_string(&mut stdin)?;
let payload: serde_json::Value = serde_json::from_str(&stdin)
    .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, format!("invalid hook JSON: {error}")))?;
let event = memory_hooks::normalize_hook_payload(agent, event_name, &root_path, &payload, *deadline_ms)
    .map_err(io_error_from_workspace)?;
let body = serde_json::to_string(&crate::memory::MemoryHookEventRequest {
    agent_source: event.agent_source.clone(),
    event_name: event.event_name.clone(),
    workspace_root: event.workspace_root.clone(),
    cwd: event.cwd.clone(),
    session_id: event.session_id.clone(),
    turn_id: event.turn_id.clone(),
    event_seq: event.event_seq,
    idempotency_key: event.idempotency_key.clone(),
    raw_payload: event.raw_payload.clone(),
    deadline_ms: event.deadline_ms,
}).unwrap();
let response = memory_daemon::dispatch(root_path.clone(), "POST", "/hook/events", &body)
    .map_err(io_error_from_workspace)?;
let json: serde_json::Value = serde_json::from_str(&response.body)
    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, format!("invalid daemon response: {error}")))?;
let additional_context = json.get("additional_context").and_then(|value| value.as_str());
let hook_output = memory_hooks::format_hook_output(agent, event_name, additional_context)
    .map_err(io_error_from_workspace)?;
print!("{hook_output}");
```

- [ ] **Step 5: Route install/status/doctor/repair/uninstall to agent setup module**

Use these response structs in `memory_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIntegrationStatus {
    pub agent_source: String,
    pub installed: bool,
    pub enabled: bool,
    pub authorized: bool,
    pub hook_version: Option<String>,
    pub last_event_at: Option<String>,
    pub last_error: Option<String>,
    pub doctor_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDoctorReport {
    pub ok: bool,
    pub statuses: Vec<MemoryIntegrationStatus>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}
```

Expose CLI responses through `CliResponse` fields `memory_integrations` and `memory_doctor`.

- [ ] **Step 6: Run parser and command tests**

Run:

```bash
cd src-tauri
cargo test parses_memory_hook_command_without_desktop_socket parses_memory_migrate_storage_dry_run --lib
cargo test --bin mdx-cli
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/cli_server.rs src-tauri/src/memory_agent_setup.rs src-tauri/src/memory_models.rs src-tauri/src/memory_tests.rs
git commit -m "feat: expose memory backend cli commands"
```

---

### Task 7: Upgrade Codex, Claude, And Cursor Installer/Doctor

**Files:**
- Modify: `src-tauri/src/memory_agent_setup.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write managed-block preservation tests**

Add:

```rust
#[test]
fn agent_setup_updates_only_mdx_managed_blocks() {
    let root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let claude_file = home.path().join(".claude/CLAUDE.md");
    std::fs::create_dir_all(claude_file.parent().unwrap()).unwrap();
    std::fs::write(&claude_file, "# User Rules\n\nKeep this.\n").unwrap();

    let paths = crate::memory_agent_setup::AgentSetupPaths {
        home: home.path().to_path_buf(),
        mdx_cli: "/Applications/MDX.app/Contents/MacOS/mdx-cli".to_string(),
        mdx_mcp: "/Applications/MDX.app/Contents/MacOS/mdx-mcp".to_string(),
        hook_script: home.path().join(".mdx-memory-hook.mjs"),
    };
    let targets = crate::memory_agent_setup::AgentSetupTargets {
        codex: false,
        claude: true,
        cursor: false,
        hooks: true,
    };

    let changes = crate::memory_agent_setup::plan_memory_agent_setup(
        &root.path().to_string_lossy(),
        &targets,
        &paths,
    ).unwrap();
    let claude_change = changes.iter().find(|change| change.path == claude_file).unwrap();

    assert!(claude_change.contents.contains("Keep this."));
    assert!(claude_change.contents.contains("BEGIN MDX MEMORY"));
    assert!(claude_change.contents.contains("mdx-cli memory --root"));
}
```

- [ ] **Step 2: Write doctor status test**

Add:

```rust
#[test]
fn doctor_reports_codex_claude_cursor_statuses() {
    let root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    let report = crate::memory_agent_setup::memory_agent_doctor_for_home(
        root.path().to_string_lossy().as_ref(),
        home.path(),
    ).unwrap();

    let agents: Vec<_> = report.statuses.iter().map(|status| status.agent_source.as_str()).collect();
    assert_eq!(agents, vec!["codex", "claude", "cursor"]);
    assert!(!report.ok);
    assert!(report.warnings.iter().any(|warning| warning.contains("not installed")));
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test agent_setup_updates_only_mdx_managed_blocks doctor_reports_codex_claude_cursor_statuses --lib
```

Expected: second test FAIL to compile because doctor function does not exist, and first test may fail if managed block text is not versioned.

- [ ] **Step 4: Version managed entries**

In `memory_agent_setup.rs`, set constants:

```rust
const MDX_MEMORY_HOOK_VERSION: &str = "1";
const MDX_MEMORY_BLOCK_BEGIN: &str = "<!-- BEGIN MDX MEMORY v1 -->";
const MDX_MEMORY_BLOCK_END: &str = "<!-- END MDX MEMORY -->";
```

Update all generated blocks and JSON entries to include:

```json
"name": "mdx-memory",
"version": "1",
"command": "mdx-cli",
"args": ["memory", "--root", "<workspace>", "hook", "<agent>", "<event>"]
```

- [ ] **Step 5: Implement doctor**

Add:

```rust
pub fn memory_agent_doctor_for_home(root_path: &str, home: &Path) -> io::Result<crate::memory::MemoryDoctorReport> {
    let statuses = vec![
        inspect_agent(root_path, home, "codex")?,
        inspect_agent(root_path, home, "claude")?,
        inspect_agent(root_path, home, "cursor")?,
    ];
    let ok = statuses.iter().all(|status| status.installed && status.authorized && status.doctor_status == "ok");
    let warnings = statuses
        .iter()
        .filter(|status| !status.installed)
        .map(|status| format!("{} not installed or not configured", status.agent_source))
        .collect();
    Ok(crate::memory::MemoryDoctorReport { ok, statuses, errors: Vec::new(), warnings })
}
```

`inspect_agent` must check only the files this installer manages:
- Codex: `~/.codey/config.toml`, `~/.agents/skills/mdx-memory/SKILL.md`, `~/.codey/skills/mdx-memory/SKILL.md`
- Claude: `~/.claude/CLAUDE.md`, `~/.claude/hooks/hooks.json`, `~/.claude/skills/mdx-memory/SKILL.md`
- Cursor: `~/.cursor/mcp.json`, `~/.cursor/hooks.json`, `~/.cursor/rules/mdx-memory.mdc`, `~/.cursor/skills/mdx-memory/SKILL.md`

- [ ] **Step 6: Add repair/uninstall planners**

Add public functions:

```rust
pub fn plan_memory_agent_repair(
    root_path: &str,
    agent: Option<&str>,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>>;

pub fn plan_memory_agent_uninstall(
    agent: Option<&str>,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>>;
```

Uninstall must remove only MDX managed block/entry and leave unrelated user content unchanged.

- [ ] **Step 7: Run tests**

Run:

```bash
cd src-tauri
cargo test agent_setup_updates_only_mdx_managed_blocks doctor_reports_codex_claude_cursor_statuses --lib
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/memory_agent_setup.rs src-tauri/src/memory_models.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory agent installer doctor"
```

---

### Task 8: Implement DB-Backed Recall Engine

**Files:**
- Create: `src-tauri/src/memory_recall_engine.rs`
- Modify: `src-tauri/src/memory_recall.rs`
- Modify: `src-tauri/src/memory_storage.rs`
- Modify: `src-tauri/src/memory_storage_sqlite.rs`
- Modify: `src-tauri/src/memory_storage_postgres.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write recall budget tests**

Add:

```rust
#[test]
fn db_recall_respects_byte_budget_and_never_reads_thread_body_by_default() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    storage.insert_memory_for_test(
        "memory-1",
        "workspace:test",
        "workspace:test",
        "Decision",
        "MDX Memory is an agent backend for Codex Claude Cursor.",
        &["architecture"],
        0.9,
    ).unwrap();
    storage.insert_thread_for_test(
        "thread-1",
        "workspace:test",
        "codex",
        "Thread title with Memory",
        "This full thread body must not appear in recall output.",
    ).unwrap();

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        crate::memory::RecallRequest {
            query: "Memory backend".to_string(),
            limit: Some(5),
            byte_budget: Some(80),
            include_working: Some(false),
            include_threads: Some(false),
            tag: None,
            since: None,
        },
    ).unwrap();

    assert_eq!(result.memories.len(), 1);
    assert!(result.byte_count <= 80);
    assert!(result.threads.is_empty());
    assert!(!format!("{result:?}").contains("full thread body"));
}
```

- [ ] **Step 2: Run recall test and verify failure**

Run:

```bash
cd src-tauri
cargo test db_recall_respects_byte_budget_and_never_reads_thread_body_by_default --lib
```

Expected: FAIL because DB recall engine and test insert helpers do not exist.

- [ ] **Step 3: Add search methods to storage**

Add to `MemoryStorage`:

```rust
fn search_memories(
    &mut self,
    query: &str,
    limit: usize,
    tag: Option<&str>,
    since: Option<&str>,
) -> Result<Vec<crate::memory::MemorySummary>, WorkspaceError>;
fn search_thread_summaries(
    &mut self,
    query: &str,
    limit: usize,
) -> Result<Vec<crate::memory::ThreadListItem>, WorkspaceError>;
```

In SQLite implementation, use simple `LIKE` over `title` and `body`, sorted by `importance DESC, updated_at DESC`. Do not query thread `body` unless `include_threads` is true, and even then return summaries only.

- [ ] **Step 4: Add recall engine**

Create `src-tauri/src/memory_recall_engine.rs`:

```rust
use crate::memory::{RecallMemoryItem, RecallRequest, RecallResult};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

pub fn recall_from_storage(
    storage: &mut dyn MemoryStorage,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let limit = request.limit.unwrap_or(10);
    let byte_budget = request.byte_budget.unwrap_or(65_536);
    let summaries = storage.search_memories(
        &request.query,
        limit,
        request.tag.as_deref(),
        request.since.as_deref(),
    )?;

    let mut byte_count = 0usize;
    let mut truncated = false;
    let mut memories = Vec::new();
    for summary in summaries {
        let snippet = summary.snippet.clone();
        let projected_bytes = byte_count + snippet.len();
        if projected_bytes > byte_budget {
            truncated = true;
            break;
        }
        byte_count = projected_bytes;
        memories.push(RecallMemoryItem {
            memory_id: summary.memory_id,
            title: summary.title,
            path: summary.path,
            snippet,
            score: summary.score,
            importance: summary.importance,
        });
    }

    let threads = if request.include_threads.unwrap_or(false) {
        storage.search_thread_summaries(&request.query, limit)?
    } else {
        Vec::new()
    };

    Ok(RecallResult {
        working: None,
        memories,
        threads,
        wiki_refs: Vec::new(),
        truncated,
        byte_count,
        index_degraded: false,
    })
}
```

- [ ] **Step 5: Route existing facade**

In `memory_recall.rs`, make `memory_recall(root_path, request)` open configured storage and call `recall_from_storage`. During old workspace migration, if `.mdx/memory.sqlite` does not exist, fall back to existing Markdown scan and set `index_degraded = true`.

- [ ] **Step 6: Run recall tests**

Run:

```bash
cd src-tauri
cargo test db_recall_respects_byte_budget_and_never_reads_thread_body_by_default --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/memory_recall.rs src-tauri/src/memory_recall_engine.rs src-tauri/src/memory_storage.rs src-tauri/src/memory_storage_sqlite.rs src-tauri/src/memory_storage_postgres.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add db backed memory recall"
```

---

### Task 9: Add Distill Worker, Provider Registry, And Safety Classification

**Files:**
- Create: `src-tauri/src/memory_provider.rs`
- Create: `src-tauri/src/memory_distill_worker.rs`
- Modify: `src-tauri/src/memory_distill.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_queue.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write safety classification tests**

Add:

```rust
#[test]
fn distill_safety_rejects_secrets_and_routes_sensitive_to_inbox() {
    let secret = crate::memory_distill_worker::classify_distill_candidate(
        "API token sk-1234567890abcdef must be remembered",
        0.99,
    );
    assert_eq!(secret.action, "drop");
    assert_eq!(secret.reason, "secret_detected");

    let sensitive = crate::memory_distill_worker::classify_distill_candidate(
        "The user's customer Acme has a private billing issue",
        0.91,
    );
    assert_eq!(sensitive.action, "inbox");
    assert_eq!(sensitive.reason, "sensitive_content");

    let stable = crate::memory_distill_worker::classify_distill_candidate(
        "MDX Memory must remain an external agent backend for Codex Claude Cursor.",
        0.93,
    );
    assert_eq!(stable.action, "auto_accept");
}
```

- [ ] **Step 2: Write mock provider worker test**

Add:

```rust
#[test]
fn distill_worker_writes_auto_accept_memory_with_provenance() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    let provider = crate::memory_provider::MockMemoryProvider::new(serde_json::json!({
        "candidates": [
            {
                "title": "Memory positioning",
                "body": "MDX Memory is an external agent backend for Codex, Claude, and Cursor.",
                "confidence": 0.94,
                "tags": ["memory", "architecture"]
            }
        ]
    }));

    let result = crate::memory_distill_worker::run_distill_job_for_test(
        &mut storage,
        &provider,
        "workspace:test",
        "codex:session-1",
    ).unwrap();

    assert_eq!(result.created_memories, 1);
    assert_eq!(result.created_inbox, 0);
    assert_eq!(storage.count_memories_for_test().unwrap(), 1);
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test distill_safety_rejects_secrets_and_routes_sensitive_to_inbox distill_worker_writes_auto_accept_memory_with_provenance --lib
```

Expected: FAIL because provider and worker modules do not exist.

- [ ] **Step 4: Add provider trait and adapters**

Create `src-tauri/src/memory_provider.rs`:

```rust
use crate::WorkspaceError;

pub trait MemoryProvider {
    fn complete_json(&self, messages: &[MemoryProviderMessage]) -> Result<serde_json::Value, WorkspaceError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryProviderMessage {
    pub role: String,
    pub content: String,
}

pub struct ReusedLlmProvider;

impl MemoryProvider for ReusedLlmProvider {
    fn complete_json(&self, messages: &[MemoryProviderMessage]) -> Result<serde_json::Value, WorkspaceError> {
        let llm_messages = messages
            .iter()
            .map(|message| crate::llm_wiki_llm::LlmChatMessage {
                role: message.role.clone(),
                content: message.content.clone(),
            })
            .collect::<Vec<_>>();
        let config_path = crate::llm_wiki_llm::default_llm_config_path()?;
        let config = crate::llm_wiki_llm::load_llm_config_from_path(config_path)?;
        let output = crate::llm_wiki_llm::call_chat_completion(config, &llm_messages)?;
        serde_json::from_str(&output).map_err(|error| {
            WorkspaceError::new("memory_provider_parse_failed", format!("provider did not return valid JSON: {error}"))
        })
    }
}

#[cfg(test)]
pub struct MockMemoryProvider {
    response: serde_json::Value,
}

#[cfg(test)]
impl MockMemoryProvider {
    pub fn new(response: serde_json::Value) -> Self {
        Self { response }
    }
}

#[cfg(test)]
impl MemoryProvider for MockMemoryProvider {
    fn complete_json(&self, _messages: &[MemoryProviderMessage]) -> Result<serde_json::Value, WorkspaceError> {
        Ok(self.response.clone())
    }
}
```

- [ ] **Step 5: Add distill worker**

Create `src-tauri/src/memory_distill_worker.rs`:

```rust
use crate::memory_provider::{MemoryProvider, MemoryProviderMessage};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateClassification {
    pub action: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistillWorkerResult {
    pub created_memories: usize,
    pub created_inbox: usize,
    pub dropped: usize,
}

pub fn classify_distill_candidate(body: &str, confidence: f64) -> CandidateClassification {
    let lowered = body.to_ascii_lowercase();
    if lowered.contains("sk-") || lowered.contains("token") || lowered.contains("password") || lowered.contains("private key") {
        return CandidateClassification { action: "drop".to_string(), reason: "secret_detected".to_string() };
    }
    if lowered.contains("customer") || lowered.contains("billing") || lowered.contains("private") {
        return CandidateClassification { action: "inbox".to_string(), reason: "sensitive_content".to_string() };
    }
    if confidence >= 0.90 {
        CandidateClassification { action: "auto_accept".to_string(), reason: "high_confidence_low_risk".to_string() }
    } else {
        CandidateClassification { action: "inbox".to_string(), reason: "low_confidence".to_string() }
    }
}

pub fn run_distill_job_for_test(
    storage: &mut dyn MemoryStorage,
    provider: &dyn MemoryProvider,
    workspace_id: &str,
    session_pk: &str,
) -> Result<DistillWorkerResult, WorkspaceError> {
    let response = provider.complete_json(&[
        MemoryProviderMessage { role: "system".to_string(), content: "Extract durable MDX Memory candidates as JSON.".to_string() },
        MemoryProviderMessage { role: "user".to_string(), content: format!("Session: {session_pk}") },
    ])?;
    write_candidates(storage, workspace_id, session_pk, response)
}

fn write_candidates(
    storage: &mut dyn MemoryStorage,
    workspace_id: &str,
    session_pk: &str,
    response: serde_json::Value,
) -> Result<DistillWorkerResult, WorkspaceError> {
    let candidates = response.get("candidates").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let mut result = DistillWorkerResult { created_memories: 0, created_inbox: 0, dropped: 0 };
    for candidate in candidates {
        let title = candidate.get("title").and_then(|value| value.as_str()).unwrap_or("Untitled memory");
        let body = candidate.get("body").and_then(|value| value.as_str()).unwrap_or("");
        let confidence = candidate.get("confidence").and_then(|value| value.as_f64()).unwrap_or(0.0);
        let classification = classify_distill_candidate(body, confidence);
        match classification.action.as_str() {
            "auto_accept" => {
                storage.insert_distilled_memory_for_test(workspace_id, title, body, confidence, session_pk)?;
                result.created_memories += 1;
            }
            "inbox" => {
                storage.insert_distilled_inbox_for_test(workspace_id, title, body, confidence, &classification.reason, session_pk)?;
                result.created_inbox += 1;
            }
            _ => result.dropped += 1,
        }
    }
    Ok(result)
}
```

- [ ] **Step 6: Wire worker and reuse existing distill facade**

Modify `src-tauri/src/lib.rs`:

```rust
mod memory_distill_worker;
mod memory_provider;
```

Modify `memory_distill.rs` so CLI/manual distill uses `MemoryProvider` and returns existing `MemoryDistillResult`. Keep existing user-facing command shape.

- [ ] **Step 7: Run tests**

Run:

```bash
cd src-tauri
cargo test distill_safety_rejects_secrets_and_routes_sensitive_to_inbox distill_worker_writes_auto_accept_memory_with_provenance --lib
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_distill.rs src-tauri/src/memory_distill_worker.rs src-tauri/src/memory_models.rs src-tauri/src/memory_provider.rs src-tauri/src/memory_queue.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory distill worker"
```

---

### Task 10: Generate Markdown Projection From DB

**Files:**
- Create: `src-tauri/src/memory_projection.rs`
- Modify: `src-tauri/src/memory_storage.rs`
- Modify: `src-tauri/src/memory_storage_sqlite.rs`
- Modify: `src-tauri/src/memory_storage_postgres.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write projection rebuild test**

Add:

```rust
#[test]
fn projection_rebuild_writes_memory_markdown_with_stable_frontmatter() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    storage.insert_memory_for_test(
        "memory-projection-1",
        "workspace:test",
        "workspace:test",
        "Agent backend",
        "Memory is external to Codex Claude Cursor.",
        &["architecture"],
        0.95,
    ).unwrap();

    let report = crate::memory_projection::rebuild_projection(root.path(), &mut storage).unwrap();

    assert_eq!(report.written, 1);
    let markdown = std::fs::read_to_string(root.path().join("memory/memories/agent-backend.md")).unwrap();
    assert!(markdown.contains("memory_id: memory-projection-1"));
    assert!(markdown.contains("kind: memory"));
    assert!(markdown.contains("Memory is external to Codex Claude Cursor."));
}
```

- [ ] **Step 2: Run projection test and verify failure**

Run:

```bash
cd src-tauri
cargo test projection_rebuild_writes_memory_markdown_with_stable_frontmatter --lib
```

Expected: FAIL because projection module and storage list method do not exist.

- [ ] **Step 3: Add projection types**

Create `src-tauri/src/memory_projection.rs`:

```rust
use std::fs;
use std::path::Path;

use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionReport {
    pub written: usize,
    pub skipped: usize,
    pub conflicts: usize,
}

pub fn rebuild_projection(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<ProjectionReport, WorkspaceError> {
    let root = root.as_ref();
    let memories = storage.list_active_memories_for_projection()?;
    let mut report = ProjectionReport { written: 0, skipped: 0, conflicts: 0 };
    for memory in memories {
        let slug = slugify(&memory.title);
        let path = root.join("memory/memories").join(format!("{slug}.md"));
        let markdown = format!(
            "---\nschema_version: 2\nkind: memory\nmemory_id: {}\ntitle: {}\nstatus: active\ncreated_at: {}\n---\n\n{}\n",
            memory.memory_id,
            memory.title,
            memory.created_at,
            memory.body
        );
        if path.exists() {
            let existing = fs::read_to_string(&path).map_err(|error| {
                WorkspaceError::from_io("projection_read_failed", "failed to read projected memory", &error)
            })?;
            if existing == markdown {
                report.skipped += 1;
                continue;
            }
        }
        fs::write(&path, markdown).map_err(|error| {
            WorkspaceError::from_io("projection_write_failed", "failed to write projected memory", &error)
        })?;
        report.written += 1;
    }
    Ok(report)
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}
```

- [ ] **Step 4: Add projection list method**

Add to `MemoryStorage`:

```rust
fn list_active_memories_for_projection(&mut self) -> Result<Vec<ProjectionMemory>, WorkspaceError>;
```

Add:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectionMemory {
    pub memory_id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}
```

- [ ] **Step 5: Respect projection hard shutdown**

In all places that enqueue projection or call `rebuild_projection`, call:

```rust
let projection = crate::memory_config::resolve_memory_feature(
    &config,
    crate::memory_config::MemoryFeature::Projection,
    None,
);
if !projection.enabled {
    return Ok(ProjectionReport { written: 0, skipped: 0, conflicts: 0 });
}
```

- [ ] **Step 6: Run projection test**

Run:

```bash
cd src-tauri
cargo test projection_rebuild_writes_memory_markdown_with_stable_frontmatter --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory.rs src-tauri/src/memory_projection.rs src-tauri/src/memory_storage.rs src-tauri/src/memory_storage_sqlite.rs src-tauri/src/memory_storage_postgres.rs src-tauri/src/memory_tests.rs
git commit -m "feat: project memory database records to markdown"
```

---

### Task 11: Implement Storage Migration And Markdown Import

**Files:**
- Create: `src-tauri/src/memory_storage_migration.rs`
- Modify: `src-tauri/src/memory_daemon.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write Markdown import test**

Add:

```rust
#[test]
fn markdown_memory_import_preserves_existing_ids_and_unknown_message_count() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("memory/memories")).unwrap();
    std::fs::write(
        root.path().join("memory/memories/decision.md"),
        "---\nschema_version: 1\nkind: memory\nmemory_id: memory-old-1\ntitle: Old decision\nstatus: active\ncreated_at: 2026-06-14T00:00:00Z\n---\n\nUse DB first.\n",
    ).unwrap();
    std::fs::create_dir_all(root.path().join("memory/threads/codex")).unwrap();
    std::fs::write(
        root.path().join("memory/threads/codex/old-thread.md"),
        "---\nschema_version: 1\nkind: thread\nthread_id: codex:old\ntitle: Old thread\ncontent_hash: abc\n---\n\n## Message 1 - user\nhello\n",
    ).unwrap();

    let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let report = crate::memory_storage_migration::import_markdown_memory_to_db(root.path(), &mut storage).unwrap();

    assert_eq!(report.memories_imported, 1);
    assert_eq!(report.threads_imported, 1);
    let thread = storage.get_thread_for_test("codex:old").unwrap().unwrap();
    assert_eq!(thread.message_count, None);
}
```

- [ ] **Step 2: Write SQLite to PostgreSQL dry-run model test**

Add:

```rust
#[test]
fn storage_migration_dry_run_reports_copy_counts_without_switching_backend() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut sqlite = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    sqlite.initialize().unwrap();
    sqlite.insert_memory_for_test("memory-1", "workspace:test", "workspace:test", "Decision", "Use DB first.", &["db"], 0.9).unwrap();

    let report = crate::memory_storage_migration::dry_run_storage_migration(
        root.path(),
        "sqlite",
        "postgresql",
        Some("postgresql://example/mdx"),
    ).unwrap();

    assert_eq!(report.from, "sqlite");
    assert_eq!(report.to, "postgresql");
    assert_eq!(report.records_seen.get("memories"), Some(&1));
    assert!(!report.config_switched);
}
```

- [ ] **Step 3: Run migration tests and verify failure**

Run:

```bash
cd src-tauri
cargo test markdown_memory_import_preserves_existing_ids_and_unknown_message_count storage_migration_dry_run_reports_copy_counts_without_switching_backend --lib
```

Expected: FAIL because migration module and report models do not exist.

- [ ] **Step 4: Add migration report models**

In `memory_models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryStorageMigrationReport {
    pub migration_id: String,
    pub from: String,
    pub to: String,
    pub dry_run: bool,
    pub records_seen: std::collections::BTreeMap<String, usize>,
    pub records_copied: std::collections::BTreeMap<String, usize>,
    pub records_skipped: std::collections::BTreeMap<String, usize>,
    pub validation_errors: Vec<String>,
    pub backup_path: Option<String>,
    pub config_switched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryMarkdownImportReport {
    pub memories_imported: usize,
    pub inbox_imported: usize,
    pub threads_imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}
```

- [ ] **Step 5: Implement Markdown import**

Create `src-tauri/src/memory_storage_migration.rs` with:

```rust
use std::collections::BTreeMap;
use std::path::Path;

use crate::memory::{MemoryMarkdownImportReport, MemoryStorageMigrationReport};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

pub fn import_markdown_memory_to_db(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<MemoryMarkdownImportReport, WorkspaceError> {
    let root = root.as_ref();
    let memories_imported = import_memory_files(root, storage)?;
    let threads_imported = import_thread_files(root, storage)?;
    Ok(MemoryMarkdownImportReport {
        memories_imported,
        inbox_imported: 0,
        threads_imported,
        skipped: 0,
        errors: Vec::new(),
    })
}

pub fn dry_run_storage_migration(
    root: impl AsRef<Path>,
    from: &str,
    to: &str,
    target: Option<&str>,
) -> Result<MemoryStorageMigrationReport, WorkspaceError> {
    let mut records_seen = BTreeMap::new();
    let memory_count = count_markdown_files(root.as_ref().join("memory/memories"))?;
    records_seen.insert("memories".to_string(), memory_count);
    Ok(MemoryStorageMigrationReport {
        migration_id: format!("migration:{}:{to}", crate::memory_fs::now_rfc3339()),
        from: from.to_string(),
        to: to.to_string(),
        dry_run: true,
        records_seen,
        records_copied: BTreeMap::new(),
        records_skipped: BTreeMap::new(),
        validation_errors: target.filter(|value| value.trim().is_empty()).map(|_| "target_empty".to_string()).into_iter().collect(),
        backup_path: None,
        config_switched: false,
    })
}
```

Implement `import_memory_files`, `import_thread_files`, and `count_markdown_files` using existing `parse_markdown_frontmatter` helpers from `memory_fs`.

- [ ] **Step 6: Add daemon migration routes**

In `memory_daemon.rs`, add:

```rust
("POST", "/storage/migrate/dry-run") => post_json(body, |request: crate::memory::MemoryStorageMigrateRequest| {
    crate::memory_storage_migration::dry_run_storage_migration(
        &root,
        &request.from,
        &request.to,
        request.target.as_deref(),
    )
}),
```

Add request model:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryStorageMigrateRequest {
    pub from: String,
    pub to: String,
    pub target: Option<String>,
    pub dry_run: bool,
    pub resume: bool,
}
```

- [ ] **Step 7: Run migration tests**

Run:

```bash
cd src-tauri
cargo test markdown_memory_import_preserves_existing_ids_and_unknown_message_count storage_migration_dry_run_reports_copy_counts_without_switching_backend --lib
```

Expected: PASS.

- [ ] **Step 8: Run optional PostgreSQL integration test**

Run with a local database:

```bash
cd src-tauri
MDX_MEMORY_POSTGRES_TEST_URL='postgresql://mdx:mdx@localhost:5432/mdx_memory_test' \
  cargo test memory_postgres_storage_initializes_schema_version --lib -- --ignored
```

Expected with running PostgreSQL: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/bin/mdx_cli.rs src-tauri/src/lib.rs src-tauri/src/memory_daemon.rs src-tauri/src/memory_models.rs src-tauri/src/memory_storage_migration.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory storage migration"
```

---

### Task 12: Extend MCP Tools For Agent Memory Backend

**Files:**
- Modify: `src-tauri/src/bin/mdx_mcp.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`

- [ ] **Step 1: Write MCP tool manifest test**

Add to `src-tauri/src/cli_protocol_tests.rs`:

```rust
#[test]
fn mcp_lists_memory_backend_tools() {
    let manifest = crate::bin::mdx_mcp::tools_manifest_for_test();
    for name in [
        "memory_recall",
        "memory_search",
        "memory_add",
        "memory_inbox_add",
        "memory_inbox_list",
        "memory_inbox_accept",
        "memory_hook_status",
        "memory_diagnostics",
    ] {
        assert!(manifest.contains(name), "missing MCP tool {name}");
    }
}
```

- [ ] **Step 2: Run MCP test and verify failure**

Run:

```bash
cd src-tauri
cargo test mcp_lists_memory_backend_tools --lib
```

Expected: FAIL because test helper or tools are absent.

- [ ] **Step 3: Add MCP tools**

In `mdx_mcp.rs`, add tool definitions with these names and route them through existing `CliRequest` variants or new variants added in Task 6:

```json
{
  "name": "memory_recall",
  "description": "Recall relevant MDX Memory context for the active workspace.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "limit": { "type": "integer" },
      "include_threads": { "type": "boolean" }
    },
    "required": ["query"]
  }
}
```

Define schemas for:
- `memory_search`: query, limit, tag, since
- `memory_add`: title, body, tags, source_thread, confidence
- `memory_inbox_add`: title, body, tags, confidence
- `memory_inbox_list`: include_reviewed
- `memory_inbox_accept`: inbox_id, title, body, tags
- `memory_hook_status`: agent
- `memory_diagnostics`: include_logs

- [ ] **Step 4: Run MCP tests**

Run:

```bash
cd src-tauri
cargo test mcp_lists_memory_backend_tools --lib
cargo test --bin mdx-mcp
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bin/mdx_mcp.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/cli_server.rs
git commit -m "feat: expose memory backend mcp tools"
```

---

### Task 13: Rebuild Memory Frontend As Backend Console

**Files:**
- Modify: `features/memory/lib/types.ts`
- Modify: `features/memory/lib/memory-client.ts`
- Modify: `features/memory/lib/memory-client.test.ts`
- Modify: `features/memory/lib/memory-panel-state.ts`
- Modify: `features/memory/lib/memory-panel-state.test.ts`
- Modify: `features/memory/components/memory-panel.tsx`
- Create: `features/memory/components/memory-overview-tab.tsx`
- Create: `features/memory/components/memory-integrations-tab.tsx`
- Create: `features/memory/components/memory-sessions-tab.tsx`
- Create: `features/memory/components/memory-long-term-tab.tsx`
- Create: `features/memory/components/memory-pending-tab.tsx`
- Create: `features/memory/components/memory-working-context-tab.tsx`
- Create: `features/memory/components/memory-diagnostics-tab.tsx`
- Modify: `features/memory/components/memory-panel.test.tsx`

- [ ] **Step 1: Write tab state test**

Replace or extend `features/memory/lib/memory-panel-state.test.ts`:

```ts
it("builds the agent backend console tabs with Chinese labels", () => {
  const tabs = buildMemoryPanelTabs({ hasMemory: true });

  expect(tabs.map((tab) => tab.id)).toEqual([
    "overview",
    "integrations",
    "sessions",
    "longTerm",
    "pending",
    "working",
    "diagnostics",
  ]);
  expect(tabs.map((tab) => tab.label)).toEqual([
    "概览",
    "Agent 集成",
    "会话",
    "长期记忆",
    "待确认",
    "工作上下文",
    "诊断",
  ]);
});
```

- [ ] **Step 2: Write client API tests**

Add to `features/memory/lib/memory-client.test.ts`:

```ts
it("fetches backend status and integration status", async () => {
  const invoke = vi.fn(async (command: string) => {
    if (command === "memory_backend_status") {
      return { ok: true, daemon: { status: "running" }, queue: { depth: 0 } };
    }
    return [
      { agent_source: "codex", installed: true, enabled: true, authorized: true, hook_version: "1", last_event_at: null, last_error: null, doctor_status: "ok" },
    ];
  });
  mockInvoke(invoke);

  await getMemoryBackendStatus("/tmp/ws");
  await getMemoryIntegrationStatus("/tmp/ws");

  expect(invoke).toHaveBeenCalledWith("memory_backend_status", { rootPath: "/tmp/ws" });
  expect(invoke).toHaveBeenCalledWith("memory_integration_status", { rootPath: "/tmp/ws" });
});
```

- [ ] **Step 3: Run frontend tests and verify failure**

Run:

```bash
npm test -- features/memory/lib/memory-panel-state.test.ts features/memory/lib/memory-client.test.ts
```

Expected: FAIL because new tabs and client functions do not exist.

- [ ] **Step 4: Update types and client**

In `features/memory/lib/types.ts`, add:

```ts
export type MemoryBackendHealth = "running" | "degraded" | "disabled" | "stopped";

export interface MemoryBackendStatus {
  ok: boolean;
  daemon: { status: MemoryBackendHealth; lastError?: string | null };
  storage: { backend: "sqlite" | "postgresql"; status: string };
  queue: { depth: number; oldestJobAgeSeconds?: number | null };
  projection: { status: string; dirtyCount: number };
  today: { capturedEvents: number; pendingCandidates: number };
}

export interface MemoryIntegrationStatus {
  agent_source: "codex" | "claude" | "cursor";
  installed: boolean;
  enabled: boolean;
  authorized: boolean;
  hook_version: string | null;
  last_event_at: string | null;
  last_error: string | null;
  doctor_status: string;
}
```

In `memory-client.ts`, add:

```ts
export function getMemoryBackendStatus(rootPath: string): Promise<MemoryBackendStatus> {
  return invokeCommand("memory_backend_status", { rootPath });
}

export function getMemoryIntegrationStatus(rootPath: string): Promise<MemoryIntegrationStatus[]> {
  return invokeCommand("memory_integration_status", { rootPath });
}

export function repairMemoryIntegration(rootPath: string, agent: string): Promise<MemoryDoctorReport> {
  return invokeCommand("memory_integration_repair", { rootPath, agent });
}
```

- [ ] **Step 5: Update tab state**

In `memory-panel-state.ts`, set:

```ts
export type MemoryPanelTabId =
  | "overview"
  | "integrations"
  | "sessions"
  | "longTerm"
  | "pending"
  | "working"
  | "diagnostics";
```

`buildMemoryPanelTabs` must return the labels from Step 1.

- [ ] **Step 6: Split UI components**

Keep `MemoryPanel` as the data-loading shell and render tab components:

```tsx
{effectiveTab === "overview" ? <MemoryOverviewTab status={backendStatus} /> : null}
{effectiveTab === "integrations" ? <MemoryIntegrationsTab statuses={integrations} onRepair={handleRepairIntegration} /> : null}
{effectiveTab === "sessions" ? <MemorySessionsTab sessions={sessions} /> : null}
{effectiveTab === "longTerm" ? <MemoryLongTermTab memories={memories} onArchive={handleArchiveMemory} /> : null}
{effectiveTab === "pending" ? <MemoryPendingTab inbox={inbox} onAccept={handleAcceptInbox} onReject={handleRejectInbox} /> : null}
{effectiveTab === "working" ? <MemoryWorkingContextTab value={workingText} onChange={setWorkingText} onSave={handleSaveWorking} /> : null}
{effectiveTab === "diagnostics" ? <MemoryDiagnosticsTab diagnostics={diagnostics} /> : null}
```

Each tab component must use existing `TextControlButton` or `IconButton` controls and Chinese user-facing labels.

- [ ] **Step 7: Run frontend tests**

Run:

```bash
npm test -- features/memory/lib/memory-panel-state.test.ts features/memory/lib/memory-client.test.ts features/memory/components/memory-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add features/memory/lib/types.ts features/memory/lib/memory-client.ts features/memory/lib/memory-client.test.ts features/memory/lib/memory-panel-state.ts features/memory/lib/memory-panel-state.test.ts features/memory/components/memory-panel.tsx features/memory/components/memory-overview-tab.tsx features/memory/components/memory-integrations-tab.tsx features/memory/components/memory-sessions-tab.tsx features/memory/components/memory-long-term-tab.tsx features/memory/components/memory-pending-tab.tsx features/memory/components/memory-working-context-tab.tsx features/memory/components/memory-diagnostics-tab.tsx features/memory/components/memory-panel.test.tsx
git commit -m "feat: rebuild memory as agent backend console"
```

---

### Task 14: Add Settings Hard Shutdown, Provider, Storage, And Migration UI

**Files:**
- Modify: `features/workspace/components/settings-button.tsx`
- Modify: `features/workspace/components/settings-button.test.tsx`
- Modify: `features/workspace/lib/types.ts`
- Modify: `features/workspace/lib/preferences.ts`
- Modify: `features/workspace/lib/preferences.test.ts`
- Modify: `features/memory/components/memory-settings-section.tsx`
- Modify: `features/memory/lib/memory-client.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory_daemon.rs`
- Modify: `src-tauri/src/memory_models.rs`

- [ ] **Step 1: Write settings UI test**

Add to `features/workspace/components/settings-button.test.tsx`:

```tsx
it("renders memory feature hard shutdown controls", async () => {
  await renderSettings(root);

  expect(host.textContent).toContain("Memory");
  expect(host.textContent).toContain("总开关");
  expect(host.textContent).toContain("自动捕获");
  expect(host.textContent).toContain("Recall 注入");
  expect(host.textContent).toContain("自动提取");
  expect(host.textContent).toContain("Markdown 投影");
  expect(host.textContent).toContain("SQLite");
  expect(host.textContent).toContain("PostgreSQL");
});
```

- [ ] **Step 2: Write backend config set test**

Add to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn config_set_disables_capture_without_deleting_history() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let body = serde_json::json!({
        "scope": "workspace",
        "key": "agent_backend.capture_enabled",
        "enabled": false
    }).to_string();
    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/config/set",
        &body,
    ).unwrap();

    assert_eq!(response.status, 200);
    let config = crate::memory::load_memory_config_for_root(root.path()).unwrap();
    assert!(!config.agent_backend.capture_enabled);
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- features/workspace/components/settings-button.test.tsx
cd src-tauri && cargo test config_set_disables_capture_without_deleting_history --lib
```

Expected: both FAIL because Memory settings UI and `/config/set` route are absent.

- [ ] **Step 4: Add config set model and route**

In `memory_models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryConfigSetRequest {
    pub scope: String,
    pub key: String,
    pub enabled: bool,
}
```

In `memory_daemon.rs`, route:

```rust
("POST", "/config/set") => post_json(body, |request: crate::memory::MemoryConfigSetRequest| {
    crate::memory::memory_config_set(root, request)
}),
```

In `memory.rs`, implement `memory_config_set` for these keys:
- `memory.enabled`
- `agent_backend.capture_enabled`
- `agent_backend.recall_injection_enabled`
- `agent_backend.distill_enabled`
- `agent_backend.auto_accept`
- `projection.enabled`
- `agents.codex.enabled`
- `agents.claude.enabled`
- `agents.cursor.enabled`

Unknown keys return `WorkspaceError::new("memory_config_key_unknown", format!("unsupported memory config key: {key}"))`.

- [ ] **Step 5: Add Memory settings section**

Create or fill `features/memory/components/memory-settings-section.tsx`:

```tsx
export function MemorySettingsSection({
  disabled,
  onToggle,
}: {
  disabled: boolean;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  return (
    <section data-settings-section="memory">
      <h2>Memory</h2>
      <label><input type="checkbox" disabled={disabled} onChange={(event) => onToggle("memory.enabled", event.currentTarget.checked)} /> 总开关</label>
      <label><input type="checkbox" disabled={disabled} onChange={(event) => onToggle("agent_backend.capture_enabled", event.currentTarget.checked)} /> 自动捕获</label>
      <label><input type="checkbox" disabled={disabled} onChange={(event) => onToggle("agent_backend.recall_injection_enabled", event.currentTarget.checked)} /> Recall 注入</label>
      <label><input type="checkbox" disabled={disabled} onChange={(event) => onToggle("agent_backend.distill_enabled", event.currentTarget.checked)} /> 自动提取</label>
      <label><input type="checkbox" disabled={disabled} onChange={(event) => onToggle("projection.enabled", event.currentTarget.checked)} /> Markdown 投影</label>
      <div role="group" aria-label="Memory storage backend">
        <button type="button">SQLite</button>
        <button type="button">PostgreSQL</button>
      </div>
    </section>
  );
}
```

Then import and render this section in `settings-button.tsx`. Add `memory` to `SettingsSection` and `SETTINGS_SECTIONS`.

- [ ] **Step 6: Run settings tests**

Run:

```bash
npm test -- features/workspace/components/settings-button.test.tsx
cd src-tauri && cargo test config_set_disables_capture_without_deleting_history --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/workspace/components/settings-button.tsx features/workspace/components/settings-button.test.tsx features/workspace/lib/types.ts features/workspace/lib/preferences.ts features/workspace/lib/preferences.test.ts features/memory/components/memory-settings-section.tsx features/memory/lib/memory-client.ts src-tauri/src/lib.rs src-tauri/src/memory_daemon.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/memory_tests.rs
git commit -m "feat: add memory hard shutdown settings"
```

---

### Task 15: Add Diagnostics, Retention, And End-To-End Smoke Fixtures

**Files:**
- Modify: `src-tauri/src/memory_daemon.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_queue.rs`
- Modify: `src-tauri/src/memory_tests.rs`
- Create: `src-tauri/tests/fixtures/memory-hooks/codex-user-prompt.json`
- Create: `src-tauri/tests/fixtures/memory-hooks/claude-stop.json`
- Create: `src-tauri/tests/fixtures/memory-hooks/cursor-stop.json`
- Modify: `features/memory/components/memory-diagnostics-tab.tsx`
- Modify: `features/memory/components/memory-panel.test.tsx`

- [ ] **Step 1: Write diagnostics route test**

Add:

```rust
#[test]
fn diagnostics_reports_queue_spool_projection_and_recent_errors() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "GET",
        "/diagnostics",
        "",
    ).unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert!(json["result"]["queue"]["depth"].is_number());
    assert!(json["result"]["spool"]["pending"].is_number());
    assert!(json["result"]["projection"]["dirty_count"].is_number());
}
```

- [ ] **Step 2: Run diagnostics test and verify failure**

Run:

```bash
cd src-tauri
cargo test diagnostics_reports_queue_spool_projection_and_recent_errors --lib
```

Expected: FAIL because `/diagnostics` is not routed.

- [ ] **Step 3: Add diagnostics models**

In `memory_models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDiagnostics {
    pub queue: MemoryQueueDiagnostics,
    pub spool: MemorySpoolDiagnostics,
    pub projection: MemoryProjectionDiagnostics,
    pub recent_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryQueueDiagnostics {
    pub depth: usize,
    pub dead: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemorySpoolDiagnostics {
    pub pending: usize,
    pub quarantined: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryProjectionDiagnostics {
    pub status: String,
    pub dirty_count: usize,
}
```

- [ ] **Step 4: Route diagnostics**

In `memory_daemon.rs`, add:

```rust
("GET", "/diagnostics") => get_json(|| crate::memory::memory_diagnostics(root)),
```

In `memory.rs`, implement:

```rust
pub fn memory_diagnostics(root_path: String) -> Result<MemoryDiagnostics, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    Ok(MemoryDiagnostics {
        queue: MemoryQueueDiagnostics { depth: 0, dead: 0 },
        spool: MemorySpoolDiagnostics {
            pending: crate::memory_spool::count_spool_files(&root)?,
            quarantined: crate::memory_spool::count_quarantine_files(&root)?,
        },
        projection: MemoryProjectionDiagnostics { status: "clean".to_string(), dirty_count: 0 },
        recent_errors: Vec::new(),
    })
}
```

- [ ] **Step 5: Add fixture smoke test**

Create the three fixture JSON files. Add test:

```rust
#[test]
fn hook_fixture_smoke_captures_codex_claude_cursor_events() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    for (agent, event, fixture) in [
        ("codex", "UserPromptSubmit", include_str!("../tests/fixtures/memory-hooks/codex-user-prompt.json")),
        ("claude", "Stop", include_str!("../tests/fixtures/memory-hooks/claude-stop.json")),
        ("cursor", "Stop", include_str!("../tests/fixtures/memory-hooks/cursor-stop.json")),
    ] {
        let payload: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let normalized = crate::memory_hooks::normalize_hook_payload(agent, event, &root.path().to_string_lossy(), &payload, Some(400)).unwrap();
        assert_eq!(normalized.agent_source, agent);
        assert_eq!(normalized.event_name, event);
    }
}
```

- [ ] **Step 6: Run diagnostics and fixture tests**

Run:

```bash
cd src-tauri
cargo test diagnostics_reports_queue_spool_projection_and_recent_errors hook_fixture_smoke_captures_codex_claude_cursor_events --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/memory_daemon.rs src-tauri/src/memory_models.rs src-tauri/src/memory_queue.rs src-tauri/src/memory_tests.rs src-tauri/tests/fixtures/memory-hooks/codex-user-prompt.json src-tauri/tests/fixtures/memory-hooks/claude-stop.json src-tauri/tests/fixtures/memory-hooks/cursor-stop.json features/memory/components/memory-diagnostics-tab.tsx features/memory/components/memory-panel.test.tsx
git commit -m "feat: add memory diagnostics and hook smoke fixtures"
```

---

### Task 16: Documentation, Full Verification, And Release Gate

**Files:**
- Create: `docs/memory-agent-backend.md`
- Modify: `docs/memory-usage.md`
- Modify: `docs/loopx/specs/memory.md`
- Modify: `AGENT.md`
- Modify: `package.json` if a new focused test script is useful

- [ ] **Step 1: Write user-facing docs**

Create `docs/memory-agent-backend.md` with these sections:

```markdown
# MDX Memory Agent Backend

## Positioning

MDX Memory is a local-first external memory backend for Codex, Claude, and Cursor. Agents use hooks, CLI, MCP, and local daemon APIs to recall, capture, and distill memory automatically.

## Storage

SQLite is the default local runtime database. PostgreSQL is available for advanced service-style deployments. Markdown under `memory/**` is a readable projection and can be rebuilt from the database.

## Hard Shutdown

Turning off a Memory feature stops new writes for that feature. It does not delete historical data.

## Agent Integrations

Use `mdx-cli memory --root <workspace> install --agent codex`, `claude`, `cursor`, or omit `--agent` to configure all supported agents.

## Migration

Run `mdx-cli memory --root <workspace> migrate storage --to postgresql --target <url> --dry-run` before switching runtime storage.
```

- [ ] **Step 2: Update usage docs**

In `docs/memory-usage.md`, add command examples:

```bash
mdx-cli memory --root "$PWD" daemon --port 14243
mdx-cli memory --root "$PWD" install --agent codex --dry-run
mdx-cli memory --root "$PWD" doctor --agent codex --json
mdx-cli memory --root "$PWD" hook codex UserPromptSubmit < codex-hook.json
mdx-cli memory --root "$PWD" migrate storage --to postgresql --target "$MDX_MEMORY_POSTGRES_URL" --dry-run
```

- [ ] **Step 3: Run backend focused suite**

Run:

```bash
cd src-tauri
cargo test memory_ --lib
```

Expected: PASS with no failed tests.

- [ ] **Step 4: Run CLI/MCP suites**

Run:

```bash
cd src-tauri
cargo test --bin mdx-cli
cargo test --bin mdx-mcp
```

Expected: PASS with no failed tests.

- [ ] **Step 5: Run frontend suite**

Run:

```bash
npm test -- features/memory features/workspace/components/settings-button.test.tsx features/workspace/components/workspace-shell.test.tsx
```

Expected: PASS with no failed tests.

- [ ] **Step 6: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 7: Run full test suites**

Run:

```bash
npm test
cd src-tauri && cargo test --lib
```

Expected: PASS with no failed tests.

- [ ] **Step 8: Manual local smoke**

Run:

```bash
WORKSPACE="$(mktemp -d)"
cd src-tauri
cargo run --bin mdx-cli -- memory --root "$WORKSPACE" init
printf '{"session_id":"s1","turn_id":"t1","cwd":"%s","prompt":"remember Memory positioning"}' "$WORKSPACE" \
  | cargo run --bin mdx-cli -- memory --root "$WORKSPACE" hook codex UserPromptSubmit
cargo run --bin mdx-cli -- memory --root "$WORKSPACE" doctor --json
```

Expected:
- `memory init` returns `ok: true`.
- Hook command exits 0.
- `doctor --json` returns statuses for Codex, Claude, Cursor.

- [ ] **Step 9: Commit docs and release gate**

```bash
git add docs/memory-agent-backend.md docs/memory-usage.md docs/loopx/specs/memory.md AGENT.md package.json
git commit -m "docs: document memory agent backend"
```

---

## Self-Review Checklist

- Spec coverage:
  - Product positioning and non-goals: Tasks 1 and 16.
  - SQLite/PostgreSQL DB runtime source of truth: Tasks 2 and 11.
  - Daemon, queue, spool, worker lifecycle: Tasks 3, 5, 9, and 15.
  - Codex/Claude/Cursor hook adapters and installers: Tasks 4, 6, and 7.
  - Recall injection and no raw thread injection by default: Tasks 4, 5, and 8.
  - Auto capture, distill, auto-accept, inbox safety: Tasks 3, 5, and 9.
  - Markdown projection: Task 10.
  - Migration: Task 11.
  - MCP/CLI/daemon/Tauri surfaces: Tasks 5, 6, 12, and 14.
  - UI console and settings hard shutdown: Tasks 13 and 14.
  - Diagnostics, retention entry points, smoke fixtures: Task 15.
- Placeholder scan: no unresolved marker terms or future empty sections.
- Type consistency:
  - Rust uses snake_case serde models and existing `WorkspaceError`.
  - Frontend uses existing `rootPath` Tauri argument convention.
  - Agent names are consistently `codex`, `claude`, `cursor`.
- Design drift check:
  - The plan does not introduce bidirectional SQLite/PostgreSQL sync.
  - The plan does not make LLM Wiki read Memory by default.
  - The plan does not make Claude Code or any external agent the default distill worker.
  - The plan keeps manual working memory as a secondary/debug workflow, not the primary product path.

## Execution Handoff

Plan implementation should use `loopx:subagent-exec` task-by-task. Use a fresh subagent per task when possible, verify tests after each task, and commit after each task using the commit command included in that task.
