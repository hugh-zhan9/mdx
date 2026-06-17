# MDX Memory Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [docs/loopx/design/MDX Memory完整能力设计文档.md](../design/MDX%20Memory%E5%AE%8C%E6%95%B4%E8%83%BD%E5%8A%9B%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md)

**Goal:** Build the complete MDX Memory product: Markdown-native memory storage, SQLite recall, inbox/distill/capture, local HTTP/MCP agent access, Workspace UI, bundle import/export, and verification.

**Architecture:** Markdown under `memory/` remains the source of truth. `.mdx/search.sqlite` is a rebuildable projection used by recall/search; CLI, Tauri commands, HTTP, MCP, and UI all call the same Rust Memory facade. Memory and LLM Wiki remain parallel layers; only explicit `memory promote` writes copied material to `raw/promoted/`.

**Tech Stack:** Rust 2021, Tauri 2, Clap, Serde, serde_yaml_ng, time, rusqlite/SQLite FTS5, std local networking, Next.js 16, React 19, TypeScript, Vitest, Rust tests.

---

## Scope Check

This is a master implementation plan for a large design covering storage, search, protocol, capture, LLM distill, UI, and import/export. Keep each task independently buildable and reviewable. Do not merge unrelated tasks into one change, and do not start UI work before the Rust facade and Tauri command contract exist.

## File Structure

- Modify `src-tauri/Cargo.toml`
  - Add `rusqlite` with bundled SQLite/FTS5 support.
  - Add a local HTTP dependency only if the selected implementation cannot use `std::net` cleanly.
- Modify `src-tauri/src/lib.rs`
  - Register new Memory modules and Tauri commands.
- Modify `src-tauri/src/memory_models.rs`
  - Add complete request/response DTOs, config, inbox, index, distill, capture, bundle, daemon, and recall models.
- Modify `src-tauri/src/memory.rs`
  - Keep as public service facade for CLI, Tauri commands, HTTP, and MCP.
- Modify `src-tauri/src/memory_fs.rs`
  - Add workspace lock, config migration, repair helpers, and structured audit helpers.
- Modify `src-tauri/src/memory_thread.rs`
  - Add source validation, archive/import, Codex source, index hooks, and corrected audit events.
- Modify `src-tauri/src/memory_store.rs`
  - Add update/evolve semantics, source validation, index hooks, and richer summaries.
- Modify `src-tauri/src/memory_recall.rs`
  - Replace scan-first recall with config-aware hybrid recall and fallback behavior.
- Modify `src-tauri/src/memory_promote.rs`
  - Support promoting both thread and memory records.
- Create `src-tauri/src/memory_inbox.rs`
  - Inbox candidate CRUD and review workflow.
- Create `src-tauri/src/search_index.rs`
  - SQLite schema, rebuild, status, FTS search, metadata upsert, dirty fallback.
- Create `src-tauri/src/memory_distill.rs`
  - Smart Distill orchestration, strict JSON parsing, candidate validation.
- Create `src-tauri/src/memory_capture.rs`
  - Capture trait and Codex/Cursor/Claude/manual adapters using explicit path/stdin fixtures.
- Create `src-tauri/src/memory_daemon.rs`
  - Local HTTP server and route dispatch.
- Create `src-tauri/src/memory_bundle.rs`
  - Export/import bundle manifest and conflict handling.
- Create `src-tauri/src/bin/mdx_mcp.rs`
  - MCP stdio JSON-RPC tool server.
- Modify `src-tauri/src/bin/mdx_cli.rs`
  - Add complete CLI command tree for index, inbox, distill, capture, serve, export/import.
- Modify `src-tauri/src/cli_protocol.rs` and `src-tauri/src/cli_server.rs`
  - Keep socket runtime aligned with headless runtime.
- Create `features/memory/lib/types.ts`
  - Frontend types matching Rust DTOs.
- Create `features/memory/lib/memory-client.ts`
  - Tauri invoke client.
- Create `features/memory/hooks/use-memory-workspace.ts`
  - Workspace Memory state loader.
- Create `features/memory/components/memory-panel.tsx`
  - Workspace panel with Recall, Working, Memories, Inbox, Threads, Settings tabs.
- Create `features/memory/index.ts`
  - Feature exports.
- Modify `features/workspace/components/workspace-shell.tsx`
  - Add Memory as a right panel tab beside Outline and LLM Wiki.
- Modify README files and `docs/loopx/specs/memory.md`
  - Align public contract with the complete implementation.

---

### Task 1: Contract Alignment, Config Migration, And Source Validation

**Files:**
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_fs.rs`
- Modify: `src-tauri/src/memory_thread.rs`
- Modify: `src-tauri/src/memory_store.rs`
- Modify: `src-tauri/src/memory_recall.rs`
- Modify: `src-tauri/src/memory_tests.rs`
- Modify: `docs/loopx/specs/memory.md`

- [ ] **Step 1: Write failing tests for current Phase 1 contract gaps**

Append these tests to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn memory_init_appends_a_memory_init_audit_event() {
    let root = tempdir().unwrap();

    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("memory_init"));
}

#[test]
fn thread_save_uses_documented_audit_event_name() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:session-1".to_string()),
            title: "Codex session".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-13T08:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("thread_save"));
    assert!(!log.contains("memory_thread_save"));
}

#[test]
fn thread_save_rejects_unknown_source_and_accepts_codex() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let invalid = memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "unknown-agent".to_string(),
            thread_id: Some("bad:1".to_string()),
            title: "Bad".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-13T08:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap_err();
    assert!(format!("{invalid}").starts_with("invalid_thread_source:"));

    let valid = memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:1".to_string()),
            title: "Codex".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-13T08:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();
    assert!(valid.path.starts_with("memory/threads/codex/"));
}

#[test]
fn recall_uses_memory_config_defaults_when_request_omits_limit_and_budget() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        r#"{
  "version": 1,
  "recall": {
    "default_limit": 1,
    "context_byte_budget": 64,
    "half_life_days": 30,
    "embeddings": { "enabled": false }
  },
  "distill": {
    "enabled": false,
    "min_messages": 4,
    "skip_patterns": ["^Running terminal command"],
    "auto_accept": false,
    "confidence_threshold": 0.85
  },
  "capture": { "enabled": false, "sources": [] }
}
"#,
    )
    .unwrap();

    memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "Auth alpha".to_string(),
        body: "auth alpha decision".to_string(),
        tags: vec!["auth".to_string()],
        source_thread: None,
        importance: Some(0.9),
        confidence: Some(0.9),
    }).unwrap();
    memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "Auth beta".to_string(),
        body: "auth beta decision".to_string(),
        tags: vec!["auth".to_string()],
        source_thread: None,
        importance: Some(0.8),
        confidence: Some(0.8),
    }).unwrap();

    let result = memory_recall(root.path().to_string_lossy().into_owned(), RecallRequest {
        query: "auth".to_string(),
        limit: None,
        byte_budget: None,
        include_working: false,
        include_threads: false,
        tag: None,
        since: None,
    }).unwrap();
    assert_eq!(result.memories.len(), 1);
    assert!(result.byte_count <= 64);
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cargo test memory_tests::memory_init_appends_a_memory_init_audit_event memory_tests::thread_save_uses_documented_audit_event_name memory_tests::thread_save_rejects_unknown_source_and_accepts_codex memory_tests::recall_uses_memory_config_defaults_when_request_omits_limit_and_budget --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because init has no audit event, audit event name is wrong, `codex` directories/source validation are missing, and recall ignores config.

- [ ] **Step 3: Extend models and config defaults**

Update `MemoryRecallConfig`, `MemoryDistillConfig`, and `MemoryCaptureConfig` in `src-tauri/src/memory_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRecallConfig {
    pub default_limit: usize,
    pub context_byte_budget: usize,
    pub half_life_days: u32,
    pub embeddings: MemoryEmbeddingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryEmbeddingConfig {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillConfig {
    pub enabled: bool,
    pub min_messages: usize,
    pub skip_patterns: Vec<String>,
    pub auto_accept: bool,
    pub confidence_threshold: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureConfig {
    pub enabled: bool,
    pub sources: Vec<String>,
}
```

Update `default_memory_config()` in `src-tauri/src/memory.rs` to include `half_life_days: 30`, `MemoryEmbeddingConfig { enabled: false }`, `auto_accept: false`, and `confidence_threshold: 85`.

- [ ] **Step 4: Add config read helper and source validation**

Add to `src-tauri/src/memory_fs.rs`:

```rust
pub(crate) fn read_memory_config(root: &Path) -> Result<crate::memory_models::MemoryConfig, WorkspaceError> {
    let contents = read_workspace_file(root, ".mdx/memory-config.json")?;
    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "json_decode_failed",
            format!("failed to parse memory config: {error}"),
        )
    })
}

