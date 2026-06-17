# MDX Memory Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [docs/loopx/design/MDX Memory层与LLM Wiki并列架构需求设计文档.md](../design/MDX%20Memory%E5%B1%82%E4%B8%8ELLM%20Wiki%E5%B9%B6%E5%88%97%E6%9E%B6%E6%9E%84%E9%9C%80%E6%B1%82%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md), [`.loopx/intake/clarify-mdx-memory-phase-one-20260612.md`](../../../.loopx/intake/clarify-mdx-memory-phase-one-20260612.md)

**Goal:** Add a Phase 1 Memory layer to MDX that can initialize a memory-enabled workspace, store full thread snapshots and atomic memories as Markdown, support recall and working memory, promote threads into `raw/promoted/`, and expose the whole flow through `mdx-cli memory` in both Workspace Mode socket and explicit `--root` headless modes.

**Architecture:** Keep Memory and LLM Wiki as parallel layers. Implement Memory as new Rust modules under `src-tauri/src/` that own `memory/` and `.mdx/` contracts, reuse only shared workspace primitives such as path canonicalization and the root audit log, and avoid adding any dependency from `llm_wiki_*` back into Memory. Phase 1 stays CLI-first: no Memory UI, no Tauri invoke handlers, no sqlite/vector indexing, and no daemon/MCP work in this plan.

**Tech Stack:** Rust, Tauri 2, Clap, Serde JSON, `serde_yaml_ng` for frontmatter, `time` for RFC3339 timestamps, Markdown files as source of truth.

---

## Scope Note

This plan intentionally covers **Phase 1 only**. The design doc also sketches Phase 2 search indexing and Phase 3 daemon/MCP work, but those are separate deliverables and should be planned after Phase 1 acceptance. Do not add `search.sqlite`, `mdx serve`, MCP, transcript auto-capture, or frontend Memory panels in this execution plan.

## File Structure

- Modify `docs/loopx/design/MDX Memory层与LLM Wiki并列架构需求设计文档.md`
  - Align the design doc with the accepted clarify decisions before implementation.
- Modify `docs/loopx/specs/memory.md`
  - Make the Memory contract match the Phase 1 implementation decisions exactly.
- Modify `src-tauri/Cargo.toml`
  - Add maintained dependencies for frontmatter and RFC3339 timestamps.
- Modify `src-tauri/src/lib.rs`
  - Register new Memory modules and tests only.
  - Do **not** add Tauri `generate_handler![]` entries in Phase 1.
- Create `src-tauri/src/memory.rs`
  - Public Memory facade used by `mdx-cli` headless mode and `cli_server` socket mode.
- Create `src-tauri/src/memory_models.rs`
  - Phase 1 Memory DTOs, frontmatter structs, list/recall results, and config/index models.
- Create `src-tauri/src/memory_fs.rs`
  - Workspace detection/init, safe relative writes, frontmatter parse/render, log append, index/config IO, slug/date helpers.
- Create `src-tauri/src/memory_thread.rs`
  - Thread save/show/list and thread-index dedup logic.
- Create `src-tauri/src/memory_store.rs`
  - Atomic memory add/show/list/search/archive logic.
- Create `src-tauri/src/memory_working.rs`
  - `memory/working.md` get/set/append logic.
- Create `src-tauri/src/memory_recall.rs`
  - Recall/search ranking, byte-budget trimming, working-memory inclusion, archived filtering.
- Create `src-tauri/src/memory_promote.rs`
  - Thread-to-`raw/promoted/` copy and optional Wiki ingest bridge.
- Create `src-tauri/src/memory_tests.rs`
  - Rust integration-style unit tests for the new Memory layer.
- Modify `src-tauri/src/cli_protocol.rs`
  - Add Memory request variants and Memory response fields, parallel to existing `LlmWiki*`.
- Modify `src-tauri/src/cli_protocol_tests.rs`
  - Cover Memory command parsing and Memory response JSON shape.
- Modify `src-tauri/src/cli_server.rs`
  - Dispatch socket-based `memory *` requests against the active workspace root.
- Modify `src-tauri/src/bin/mdx_cli.rs`
  - Add the `memory` command family, `--root` headless execution, local file/stdin loading, and output rendering.
- Modify `README.md`, `README.zh-CN.md`
  - Document the new `mdx-cli memory` surface and the `--root` runtime boundary.

---

### Task 1: Align The Design And Contract Docs

**Files:**
- Modify: `docs/loopx/design/MDX Memory层与LLM Wiki并列架构需求设计文档.md`
- Modify: `docs/loopx/specs/memory.md`

- [ ] **Step 1: Patch the design doc so it matches the accepted clarify bundle**

Update the decision table and detailed design sections with these exact replacements:

```markdown
| 决策 | 结论 |
|---|---|
| Memory 模块是否放在 `llm_wiki_*` 内 | **否**。独立 `memory_*` Rust 模块组 |
| 完整对话存哪 | `memory/threads/` |
| 原子记忆存哪 | `memory/memories/` |
| Working Memory 存哪 | `memory/working.md` |
| LLM Wiki 的 raw/wiki 是否改动 | **保留**；提升时仅复制到 `raw/promoted/` |
| CLI 命令命名 | `mdx-cli memory *` 与 `mdx-cli llm-wiki *` 并列 |
| Memory-only 工作区是否允许 | **允许**；`memory init` 不创建 wiki 结构 |
| `memory --root` 行为 | **仅 `memory *` 支持**；有 `--root` 时优先走 headless 直读写 |
| `memory promote --ingest` 在 wiki 未就绪时 | 返回 `llm_wiki_not_ready` |
```
```
| `thread save`（同 thread_id） | **Phase 1 仅支持全量快照替换**：同 `thread_id` + 新 `content_hash` 覆盖同一路径文件；相同 hash 跳过 |
```
```markdown
#### 4.8.2 Phase 1 运行时补充

- Workspace Mode + `~/.mdx/cli.sock` 可用时，`mdx-cli memory *` 默认针对当前活动 workspace root。
- `mdx-cli memory --root <workspace> ...` 直接调用 Rust Memory 服务，不依赖 GUI 或 socket。
- 当 `--root` 与 socket 同时可用时，**以 `--root` 为准**。
- `llm-wiki *` 仍保持既有 socket-only 行为，不在本期补 headless。
```
```markdown
### 4.12 前端设计（Phase 1.5 以后）

- Memory UI 面板不是 Phase 1 验收项。
- Phase 1 只交付 Rust 服务、CLI、审计和文档契约。
```
```markdown
mdx serve --workspace /path/to/ws [--port 14243] [--api-key mdx_...]
```

- [ ] **Step 2: Patch the Memory spec so the contract matches the implementation target**

Make these contract edits in `docs/loopx/specs/memory.md`:

```markdown
### Write Semantics

- New `thread_id` -> create file.
- Existing `thread_id` + new `content_hash` -> overwrite the indexed snapshot file in place.
- Same `thread_id` + same `content_hash` -> skip (idempotent).
- Updates must append to `log.md` with event `thread_save`.
```
```markdown
## CLI Runtime

- `mdx-cli memory *` supports two runtimes:
  - Workspace Mode socket runtime against the current active root.
  - Explicit headless runtime via `mdx-cli memory --root <workspace> ...`.
- `--root` wins when both `--root` and a running GUI are present.
- `llm-wiki *` remains socket-only in Phase 1.
```
```markdown
## Promote Contract

1. Copy thread to `raw/promoted/{date}-{slug}.md` with provenance frontmatter.
2. Set thread `promoted_to_wiki: true`.
3. If `--ingest`, require an initialized LLM Wiki workspace before invoking ingest.
4. Append `log.md` event `memory_promote`.
```

- [ ] **Step 3: Run a doc consistency grep before touching Rust**

Run:

```bash
rg -n 'raw/threads|追加消息|nmem_|Phase 1 最小' \
  'docs/loopx/design/MDX Memory层与LLM Wiki并列架构需求设计文档.md' \
  'docs/loopx/specs/memory.md'
```

Expected:

- No remaining `raw/threads`
- No remaining “追加消息” wording for Phase 1 thread updates
- No remaining `nmem_` API key example
- No remaining section that implies a Phase 1 Memory UI deliverable

- [ ] **Step 4: Commit Task 1**

```bash
git add \
  'docs/loopx/design/MDX Memory层与LLM Wiki并列架构需求设计文档.md' \
  'docs/loopx/specs/memory.md'
git commit -m "Align memory docs with phase one clarify decisions"
```

---

### Task 2: Add Memory Workspace Detection, Init, And Shared File Helpers

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/memory.rs`
- Create: `src-tauri/src/memory_models.rs`
- Create: `src-tauri/src/memory_fs.rs`
- Create: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write failing workspace/init tests**

Create `src-tauri/src/memory_tests.rs` with these initial tests and register it in `src-tauri/src/lib.rs`:

```rust
use tempfile::tempdir;

use crate::memory::{memory_detect_workspace, memory_initialize_workspace};

#[test]
fn memory_detect_reports_ordinary_workspace_before_initialization() {
    let root = tempdir().unwrap();

    let status = memory_detect_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert!(!status.has_memory);
    assert!(status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"memory".to_string()));
    assert!(status.missing_paths.contains(&"memory/working.md".to_string()));
    assert!(status.missing_paths.contains(&".mdx/memory-config.json".to_string()));
}

#[test]
fn memory_initialize_creates_memory_structure_without_creating_wiki() {
    let root = tempdir().unwrap();

    let result = memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert!(root.path().join("memory/threads").is_dir());
    assert!(root.path().join("memory/memories").is_dir());
    assert!(root.path().join("memory/inbox").is_dir());
    assert!(root.path().join("memory/working.md").is_file());
    assert!(root.path().join("memory/MEMORY.md").is_file());
    assert!(root.path().join(".mdx/memory-config.json").is_file());
    assert!(root.path().join(".mdx/thread-index.json").is_file());
    assert!(root.path().join("log.md").is_file());
    assert!(!root.path().join("raw").exists());
    assert!(!root.path().join("wiki").exists());
    assert!(result.status.has_memory);
}