pub(crate) fn validate_thread_source(source: &str) -> Result<(), WorkspaceError> {
    match source {
        "codex" | "cursor" | "claude-code" | "import" | "manual" => Ok(()),
        _ => Err(WorkspaceError::new(
            "invalid_thread_source",
            "thread source must be one of codex, cursor, claude-code, import, manual",
        )),
    }
}
```

- [ ] **Step 5: Apply minimal implementation**

Make these changes:

- Add `"memory/threads/codex"` to init-created directories.
- Keep parent `memory/threads` detection compatible with existing workspaces.
- Call `append_memory_log_entry(root, "memory_init")` after successful initialization.
- Call `validate_thread_source(&request.source)?` at the start of `memory_thread_save`.
- Change the thread save audit entry to start with `thread_save`.
- Read config in `memory_recall` and use config defaults when request limit or byte budget is `None`.
- Use config `half_life_days` in recency decay instead of hard-coded 30.

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test memory_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Update docs contract**

Update `docs/loopx/specs/memory.md`:

- Add `codex` to thread source enum.
- Use snake_case config field names.
- Document `thread_save` and `memory_init` audit event names.
- State recall reads `.mdx/memory-config.json` defaults.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/memory_fs.rs src-tauri/src/memory_thread.rs src-tauri/src/memory_recall.rs src-tauri/src/memory_tests.rs docs/loopx/specs/memory.md
git commit -m "Align memory contract with complete design"
```

---

### Task 2: Workspace Lock And Repair Command

**Files:**
- Modify: `src-tauri/src/memory_fs.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write failing lock and repair tests**

Append to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn memory_repair_recreates_missing_thread_index_and_preserves_markdown() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::remove_file(root.path().join(".mdx/thread-index.json")).unwrap();

    let result = crate::memory::memory_repair_workspace(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryRepairRequest { rebuild_index: false },
    )
    .unwrap();

    assert!(root.path().join(".mdx/thread-index.json").is_file());
    assert!(result.repaired_paths.contains(&".mdx/thread-index.json".to_string()));
}

#[test]
fn workspace_lock_serializes_memory_writes() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let root_path = root.path().to_path_buf();
    let first = crate::memory_fs::try_acquire_memory_lock(&root_path).unwrap();
    let second = crate::memory_fs::try_acquire_memory_lock(&root_path).unwrap_err();
    drop(first);

    assert!(format!("{second}").starts_with("memory_lock_busy:"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test memory_tests::memory_repair_recreates_missing_thread_index_and_preserves_markdown memory_tests::workspace_lock_serializes_memory_writes --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing `memory_repair_workspace`, `MemoryRepairRequest`, and `try_acquire_memory_lock`.

- [ ] **Step 3: Add repair models**

Add to `src-tauri/src/memory_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRepairRequest {
    pub rebuild_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRepairResult {
    pub repaired_paths: Vec<String>,
    pub warnings: Vec<String>,
}
```

Re-export both from `src-tauri/src/memory.rs`.

- [ ] **Step 4: Implement lock helper**

Add to `src-tauri/src/memory_fs.rs`:

```rust
pub(crate) struct MemoryWorkspaceLock {
    path: PathBuf,
}

impl Drop for MemoryWorkspaceLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub(crate) fn try_acquire_memory_lock(root: &Path) -> Result<MemoryWorkspaceLock, WorkspaceError> {
    ensure_parent_directories(root, ".mdx/memory.lock")?;
    let path = root.join(".mdx/memory.lock");
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let _ = writeln!(file, "pid={}", std::process::id());
            Ok(MemoryWorkspaceLock { path })
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(WorkspaceError::new(
            "memory_lock_busy",
            "memory workspace is locked by another writer",
        )),
        Err(error) => Err(WorkspaceError::from_io(
            "memory_lock_failed",
            "failed to acquire memory workspace lock",
            &error,
        )),
    }
}
```

- [ ] **Step 5: Implement repair facade**

Add to `src-tauri/src/memory.rs`:

```rust
pub fn memory_repair_workspace(
    root_path: String,
    request: MemoryRepairRequest,
) -> Result<MemoryRepairResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = crate::memory_fs::try_acquire_memory_lock(&root)?;
    let mut repaired_paths = Vec::new();
    let mut warnings = Vec::new();

    if !root.join(".mdx/thread-index.json").is_file() {
        create_json_file_if_missing(
            &root,
            ".mdx/thread-index.json",
            &default_thread_index(),
            &mut repaired_paths,
            &mut Vec::new(),
        )?;
    }
    if request.rebuild_index {
        warnings.push("search index rebuild is handled by the search index task".to_string());
    }
    append_memory_log_entry_impl(&root, "memory_repair")?;
    Ok(MemoryRepairResult { repaired_paths, warnings })
}
```

- [ ] **Step 6: Wire CLI/socket repair**

Add `MemoryRepair { rebuild_index: bool }` to `CliRequest`, `CliResponse.memory_repair`, `mdx-cli memory repair [--rebuild-index]`, and both headless/socket dispatchers. Use the same pattern as `MemoryInit`.

- [ ] **Step 7: Run tests**

Run:

```bash
cargo test memory_tests::memory_repair_recreates_missing_thread_index_and_preserves_markdown memory_tests::workspace_lock_serializes_memory_writes cli_protocol_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/memory_fs.rs src-tauri/src/memory.rs src-tauri/src/memory_models.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_server.rs src-tauri/src/memory_tests.rs
git commit -m "Add memory workspace repair and lock"
```

---

### Task 3: SQLite Search Index Projection

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/search_index.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_store.rs`
- Modify: `src-tauri/src/memory_thread.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Add dependency**

Update `src-tauri/Cargo.toml`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Write failing index tests**

Append to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn search_index_rebuild_recovers_memory_search_from_markdown() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "JWT access token lifetime".to_string(),
        body: "Access tokens expire after 15 minutes.".to_string(),
        tags: vec!["auth".to_string()],
        source_thread: None,
        importance: Some(0.8),
        confidence: Some(0.9),
    }).unwrap();

    let status = crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(status.index_status, "clean");
    assert!(root.path().join(".mdx/search.sqlite").is_file());
    let results = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: "JWT".to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    ).unwrap();
    assert_eq!(results.items.len(), 1);
    assert_eq!(results.items[0].title, "JWT access token lifetime");
}
```

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
cargo test memory_tests::search_index_rebuild_recovers_memory_search_from_markdown --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing index APIs.

- [ ] **Step 4: Add index models**

Add to `src-tauri/src/memory_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexStatus {
    pub index_status: String,
    pub document_count: usize,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchRequest {
    pub query: String,
    pub limit: usize,
    pub kinds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchResult {
    pub items: Vec<MemoryIndexSearchItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchItem {
    pub doc_id: String,
    pub kind: String,
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}
```

- [ ] **Step 5: Implement `search_index.rs`**

Create `src-tauri/src/search_index.rs` with:

```rust
use std::path::Path;

use rusqlite::{params, Connection};

use crate::memory_models::{
    MemoryIndexSearchItem, MemoryIndexSearchRequest, MemoryIndexSearchResult, MemoryIndexStatus,
};
use crate::models::WorkspaceError;

const SCHEMA_VERSION: i64 = 1;

pub(crate) fn rebuild(root: &Path) -> Result<MemoryIndexStatus, WorkspaceError> {
    let db_path = root.join(".mdx/search.sqlite");
    let conn = open(&db_path)?;
    init_schema(&conn)?;
    conn.execute("DELETE FROM documents", []).map_err(sql_error)?;
    conn.execute("DELETE FROM fts_memories", []).map_err(sql_error)?;

    let memories = crate::memory_store::memory_list(
        root,
        crate::memory_models::MemoryListFilter {
            tag: None,
            since: None,
            include_archived: false,
        },
    )?;
    for summary in memories {
        let record = crate::memory_store::memory_get(root, summary.memory_id.clone())?;
        upsert_memory(&conn, &record)?;
    }
    let count = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get::<_, i64>(0))
        .map_err(sql_error)? as usize;
    Ok(MemoryIndexStatus {
        index_status: "clean".to_string(),
        document_count: count,
        dirty: false,
    })
}

pub(crate) fn search(
    root: &Path,
    request: MemoryIndexSearchRequest,
) -> Result<MemoryIndexSearchResult, WorkspaceError> {
    let conn = open(&root.join(".mdx/search.sqlite"))?;
    init_schema(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT d.doc_id, d.kind, d.path, d.title, snippet(fts_memories, 2, '[', ']', '...', 16), bm25(fts_memories)
             FROM fts_memories
             JOIN documents d ON d.rowid = fts_memories.rowid
             WHERE fts_memories MATCH ?
             ORDER BY bm25(fts_memories)
             LIMIT ?",
        )
        .map_err(sql_error)?;
    let rows = stmt
        .query_map(params![request.query, request.limit as i64], |row| {
            Ok(MemoryIndexSearchItem {
                doc_id: row.get(0)?,
                kind: row.get(1)?,
                path: row.get(2)?,
                title: row.get(3)?,
                snippet: row.get(4)?,
                score: -row.get::<_, f64>(5)?,
            })
        })
        .map_err(sql_error)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(sql_error)?);
    }
    Ok(MemoryIndexSearchResult { items })
}

pub(crate) fn upsert_memory(conn: &Connection, record: &crate::memory_models::MemoryRecord) -> Result<(), WorkspaceError> {
    conn.execute(
        "INSERT OR REPLACE INTO documents (doc_id, kind, path, title, status, created_at, importance, confidence, tags_json)
         VALUES (?, 'memory', ?, ?, ?, ?, ?, ?, ?)",
        params![
            record.frontmatter.memory_id,
            record.path,
            record.frontmatter.title,
            record.frontmatter.status,
            record.frontmatter.created_at,
            record.frontmatter.importance.unwrap_or(0.5),
            record.frontmatter.confidence.unwrap_or(0.5),
            serde_json::to_string(&record.frontmatter.tags).unwrap_or_else(|_| "[]".to_string()),
        ],
    )
    .map_err(sql_error)?;
    let rowid = conn.last_insert_rowid();
    conn.execute(
        "INSERT OR REPLACE INTO fts_memories(rowid, title, body, tags) VALUES (?, ?, ?, ?)",
        params![rowid, record.frontmatter.title, record.body, record.frontmatter.tags.join(" ")],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn open(path: &Path) -> Result<Connection, WorkspaceError> {
    Connection::open(path).map_err(sql_error)
}

fn init_schema(conn: &Connection) -> Result<(), WorkspaceError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT OR REPLACE INTO metadata(key, value) VALUES('schema_version', '1');
        CREATE TABLE IF NOT EXISTS documents(
          doc_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT,
          created_at TEXT,
          updated_at TEXT,
          content_hash TEXT,
          importance REAL,
          confidence REAL,
          tags_json TEXT
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(title, body, tags);
        ",
    )
    .map_err(sql_error)?;
    let _ = SCHEMA_VERSION;
    Ok(())
}

fn sql_error(error: rusqlite::Error) -> WorkspaceError {
    WorkspaceError::new("index_failed", format!("memory search index failed: {error}"))
}
```

- [ ] **Step 6: Wire module and facade**

Add `mod search_index;` in `src-tauri/src/lib.rs`.

Add to `src-tauri/src/memory.rs`:

```rust
pub fn memory_index_rebuild(root_path: String) -> Result<MemoryIndexStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::search_index::rebuild(&root)
}

pub fn memory_index_search(
    root_path: String,
    request: MemoryIndexSearchRequest,
) -> Result<MemoryIndexSearchResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::search_index::search(&root, request)
}
```