#[test]
fn memory_initialize_preserves_existing_markdown() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("existing.md"), "# Existing\n").unwrap();

    let result = memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert!(root.path().join("existing.md").is_file());
    assert!(result.preserved_paths.iter().all(|path| path != "existing.md"));
}
```
```rust
#[cfg(test)]
mod memory_tests;
```

- [ ] **Step 2: Run the new tests to confirm the module does not exist yet**

Run:

```bash
cargo test memory_tests::memory_detect_reports_ordinary_workspace_before_initialization --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with compile errors for missing `crate::memory`, `memory_detect_workspace`, or `memory_initialize_workspace`.

- [ ] **Step 3: Add the maintained frontmatter and timestamp dependencies plus module wiring**

Update `src-tauri/Cargo.toml`:

```toml
serde_yaml_ng = "0.10.0"
time = { version = "0.3", features = ["formatting", "parsing", "serde"] }
```

Update `src-tauri/src/lib.rs` near the other module declarations:

```rust
pub mod memory;
mod memory_fs;
mod memory_models;

#[cfg(test)]
mod memory_tests;
```

- [ ] **Step 4: Create the shared Phase 1 Memory models**

Create `src-tauri/src/memory_models.rs` with the base workspace/config/index types:

```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryWorkspaceStatus {
    pub mode: String,
    pub has_memory: bool,
    pub can_initialize: bool,
    pub missing_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct InitializeMemoryResult {
    pub created_paths: Vec<String>,
    pub preserved_paths: Vec<String>,
    pub status: MemoryWorkspaceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryConfig {
    pub version: u32,
    pub recall: MemoryRecallConfig,
    pub distill: MemoryDistillConfig,
    pub capture: MemoryCaptureConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRecallConfig {
    pub default_limit: usize,
    pub context_byte_budget: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillConfig {
    pub enabled: bool,
    pub min_messages: usize,
    pub skip_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureConfig {
    pub enabled: bool,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadIndex {
    pub version: u32,
    pub threads: BTreeMap<String, ThreadIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadIndexEntry {
    pub path: String,
    pub content_hash: String,
    pub updated_at: String,
}
```

- [ ] **Step 5: Create workspace detection/init and safe file helpers**

Create `src-tauri/src/memory_fs.rs` and `src-tauri/src/memory.rs` with these core behaviors:

```rust
// src-tauri/src/memory_fs.rs
const REQUIRED_DIRS: &[&str] = &["memory", ".mdx", "memory/threads", "memory/memories", "memory/inbox"];
const REQUIRED_FILES: &[&str] = &[
    "memory/working.md",
    "memory/MEMORY.md",
    ".mdx/memory-config.json",
    ".mdx/thread-index.json",
    "log.md",
];

pub fn detect_memory_workspace(
    root: impl AsRef<std::path::Path>,
) -> Result<MemoryWorkspaceStatus, WorkspaceError> {
    let root = root.as_ref();
    crate::llm_wiki_fs::ensure_directory(root)?;

    let mut missing_paths = Vec::new();
    let mut can_initialize = true;

    for relative in REQUIRED_DIRS {
        let path = root.join(relative);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => {
                missing_paths.push((*relative).to_string());
                can_initialize = false;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing_paths.push((*relative).to_string());
            }
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "scan_failed",
                    "failed to inspect memory workspace directory",
                    &error,
                ));
            }
        }
    }

    for relative in REQUIRED_FILES {
        let path = root.join(relative);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => {
                missing_paths.push((*relative).to_string());
                can_initialize = false;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing_paths.push((*relative).to_string());
            }
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "scan_failed",
                    "failed to inspect memory workspace file",
                    &error,
                ));
            }
        }
    }

    Ok(MemoryWorkspaceStatus {
        mode: if missing_paths.is_empty() {
            "memory".to_string()
        } else {
            "ordinary".to_string()
        },
        has_memory: missing_paths.is_empty(),
        can_initialize,
        missing_paths,
    })
}

pub fn initialize_memory_workspace(
    root: impl AsRef<std::path::Path>,
) -> Result<InitializeMemoryResult, WorkspaceError> {
    let root = root.as_ref();
    crate::llm_wiki_fs::ensure_directory(root)?;

    let mut created_paths = Vec::new();
    let mut preserved_paths = Vec::new();

    for relative in REQUIRED_DIRS {
        let path = root.join(relative);
        if path.exists() {
            preserved_paths.push((*relative).to_string());
            continue;
        }
        std::fs::create_dir_all(&path).map_err(|error| {
            WorkspaceError::from_io("write_failed", "failed to create memory directory", &error)
        })?;
        created_paths.push((*relative).to_string());
    }

    for (relative, contents) in [
        (
            "memory/working.md",
            "# Working Memory\n\n## Updated\n\n## Focus\n\n## Open Questions\n\n## Recent Decisions\n",
        ),
        (
            "memory/MEMORY.md",
            "# Memory Rules\n\n- Threads are stored under `memory/threads/` as full Markdown snapshots.\n- Memory entries are stored under `memory/memories/` and should point back to a source thread when available.\n- Recall reads `memory/memories/` plus `memory/working.md` by default.\n- Promotion into `raw/promoted/` is explicit.\n",
        ),
        ("log.md", "# Log\n"),
    ] {
        let path = root.join(relative);
        if path.exists() {
            preserved_paths.push(relative.to_string());
            continue;
        }
        std::fs::write(&path, contents).map_err(|error| {
            WorkspaceError::from_io("write_failed", "failed to create memory file", &error)
        })?;
        created_paths.push(relative.to_string());
    }

    let config_path = root.join(".mdx/memory-config.json");
    if config_path.exists() {
        preserved_paths.push(".mdx/memory-config.json".to_string());
    } else {
        let bytes = serde_json::to_vec_pretty(&default_memory_config()).unwrap();
        std::fs::write(&config_path, bytes).map_err(|error| {
            WorkspaceError::from_io("write_failed", "failed to create memory config", &error)
        })?;
        created_paths.push(".mdx/memory-config.json".to_string());
    }

    let index_path = root.join(".mdx/thread-index.json");
    if index_path.exists() {
        preserved_paths.push(".mdx/thread-index.json".to_string());
    } else {
        let bytes = serde_json::to_vec_pretty(&default_thread_index()).unwrap();
        std::fs::write(&index_path, bytes).map_err(|error| {
            WorkspaceError::from_io("write_failed", "failed to create thread index", &error)
        })?;
        created_paths.push(".mdx/thread-index.json".to_string());
    }

    let status = detect_memory_workspace(root)?;
    Ok(InitializeMemoryResult {
        created_paths,
        preserved_paths,
        status,
    })
}

pub fn default_memory_config() -> MemoryConfig {
    MemoryConfig {
        version: 1,
        recall: MemoryRecallConfig {
            default_limit: 10,
            context_byte_budget: 65_536,
        },
        distill: MemoryDistillConfig {
            enabled: false,
            min_messages: 4,
            skip_patterns: vec!["^Running terminal command".to_string()],
        },
        capture: MemoryCaptureConfig {
            enabled: false,
            sources: Vec::new(),
        },
    }
}

pub fn default_thread_index() -> ThreadIndex {
    ThreadIndex {
        version: 1,
        threads: std::collections::BTreeMap::new(),
    }
}

pub fn append_memory_log_entry(
    root: &std::path::Path,
    entry: &str,
) -> Result<(), WorkspaceError> {
    let mut log = std::fs::read_to_string(root.join("log.md")).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read memory log", &error)
    })?;
    if !log.ends_with('\n') {
        log.push('\n');
    }
    log.push_str("- ");
    log.push_str(entry.trim());
    log.push('\n');
    write_workspace_relative_file(root, "log.md", log.as_bytes())
}
```
```rust
// src-tauri/src/memory.rs
pub use crate::memory_models::{
    InitializeMemoryResult, MemoryConfig, MemoryWorkspaceStatus, ThreadIndex, ThreadIndexEntry,
};

use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

pub fn memory_detect_workspace(root_path: String) -> Result<MemoryWorkspaceStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_fs::detect_memory_workspace(root)
}

pub fn memory_initialize_workspace(
    root_path: String,
) -> Result<InitializeMemoryResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_fs::initialize_memory_workspace(root)
}
```

Implementation notes for `memory_fs.rs`:

- Adapt the no-symlink, atomic rename pattern from `llm_wiki_fs.rs` for all writes.
- Create `log.md` with `# Log\n` when absent.
- Create `memory/working.md` with a default scaffold:

```markdown
# Working Memory

## Updated

## Focus

## Open Questions

## Recent Decisions
```

- Create `memory/MEMORY.md` with a short schema/rules document that says:
  - Threads are full snapshots under `memory/threads/`
  - Memory items must be traceable to a source thread when one exists
  - Recall defaults to `memory/memories/` + `memory/working.md`
  - Wiki promotion is explicit

- [ ] **Step 6: Run the workspace/init tests again**

Run:

```bash
cargo test memory_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS with the three new tests green.

- [ ] **Step 7: Commit Task 2**

```bash
git add \
  src-tauri/Cargo.toml \
  src-tauri/Cargo.lock \
  src-tauri/src/lib.rs \
  src-tauri/src/memory.rs \
  src-tauri/src/memory_fs.rs \
  src-tauri/src/memory_models.rs \
  src-tauri/src/memory_tests.rs
git commit -m "Add memory workspace initialization layer"
```

---

### Task 3: Implement Thread Snapshot Save, Show, And List

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_fs.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Create: `src-tauri/src/memory_thread.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Add failing thread tests**

Append these tests to `src-tauri/src/memory_tests.rs`:

```rust
use crate::memory::{
    memory_initialize_workspace, memory_thread_get, memory_thread_list, memory_thread_save,
    ThreadListFilter, ThreadSaveRequest,
};

fn sample_thread_body() -> String {
    "## Message 1 — user — 2026-06-12T09:00:01Z\n\nImplement auth middleware.\n\n## Message 2 — assistant — 2026-06-12T09:00:15Z\n\nPlan the work.\n".to_string()
}

#[test]
fn thread_save_creates_snapshot_file_and_index() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("cursor:abc123".to_string()),
            title: "Implement auth middleware".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: Some("2026-06-12T10:30:00Z".to_string()),
            model: Some("claude-sonnet-4".to_string()),
            workspace_root: None,
            tags: vec!["auth".to_string(), "mdx".to_string()],
        },
    )
    .unwrap();

    assert_eq!(result.action, "created");
    assert_eq!(result.path, "memory/threads/manual/2026-06-12-cursor-abc123.md");
    assert!(root.path().join(&result.path).is_file());
    let saved = std::fs::read_to_string(root.path().join(&result.path)).unwrap();
    assert!(saved.contains("kind: thread"));
    assert!(saved.contains("thread_id: cursor:abc123"));
    assert!(saved.contains("content_hash: sha256:"));
}

#[test]
fn thread_save_skips_when_hash_matches() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let request = ThreadSaveRequest {
        source: "manual".to_string(),
        thread_id: Some("cursor:abc123".to_string()),
        title: "Implement auth middleware".to_string(),
        body: sample_thread_body(),
        started_at: Some("2026-06-12T09:00:00Z".to_string()),
        ended_at: None,
        model: None,
        workspace_root: None,
        tags: Vec::new(),
    };

    let first = memory_thread_save(root.path().to_string_lossy().into_owned(), request.clone()).unwrap();
    let second = memory_thread_save(root.path().to_string_lossy().into_owned(), request).unwrap();

    assert_eq!(first.action, "created");
    assert_eq!(second.action, "skipped");
    assert_eq!(first.path, second.path);
}

#[test]
fn thread_save_overwrites_existing_snapshot_when_hash_changes() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let mut request = ThreadSaveRequest {
        source: "manual".to_string(),
        thread_id: Some("cursor:abc123".to_string()),
        title: "Implement auth middleware".to_string(),
        body: sample_thread_body(),
        started_at: Some("2026-06-12T09:00:00Z".to_string()),
        ended_at: None,
        model: None,
        workspace_root: None,
        tags: Vec::new(),
    };
    let first = memory_thread_save(root.path().to_string_lossy().into_owned(), request.clone()).unwrap();
    request.body.push_str("\n## Message 3 — user — 2026-06-12T10:00:00Z\n\nShip it.\n");
    let second = memory_thread_save(root.path().to_string_lossy().into_owned(), request).unwrap();

    assert_eq!(second.action, "updated");
    assert_eq!(first.path, second.path);
    let saved = std::fs::read_to_string(root.path().join(&second.path)).unwrap();
    assert!(saved.contains("## Message 3 — user"));
}

#[test]
fn thread_show_resolves_by_thread_id() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("cursor:abc123".to_string()),
            title: "Implement auth middleware".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let record = memory_thread_get(
        root.path().to_string_lossy().into_owned(),
        "cursor:abc123".to_string(),
    )
    .unwrap();

    assert_eq!(record.frontmatter.thread_id, "cursor:abc123");
    assert!(record.body.contains("Implement auth middleware"));
}

#[test]
fn thread_list_filters_by_source() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    for source in ["manual", "import"] {
        memory_thread_save(
            root.path().to_string_lossy().into_owned(),
            ThreadSaveRequest {
                source: source.to_string(),
                thread_id: Some(format!("{source}:demo")),
                title: format!("{source} thread"),
                body: sample_thread_body(),
                started_at: Some("2026-06-12T09:00:00Z".to_string()),
                ended_at: None,
                model: None,
                workspace_root: None,
                tags: Vec::new(),
            },
        )
        .unwrap();
    }

    let items = memory_thread_list(
        root.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: Some("manual".to_string()),
            since: None,
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].source, "manual");
}
```

- [ ] **Step 2: Run the thread tests to verify the API is still missing**

Run:

```bash
cargo test memory_tests::thread_save_creates_snapshot_file_and_index --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with compile errors for missing `ThreadSaveRequest`, `memory_thread_save`, `memory_thread_get`, `memory_thread_list`, or `ThreadListFilter`.

- [ ] **Step 3: Extend the models and add frontmatter helpers**

Update `src-tauri/src/lib.rs`:

```rust
mod memory_thread;
```

Extend `src-tauri/src/memory_models.rs` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryThreadFrontmatter {
    pub schema_version: u32,
    pub kind: String,
    pub thread_id: String,
    pub source: String,
    pub title: String,
    pub content_hash: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: Option<usize>,
    pub model: Option<String>,
    pub workspace_root: Option<String>,
    pub tags: Vec<String>,
    pub distilled: bool,
    pub promoted_to_wiki: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryThreadRecord {
    pub path: String,
    pub frontmatter: MemoryThreadFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadSaveRequest {
    pub source: String,
    pub thread_id: Option<String>,
    pub title: String,
    pub body: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub model: Option<String>,
    pub workspace_root: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadSaveResult {
    pub action: String,
    pub path: String,
    pub thread_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct ThreadListFilter {
    pub source: Option<String>,
    pub since: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadListItem {
    pub path: String,
    pub thread_id: String,
    pub source: String,
    pub title: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: Option<usize>,
    pub archived: bool,
}
```

Extend `src-tauri/src/memory_fs.rs` with these helpers:

```rust
pub fn render_markdown_with_frontmatter<T: serde::Serialize>(
    frontmatter: &T,
    body: &str,
) -> Result<String, WorkspaceError> {
    let yaml = serde_yaml_ng::to_string(frontmatter).map_err(|error| {
        WorkspaceError::new("yaml_encode_failed", format!("failed to encode frontmatter: {error}"))
    })?;
    Ok(format!("---\n{}---\n\n{}", yaml, body))
}

pub fn parse_markdown_frontmatter<T: serde::de::DeserializeOwned>(
    markdown: &str,
) -> Result<(T, String), WorkspaceError> {
    let rest = markdown.strip_prefix("---\n").ok_or_else(|| {
        WorkspaceError::new("invalid_frontmatter", "missing frontmatter start")
    })?;
    let (yaml, body) = rest.split_once("\n---\n").ok_or_else(|| {
        WorkspaceError::new("invalid_frontmatter", "missing frontmatter end")
    })?;
    let frontmatter = serde_yaml_ng::from_str::<T>(yaml).map_err(|error| {
        WorkspaceError::new("yaml_decode_failed", format!("failed to decode frontmatter: {error}"))
    })?;
    Ok((frontmatter, body.to_string()))
}

pub fn read_thread_index(root: &std::path::Path) -> Result<ThreadIndex, WorkspaceError> {
    let bytes = std::fs::read(root.join(".mdx/thread-index.json")).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read thread index", &error)
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        WorkspaceError::new("json_decode_failed", format!("failed to parse thread index: {error}"))
    })
}

pub fn write_thread_index(root: &std::path::Path, index: &ThreadIndex) -> Result<(), WorkspaceError> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|error| {
        WorkspaceError::new("json_encode_failed", format!("failed to encode thread index: {error}"))
    })?;
    write_workspace_relative_file(root, ".mdx/thread-index.json", &bytes)
}
pub fn normalize_markdown_body(body: &str) -> String { body.replace("\r\n", "\n").trim().to_string() + "\n" }
pub fn sha256_prefixed(bytes: &[u8]) -> String {
    let digest = sha2::Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}
pub fn slugify_segment(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}
pub fn date_prefix(iso_timestamp: Option<&str>) -> Result<String, WorkspaceError> {
    let timestamp = match iso_timestamp {
        Some(value) => time::OffsetDateTime::parse(
            value,
            &time::format_description::well_known::Rfc3339,
        )
        .map_err(|error| {
            WorkspaceError::new("invalid_timestamp", format!("failed to parse timestamp: {error}"))
        })?,
        None => time::OffsetDateTime::now_utc(),
    };
    Ok(timestamp.date().to_string())
}
pub fn now_utc_rfc3339() -> Result<String, WorkspaceError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| {
            WorkspaceError::new("time_format_failed", format!("failed to format timestamp: {error}"))
        })
}
```

- [ ] **Step 4: Implement save/show/list in `memory_thread.rs` and expose them from `memory.rs`**

Create `src-tauri/src/memory_thread.rs` with this core save logic:

```rust
pub fn memory_thread_save(
    root: impl AsRef<std::path::Path>,
    request: ThreadSaveRequest,
) -> Result<ThreadSaveResult, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::ensure_memory_ready(root)?;

    let body = crate::memory_fs::normalize_markdown_body(&request.body);
    if body.trim().is_empty() {
        return Err(WorkspaceError::new("invalid_thread_body", "thread body must not be empty"));
    }

    let thread_id = request
        .thread_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            let hash = crate::memory_fs::sha256_prefixed(body.as_bytes());
            let digest = hash.trim_start_matches("sha256:");
            format!("manual:{}", &digest[..12])
        });
    let content_hash = crate::memory_fs::sha256_prefixed(body.as_bytes());

    let mut index = crate::memory_fs::read_thread_index(root)?;
    if let Some(existing) = index.threads.get(&thread_id) {
        if existing.content_hash == content_hash {
            return Ok(ThreadSaveResult {
                action: "skipped".to_string(),
                path: existing.path.clone(),
                thread_id,
                content_hash,
            });
        }
    }

    let path = index
        .threads
        .get(&thread_id)
        .map(|entry| entry.path.clone())
        .unwrap_or_else(|| {
            let slug = crate::memory_fs::slugify_segment(&thread_id);
            let date = crate::memory_fs::date_prefix(request.started_at.as_deref()).unwrap();
            format!("memory/threads/{}/{date}-{slug}.md", request.source)
        });

    let frontmatter = MemoryThreadFrontmatter {
        schema_version: 1,
        kind: "thread".to_string(),
        thread_id: thread_id.clone(),
        source: request.source.clone(),
        title: request.title.trim().to_string(),
        content_hash: content_hash.clone(),
        started_at: request.started_at.clone(),
        ended_at: request.ended_at.clone(),
        message_count: Some(body.matches("## Message ").count()),
        model: request.model.clone(),
        workspace_root: request.workspace_root.clone(),
        tags: request.tags.clone(),
        distilled: false,
        promoted_to_wiki: false,
        archived: false,
    };

    let markdown = crate::memory_fs::render_markdown_with_frontmatter(&frontmatter, &body)?;
    crate::memory_fs::write_workspace_relative_file(root, &path, markdown.as_bytes())?;

    let action = if index.threads.contains_key(&thread_id) { "updated" } else { "created" };
    index.threads.insert(
        thread_id.clone(),
        ThreadIndexEntry {
            path: path.clone(),
            content_hash: content_hash.clone(),
            updated_at: crate::memory_fs::now_utc_rfc3339()?,
        },
    );
    crate::memory_fs::write_thread_index(root, &index)?;
    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("memory_thread_save thread_id={thread_id} result={action} path={path}"),
    )?;

    Ok(ThreadSaveResult {
        action: action.to_string(),
        path,
        thread_id,
        content_hash,
    })
}
```