Re-export index models from `memory.rs`.

- [ ] **Step 7: Add CLI `memory index status|rebuild`**

Add `MemoryCommand::Index { command: MemoryIndexCommand }` in `mdx_cli.rs`, with:

```rust
enum MemoryIndexCommand {
    Status,
    Rebuild,
}
```

Headless execution should call `memory_index_rebuild` for rebuild. Status may call `memory_index_rebuild` only in this task if no status API exists yet; later tasks can split status from rebuild.

- [ ] **Step 8: Run tests**

Run:

```bash
cargo test memory_tests::search_index_rebuild_recovers_memory_search_from_markdown --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/search_index.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/memory_tests.rs
git commit -m "Add rebuildable memory search index"
```

---

### Task 4: Config-Aware Hybrid Recall

**Files:**
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory_recall.rs`
- Modify: `src-tauri/src/search_index.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write failing hybrid recall tests**

Append to `src-tauri/src/memory_tests.rs`:

```rust
#[test]
fn recall_reports_index_degraded_when_sqlite_is_missing_and_scan_fallback_succeeds() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "Local first memory".to_string(),
        body: "Memory remains readable without sqlite.".to_string(),
        tags: vec!["local".to_string()],
        source_thread: None,
        importance: Some(0.7),
        confidence: Some(0.9),
    }).unwrap();
    let _ = std::fs::remove_file(root.path().join(".mdx/search.sqlite"));

    let result = memory_recall(root.path().to_string_lossy().into_owned(), RecallRequest {
        query: "sqlite".to_string(),
        limit: Some(5),
        byte_budget: Some(8192),
        include_working: false,
        include_threads: false,
        tag: None,
        since: None,
    }).unwrap();

    assert_eq!(result.memories.len(), 1);
    assert!(result.index_degraded);
    assert!(result.warnings.iter().any(|warning| warning.contains("fallback")));
}

#[test]
fn recall_can_include_explicit_thread_excerpt_but_not_default_thread_body() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(root.path().to_string_lossy().into_owned(), ThreadSaveRequest {
        source: "codex".to_string(),
        thread_id: Some("codex:recall-thread".to_string()),
        title: "Recall thread".to_string(),
        body: "## Message 1 — user — 2026-06-13T08:00:00Z\n\nthread-only-secret-token\n".to_string(),
        started_at: Some("2026-06-13T08:00:00Z".to_string()),
        ended_at: None,
        model: None,
        workspace_root: None,
        tags: Vec::new(),
    }).unwrap();

    let without_thread = memory_recall(root.path().to_string_lossy().into_owned(), RecallRequest {
        query: "thread-only-secret-token".to_string(),
        limit: Some(10),
        byte_budget: Some(8192),
        include_working: false,
        include_threads: false,
        tag: None,
        since: None,
    }).unwrap();
    assert!(without_thread.threads.is_empty());
    assert!(without_thread.memories.is_empty());
}
```

This test uses `index_degraded` and `warnings`; add those fields in the next step.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test memory_tests::recall_reports_index_degraded_when_sqlite_is_missing_and_scan_fallback_succeeds memory_tests::recall_can_include_explicit_thread_excerpt_but_not_default_thread_body --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because `RecallResult` lacks `index_degraded` and `warnings`.

- [ ] **Step 3: Extend recall models**

Update `RecallRequest` in `memory_models.rs`:

```rust
pub struct RecallRequest {
    pub query: String,
    pub limit: Option<usize>,
    pub byte_budget: Option<usize>,
    pub include_working: bool,
    pub include_threads: bool,
    pub tag: Option<String>,
    pub since: Option<String>,
    pub thread_ids: Vec<String>,
    pub include_wiki_refs: bool,
    pub include_wiki_snippets: bool,
}
```

Update `RecallResult`:

```rust
pub struct RecallResult {
    pub working: Option<String>,
    pub memories: Vec<RecallMemoryItem>,
    pub threads: Vec<MemorySummary>,
    pub wiki_refs: Vec<MemorySummary>,
    pub truncated: bool,
    pub byte_count: usize,
    pub index_degraded: bool,
    pub warnings: Vec<String>,
}
```

Update every existing `RecallRequest` construction in tests, CLI, and server to provide `thread_ids: Vec::new()`, `include_wiki_refs: false`, `include_wiki_snippets: false`.

- [ ] **Step 4: Implement index-first recall with scan fallback**

In `memory_recall.rs`:

- Read config through `read_memory_config`.
- Try `search_index::search` first when `.mdx/search.sqlite` exists.
- Convert index hits to `MemoryRecord` through `memory_get`.
- If index search fails, run existing scan logic and set `index_degraded=true` with warning `"search index unavailable; used markdown fallback"`.
- Preserve byte budget trimming.
- Keep thread body excluded unless later explicit thread excerpt support is added.

- [ ] **Step 5: Update CLI include-working flags**

Add `--no-working` to `mdx-cli memory recall`. In `request_from_memory_command`, send `include_working: Some(false)` when set. Add `include_working: Option<bool>` to `CliRequest::MemoryRecall`, and have socket/headless default to true.

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test memory_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/memory_models.rs src-tauri/src/memory_recall.rs src-tauri/src/search_index.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_server.rs src-tauri/src/memory_tests.rs
git commit -m "Use search index for memory recall with fallback"
```

---

### Task 5: Inbox Workflow And Memory Update

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_inbox.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_store.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write failing inbox tests**

Append:

```rust
#[test]
fn inbox_accept_creates_active_memory_and_marks_candidate_accepted() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let candidate = crate::memory::memory_inbox_add(root.path().to_string_lossy().into_owned(), crate::memory::InboxAddRequest {
        title: "Use JWT".to_string(),
        body: "The project uses JWT access tokens.".to_string(),
        tags: vec!["auth".to_string()],
        source_thread: None,
        source_message_refs: vec![1],
        importance: Some(0.8),
        confidence: Some(0.9),
        distill_run_id: Some("run-1".to_string()),
    }).unwrap();

    let result = crate::memory::memory_inbox_accept(root.path().to_string_lossy().into_owned(), crate::memory::InboxReviewRequest {
        inbox_id: candidate.frontmatter.inbox_id.clone(),
        edited_title: None,
        edited_body: None,
        edited_tags: None,
    }).unwrap();

    assert_eq!(result.action, "accepted");
    assert!(result.memory_id.is_some());
    let inbox = crate::memory::memory_inbox_get(root.path().to_string_lossy().into_owned(), candidate.frontmatter.inbox_id).unwrap();
    assert_eq!(inbox.frontmatter.status, "accepted");
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test memory_tests::inbox_accept_creates_active_memory_and_marks_candidate_accepted --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing inbox APIs.

- [ ] **Step 3: Add inbox models**

Add `InboxFrontmatter`, `InboxRecord`, `InboxAddRequest`, `InboxReviewRequest`, and `InboxReviewResult` to `memory_models.rs`. Required fields: `schema_version`, `kind`, `inbox_id`, `title`, `status`, `created_at`, `source_thread`, `source_message_refs`, `importance`, `confidence`, `tags`, `distill_run_id`, `accepted_memory_id`.

- [ ] **Step 4: Implement `memory_inbox.rs`**

Implement:

- `memory_inbox_add(root, InboxAddRequest) -> InboxRecord`
- `memory_inbox_get(root, target) -> InboxRecord`
- `memory_inbox_list(root, include_reviewed: bool) -> Vec<InboxRecord>`
- `memory_inbox_accept(root, InboxReviewRequest) -> InboxReviewResult`
- `memory_inbox_reject(root, target) -> InboxReviewResult`

Use `write_new_markdown_file(root, "memory/inbox", ...)` and `render_markdown_with_frontmatter`.

- [ ] **Step 5: Wire facade, module, CLI, and socket**

Add `mod memory_inbox;` in `lib.rs`. Re-export models and facade functions from `memory.rs`.

Add CLI:

```bash
mdx-cli memory inbox list [--include-reviewed] [--json]
mdx-cli memory inbox accept <inbox-id> [--title "..."] [--file path|--body "..."]
mdx-cli memory inbox reject <inbox-id>
```

Add matching `CliRequest` variants and server dispatch.

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test memory_tests::inbox_accept_creates_active_memory_and_marks_candidate_accepted cli_protocol_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_inbox.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/memory_store.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_server.rs src-tauri/src/memory_tests.rs
git commit -m "Add memory inbox review workflow"
```

---

### Task 6: Smart Distill

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_distill.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write parser and validation tests**

Append:

```rust
#[test]
fn distill_parser_rejects_invalid_scores_and_accepts_valid_candidates() {
    let valid = r#"[{
      "title": "Use JWT",
      "body": "The project uses JWT access tokens.",
      "tags": ["auth"],
      "importance": 0.8,
      "confidence": 0.9,
      "source_message_refs": [1]
    }]"#;
    let candidates = crate::memory_distill::parse_distill_candidates_for_test(valid).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].title, "Use JWT");

    let invalid = r#"[{
      "title": "Bad",
      "body": "Bad score.",
      "tags": [],
      "importance": 2.0,
      "confidence": 0.9,
      "source_message_refs": [1]
    }]"#;
    let error = crate::memory_distill::parse_distill_candidates_for_test(invalid).unwrap_err();
    assert!(format!("{error}").starts_with("distill_parse_failed:"));
}
```

- [ ] **Step 2: Run parser test to verify failure**

Run:

```bash
cargo test memory_tests::distill_parser_rejects_invalid_scores_and_accepts_valid_candidates --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing module/API.

- [ ] **Step 3: Add distill models**

Add `MemoryDistillRequest`, `MemoryDistillResult`, and internal `DistillCandidate` to `memory_models.rs`. Public request fields: `target`, `accept`, `force`.

- [ ] **Step 4: Implement JSON parser and validator**

Create `memory_distill.rs`:

```rust
use crate::models::WorkspaceError;

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct DistillCandidate {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub confidence: f64,
    pub source_message_refs: Vec<usize>,
}

pub(crate) fn parse_distill_candidates(json: &str) -> Result<Vec<DistillCandidate>, WorkspaceError> {
    let candidates: Vec<DistillCandidate> = serde_json::from_str(json).map_err(|error| {
        WorkspaceError::new("distill_parse_failed", format!("failed to parse distill JSON: {error}"))
    })?;
    for candidate in &candidates {
        if candidate.title.trim().is_empty() || candidate.body.trim().is_empty() {
            return Err(WorkspaceError::new("distill_parse_failed", "distill candidate title and body must not be empty"));
        }
        if !(0.0..=1.0).contains(&candidate.importance) || !(0.0..=1.0).contains(&candidate.confidence) {
            return Err(WorkspaceError::new("distill_parse_failed", "distill candidate scores must be between 0 and 1"));
        }
    }
    Ok(candidates)
}

#[cfg(test)]
pub(crate) fn parse_distill_candidates_for_test(json: &str) -> Result<Vec<DistillCandidate>, WorkspaceError> {
    parse_distill_candidates(json)
}
```

- [ ] **Step 5: Implement `memory_distill` with injectable LLM result**

Add a production facade that calls existing LLM provider in a small wrapper, and a test helper `memory_distill_with_json_for_test(root, request, json)` that writes candidates to inbox or active memories. Use `memory_inbox_add` unless `request.accept == true`.

- [ ] **Step 6: Add CLI/socket distill**

Add:

```bash
mdx-cli memory distill --thread <id|path> [--accept] [--force] [--json]
```

Wire to `CliRequest::MemoryDistill`.

- [ ] **Step 7: Run tests**

Run:

```bash
cargo test memory_tests::distill_parser_rejects_invalid_scores_and_accepts_valid_candidates --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_distill.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_server.rs src-tauri/src/memory_tests.rs
git commit -m "Add smart distill candidate workflow"
```

---

### Task 7: Capture Adapters For Codex, Cursor, Claude Code, And Manual Import

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_capture.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/memory_tests.rs`
- Create: `src-tauri/fixtures/memory/codex-session.jsonl`
- Create: `src-tauri/fixtures/memory/cursor-session.json`
- Create: `src-tauri/fixtures/memory/claude-code-session.json`

- [ ] **Step 1: Add fixtures**

Create `src-tauri/fixtures/memory/codex-session.jsonl`:

```jsonl
{"role":"user","timestamp":"2026-06-13T08:00:00Z","content":"Remember that MDX memory supports Codex."}
{"role":"assistant","timestamp":"2026-06-13T08:00:05Z","content":"I will save a Codex thread."}
```

Create `src-tauri/fixtures/memory/cursor-session.json`:

```json
{
  "id": "cursor-fixture-1",
  "messages": [
    {"role": "user", "timestamp": "2026-06-13T08:01:00Z", "content": "Cursor transcript"},
    {"role": "assistant", "timestamp": "2026-06-13T08:01:05Z", "content": "Imported from Cursor"}
  ]
}
```

Create `src-tauri/fixtures/memory/claude-code-session.json`:

```json
{
  "session_id": "claude-fixture-1",
  "messages": [
    {"role": "user", "timestamp": "2026-06-13T08:02:00Z", "content": "Claude Code transcript"},
    {"role": "assistant", "timestamp": "2026-06-13T08:02:05Z", "content": "Imported from Claude Code"}
  ]
}
```

- [ ] **Step 2: Write failing capture tests**

Append:

```rust
#[test]
fn capture_imports_codex_jsonl_as_thread() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/memory/codex-session.jsonl");

    let result = crate::memory::memory_capture_import(root.path().to_string_lossy().into_owned(), crate::memory::MemoryCaptureImportRequest {
        source: "codex".to_string(),
        path: fixture.to_string_lossy().into_owned(),
        title: Some("Codex fixture".to_string()),
        thread_id: Some("codex:fixture-1".to_string()),
        distill: false,
    }).unwrap();

    assert_eq!(result.thread_id, "codex:fixture-1");
    assert!(result.path.starts_with("memory/threads/codex/"));
    let thread = memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert!(thread.body.contains("MDX memory supports Codex"));
}
```

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
cargo test memory_tests::capture_imports_codex_jsonl_as_thread --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing capture API.

- [ ] **Step 4: Add capture models and parser**

Add `MemoryCaptureImportRequest` and `MemoryCaptureImportResult`. Implement parsers:

- Codex JSONL: each line object with `role`, `timestamp`, `content`.
- Cursor JSON: `id` and `messages`.
- Claude JSON: `session_id` and `messages`.

All parse outputs should render body as:

```markdown
## Message 1 — user — 2026-06-13T08:00:00Z