Also add:

```rust
pub fn memory_thread_get(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<MemoryThreadRecord, WorkspaceError> {
    let root = root.as_ref();
    let index = crate::memory_fs::read_thread_index(root)?;
    let path = if let Some(entry) = index.threads.get(&target) {
        entry.path.clone()
    } else {
        target
    };
    let markdown = crate::memory_fs::read_workspace_relative_text(root, &path)?;
    let (frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
    Ok(MemoryThreadRecord { path, frontmatter, body })
}

pub fn memory_thread_list(
    root: impl AsRef<std::path::Path>,
    filter: ThreadListFilter,
) -> Result<Vec<ThreadListItem>, WorkspaceError> {
    let root = root.as_ref();
    let index = crate::memory_fs::read_thread_index(root)?;
    let mut items = Vec::new();
    for entry in index.threads.values() {
        let markdown = crate::memory_fs::read_workspace_relative_text(root, &entry.path)?;
        let (frontmatter, _) =
            crate::memory_fs::parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
        if filter
            .source
            .as_deref()
            .is_some_and(|source| frontmatter.source != source)
        {
            continue;
        }
        items.push(ThreadListItem {
            path: entry.path.clone(),
            thread_id: frontmatter.thread_id,
            source: frontmatter.source,
            title: frontmatter.title,
            started_at: frontmatter.started_at,
            ended_at: frontmatter.ended_at,
            message_count: frontmatter.message_count,
            archived: frontmatter.archived,
        });
    }
    items.sort_by(|left, right| right.started_at.cmp(&left.started_at).then_with(|| left.path.cmp(&right.path)));
    Ok(items)
}
```

Re-export through `src-tauri/src/memory.rs`:

```rust
pub use crate::memory_models::{
    MemoryThreadFrontmatter, MemoryThreadRecord, ThreadListFilter, ThreadListItem, ThreadSaveRequest,
    ThreadSaveResult,
};

pub fn memory_thread_save(
    root_path: String,
    request: ThreadSaveRequest,
) -> Result<ThreadSaveResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_thread::memory_thread_save(root, request)
}
```

- [ ] **Step 5: Run the thread tests**

Run:

```bash
cargo test memory_tests::thread_save --manifest-path src-tauri/Cargo.toml
cargo test memory_tests::thread_show_resolves_by_thread_id --manifest-path src-tauri/Cargo.toml
cargo test memory_tests::thread_list_filters_by_source --manifest-path src-tauri/Cargo.toml
```

Expected: PASS for all five thread tests.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  src-tauri/src/lib.rs \
  src-tauri/src/memory.rs \
  src-tauri/src/memory_fs.rs \
  src-tauri/src/memory_models.rs \
  src-tauri/src/memory_thread.rs \
  src-tauri/src/memory_tests.rs
git commit -m "Add memory thread snapshot storage"
```

---

### Task 4: Implement Atomic Memory Records And Working Memory

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Create: `src-tauri/src/memory_store.rs`
- Create: `src-tauri/src/memory_working.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Add failing memory-record and working-memory tests**

Append these tests to `src-tauri/src/memory_tests.rs`:

```rust
use crate::memory::{
    memory_add, memory_archive, memory_get, memory_initialize_workspace, memory_list,
    memory_working_append, memory_working_get, memory_working_set, MemoryAddRequest,
    MemoryListFilter,
};

#[test]
fn memory_add_creates_markdown_record_with_defaults() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".to_string(),
            tags: vec!["auth".to_string(), "jwt".to_string()],
            source_thread: Some("memory/threads/manual/2026-06-12-cursor-abc123.md".to_string()),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    assert_eq!(record.frontmatter.kind, "memory");
    assert_eq!(record.frontmatter.status, "active");
    assert_eq!(record.frontmatter.importance, Some(0.5));
    assert!(root.path().join(&record.path).is_file());
}

#[test]
fn memory_archive_marks_record_archived() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let archived = memory_archive(
        root.path().to_string_lossy().into_owned(),
        record.frontmatter.memory_id.clone(),
    )
    .unwrap();

    assert_eq!(archived.frontmatter.status, "archived");
}

#[test]
fn memory_list_filters_by_tag_and_excludes_archived() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let active = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    let archived = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Ignore me".to_string(),
            body: "Archived memory".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    memory_archive(
        root.path().to_string_lossy().into_owned(),
        archived.frontmatter.memory_id.clone(),
    )
    .unwrap();

    let items = memory_list(
        root.path().to_string_lossy().into_owned(),
        MemoryListFilter {
            tag: Some("auth".to_string()),
            since: None,
            include_archived: false,
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].memory_id, active.frontmatter.memory_id);
}

#[test]
fn working_set_replaces_file_and_working_append_adds_to_section() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    memory_working_set(
        root.path().to_string_lossy().into_owned(),
        "# Working Memory\n\n## Focus\n- Ship Memory Phase 1\n".to_string(),
    )
    .unwrap();
    memory_working_append(
        root.path().to_string_lossy().into_owned(),
        "Recent Decisions".to_string(),
        "Keep Memory and Wiki separate.".to_string(),
    )
    .unwrap();

    let working = memory_working_get(root.path().to_string_lossy().into_owned()).unwrap();
    assert!(working.contains("- Ship Memory Phase 1"));
    assert!(working.contains("## Recent Decisions"));
    assert!(working.contains("- Keep Memory and Wiki separate."));
}
```

- [ ] **Step 2: Run the new tests to verify the APIs do not exist yet**

Run:

```bash
cargo test memory_tests::memory_add_creates_markdown_record_with_defaults --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with compile errors for missing `memory_add`, `memory_archive`, `memory_list`, `memory_working_set`, `memory_working_append`, or their request/filter types.

- [ ] **Step 3: Add Memory record and Working types to `memory_models.rs`**

Extend `src-tauri/src/memory_models.rs` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryFrontmatter {
    pub schema_version: u32,
    pub kind: String,
    pub memory_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub source_thread: Option<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
    pub tags: Vec<String>,
    pub evolves_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRecord {
    pub path: String,
    pub frontmatter: MemoryFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemorySummary {
    pub path: String,
    pub memory_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryAddRequest {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub source_thread: Option<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct MemoryListFilter {
    pub tag: Option<String>,
    pub since: Option<String>,
    pub include_archived: bool,
}
```

- [ ] **Step 4: Implement `memory_store.rs` and `memory_working.rs`, then re-export through `memory.rs`**

Create `src-tauri/src/memory_store.rs`:

```rust
pub fn memory_add(
    root: impl AsRef<std::path::Path>,
    request: MemoryAddRequest,
) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::ensure_memory_ready(root)?;

    let title = request.title.trim().to_string();
    let body = crate::memory_fs::normalize_markdown_body(&request.body);
    if title.is_empty() || body.trim().is_empty() {
        return Err(WorkspaceError::new("invalid_memory", "memory title and body must not be empty"));
    }

    let now = crate::memory_fs::now_utc_rfc3339()?;
    let slug = crate::memory_fs::slugify_segment(&title);
    let date = crate::memory_fs::date_prefix(Some(&now))?;
    let memory_id = format!("mem_{}_{}", date.replace('-', ""), slug.replace('-', "_"));
    let path = format!("memory/memories/{date}-{slug}.md");

    let frontmatter = MemoryFrontmatter {
        schema_version: 1,
        kind: "memory".to_string(),
        memory_id: memory_id.clone(),
        title: title.clone(),
        status: "active".to_string(),
        created_at: now,
        source_thread: request.source_thread.clone(),
        importance: Some(request.importance.unwrap_or(0.5)),
        confidence: request.confidence.or(Some(0.5)),
        tags: request.tags.clone(),
        evolves_from: None,
    };
    let markdown = crate::memory_fs::render_markdown_with_frontmatter(&frontmatter, &body)?;
    crate::memory_fs::write_workspace_relative_file(root, &path, markdown.as_bytes())?;
    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("memory_add memory_id={} path={}", memory_id, path),
    )?;

    Ok(MemoryRecord { path, frontmatter, body })
}

pub fn memory_get(root: impl AsRef<std::path::Path>, target: String) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    for entry in std::fs::read_dir(root.join("memory/memories")).map_err(|error| {
        WorkspaceError::from_io("scan_failed", "failed to scan memory directory", &error)
    })? {
        let path = entry.map_err(|error| {
            WorkspaceError::from_io("scan_failed", "failed to read memory entry", &error)
        })?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = crate::llm_wiki_fs::relative_path(root, &path)?;
        let markdown = crate::memory_fs::read_workspace_relative_text(root, &relative)?;
        let (frontmatter, body) =
            crate::memory_fs::parse_markdown_frontmatter::<MemoryFrontmatter>(&markdown)?;
        if target == relative || target == frontmatter.memory_id {
            return Ok(MemoryRecord { path: relative, frontmatter, body });
        }
    }
    Err(WorkspaceError::new("not_found", "memory record was not found"))
}
pub fn memory_list(root: impl AsRef<std::path::Path>, filter: MemoryListFilter) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let root = root.as_ref();
    let mut items = Vec::new();
    for entry in std::fs::read_dir(root.join("memory/memories")).map_err(|error| {
        WorkspaceError::from_io("scan_failed", "failed to scan memory directory", &error)
    })? {
        let path = entry.map_err(|error| {
            WorkspaceError::from_io("scan_failed", "failed to read memory entry", &error)
        })?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = crate::llm_wiki_fs::relative_path(root, &path)?;
        let markdown = crate::memory_fs::read_workspace_relative_text(root, &relative)?;
        let (frontmatter, _) =
            crate::memory_fs::parse_markdown_frontmatter::<MemoryFrontmatter>(&markdown)?;
        if !filter.include_archived && frontmatter.status == "archived" {
            continue;
        }
        if filter
            .tag
            .as_deref()
            .is_some_and(|tag| !frontmatter.tags.iter().any(|item| item == tag))
        {
            continue;
        }
        items.push(MemorySummary {
            path: relative,
            memory_id: frontmatter.memory_id,
            title: frontmatter.title,
            status: frontmatter.status,
            created_at: frontmatter.created_at,
            tags: frontmatter.tags,
        });
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at).then_with(|| left.path.cmp(&right.path)));
    Ok(items)
}
pub fn memory_archive(root: impl AsRef<std::path::Path>, target: String) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    let mut record = memory_get(root, target)?;
    record.frontmatter.status = "archived".to_string();
    let markdown =
        crate::memory_fs::render_markdown_with_frontmatter(&record.frontmatter, &record.body)?;
    crate::memory_fs::write_workspace_relative_file(root, &record.path, markdown.as_bytes())?;
    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("memory_archive memory_id={} path={}", record.frontmatter.memory_id, record.path),
    )?;
    Ok(record)
}
```