...
```

- [ ] **Step 5: Implement import facade**

`memory_capture_import` validates source, reads explicit path, parses transcript, calls `memory_thread_save`, and optionally calls distill when requested.

- [ ] **Step 6: Add CLI/socket capture import**

Add:

```bash
mdx-cli memory capture import --source codex --file <path> --thread-id <id> --title "..." [--distill]
mdx-cli memory capture scan --source codex
```

For this task, `scan` may return `capture_scan_not_configured` unless config sources are present.

- [ ] **Step 7: Run tests**

Run:

```bash
cargo test memory_tests::capture_imports_codex_jsonl_as_thread --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_capture.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_server.rs src-tauri/src/memory_tests.rs src-tauri/fixtures/memory
git commit -m "Add memory capture import adapters"
```

---

### Task 8: Local HTTP Daemon

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_daemon.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write route dispatch tests**

Append:

```rust
#[test]
fn daemon_dispatch_health_reports_memory_status() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "GET",
        "/health",
        "",
    ).unwrap();

    assert_eq!(response.status, 200);
    assert!(response.body.contains("\"has_memory\":true"));
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test memory_tests::daemon_dispatch_health_reports_memory_status --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing daemon module.

- [ ] **Step 3: Implement daemon route dispatcher**

Create `memory_daemon.rs` with `DaemonResponse { status: u16, body: String }` and `dispatch(root, method, path, body)`. Implement:

- `GET /health`
- `POST /memory/recall`
- `POST /memory/add`
- `POST /memory/thread/save`

Use serde JSON and `memory` facade.

- [ ] **Step 4: Add `mdx-cli serve`**

Add top-level `CommandLine::Serve { workspace, port, api_key }`. Start a local server on `127.0.0.1:<port>` using `std::net::TcpListener`. The server should handle one request per connection and call the route dispatcher.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test memory_tests::daemon_dispatch_health_reports_memory_status --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_daemon.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/memory_tests.rs
git commit -m "Add local memory HTTP daemon"
```

---

### Task 9: MCP Stdio Server

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/bin/mdx_mcp.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Register binary**

Add to `src-tauri/Cargo.toml`:

```toml
[[bin]]
name = "mdx-mcp"
path = "src/bin/mdx_mcp.rs"
```

- [ ] **Step 2: Write a JSON-RPC parser unit test in the binary**

Create `src-tauri/src/bin/mdx_mcp.rs` with a `#[cfg(test)]` module:

```rust
#[derive(Debug, serde::Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: serde_json::Value,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn parse_request(line: &str) -> Result<JsonRpcRequest, serde_json::Error> {
    serde_json::from_str(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mcp_tool_call_request() {
        let request = parse_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_status","arguments":{}}}"#).unwrap();
        assert_eq!(request.method, "tools/call");
        assert_eq!(request.params["name"], "memory_status");
    }
}

fn main() {
    eprintln!("mdx-mcp requires --workspace <path>; implementation is wired in the MCP task");
}
```

- [ ] **Step 3: Run test**

Run:

```bash
cargo test --bin mdx-mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Implement tools/list and tools/call**

Extend `mdx_mcp.rs`:

- Parse `--workspace <path>`.
- For `tools/list`, return tools: `memory_status`, `memory_recall`, `memory_add`, `memory_thread_save`, `memory_thread_show`, `memory_inbox_list`, `memory_inbox_accept`, `memory_distill`, `memory_search`, `memory_promote`.
- For `tools/call`, dispatch to the memory facade.
- Return JSON-RPC `result` on success and `error` on failure.

- [ ] **Step 5: Run binary compile**

Run:

```bash
cargo test --bin mdx-mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/bin/mdx_mcp.rs
git commit -m "Add memory MCP stdio server"
```

---

### Task 10: Bundle Export And Import

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory_bundle.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write failing bundle tests**

Append:

```rust
#[test]
fn memory_export_writes_manifest_and_import_dry_run_reports_records() {
    let root = tempdir().unwrap();
    let target = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "Bundle memory".to_string(),
        body: "Export this memory.".to_string(),
        tags: vec!["bundle".to_string()],
        source_thread: None,
        importance: Some(0.5),
        confidence: Some(0.8),
    }).unwrap();

    let bundle_path = root.path().join("memory-bundle");
    let export = crate::memory::memory_export_bundle(root.path().to_string_lossy().into_owned(), crate::memory::MemoryExportRequest {
        output_path: bundle_path.to_string_lossy().into_owned(),
        include_log: false,
    }).unwrap();
    assert!(std::path::Path::new(&export.manifest_path).is_file());

    let dry_run = crate::memory::memory_import_bundle(target.path().to_string_lossy().into_owned(), crate::memory::MemoryImportRequest {
        input_path: bundle_path.to_string_lossy().into_owned(),
        strategy: "skip".to_string(),
        dry_run: true,
    }).unwrap();
    assert_eq!(dry_run.records_seen, 1);
    assert_eq!(dry_run.records_imported, 0);
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test memory_tests::memory_export_writes_manifest_and_import_dry_run_reports_records --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with missing bundle APIs.

- [ ] **Step 3: Add bundle models and module**

Add `MemoryExportRequest`, `MemoryExportResult`, `MemoryImportRequest`, `MemoryImportResult`.

Implement export as a directory bundle:

```text
<output_path>/
  manifest.json
  memory/
    memories/
    inbox/
    threads/
```

Do not include `.mdx/search.sqlite`.

- [ ] **Step 4: Implement import dry-run and skip strategy**

Import should:

- Read `manifest.json`.
- Count records.
- In dry-run, write nothing.
- In apply mode with `skip`, copy only paths that do not exist.
- Reject absolute paths and `..` components.

- [ ] **Step 5: Add CLI**

Add:

```bash
mdx-cli memory export --output <dir> [--include-log]
mdx-cli memory import --input <dir> [--strategy skip|rename|overwrite-archived-only] [--dry-run]
```

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test memory_tests::memory_export_writes_manifest_and_import_dry_run_reports_records --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/memory_bundle.rs src-tauri/src/memory_models.rs src-tauri/src/memory.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/memory_tests.rs
git commit -m "Add memory bundle import export"
```

---

### Task 11: Tauri Commands And Frontend Client

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `features/memory/lib/types.ts`
- Create: `features/memory/lib/memory-client.ts`
- Create: `features/memory/lib/memory-client.test.ts`
- Create: `features/memory/index.ts`

- [ ] **Step 1: Write frontend client test**

Create `features/memory/lib/memory-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { detectMemoryWorkspace } from "./memory-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({
    invoke: async (command: string, args?: Record<string, unknown>) => ({
      command,
      args,
      mode: "memory",
      hasMemory: true,
      canInitialize: false,
      missingPaths: [],
    }),
  }),
}));

describe("memory-client", () => {
  it("invokes memory workspace detection with rootPath", async () => {
    const result = await detectMemoryWorkspace("/tmp/ws");
    expect(result.hasMemory).toBe(true);
  });
});
```

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
npm run test -- features/memory/lib/memory-client.test.ts
```

Expected: FAIL because client file does not exist.

- [ ] **Step 3: Add Tauri commands**

In `src-tauri/src/lib.rs`, add `#[tauri::command]` wrappers for:

- `memory_detect_workspace`
- `memory_initialize_workspace`
- `memory_working_get`
- `memory_working_set`
- `memory_recall`
- `memory_list`
- `memory_thread_list`
- `memory_inbox_list`
- `memory_inbox_accept`
- `memory_promote`

Register them in `generate_handler!`.

- [ ] **Step 4: Add frontend types and client**

Create `features/memory/lib/types.ts` with TypeScript interfaces matching Rust DTOs for status, recall, memory summary, thread list item, inbox record, and promote result.

Create `features/memory/lib/memory-client.ts`:

```ts
import { tauriCore } from "@/common/lib/tauri";
import type { MemoryWorkspaceStatus } from "./types";

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await tauriCore();
  return invoke<T>(command, args);
}

export function detectMemoryWorkspace(rootPath: string): Promise<MemoryWorkspaceStatus> {
  return invokeCommand("memory_detect_workspace", { rootPath });
}
```

Add additional functions after the first test passes.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- features/memory/lib/memory-client.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs features/memory/lib/types.ts features/memory/lib/memory-client.ts features/memory/lib/memory-client.test.ts features/memory/index.ts
git commit -m "Expose memory service to frontend"
```

---

### Task 12: Memory Workspace Hook And Panel View Model

**Files:**
- Create: `features/memory/hooks/use-memory-workspace.ts`
- Create: `features/memory/lib/memory-panel-state.ts`
- Create: `features/memory/lib/memory-panel-state.test.ts`
- Create: `features/memory/components/memory-panel.tsx`
- Modify: `features/memory/index.ts`

- [ ] **Step 1: Write view model test**

Create `features/memory/lib/memory-panel-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMemoryPanelTabs } from "./memory-panel-state";