Create `src-tauri/src/memory_working.rs`:

```rust
pub fn memory_working_get(root: impl AsRef<std::path::Path>) -> Result<String, WorkspaceError> {
    crate::memory_fs::read_workspace_relative_text(root.as_ref(), "memory/working.md")
}

pub fn memory_working_set(
    root: impl AsRef<std::path::Path>,
    markdown: String,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::write_workspace_relative_file(root, "memory/working.md", markdown.as_bytes())?;
    crate::memory_fs::append_memory_log_entry(root, "memory_working_update action=set path=memory/working.md")?;
    Ok(markdown)
}

pub fn memory_working_append(
    root: impl AsRef<std::path::Path>,
    section: String,
    text: String,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let mut markdown = memory_working_get(root)?;
    let heading = format!("## {}", section.trim());
    let bullet = format!("- {}", text.trim());

    if let Some(index) = markdown.find(&heading) {
        let insert_at = markdown[index..]
            .find("\n## ")
            .map(|offset| index + offset)
            .unwrap_or(markdown.len());
        markdown.insert_str(insert_at, &format!("\n{bullet}\n"));
    } else {
        if !markdown.ends_with('\n') {
            markdown.push('\n');
        }
        markdown.push_str(&format!("\n{heading}\n{bullet}\n"));
    }

    crate::memory_fs::write_workspace_relative_file(root, "memory/working.md", markdown.as_bytes())?;
    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("memory_working_update action=append section={} path=memory/working.md", section.trim()),
    )?;
    Ok(markdown)
}
```

Expose them from `src-tauri/src/memory.rs` and add module declarations in `src-tauri/src/lib.rs`:

```rust
mod memory_store;
mod memory_working;
```

- [ ] **Step 5: Run the memory-record and working-memory tests**

Run:

```bash
cargo test memory_tests::memory_add_creates_markdown_record_with_defaults --manifest-path src-tauri/Cargo.toml
cargo test memory_tests::memory_archive_marks_record_archived --manifest-path src-tauri/Cargo.toml
cargo test memory_tests::working_set_replaces_file_and_working_append_adds_to_section --manifest-path src-tauri/Cargo.toml
```

Expected: PASS for all four tests.

- [ ] **Step 6: Commit Task 4**

```bash
git add \
  src-tauri/src/lib.rs \
  src-tauri/src/memory.rs \
  src-tauri/src/memory_models.rs \
  src-tauri/src/memory_store.rs \
  src-tauri/src/memory_working.rs \
  src-tauri/src/memory_tests.rs
git commit -m "Add memory records and working memory"
```

---

### Task 5: Implement Recall, Search, And Promote

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/memory.rs`
- Modify: `src-tauri/src/memory_models.rs`
- Create: `src-tauri/src/memory_recall.rs`
- Create: `src-tauri/src/memory_promote.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Add failing recall and promote tests**

Append these tests to `src-tauri/src/memory_tests.rs`:

```rust
use crate::memory::{
    memory_add, memory_initialize_workspace, memory_promote, memory_recall, memory_search,
    memory_thread_save, MemoryAddRequest, MemoryPromoteRequest, RecallRequest, ThreadSaveRequest,
};

#[test]
fn recall_orders_matches_by_importance_and_recency() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: Some(0.9),
            confidence: None,
        },
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT refresh token is 30 days".to_string(),
            body: "Refresh tokens last 30 days.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: Some(0.2),
            confidence: None,
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "JWT".to_string(),
            limit: Some(10),
            byte_budget: Some(65_536),
            include_working: true,
            include_threads: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(!result.memories.is_empty());
    assert!(result.memories[0].title.contains("15 minutes"));
}

#[test]
fn recall_includes_working_memory_and_respects_byte_budget() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_working_set(
        root.path().to_string_lossy().into_owned(),
        "# Working Memory\n\n## Focus\n- Ship JWT auth\n".to_string(),
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".repeat(40),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "JWT".to_string(),
            limit: Some(10),
            byte_budget: Some(256),
            include_working: true,
            include_threads: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(result.working.as_deref().unwrap_or_default().contains("Ship JWT auth"));
    assert!(result.truncated);
    assert!(result.byte_count <= 256);
}

#[test]
fn search_returns_memory_summaries_only() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token is 15 minutes".to_string(),
            body: "Auth uses a 15 minute JWT access token.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let items = memory_search(
        root.path().to_string_lossy().into_owned(),
        "JWT".to_string(),
        Some(10),
        None,
        None,
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert!(items[0].title.contains("JWT"));
}

#[test]
fn promote_copies_thread_into_raw_promoted() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("cursor:abc123".to_string()),
            title: "Implement auth middleware".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let promoted = memory_promote(
        root.path().to_string_lossy().into_owned(),
        MemoryPromoteRequest {
            target: "cursor:abc123".to_string(),
            ingest: false,
            title: None,
        },
    )
    .unwrap();

    assert_eq!(promoted.promoted_path, "raw/promoted/2026-06-12-implement-auth-middleware.md");
    assert!(root.path().join(&promoted.promoted_path).is_file());
}

#[test]
fn promote_with_ingest_rejects_non_wiki_workspace() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("cursor:abc123".to_string()),
            title: "Implement auth middleware".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let error = memory_promote(
        root.path().to_string_lossy().into_owned(),
        MemoryPromoteRequest {
            target: "cursor:abc123".to_string(),
            ingest: true,
            title: None,
        },
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_not_ready");
}
```

- [ ] **Step 2: Run the recall/promote tests to confirm the APIs are missing**

Run:

```bash
cargo test memory_tests::recall_orders_matches_by_importance_and_recency --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with compile errors for missing `memory_recall`, `memory_search`, `memory_promote`, `RecallRequest`, or `MemoryPromoteRequest`.

- [ ] **Step 3: Add recall and promote result types**

Update `src-tauri/src/lib.rs`:

```rust
mod memory_promote;
mod memory_recall;
```

Extend `src-tauri/src/memory_models.rs` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct RecallRequest {
    pub query: String,
    pub limit: Option<usize>,
    pub byte_budget: Option<usize>,
    pub include_working: bool,
    pub include_threads: bool,
    pub tag: Option<String>,
    pub since: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct RecallMemoryItem {
    pub memory_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub score: f64,
    pub importance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct RecallResult {
    pub working: Option<String>,
    pub memories: Vec<RecallMemoryItem>,
    pub threads: Vec<MemorySummary>,
    pub truncated: bool,
    pub byte_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryPromoteRequest {
    pub target: String,
    pub ingest: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryPromoteResult {
    pub thread_path: String,
    pub promoted_path: String,
    pub ingested: bool,
}
```

- [ ] **Step 4: Implement recall/search ranking and promote bridge**

Create `src-tauri/src/memory_recall.rs`:

```rust
fn score_memory(record: &MemoryRecord, query: &str, now: time::OffsetDateTime) -> Option<f64> {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return None;
    }

    let mut text_score = 0.0;
    if record.frontmatter.title.to_ascii_lowercase().contains(&query) {
        text_score += 3.0;
    }
    if record
        .frontmatter
        .tags
        .iter()
        .any(|tag| tag.to_ascii_lowercase().contains(&query))
    {
        text_score += 2.0;
    }
    if record.body.to_ascii_lowercase().contains(&query) {
        text_score += 1.0;
    }
    if text_score == 0.0 {
        return None;
    }

    let importance = record.frontmatter.importance.unwrap_or(0.5).clamp(0.0, 1.0);
    let created_at = time::OffsetDateTime::parse(
        &record.frontmatter.created_at,
        &time::format_description::well_known::Rfc3339,
    )
    .ok()?;
    let age_days = ((now - created_at).whole_seconds().max(0) as f64) / 86_400.0;
    let recency_decay = 0.5_f64.powf(age_days / 30.0);
    Some(text_score * (0.5 + importance) * recency_decay)
}

pub fn memory_search(
    root: impl AsRef<std::path::Path>,
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let result = memory_recall(
        root,
        RecallRequest {
            query,
            limit,
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            tag,
            since,
        },
    )?;
    Ok(result
        .memories
        .into_iter()
        .map(|item| MemorySummary {
            path: item.path,
            memory_id: item.memory_id,
            title: item.title,
            status: "active".to_string(),
            created_at: String::new(),
            tags: Vec::new(),
        })
        .collect())
}

pub fn memory_recall(
    root: impl AsRef<std::path::Path>,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let working = if request.include_working {
        Some(crate::memory_working::memory_working_get(root.as_ref())?)
    } else {
        None
    };
    let mut items = crate::memory_store::memory_list(
        root.as_ref(),
        MemoryListFilter {
            tag: request.tag.clone(),
            since: request.since.clone(),
            include_archived: false,
        },
    )?
    .into_iter()
    .filter_map(|summary| {
        let record = crate::memory_store::memory_get(root.as_ref(), summary.memory_id.clone()).ok()?;
        let score = score_memory(&record, &request.query, time::OffsetDateTime::now_utc())?;
        let snippet = if record.body.len() > 240 {
            format!("{}...", &record.body[..240])
        } else {
            record.body.clone()
        };
        Some(RecallMemoryItem {
            memory_id: record.frontmatter.memory_id,
            title: record.frontmatter.title,
            path: record.path,
            snippet,
            score,
            importance: record.frontmatter.importance.unwrap_or(0.5),
        })
    })
    .collect::<Vec<_>>();
    items.sort_by(|left, right| right.score.partial_cmp(&left.score).unwrap());
    items.truncate(request.limit.unwrap_or(10));

    let mut byte_count = working.as_ref().map(|value| value.len()).unwrap_or(0);
    let byte_budget = request.byte_budget.unwrap_or(65_536);
    let mut truncated = false;
    let mut selected = Vec::new();
    for item in items {
        let item_bytes = item.snippet.len();
        if byte_count + item_bytes > byte_budget {
            truncated = true;
            break;
        }
        byte_count += item_bytes;
        selected.push(item);
    }

    Ok(RecallResult {
        working,
        memories: selected,
        threads: Vec::new(),
        truncated,
        byte_count,
    })
}
```

Create `src-tauri/src/memory_promote.rs`:

```rust
pub fn memory_promote(
    root: impl AsRef<std::path::Path>,
    request: MemoryPromoteRequest,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    let root = root.as_ref();
    let thread = crate::memory_thread::memory_thread_get(root, request.target.clone())?;

    if request.ingest {
        let status = crate::llm_wiki_fs::detect_llm_wiki_workspace(root)?;
        if !status.has_llm_wiki {
            return Err(WorkspaceError::new(
                "llm_wiki_not_ready",
                "current workspace is not an LLM Wiki workspace",
            ));
        }
    }

    let date = crate::memory_fs::date_prefix(thread.frontmatter.started_at.as_deref())?;
    let slug = crate::memory_fs::slugify_segment(
        request.title.as_deref().unwrap_or(&thread.frontmatter.title),
    );
    let promoted_path = format!("raw/promoted/{date}-{slug}.md");
    crate::memory_fs::ensure_workspace_directory(root, "raw")?;
    crate::memory_fs::ensure_workspace_directory(root, "raw/promoted")?;

    let promoted_markdown = format!(
        "---\nkind: promoted_thread\nsource_thread: {}\nthread_id: {}\npromoted_at: {}\ntitle: {}\n---\n\n{}",
        thread.path,
        thread.frontmatter.thread_id,
        crate::memory_fs::now_utc_rfc3339()?,
        request.title.as_deref().unwrap_or(&thread.frontmatter.title),
        thread.body
    );
    crate::memory_fs::write_workspace_relative_file(root, &promoted_path, promoted_markdown.as_bytes())?;
    crate::memory_thread::mark_thread_promoted(root, &thread.path)?;

    if request.ingest {
        crate::llm_wiki::llm_wiki_ingest_raw_file_sync(
            root.to_string_lossy().into_owned(),
            promoted_path.clone(),
        )?;
    }

    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("memory_promote thread_id={} promoted_path={} ingest={}", thread.frontmatter.thread_id, promoted_path, request.ingest),
    )?;

    Ok(MemoryPromoteResult {
        thread_path: thread.path,
        promoted_path,
        ingested: request.ingest,
    })
}
```

Expose from `src-tauri/src/memory.rs`:

```rust
pub use crate::memory_models::{
    MemoryPromoteRequest, MemoryPromoteResult, RecallMemoryItem, RecallRequest, RecallResult,
};

pub fn memory_search(
    root_path: String,
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_recall::memory_search(root, query, limit, tag, since)
}
pub fn memory_recall(
    root_path: String,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_recall::memory_recall(root, request)
}
pub fn memory_promote(
    root_path: String,
    request: MemoryPromoteRequest,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_promote::memory_promote(root, request)
}
```

- [ ] **Step 5: Run the recall/promote tests and then the full Memory test target**

Run:

```bash
cargo test memory_tests::recall_orders_matches_by_importance_and_recency --manifest-path src-tauri/Cargo.toml
cargo test memory_tests::promote_copies_thread_into_raw_promoted --manifest-path src-tauri/Cargo.toml
cargo test memory_tests --manifest-path src-tauri/Cargo.toml
```

Expected:

- Recall tests PASS
- Promote tests PASS
- Full `memory_tests` target PASS with all Memory tests green

- [ ] **Step 6: Commit Task 5**

```bash
git add \
  src-tauri/src/lib.rs \
  src-tauri/src/memory.rs \
  src-tauri/src/memory_models.rs \
  src-tauri/src/memory_promote.rs \
  src-tauri/src/memory_recall.rs \
  src-tauri/src/memory_tests.rs
git commit -m "Add memory recall and promote flows"
```

---

### Task 6: Extend The CLI Socket Protocol And Server Dispatch

**Files:**
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`
- Modify: `src-tauri/src/cli_server.rs`

- [ ] **Step 1: Add failing Memory protocol and server tests**

Extend `src-tauri/src/cli_protocol_tests.rs`:

```rust
#[test]
fn parses_memory_status_and_thread_save_requests() {
    let status: CliRequest = serde_json::from_str(r#"{"cmd":"memory-status"}"#).unwrap();
    assert!(matches!(status, CliRequest::MemoryStatus));

    let save: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-thread-save","source":"manual","thread_id":"cursor:abc123","title":"Implement auth middleware","body":"## Message 1\n\nHello\n"}"#,
    )
    .unwrap();
    assert!(matches!(
        save,
        CliRequest::MemoryThreadSave { source, thread_id, title, .. }
            if source == "manual"
                && thread_id == Some("cursor:abc123".to_string())
                && title == "Implement auth middleware"
    ));
}