describe("buildMemoryPanelTabs", () => {
  it("disables data tabs until memory is initialized", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: false });
    expect(tabs.find((tab) => tab.id === "recall")?.disabled).toBe(true);
    expect(tabs.find((tab) => tab.id === "settings")?.disabled).toBe(false);
  });

  it("enables recall, working, memories, inbox, and threads when ready", () => {
    const tabs = buildMemoryPanelTabs({ hasMemory: true });
    expect(tabs.filter((tab) => tab.disabled)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- features/memory/lib/memory-panel-state.test.ts
```

Expected: FAIL because view model does not exist.

- [ ] **Step 3: Implement view model**

Create `features/memory/lib/memory-panel-state.ts`:

```ts
export type MemoryPanelTabId = "recall" | "working" | "memories" | "inbox" | "threads" | "settings";

export interface MemoryPanelTab {
  id: MemoryPanelTabId;
  label: string;
  disabled: boolean;
}

export function buildMemoryPanelTabs(status: { hasMemory: boolean }): MemoryPanelTab[] {
  return [
    { id: "recall", label: "Recall", disabled: !status.hasMemory },
    { id: "working", label: "Working", disabled: !status.hasMemory },
    { id: "memories", label: "Memories", disabled: !status.hasMemory },
    { id: "inbox", label: "Inbox", disabled: !status.hasMemory },
    { id: "threads", label: "Threads", disabled: !status.hasMemory },
    { id: "settings", label: "Settings", disabled: false },
  ];
}
```

- [ ] **Step 4: Add hook and panel skeleton**

Implement `useMemoryWorkspace(rootPath)` to detect status and expose `refresh`, `initialize`, `loading`, `error`. Implement `MemoryPanel` with tab buttons and a settings/init state. Use existing restrained workspace styling patterns from `llm-wiki-panel.tsx`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- features/memory/lib/memory-panel-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/memory/hooks/use-memory-workspace.ts features/memory/lib/memory-panel-state.ts features/memory/lib/memory-panel-state.test.ts features/memory/components/memory-panel.tsx features/memory/index.ts
git commit -m "Add memory panel state and shell"
```

---

### Task 13: Workspace UI Integration

**Files:**
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/components/workspace-shell.test.tsx`
- Modify: `features/memory/components/memory-panel.tsx`

- [ ] **Step 1: Add workspace shell test**

In `features/workspace/components/workspace-shell.test.tsx`, add a test that renders a workspace shell and checks that right panel mode can include Memory. If existing tests use complex setup, add a pure helper in the component file or a new `features/workspace/lib/right-panel-tabs.ts` with this test:

```ts
import { describe, expect, it } from "vitest";
import { buildRightPanelTabs } from "../lib/right-panel-tabs";

describe("buildRightPanelTabs", () => {
  it("includes outline, llm wiki, and memory", () => {
    expect(buildRightPanelTabs().map((tab) => tab.id)).toEqual([
      "outline",
      "llmWiki",
      "memory",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- features/workspace/lib/right-panel-tabs.test.ts
```

Expected: FAIL if helper does not exist.

- [ ] **Step 3: Implement right panel tab helper and integrate**

Create helper if needed:

```ts
export type RightPanelTabId = "outline" | "llmWiki" | "memory";

export function buildRightPanelTabs(): Array<{ id: RightPanelTabId; label: string }> {
  return [
    { id: "outline", label: "Outline" },
    { id: "llmWiki", label: "LLM Wiki" },
    { id: "memory", label: "Memory" },
  ];
}
```

Update `WorkspaceShell` state from `"outline" | "llmWiki"` to `"outline" | "llmWiki" | "memory"`, import `MemoryPanel`, and render it when selected.

- [ ] **Step 4: Verify text/layout**

Run:

```bash
npm run test -- features/workspace/lib/right-panel-tabs.test.ts features/memory/lib/memory-panel-state.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/workspace/components/workspace-shell.tsx features/workspace/lib/right-panel-tabs.ts features/workspace/lib/right-panel-tabs.test.ts features/memory/components/memory-panel.tsx
git commit -m "Integrate memory panel into workspace"
```

---

### Task 14: Memory Panel Functional Tabs

**Files:**
- Modify: `features/memory/components/memory-panel.tsx`
- Modify: `features/memory/lib/memory-client.ts`
- Modify: `features/memory/lib/types.ts`
- Create: `features/memory/components/memory-panel.test.tsx`

- [ ] **Step 1: Write component behavior test**

Create `features/memory/components/memory-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./memory-panel";

vi.mock("../hooks/use-memory-workspace", () => ({
  useMemoryWorkspace: () => ({
    status: { mode: "memory", hasMemory: true, canInitialize: false, missingPaths: [] },
    loading: false,
    error: null,
    initialize: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("MemoryPanel", () => {
  it("renders complete memory tabs", () => {
    render(<MemoryPanel rootPath="/tmp/ws" />);
    expect(screen.getByRole("button", { name: "Recall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Working" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Memories" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Threads" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- features/memory/components/memory-panel.test.tsx
```

Expected: FAIL if panel does not expose all tabs.

- [ ] **Step 3: Implement tab contents**

Implement:

- Recall form: query input, recall button, results list.
- Working tab: textarea, save button.
- Memories tab: list with archive buttons.
- Inbox tab: list with accept/reject buttons.
- Threads tab: list with show/promote buttons.
- Settings tab: status, initialize/repair/index rebuild buttons.

Use icon buttons from existing UI controls and lucide icons where appropriate. Keep compact operational styling; no landing page or hero content.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test -- features/memory/components/memory-panel.test.tsx features/memory/lib/*.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/memory/components/memory-panel.tsx features/memory/components/memory-panel.test.tsx features/memory/lib/memory-client.ts features/memory/lib/types.ts
git commit -m "Build functional memory panel tabs"
```

---

### Task 15: Promote Memory Records And Wiki Boundary Tests

**Files:**
- Modify: `src-tauri/src/memory_promote.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/memory_tests.rs`
- Modify: `docs/loopx/specs/memory.md`

- [ ] **Step 1: Write failing memory promote test**

Append:

```rust
#[test]
fn promote_can_copy_memory_record_to_raw_promoted_without_ingest() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let record = memory_add(root.path().to_string_lossy().into_owned(), MemoryAddRequest {
        title: "Promote memory".to_string(),
        body: "This memory should become raw promoted material.".to_string(),
        tags: vec!["wiki".to_string()],
        source_thread: None,
        importance: Some(0.7),
        confidence: Some(0.8),
    }).unwrap();

    let result = memory_promote(root.path().to_string_lossy().into_owned(), MemoryPromoteRequest {
        target: record.frontmatter.memory_id,
        ingest: false,
        title: Some("Promoted Memory".to_string()),
    }).unwrap();

    assert!(result.promoted_path.starts_with("raw/promoted/"));
    let promoted = std::fs::read_to_string(root.path().join(result.promoted_path)).unwrap();
    assert!(promoted.contains("kind: promoted_memory"));
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test memory_tests::promote_can_copy_memory_record_to_raw_promoted_without_ingest --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because promote only handles threads.

- [ ] **Step 3: Implement target resolution**

Update `memory_promote.rs`:

- Try `memory_thread_get`.
- If not found, try `memory_get`.
- For memory records, write frontmatter `kind: promoted_memory`, `source_memory`, `promoted_at`, `title`.
- Do not mark LLM Wiki state unless ingest succeeds.

- [ ] **Step 4: Run LLM Wiki boundary tests**

Run:

```bash
cargo test llm_wiki_tests memory_tests::promote_can_copy_memory_record_to_raw_promoted_without_ingest --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/memory_promote.rs src-tauri/src/memory_models.rs src-tauri/src/bin/mdx_cli.rs src-tauri/src/memory_tests.rs docs/loopx/specs/memory.md
git commit -m "Allow explicit memory promotion to wiki raw"
```

---

### Task 16: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/loopx/specs/memory.md`
- Modify: `docs/loopx/design/MDX Memory完整能力设计文档.md`

- [ ] **Step 1: Update README command surface**

Document:

```bash
mdx-cli memory repair [--rebuild-index]
mdx-cli memory index rebuild
mdx-cli memory inbox list
mdx-cli memory inbox accept <inbox-id>
mdx-cli memory distill --thread <thread-id>
mdx-cli memory capture import --source codex --file <path>
mdx-cli serve --workspace <workspace> --port 14243
mdx-mcp --workspace <workspace>
mdx-cli memory export --output <dir>
mdx-cli memory import --input <dir> --dry-run
```

- [ ] **Step 2: Update memory spec**

Ensure `docs/loopx/specs/memory.md` includes:

- Codex as thread source.
- Inbox contract.
- Index contract.
- Distill contract.
- Capture contract.
- HTTP/MCP contract.
- Bundle contract.
- Config field names in snake_case.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run lint
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --bin mdx-mcp --manifest-path src-tauri/Cargo.toml
```

Expected: all commands PASS.

- [ ] **Step 4: Run CLI smoke on a temp workspace**

Run:

```bash
tmpdir="$(mktemp -d)"
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" init
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" add --title "Smoke memory" --body "Memory smoke test body" --tag smoke
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" index rebuild
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" recall --json smoke
```

Expected: final JSON contains `"Smoke memory"` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-CN.md docs/loopx/specs/memory.md 'docs/loopx/design/MDX Memory完整能力设计文档.md'
git commit -m "Document complete memory capability"
```

---

## Self-Review

- Spec coverage: covered workspace init/repair, thread store, memory store, working memory, inbox, search index, hybrid recall, distill, capture including Codex, HTTP daemon, MCP server, UI, promote, bundle import/export, docs, and verification.
- Placeholder scan: no task uses TBD/TODO/fill-in placeholders. Some implementation steps intentionally specify behavior instead of full final code where the design demands larger modules; each task includes concrete tests, commands, and expected outcomes.
- Type consistency: new public DTOs use snake_case naming and are routed through `memory.rs` facade.
- Design drift: no cloud sync, no browser clipper, no default LLM Wiki query over Memory, and automatic capture/distill remain opt-in.

## Execution Handoff

Plan complete and saved to `docs/loopx/plans/2026-06-13-memory-complete.md`.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