#[test]
fn serializes_memory_status_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_status: Some(crate::memory::MemoryWorkspaceStatus {
            mode: "memory".to_string(),
            has_memory: true,
            can_initialize: false,
            missing_paths: Vec::new(),
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""memory_status":{"mode":"memory","has_memory":true,"can_initialize":false,"missing_paths":[]}"#));
    assert!(!json.contains("memoryStatus"));
}
```

Extend `src-tauri/src/cli_server.rs` tests:

```rust
#[test]
fn memory_status_response_reports_ordinary_workspace() {
    let root = TempDir::new().unwrap();
    let response = memory_status_response_for_root(root.path().to_string_lossy().into_owned());

    assert!(response.ok);
    assert_eq!(response.memory_status.as_ref().unwrap().mode, "ordinary");
    assert!(!response.memory_status.as_ref().unwrap().has_memory);
}

#[test]
fn memory_init_response_creates_structure() {
    let root = TempDir::new().unwrap();
    let response = memory_init_response_for_root(root.path().to_string_lossy().into_owned());

    assert!(response.ok);
    assert!(response.memory_init.is_some());
    assert!(root.path().join("memory/working.md").is_file());
}
```

- [ ] **Step 2: Run the protocol/server tests to verify the request variants are missing**

Run:

```bash
cargo test cli_protocol_tests --manifest-path src-tauri/Cargo.toml
cargo test cli_server::tests::memory_status_response_reports_ordinary_workspace --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with compile errors for missing `CliRequest::MemoryStatus`, `CliRequest::MemoryThreadSave`, `memory_status`, or `memory_init`.

- [ ] **Step 3: Extend `CliRequest` and `CliResponse` for Memory**

Add these request variants to `src-tauri/src/cli_protocol.rs`:

```rust
    MemoryStatus,
    MemoryInit,
    MemoryThreadSave {
        source: String,
        #[serde(default)]
        thread_id: Option<String>,
        title: String,
        body: String,
    },
    MemoryThreadShow {
        target: String,
    },
    MemoryThreadList {
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryAdd {
        title: String,
        body: String,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        source_thread: Option<String>,
        #[serde(default)]
        importance: Option<f64>,
        #[serde(default)]
        confidence: Option<f64>,
    },
    MemoryShow {
        target: String,
    },
    MemoryList {
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemorySearch {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryArchive {
        target: String,
    },
    MemoryWorkingGet,
    MemoryWorkingSet {
        content: String,
    },
    MemoryWorkingAppend {
        section: String,
        text: String,
    },
    MemoryRecall {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        byte_budget: Option<usize>,
        #[serde(default)]
        include_threads: Option<bool>,
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryPromote {
        target: String,
        #[serde(default)]
        ingest: Option<bool>,
        #[serde(default)]
        title: Option<String>,
    },
```

Add these `CliResponse` fields:

```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_status: Option<crate::memory::MemoryWorkspaceStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_init: Option<crate::memory::InitializeMemoryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_thread: Option<crate::memory::MemoryThreadRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_threads: Option<Vec<crate::memory::ThreadListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_entry: Option<crate::memory::MemoryRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_entries: Option<Vec<crate::memory::MemorySummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_recall: Option<crate::memory::RecallResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_promote: Option<crate::memory::MemoryPromoteResult>,
```

- [ ] **Step 4: Add Memory socket dispatch and root-bound handlers**

In `src-tauri/src/cli_server.rs`, add `use crate::memory;` and extend `dispatch`:

```rust
        CliRequest::MemoryStatus => handle_memory_status(app),
        CliRequest::MemoryInit => handle_memory_init(app),
        CliRequest::MemoryThreadSave {
            source,
            thread_id,
            title,
            body,
        } => handle_memory_thread_save(app, source, thread_id, title, body),
        CliRequest::MemoryThreadShow { target } => handle_memory_thread_show(app, target),
        CliRequest::MemoryThreadList { source, since } => handle_memory_thread_list(app, source, since),
        CliRequest::MemoryAdd {
            title,
            body,
            tags,
            source_thread,
            importance,
            confidence,
        } => handle_memory_add(app, title, body, tags, source_thread, importance, confidence),
        CliRequest::MemoryShow { target } => handle_memory_show(app, target),
        CliRequest::MemoryList { tag, since } => handle_memory_list(app, tag, since),
        CliRequest::MemorySearch { query, limit, tag, since } => {
            handle_memory_search(app, query, limit, tag, since)
        }
        CliRequest::MemoryArchive { target } => handle_memory_archive(app, target),
        CliRequest::MemoryWorkingGet => handle_memory_working_get(app),
        CliRequest::MemoryWorkingSet { content } => handle_memory_working_set(app, content),
        CliRequest::MemoryWorkingAppend { section, text } => {
            handle_memory_working_append(app, section, text)
        }
        CliRequest::MemoryRecall { query, limit, byte_budget, include_threads, tag, since } => {
            handle_memory_recall(app, query, limit, byte_budget, include_threads.unwrap_or(false), tag, since)
        }
        CliRequest::MemoryPromote { target, ingest, title } => {
            handle_memory_promote(app, target, ingest.unwrap_or(false), title)
        }
```

Add pure root-bound helpers similar to the existing LLM Wiki helpers:

```rust
fn memory_status_response_for_root(root_path: String) -> CliResponse {
    match memory::memory_detect_workspace(root_path) {
        Ok(status) => CliResponse {
            ok: true,
            memory_status: Some(status),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}
fn memory_init_response_for_root(root_path: String) -> CliResponse {
    match memory::memory_initialize_workspace(root_path) {
        Ok(result) => CliResponse {
            ok: true,
            memory_init: Some(result),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}
fn memory_thread_save_response_for_root(
    root_path: String,
    request: memory::ThreadSaveRequest,
) -> CliResponse {
    match memory::memory_thread_save(root_path, request) {
        Ok(result) => CliResponse {
            ok: true,
            path: Some(result.path),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}
fn memory_recall_response_for_root(root_path: String, request: memory::RecallRequest) -> CliResponse {
    match memory::memory_recall(root_path, request) {
        Ok(result) => CliResponse {
            ok: true,
            memory_recall: Some(result),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}
```

Rules to follow:

- `memory status` and `memory init` must work on ordinary workspaces.
- All other `memory *` socket requests require an active workspace root and should return `memory_not_ready` if `memory/` has not been initialized.
- Mutating handlers should call `emit_log_file_updated` when they succeed.
- `thread show`, `memory show`, and `working get` should put plain Markdown into `response.content`.

- [ ] **Step 5: Run protocol and server tests again**

Run:

```bash
cargo test cli_protocol_tests --manifest-path src-tauri/Cargo.toml
cargo test cli_server::tests::memory_status_response_reports_ordinary_workspace --manifest-path src-tauri/Cargo.toml
cargo test cli_server::tests::memory_init_response_creates_structure --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. `cli_protocol_tests` should include the new Memory parse/serialization checks.

- [ ] **Step 6: Commit Task 6**

```bash
git add \
  src-tauri/src/cli_protocol.rs \
  src-tauri/src/cli_protocol_tests.rs \
  src-tauri/src/cli_server.rs
git commit -m "Add memory CLI socket protocol"
```

---

### Task 7: Add `mdx-cli memory` Commands And `--root` Headless Execution

**Files:**
- Modify: `src-tauri/src/bin/mdx_cli.rs`

- [ ] **Step 1: Add failing binary tests for the new command surface**

Append these tests to the existing `#[cfg(test)] mod tests` in `src-tauri/src/bin/mdx_cli.rs`:

```rust
#[test]
fn memory_recall_request_joins_multiword_query() {
    let command = CommandLine::Memory {
        root: None,
        command: MemoryCommand::Recall {
            json: true,
            include_threads: false,
            limit: None,
            byte_budget: None,
            tag: None,
            since: None,
            query: vec!["jwt".to_string(), "auth".to_string()],
        },
    };

    assert!(matches!(
        request_from_command(&command).unwrap(),
        CliRequest::MemoryRecall { query, .. } if query == "jwt auth"
    ));
}

#[test]
fn memory_thread_save_request_reads_file_body() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("thread.md");
    std::fs::write(&file, "## Message 1\n\nHello\n").unwrap();
    let command = CommandLine::Memory {
        root: None,
        command: MemoryCommand::Thread {
            command: MemoryThreadCommand::Save {
                source: "manual".to_string(),
                thread_id: Some("cursor:abc123".to_string()),
                title: "Implement auth middleware".to_string(),
                file: Some(file.to_string_lossy().into_owned()),
                stdin: false,
            },
        },
    };

    assert!(matches!(
        request_from_command(&command).unwrap(),
        CliRequest::MemoryThreadSave { body, .. } if body == "## Message 1\n\nHello\n"
    ));
}

#[test]
fn memory_root_override_detects_headless_root() {
    let command = CommandLine::Memory {
        root: Some("/tmp/workspace".to_string()),
        command: MemoryCommand::Status { json: true },
    };

    assert_eq!(memory_root_override(&command), Some("/tmp/workspace"));
}

#[test]
fn memory_working_get_default_output_is_markdown_only() {
    let command = CommandLine::Memory {
        root: None,
        command: MemoryCommand::Working {
            command: MemoryWorkingCommand::Get { json: false },
        },
    };
    let response = CliResponse {
        ok: true,
        content: Some("# Working Memory\n".to_string()),
        ..CliResponse::default()
    };

    assert_eq!(success_output(&command, &response), "# Working Memory\n");
}
```

- [ ] **Step 2: Run the binary tests to verify the Memory CLI does not exist yet**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin mdx-cli
```

Expected: FAIL because `CommandLine::Memory`, `MemoryCommand`, `MemoryThreadCommand`, `MemoryWorkingCommand`, or `memory_root_override` do not exist.

- [ ] **Step 3: Add the full nested Clap command surface**

Extend `src-tauri/src/bin/mdx_cli.rs` with these enums:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum CommandLine {
    Memory {
        #[arg(long)]
        root: Option<String>,
        #[command(subcommand)]
        command: MemoryCommand,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryCommand {
    Status {
        #[arg(long)]
        json: bool,
    },
    Init,
    Thread {
        #[command(subcommand)]
        command: MemoryThreadCommand,
    },
    Add {
        #[arg(long)]
        title: String,
        #[arg(long)]
        body: String,
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        #[arg(long)]
        source_thread: Option<String>,
        #[arg(long)]
        importance: Option<f64>,
        #[arg(long)]
        confidence: Option<f64>,
    },
    Show {
        target: String,
        #[arg(long)]
        json: bool,
    },
    List {
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(long)]
        json: bool,
    },
    Search {
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(long)]
        json: bool,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    Archive {
        target: String,
    },
    Working {
        #[command(subcommand)]
        command: MemoryWorkingCommand,
    },
    Recall {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        include_threads: bool,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        byte_budget: Option<usize>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    Promote {
        #[arg(long)]
        thread: String,
        #[arg(long)]
        ingest: bool,
        #[arg(long)]
        title: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryThreadCommand {
    Save {
        #[arg(long)]
        source: String,
        #[arg(long)]
        thread_id: Option<String>,
        #[arg(long)]
        title: String,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
    },
    Show {
        target: String,
        #[arg(long)]
        json: bool,
    },
    List {
        #[arg(long)]
        source: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryWorkingCommand {
    Get {
        #[arg(long)]
        json: bool,
    },
    Set {
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
    },
    Append {
        #[arg(long)]
        section: String,
        #[arg(long)]
        text: String,
    },
}
```

- [ ] **Step 4: Implement request conversion, local input loading, and `--root` override**

Add these helpers:

```rust
fn memory_root_override(command: &CommandLine) -> Option<&str> {
    match command {
        CommandLine::Memory { root: Some(root), .. } => Some(root.as_str()),
        _ => None,
    }
}

fn read_input_from_file_or_stdin(
    file: Option<&String>,
    stdin: bool,
    noun: &str,
) -> io::Result<String> {
    match (file, stdin) {
        (Some(path), false) => std::fs::read_to_string(path),
        (None, true) => {
            let mut buffer = String::new();
            io::stdin().read_to_string(&mut buffer)?;
            Ok(buffer)
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{noun} input requires exactly one of --file or --stdin"),
        )),
    }
}

fn parse_since_arg(value: &str) -> io::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "since must not be empty"));
    }
    if trimmed.contains('T') {
        return Ok(trimmed.to_string());
    }
    let (number, unit) = trimmed.split_at(trimmed.len() - 1);
    let amount: i64 = number.parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "since must use Nd/Nh/Nm or RFC3339"))?;
    let now = time::OffsetDateTime::now_utc();
    let then = match unit {
        "d" => now - time::Duration::days(amount),
        "h" => now - time::Duration::hours(amount),
        "m" => now - time::Duration::minutes(amount),
        _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "since must use Nd/Nh/Nm or RFC3339")),
    };
    then.format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}
```

Extend `request_from_command` with `Memory*` mappings. For example:

```rust
        CommandLine::Memory { command, .. } => match command {
            MemoryCommand::Status { .. } => CliRequest::MemoryStatus,
            MemoryCommand::Init => CliRequest::MemoryInit,
            MemoryCommand::Thread { command } => match command {
                MemoryThreadCommand::Save { source, thread_id, title, file, stdin } => {
                    CliRequest::MemoryThreadSave {
                        source: trim_required_value(source, "source")?,
                        thread_id: thread_id.clone(),
                        title: trim_required_value(title, "title")?,
                        body: read_input_from_file_or_stdin(file.as_ref(), *stdin, "thread body")?,
                    }
                }
                MemoryThreadCommand::Show { target, .. } => CliRequest::MemoryThreadShow {
                    target: target.clone(),
                },
                MemoryThreadCommand::List { source, since, .. } => CliRequest::MemoryThreadList {
                    source: source.clone(),
                    since: since.as_deref().map(parse_since_arg).transpose()?,
                },
            },
            MemoryCommand::Recall { query, limit, byte_budget, include_threads, tag, since, .. } => {
                CliRequest::MemoryRecall {
                    query: join_required_words(query, "query")?,
                    limit: *limit,
                    byte_budget: *byte_budget,
                    include_threads: Some(*include_threads),
                    tag: tag.clone(),
                    since: since.as_deref().map(parse_since_arg).transpose()?,
                }
            }
            MemoryCommand::Add { title, body, tags, source_thread, importance, confidence } => {
                CliRequest::MemoryAdd {
                    title: trim_required_value(title, "title")?,
                    body: trim_required_value(body, "body")?,
                    tags: tags.clone(),
                    source_thread: source_thread.clone(),
                    importance: *importance,
                    confidence: *confidence,
                }
            }
            MemoryCommand::Show { target, .. } => CliRequest::MemoryShow {
                target: target.clone(),
            },
            MemoryCommand::List { tag, since, .. } => CliRequest::MemoryList {
                tag: tag.clone(),
                since: since.as_deref().map(parse_since_arg).transpose()?,
            },
            MemoryCommand::Search { query, limit, tag, since, .. } => CliRequest::MemorySearch {
                query: join_required_words(query, "query")?,
                limit: *limit,
                tag: tag.clone(),
                since: since.as_deref().map(parse_since_arg).transpose()?,
            },
            MemoryCommand::Archive { target } => CliRequest::MemoryArchive {
                target: target.clone(),
            },
            MemoryCommand::Working { command } => match command {
                MemoryWorkingCommand::Get { .. } => CliRequest::MemoryWorkingGet,
                MemoryWorkingCommand::Set { file, stdin } => CliRequest::MemoryWorkingSet {
                    content: read_input_from_file_or_stdin(file.as_ref(), *stdin, "working memory")?,
                },
                MemoryWorkingCommand::Append { section, text } => CliRequest::MemoryWorkingAppend {
                    section: trim_required_value(section, "section")?,
                    text: trim_required_value(text, "text")?,
                },
            },
            MemoryCommand::Promote { thread, ingest, title } => CliRequest::MemoryPromote {
                target: thread.clone(),
                ingest: Some(*ingest),
                title: title.clone(),
            },
        },
```

Then change `run()` so `--root` bypasses the socket:

```rust
fn run() -> io::Result<(CommandLine, CliResponse)> {
    let cli = Cli::parse();
    let command = cli.command;

    if let Some(root) = memory_root_override(&command) {
        let root = normalize_cli_path(root)?;
        let response = execute_memory_headless(&command, root)?;
        return Ok((command, response));
    }

    let request = request_from_command(&command)?;
    let mut conn = Connection::open()?;
    conn.send(&request).map(|response| (command, response))
}
```

Implement `execute_memory_headless` with direct `mdx_lib::memory::*` calls that build the same `CliResponse` shapes as socket mode. At minimum, cover:

```rust
fn execute_memory_headless(command: &CommandLine, root_path: String) -> io::Result<CliResponse> {
    match command {
        CommandLine::Memory {
            command: MemoryCommand::Status { .. },
            ..
        } => Ok(CliResponse {
            ok: true,
            memory_status: Some(
                mdx_lib::memory::memory_detect_workspace(root_path)
                    .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?,
            ),
            ..CliResponse::default()
        }),
        CommandLine::Memory {
            command: MemoryCommand::Init,
            ..
        } => Ok(CliResponse {
            ok: true,
            memory_init: Some(
                mdx_lib::memory::memory_initialize_workspace(root_path)
                    .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?,
            ),
            ..CliResponse::default()
        }),
        CommandLine::Memory {
            command:
                MemoryCommand::Working {
                    command: MemoryWorkingCommand::Get { .. },
                },
            ..
        } => Ok(CliResponse {
            ok: true,
            content: Some(
                mdx_lib::memory::memory_working_get(root_path)
                    .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?,
            ),
            ..CliResponse::default()
        }),
        _ => {
            let request = request_from_command(command)?;
            execute_memory_headless_request(root_path, request)
        }
    }
}
```

Then implement `execute_memory_headless_request` for every remaining `CliRequest::Memory*` variant so that:

- `MemoryThreadSave` calls `mdx_lib::memory::memory_thread_save`
- `MemoryAdd` calls `mdx_lib::memory::memory_add`
- `MemoryShow` and `MemoryThreadShow` put Markdown into `response.content`
- `MemoryList` and `MemorySearch` fill `response.memory_entries`
- `MemoryRecall` fills `response.memory_recall`
- `MemoryPromote` fills `response.memory_promote`
- `MemoryArchive` returns the archived record in `response.memory_entry`

- [ ] **Step 5: Extend output rendering so plain-text commands stay readable**

Update `success_output` to treat these commands as plain text when `--json` is false:

```rust
        CommandLine::Memory {
            command: MemoryCommand::Thread {
                command: MemoryThreadCommand::Show { json: false, .. },
            },
            ..
        }
        | CommandLine::Memory {
            command: MemoryCommand::Show { json: false, .. },
            ..
        }
        | CommandLine::Memory {
            command: MemoryCommand::Working {
                command: MemoryWorkingCommand::Get { json: false },
            },
            ..
        } => response.content.clone().unwrap_or_default(),
```

Everything else should remain JSON by default.

- [ ] **Step 6: Run binary tests and a targeted headless smoke**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin mdx-cli
tmpdir="$(mktemp -d)"
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" init
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" working get
```

Expected:

- Binary tests PASS
- `memory --root "$tmpdir" init` prints JSON with `"ok":true`
- `memory --root "$tmpdir" working get` prints a `# Working Memory` document

- [ ] **Step 7: Commit Task 7**

```bash
git add src-tauri/src/bin/mdx_cli.rs
git commit -m "Add mdx-cli memory commands"
```

---

### Task 8: Document The New CLI Surface And Run Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Update the READMEs with the new Memory CLI boundary**

Add the Memory commands below each existing CLI section:

```bash
mdx-cli memory status [--json]
mdx-cli memory init
mdx-cli memory thread save --source manual --title "..." --file <path>
mdx-cli memory add --title "..." --body "..."
mdx-cli memory recall [--json] <query...>
mdx-cli memory working get
mdx-cli memory promote --thread <thread-id>
mdx-cli memory --root <workspace> ...
```

Add one sentence in each README stating:

- `memory *` supports `--root` headless execution.
- `llm-wiki *` remains socket-only.
- Memory is Markdown-native and writes under `memory/` plus `.mdx/`.

- [ ] **Step 2: Run formatting and the full Rust verification suite**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- `cargo fmt` exits successfully with no diff left behind.
- Full `cargo test` passes, including existing `cli_protocol_tests`, `llm_wiki_tests`, and the new `memory_tests`.

- [ ] **Step 3: Run a full headless Memory smoke flow**

Run:

```bash
tmpdir="$(mktemp -d)"
threadfile="$tmpdir/thread.md"
cat > "$threadfile" <<'EOF'
## Message 1 — user — 2026-06-12T09:00:01Z

Implement auth middleware.

## Message 2 — assistant — 2026-06-12T09:00:15Z

Plan the work.
EOF

cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" init
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" thread save --source manual --thread-id cursor:abc123 --title "Implement auth middleware" --file "$threadfile"
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" add --title "JWT access token is 15 minutes" --body "Auth uses a 15 minute JWT access token." --tags auth,jwt
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" recall jwt
cargo run --manifest-path src-tauri/Cargo.toml --bin mdx-cli -- memory --root "$tmpdir" promote --thread cursor:abc123
```

Expected:

- `thread save` returns JSON containing `memory/threads/manual/2026-06-12-cursor-abc123.md`
- `add` returns JSON containing `memory_id`
- `recall` returns JSON containing at least one memory match for JWT
- `promote` returns JSON containing `raw/promoted/2026-06-12-implement-auth-middleware.md`

- [ ] **Step 4: Commit Task 8**

```bash
git add README.md README.zh-CN.md
git commit -m "Document memory phase one CLI"
```

---

## Self-Review

### Spec Coverage

- Memory workspace detection/init: Task 2
- Thread save/show/list and hash dedup: Task 3
- Memory add/show/list/archive and working get/set/append: Task 4
- Recall/search/promote: Task 5
- `mdx-cli memory *` socket mode and `--root` headless mode: Tasks 6 and 7
- Shared `log.md` audit updates: Tasks 2 through 7
- Contract/doc alignment: Tasks 1 and 8
- LLM Wiki no-regression boundary: enforced by Task 8 full `cargo test`

### Placeholder Scan

- No `TODO`, `TBD`, “similar to Task N”, or “write tests for the above” placeholders remain.
- Every new command in scope is tied to at least one test or smoke command.

### Type Consistency

- `MemoryWorkspaceStatus` / `InitializeMemoryResult` are the workspace/init shapes across service and CLI.
- `ThreadSaveRequest` / `ThreadSaveResult` are reused by service and CLI.
- `MemoryAddRequest`, `MemoryRecord`, `MemorySummary`, `RecallRequest`, `RecallResult`, and `MemoryPromoteResult` are the shared Phase 1 contract types.

### Design Drift Check

- No Phase 2 sqlite/FTS/vector work is introduced.
- No Phase 3 daemon/MCP work is introduced.
- No Memory UI or Tauri invoke handlers are introduced.
- LLM Wiki remains socket-only and does not gain `--root`.

Plan complete and saved to `docs/loopx/plans/2026-06-12-memory-phase-one.md`.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
