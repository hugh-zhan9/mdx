# MDX LLM Wiki Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [docs/loopx/design/MDX本地优先LLMWiki工作区需求设计文档.md](../design/MDX本地优先LLMWiki工作区需求设计文档.md)

**Goal:** Build the macOS desktop LLM Wiki mode for MDX: initialize a wiki workspace, scan `raw/`, run app-internal LLM ingest/query/digest/lint, maintain generated wiki files, and expose progress through a LLM Wiki panel.

**Architecture:** Keep ordinary Markdown workspace mode unchanged. Add a dedicated `features/llm-wiki` frontend domain and Rust/Tauri `llm_wiki*` modules. Rust owns filesystem safety, app-level LLM config, provider calls, cache/progress writes, and Tauri commands; the frontend owns panel state, user actions, and save-trigger wiring.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Tauri 2, Rust 2021, serde/serde_json, sha2, reqwest for OpenAI-compatible HTTP calls once real provider calls are implemented.

---

## File Structure

### New Frontend Files

- `features/llm-wiki/index.ts`: barrel export.
- `features/llm-wiki/lib/types.ts`: shared UI-facing LLM Wiki types.
- `features/llm-wiki/lib/llm-wiki-client.ts`: typed wrappers around Tauri commands.
- `features/llm-wiki/lib/status-view-model.ts`: pure transformation from backend status to panel sections.
- `features/llm-wiki/lib/status-view-model.test.ts`: Vitest coverage for status labels and actions.
- `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`: detects mode, polls status, exposes panel actions.
- `features/llm-wiki/components/llm-wiki-panel.tsx`: right-side panel UI for init/config/progress/query/digest/lint/graph.

### Modified Frontend Files

- `features/workspace/components/workspace-shell.tsx`: mount `LlmWikiPanel` alongside existing editor/outline and pass save-trigger callback to save queue.
- `features/workspace/lib/workspace-save.ts`: add optional `afterSave` hook and invoke it after successful saves.
- `features/workspace/lib/workspace-save.test.ts`: verify `afterSave` fires only after a successful save under current snapshot.
- `features/workspace/index.ts`: export workspace pieces unchanged; no LLM Wiki export here.

### New Rust Files

- `src-tauri/src/llm_wiki.rs`: Tauri command surface and orchestration entry points.
- `src-tauri/src/llm_wiki_models.rs`: request/response structs, progress/cache/config models, task status enums.
- `src-tauri/src/llm_wiki_fs.rs`: workspace detection, initialization, raw scanning, cache/progress/graph filesystem operations.
- `src-tauri/src/llm_wiki_llm.rs`: app-level LLM config loading/saving and OpenAI-compatible chat completion calls.
- `src-tauri/src/llm_wiki_ingest.rs`: ingest prompt assembly, JSON/file-block parsing, safe write coordination.
- `src-tauri/src/llm_wiki_query.rs`: query/digest/lint retrieval and generation.
- `src-tauri/src/llm_wiki_tests.rs`: Rust tests for init, scanner, cache, graph, safe path rejection, and mocked LLM parsing.

### Modified Rust Files

- `src-tauri/Cargo.toml`: add `reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }` when Task 9 introduces real provider HTTP calls.
- `src-tauri/src/lib.rs`: register new modules, manage `LlmWikiState`, and add new Tauri commands.

---

### Task 1: Rust LLM Wiki Models And Initialization

**Files:**
- Create: `src-tauri/src/llm_wiki_models.rs`
- Create: `src-tauri/src/llm_wiki_fs.rs`
- Create: `src-tauri/src/llm_wiki.rs`
- Create: `src-tauri/src/llm_wiki_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing initialization tests**

Add `src-tauri/src/llm_wiki_tests.rs` with:

```rust
use tempfile::tempdir;

use crate::llm_wiki_fs::{
    detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
};

#[test]
fn detect_reports_ordinary_workspace_before_initialization() {
    let root = tempdir().unwrap();

    let status = detect_llm_wiki_workspace(root.path()).unwrap();

    assert!(!status.has_llm_wiki);
    assert!(status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"raw".to_string()));
    assert!(status.missing_paths.contains(&"wiki".to_string()));
    assert!(status.missing_paths.contains(&"AGENTS.md".to_string()));
}

#[test]
fn initialize_creates_llm_wiki_structure_without_migrating_markdown() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("existing.md"), "# Existing\n").unwrap();

    let result = initialize_llm_wiki_workspace(root.path()).unwrap();

    assert!(root.path().join("raw/notes").is_dir());
    assert!(root.path().join("raw/articles").is_dir());
    assert!(root.path().join("raw/assets").is_dir());
    assert!(root.path().join("wiki/sources").is_dir());
    assert!(root.path().join("wiki/entities").is_dir());
    assert!(root.path().join("wiki/concepts").is_dir());
    assert!(root.path().join("wiki/syntheses").is_dir());
    assert!(root.path().join("index.md").is_file());
    assert!(root.path().join("log.md").is_file());
    assert!(root.path().join("purpose.md").is_file());
    assert!(root.path().join("AGENTS.md").is_file());
    assert!(root.path().join("llm-wiki-progress.md").is_file());
    assert!(root.path().join(".llm-wiki/cache.json").is_file());
    assert!(root.path().join(".llm-wiki/config.json").is_file());
    assert!(root.path().join("existing.md").is_file());
    assert!(!root.path().join("raw/notes/existing.md").exists());
    assert!(!result.created_paths.is_empty());
}

#[test]
fn initialize_is_idempotent_and_preserves_existing_agents_file() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path()).unwrap();
    std::fs::write(root.path().join("AGENTS.md"), "# Custom Rules\n").unwrap();

    initialize_llm_wiki_workspace(root.path()).unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let agents = std::fs::read_to_string(root.path().join("AGENTS.md")).unwrap();
    assert_eq!(agents, "# Custom Rules\n");
}
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run:

```bash
cd src-tauri && cargo test llm_wiki -- --nocapture
```

Expected: FAIL with unresolved imports for `crate::llm_wiki_fs` or missing functions.

- [ ] **Step 3: Add models**

Create `src-tauri/src/llm_wiki_models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiWorkspaceStatus {
    pub mode: String,
    pub has_llm_wiki: bool,
    pub can_initialize: bool,
    pub missing_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLlmWikiResult {
    pub created_paths: Vec<String>,
    pub preserved_paths: Vec<String>,
    pub status: LlmWikiWorkspaceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiProgress {
    pub status: String,
    pub total_raw_files: usize,
    pub pending: Vec<String>,
    pub processing: Option<String>,
    pub completed: Vec<String>,
    pub failed: Vec<LlmWikiFailedFile>,
    pub skipped: Vec<String>,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiFailedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiCache {
    pub version: u32,
    pub entries: std::collections::BTreeMap<String, LlmWikiCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiCacheEntry {
    pub hash: String,
    pub source_page: String,
    pub ingested_at: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiKnowledgeConfig {
    pub paused: bool,
    pub skip_paths: Vec<String>,
}
```

- [ ] **Step 4: Add filesystem initializer**

Create `src-tauri/src/llm_wiki_fs.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmWikiCache, LlmWikiKnowledgeConfig,
    LlmWikiProgress, LlmWikiWorkspaceStatus,
};
use crate::models::WorkspaceError;

const REQUIRED_PATHS: &[&str] = &[
    "raw",
    "wiki",
    "index.md",
    "log.md",
    "purpose.md",
    "AGENTS.md",
    "llm-wiki-progress.md",
];

pub fn detect_llm_wiki_workspace(root: impl AsRef<Path>) -> Result<LlmWikiWorkspaceStatus, WorkspaceError> {
    let root = root.as_ref();
    let mut missing_paths = Vec::new();

    for relative in REQUIRED_PATHS {
        if !root.join(relative).exists() {
            missing_paths.push((*relative).to_string());
        }
    }

    let has_llm_wiki = missing_paths.is_empty();
    Ok(LlmWikiWorkspaceStatus {
        mode: if has_llm_wiki { "llm_wiki".to_string() } else { "ordinary".to_string() },
        has_llm_wiki,
        can_initialize: true,
        missing_paths,
    })
}

pub fn initialize_llm_wiki_workspace(root: impl AsRef<Path>) -> Result<InitializeLlmWikiResult, WorkspaceError> {
    let root = root.as_ref();
    let mut created_paths = Vec::new();
    let mut preserved_paths = Vec::new();

    for relative in [
        "raw/notes",
        "raw/articles",
        "raw/assets",
        "wiki/sources",
        "wiki/entities",
        "wiki/concepts",
        "wiki/syntheses",
        ".llm-wiki",
    ] {
        ensure_dir(root, relative, &mut created_paths, &mut preserved_paths)?;
    }

    ensure_file(root, "index.md", "# Index\n\n", &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, "log.md", "# Log\n\n", &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, "purpose.md", "# Purpose\n\n请描述这个知识库的研究方向、关键问题和范围。\n", &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, "AGENTS.md", default_agents_template().as_str(), &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, "llm-wiki-progress.md", default_progress_markdown().as_str(), &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, ".llm-wiki/cache.json", default_cache_json().as_str(), &mut created_paths, &mut preserved_paths)?;
    ensure_file(root, ".llm-wiki/config.json", default_config_json().as_str(), &mut created_paths, &mut preserved_paths)?;

    Ok(InitializeLlmWikiResult {
        created_paths,
        preserved_paths,
        status: detect_llm_wiki_workspace(root)?,
    })
}

fn ensure_dir(root: &Path, relative: &str, created: &mut Vec<String>, preserved: &mut Vec<String>) -> Result<(), WorkspaceError> {
    let path = root.join(relative);
    if path.exists() {
        preserved.push(relative.to_string());
        return Ok(());
    }
    fs::create_dir_all(&path).map_err(|error| WorkspaceError::from_io("write_failed", "failed to create llm wiki directory", &error))?;
    created.push(relative.to_string());
    Ok(())
}

fn ensure_file(root: &Path, relative: &str, content: &str, created: &mut Vec<String>, preserved: &mut Vec<String>) -> Result<(), WorkspaceError> {
    let path = root.join(relative);
    if path.exists() {
        preserved.push(relative.to_string());
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| WorkspaceError::from_io("write_failed", "failed to create llm wiki file parent", &error))?;
    }
    fs::write(&path, content).map_err(|error| WorkspaceError::from_io("write_failed", "failed to write llm wiki file", &error))?;
    created.push(relative.to_string());
    Ok(())
}

fn default_agents_template() -> String {
    "# AGENTS\n\nwiki_language: zh-CN\n\n只处理 raw/ 作为一手素材。维护 wiki/sources、wiki/entities、wiki/concepts、wiki/syntheses、index.md、log.md 和 llm-wiki-progress.md。\n".to_string()
}

fn default_progress_markdown() -> String {
    "# LLM Wiki Progress\n\n## Status\n\nidle\n\n## Pending\n\n## Processing\n\n无\n\n## Completed\n\n## Failed\n\n## Skipped\n".to_string()
}

fn default_cache_json() -> String {
    serde_json::to_string_pretty(&LlmWikiCache { version: 1, entries: Default::default() }).unwrap() + "\n"
}

fn default_config_json() -> String {
    serde_json::to_string_pretty(&LlmWikiKnowledgeConfig { paused: false, skip_paths: Vec::new() }).unwrap() + "\n"
}
```

- [ ] **Step 5: Add Tauri command wrapper and register modules**

Create `src-tauri/src/llm_wiki.rs`:

```rust
use std::path::PathBuf;

use crate::llm_wiki_fs::{detect_llm_wiki_workspace, initialize_llm_wiki_workspace};
use crate::llm_wiki_models::{InitializeLlmWikiResult, LlmWikiWorkspaceStatus};
use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

#[tauri::command]
pub fn llm_wiki_detect_workspace(root_path: String) -> Result<LlmWikiWorkspaceStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    detect_llm_wiki_workspace(root)
}

#[tauri::command]
pub fn llm_wiki_initialize_workspace(root_path: String) -> Result<InitializeLlmWikiResult, WorkspaceError> {
    let root: PathBuf = canonicalize_workspace_root(root_path)?;
    initialize_llm_wiki_workspace(root)
}
```

Modify `src-tauri/src/lib.rs`:

```rust
mod llm_wiki;
mod llm_wiki_fs;
mod llm_wiki_models;

#[cfg(test)]
mod llm_wiki_tests;
```

Add commands to `tauri::generate_handler!`:

```rust
llm_wiki::llm_wiki_detect_workspace,
llm_wiki::llm_wiki_initialize_workspace,
```

- [ ] **Step 6: Run Rust initialization tests**

Run:

```bash
cd src-tauri && cargo test llm_wiki -- --nocapture
```

Expected: PASS for the three initialization tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_fs.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: add llm wiki workspace initialization"
```

### Task 2: Raw Scanner, Cache, Progress, Skip, And Graph

**Files:**
- Modify: `src-tauri/src/llm_wiki_fs.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add failing scanner/cache/progress/graph tests**

Append to `src-tauri/src/llm_wiki_tests.rs`:

```rust
use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, read_knowledge_config, scan_raw_files,
    update_progress_markdown,
};

#[test]
fn scan_raw_files_only_includes_markdown_under_raw_and_respects_skip() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# A\n").unwrap();
    std::fs::write(root.path().join("raw/notes/b.txt"), "B\n").unwrap();
    std::fs::create_dir_all(root.path().join("raw/ignored")).unwrap();
    std::fs::write(root.path().join("raw/ignored/c.md"), "# C\n").unwrap();
    std::fs::write(root.path().join("wiki/sources/generated.md"), "# Generated\n").unwrap();
    std::fs::write(
        root.path().join(".llm-wiki/config.json"),
        r#"{"paused":false,"skipPaths":["raw/ignored"]}"#,
    )
    .unwrap();

    let config = read_knowledge_config(root.path()).unwrap();
    let files = scan_raw_files(root.path(), &config).unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].relative_path, "raw/notes/a.md");
    assert!(files[0].hash.starts_with("sha256:"));
}

#[test]
fn update_progress_markdown_writes_visible_status_document() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    update_progress_markdown(
        root.path(),
        "scanning",
        &["raw/notes/a.md".to_string()],
        &[],
        &[("raw/notes/b.md".to_string(), "llm_failed".to_string())],
        &["raw/ignored".to_string()],
    )
    .unwrap();

    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    assert!(progress.contains("# LLM Wiki Progress"));
    assert!(progress.contains("scanning"));
    assert!(progress.contains("raw/notes/a.md"));
    assert!(progress.contains("raw/notes/b.md"));
    assert!(progress.contains("llm_failed"));
    assert!(progress.contains("raw/ignored"));
}

#[test]
fn graph_markdown_uses_wikilinks_without_inferred_labels() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("wiki/entities/A.md"), "# A\n\n[[B]]\n").unwrap();
    std::fs::write(root.path().join("wiki/concepts/B.md"), "# B\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains("```mermaid"));
    assert!(markdown.contains("A --> B"));
    assert!(!markdown.contains("-->|"));
}
```

- [ ] **Step 2: Run scanner tests to verify failure**

Run:

```bash
cd src-tauri && cargo test llm_wiki -- --nocapture
```

Expected: FAIL with missing `scan_raw_files`, `update_progress_markdown`, or `build_knowledge_graph_markdown`.

- [ ] **Step 3: Add scanner models**

Add to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanFile {
    pub relative_path: String,
    pub absolute_path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanResult {
    pub total: usize,
    pub pending: Vec<String>,
    pub skipped: Vec<String>,
}
```

- [ ] **Step 4: Implement scanner, config, progress, graph**

Add functions to `src-tauri/src/llm_wiki_fs.rs`:

```rust
use sha2::{Digest, Sha256};
use crate::llm_wiki_models::RawScanFile;

pub fn read_knowledge_config(root: impl AsRef<Path>) -> Result<LlmWikiKnowledgeConfig, WorkspaceError> {
    let path = root.as_ref().join(".llm-wiki/config.json");
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| WorkspaceError::new("config_parse_failed", format!("failed to parse llm wiki config: {error}"))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LlmWikiKnowledgeConfig { paused: false, skip_paths: Vec::new() }),
        Err(error) => Err(WorkspaceError::from_io("read_failed", "failed to read llm wiki config", &error)),
    }
}

pub fn scan_raw_files(root: impl AsRef<Path>, config: &LlmWikiKnowledgeConfig) -> Result<Vec<RawScanFile>, WorkspaceError> {
    let root = root.as_ref();
    let raw = root.join("raw");
    let mut files = Vec::new();
    if !raw.is_dir() {
        return Ok(files);
    }
    scan_raw_dir(root, &raw, config, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn scan_raw_dir(root: &Path, dir: &Path, config: &LlmWikiKnowledgeConfig, files: &mut Vec<RawScanFile>) -> Result<(), WorkspaceError> {
    for entry in fs::read_dir(dir).map_err(|error| WorkspaceError::from_io("read_failed", "failed to scan raw directory", &error))? {
        let entry = entry.map_err(|error| WorkspaceError::from_io("read_failed", "failed to read raw entry", &error))?;
        let path = entry.path();
        let relative = relative_path_string(root, &path)?;
        if is_skipped(&relative, config) {
            continue;
        }
        if path.is_dir() {
            scan_raw_dir(root, &path, config, files)?;
        } else if is_raw_markdown(&path) {
            let bytes = fs::read(&path).map_err(|error| WorkspaceError::from_io("read_failed", "failed to read raw markdown", &error))?;
            let hash = content_hash(&relative, &bytes);
            files.push(RawScanFile {
                relative_path: relative,
                absolute_path: path.to_string_lossy().to_string(),
                hash,
            });
        }
    }
    Ok(())
}

fn is_raw_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn is_skipped(relative: &str, config: &LlmWikiKnowledgeConfig) -> bool {
    config.skip_paths.iter().any(|skip| relative == skip || relative.starts_with(&format!("{skip}/")))
}

fn content_hash(relative: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(relative.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn relative_path_string(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    let relative = path.strip_prefix(root).map_err(|_| WorkspaceError::new("outside_workspace", "path is outside workspace"))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub fn update_progress_markdown(
    root: impl AsRef<Path>,
    status: &str,
    pending: &[String],
    completed: &[String],
    failed: &[(String, String)],
    skipped: &[String],
) -> Result<(), WorkspaceError> {
    let mut markdown = format!("# LLM Wiki Progress\n\n## Status\n\n{status}\n\n## Pending\n\n");
    for path in pending {
        markdown.push_str(&format!("- {path}\n"));
    }
    markdown.push_str("\n## Processing\n\n无\n\n## Completed\n\n");
    for path in completed {
        markdown.push_str(&format!("- {path}\n"));
    }
    markdown.push_str("\n## Failed\n\n");
    for (path, reason) in failed {
        markdown.push_str(&format!("- {path}: {reason}\n"));
    }
    markdown.push_str("\n## Skipped\n\n");
    for path in skipped {
        markdown.push_str(&format!("- {path}\n"));
    }
    fs::write(root.as_ref().join("llm-wiki-progress.md"), markdown)
        .map_err(|error| WorkspaceError::from_io("write_failed", "failed to write llm wiki progress", &error))
}

pub fn build_knowledge_graph_markdown(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let wiki = root.join("wiki");
    let mut edges = Vec::<(String, String)>::new();
    collect_wikilink_edges(&wiki, &wiki, &mut edges)?;
    edges.sort();
    edges.dedup();

    let mut markdown = format!("# Knowledge Graph\n\n> 自动生成 | 共 {} 条关联\n\n```mermaid\ngraph LR\n", edges.len());
    for (from, to) in edges {
        markdown.push_str(&format!("  {} --> {}\n", mermaid_id(&from), mermaid_id(&to)));
    }
    markdown.push_str("```\n");
    Ok(markdown)
}
```

Add helper implementations for `collect_wikilink_edges` and `mermaid_id` in the same file:

```rust
fn collect_wikilink_edges(wiki_root: &Path, dir: &Path, edges: &mut Vec<(String, String)>) -> Result<(), WorkspaceError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| WorkspaceError::from_io("read_failed", "failed to scan wiki directory", &error))? {
        let entry = entry.map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki entry", &error))?;
        let path = entry.path();
        if path.is_dir() {
            collect_wikilink_edges(wiki_root, &path, edges)?;
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
            continue;
        }
        let Some(from) = path.file_stem().and_then(|stem| stem.to_str()).map(|stem| stem.to_string()) else {
            continue;
        };
        let content = fs::read_to_string(&path).map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki markdown", &error))?;
        for target in extract_wikilinks(&content) {
            if target != from {
                edges.push((from.clone(), target));
            }
        }
    }
    Ok(())
}

fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let inner = &after_start[..end];
        let target = inner.split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            links.push(target.to_string());
        }
        rest = &after_start[end + 2..];
    }
    links
}

fn mermaid_id(name: &str) -> String {
    name.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}
```

- [ ] **Step 5: Add Tauri command wrappers**

Add to `src-tauri/src/llm_wiki.rs`:

```rust
use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, read_knowledge_config, scan_raw_files,
    update_progress_markdown,
};
use crate::llm_wiki_models::RawScanResult;

#[tauri::command]
pub fn llm_wiki_rescan_raw(root_path: String) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = read_knowledge_config(&root)?;
    let files = scan_raw_files(&root, &config)?;
    let pending = files.iter().map(|file| file.relative_path.clone()).collect::<Vec<_>>();
    update_progress_markdown(&root, "scanning", &pending, &[], &[], &config.skip_paths)?;
    Ok(RawScanResult {
        total: files.len(),
        pending,
        skipped: config.skip_paths,
    })
}

#[tauri::command]
pub fn llm_wiki_refresh_graph(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let markdown = build_knowledge_graph_markdown(&root)?;
    std::fs::write(root.join("wiki/knowledge-graph.md"), &markdown)
        .map_err(|error| WorkspaceError::from_io("write_failed", "failed to write knowledge graph", &error))?;
    Ok(markdown)
}
```

Register:

```rust
llm_wiki::llm_wiki_rescan_raw,
llm_wiki::llm_wiki_refresh_graph,
```

- [ ] **Step 6: Run scanner tests**

Run:

```bash
cd src-tauri && cargo test llm_wiki -- --nocapture
```

Expected: PASS for initialization, scanner, progress, and graph tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_fs.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs src-tauri/src/lib.rs
git commit -m "feat: scan llm wiki raw sources"
```

### Task 3: Software-Level LLM Configuration And Provider Client

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/llm_wiki_llm.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add failing LLM config tests**

Append:

```rust
use crate::llm_wiki_llm::{
    load_llm_config_from_path, save_llm_config_to_path, LlmChatMessage,
    build_openai_chat_request,
};
use crate::llm_wiki_models::LlmProviderConfig;

#[test]
fn llm_config_round_trips_outside_workspace_files() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    save_llm_config_to_path(&path, &config).unwrap();
    let loaded = load_llm_config_from_path(&path).unwrap();

    assert_eq!(loaded, config);
}

#[test]
fn openai_chat_request_uses_model_and_messages() {
    let request = build_openai_chat_request(
        "model-a",
        vec![
            LlmChatMessage { role: "system".to_string(), content: "rules".to_string() },
            LlmChatMessage { role: "user".to_string(), content: "question".to_string() },
        ],
    );

    assert_eq!(request["model"], "model-a");
    assert_eq!(request["messages"][0]["role"], "system");
    assert_eq!(request["messages"][1]["content"], "question");
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd src-tauri && cargo test llm_config -- --nocapture
```

Expected: FAIL with unresolved `llm_wiki_llm` or `LlmProviderConfig`.

- [ ] **Step 3: Defer HTTP dependency**

Do not add `reqwest` in this task because Task 3 only stores app-level configuration and builds OpenAI-compatible request JSON. Add the HTTP dependency in Task 9 when `call_chat_completion` performs real provider calls.

- [ ] **Step 4: Add config model**

Add to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicLlmProviderConfig {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}
```

- [ ] **Step 5: Implement local software config and OpenAI request builder**

Create `src-tauri/src/llm_wiki_llm.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm_wiki_models::LlmProviderConfig;
use crate::models::WorkspaceError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmChatMessage {
    pub role: String,
    pub content: String,
}

pub fn load_llm_config_from_path(path: impl AsRef<Path>) -> Result<LlmProviderConfig, WorkspaceError> {
    let bytes = fs::read(path.as_ref()).map_err(|error| WorkspaceError::from_io("llm_config_load_failed", "failed to read llm config", &error))?;
    serde_json::from_slice(&bytes).map_err(|error| WorkspaceError::new("llm_config_parse_failed", format!("failed to parse llm config: {error}")))
}

pub fn save_llm_config_to_path(path: impl AsRef<Path>, config: &LlmProviderConfig) -> Result<(), WorkspaceError> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| WorkspaceError::from_io("llm_config_save_failed", "failed to create llm config directory", &error))?;
    }
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| WorkspaceError::new("llm_config_save_failed", format!("failed to serialize llm config: {error}")))?;
    fs::write(path, bytes).map_err(|error| WorkspaceError::from_io("llm_config_save_failed", "failed to write llm config", &error))
}

pub fn build_openai_chat_request(model: &str, messages: Vec<LlmChatMessage>) -> Value {
    json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2
    })
}

pub fn default_llm_config_path() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| WorkspaceError::new("llm_config_path_failed", "HOME is not set"))?;
    Ok(home.join(".mdx").join("llm-config.json"))
}
```

- [ ] **Step 6: Add Tauri config commands**

Add to `src-tauri/src/llm_wiki.rs`:

```rust
use crate::llm_wiki_llm::{
    default_llm_config_path, load_llm_config_from_path, save_llm_config_to_path,
};
use crate::llm_wiki_models::{LlmProviderConfig, PublicLlmProviderConfig};

#[tauri::command]
pub fn llm_config_get() -> Result<Option<PublicLlmProviderConfig>, WorkspaceError> {
    let path = default_llm_config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let config = load_llm_config_from_path(path)?;
    Ok(Some(PublicLlmProviderConfig {
        base_url: config.base_url,
        model: config.model,
        has_api_key: config.api_key.as_ref().map(|key| !key.is_empty()).unwrap_or(false),
    }))
}

#[tauri::command]
pub fn llm_config_set(config: LlmProviderConfig) -> Result<(), WorkspaceError> {
    save_llm_config_to_path(default_llm_config_path()?, &config)
}
```

Register:

```rust
mod llm_wiki_llm;

llm_wiki::llm_config_get,
llm_wiki::llm_config_set,
```

- [ ] **Step 7: Run LLM config tests**

Run:

```bash
cd src-tauri && cargo test llm_config -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_llm.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs src-tauri/src/lib.rs
git commit -m "feat: add llm provider configuration"
```

### Task 4: Ingest Parser, Safe Writer, And Cache Update

**Files:**
- Create: `src-tauri/src/llm_wiki_ingest.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_fs.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add failing parser and writer tests**

Append:

```rust
use crate::llm_wiki_ingest::{
    is_safe_llm_wiki_output_path, parse_file_blocks, write_ingest_outputs,
};

#[test]
fn parse_file_blocks_extracts_safe_outputs() {
    let blocks = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n---FILE: index.md---\n# Index\n---END FILE---",
    )
    .unwrap();

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].path, "wiki/sources/a.md");
    assert_eq!(blocks[0].content, "# A\n");
    assert_eq!(blocks[1].path, "index.md");
}

#[test]
fn output_path_guard_rejects_escape_and_raw_writes() {
    assert!(is_safe_llm_wiki_output_path("wiki/entities/A.md"));
    assert!(is_safe_llm_wiki_output_path("index.md"));
    assert!(!is_safe_llm_wiki_output_path("../outside.md"));
    assert!(!is_safe_llm_wiki_output_path("/tmp/outside.md"));
    assert!(!is_safe_llm_wiki_output_path("raw/notes/a.md"));
}

#[test]
fn write_ingest_outputs_writes_allowed_files_and_updates_cache_after_success() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# A\n").unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A Source\n---END FILE---").unwrap();

    write_ingest_outputs(root.path(), "raw/notes/a.md", "sha256:test", "test-model", &blocks).unwrap();

    assert_eq!(std::fs::read_to_string(root.path().join("wiki/sources/a.md")).unwrap(), "# A Source\n");
    let cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();
    assert!(cache.contains("raw/notes/a.md"));
    assert!(cache.contains("wiki/sources/a.md"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd src-tauri && cargo test ingest -- --nocapture
```

Expected: FAIL with unresolved `llm_wiki_ingest`.

- [ ] **Step 3: Implement file block parser and path guard**

Create `src-tauri/src/llm_wiki_ingest.rs`:

```rust
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::llm_wiki_models::{LlmWikiCache, LlmWikiCacheEntry};
use crate::models::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmWikiFileBlock {
    pub path: String,
    pub content: String,
}

pub fn parse_file_blocks(output: &str) -> Result<Vec<LlmWikiFileBlock>, WorkspaceError> {
    let mut blocks = Vec::new();
    let mut rest = output;
    while let Some(start) = rest.find("---FILE:") {
        let after_marker = &rest[start + "---FILE:".len()..];
        let Some(path_end) = after_marker.find("---") else {
            return Err(WorkspaceError::new("llm_output_parse_failed", "file block path is not closed"));
        };
        let path = after_marker[..path_end].trim().to_string();
        let after_path = &after_marker[path_end + 3..];
        let Some(content_end) = after_path.find("---END FILE---") else {
            return Err(WorkspaceError::new("llm_output_parse_failed", "file block content is not closed"));
        };
        let mut content = after_path[..content_end].to_string();
        if content.starts_with('\n') {
            content.remove(0);
        }
        if !is_safe_llm_wiki_output_path(&path) {
            return Err(WorkspaceError::new("unsafe_llm_output_path", format!("unsafe llm wiki output path: {path}")));
        }
        blocks.push(LlmWikiFileBlock { path, content });
        rest = &after_path[content_end + "---END FILE---".len()..];
    }
    Ok(blocks)
}

pub fn is_safe_llm_wiki_output_path(path: &str) -> bool {
    if path.starts_with('/') || path.contains("..") || path.contains('\\') {
        return false;
    }
    path == "index.md"
        || path == "log.md"
        || path == "llm-wiki-progress.md"
        || path.starts_with("wiki/sources/")
        || path.starts_with("wiki/entities/")
        || path.starts_with("wiki/concepts/")
        || path.starts_with("wiki/syntheses/")
}
```

- [ ] **Step 4: Implement safe writer and cache update**

Append to `src-tauri/src/llm_wiki_ingest.rs`:

```rust
pub fn write_ingest_outputs(
    root: impl AsRef<Path>,
    raw_relative_path: &str,
    hash: &str,
    model: &str,
    blocks: &[LlmWikiFileBlock],
) -> Result<(), WorkspaceError> {
    let root = root.as_ref();
    let mut source_page = None::<String>;
    for block in blocks {
        if !is_safe_llm_wiki_output_path(&block.path) {
            return Err(WorkspaceError::new("unsafe_llm_output_path", "unsafe path"));
        }
        let output_path = root.join(&block.path);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| WorkspaceError::from_io("write_failed", "failed to create ingest output parent", &error))?;
        }
        fs::write(&output_path, &block.content).map_err(|error| WorkspaceError::from_io("write_failed", "failed to write ingest output", &error))?;
        if block.path.starts_with("wiki/sources/") {
            source_page = Some(block.path.clone());
        }
    }
    update_cache(root, raw_relative_path, hash, source_page.as_deref().unwrap_or(""), model)
}

fn update_cache(root: &Path, raw_relative_path: &str, hash: &str, source_page: &str, model: &str) -> Result<(), WorkspaceError> {
    let path = root.join(".llm-wiki/cache.json");
    let cache = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<LlmWikiCache>(&bytes)
            .map_err(|error| WorkspaceError::new("cache_parse_failed", format!("failed to parse cache: {error}")))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => LlmWikiCache { version: 1, entries: Default::default() },
        Err(error) => return Err(WorkspaceError::from_io("read_failed", "failed to read cache", &error)),
    };
    let mut cache = cache;
    cache.entries.insert(raw_relative_path.to_string(), LlmWikiCacheEntry {
        hash: hash.to_string(),
        source_page: source_page.to_string(),
        ingested_at: "now".to_string(),
        model: Some(model.to_string()),
    });
    let bytes = serde_json::to_vec_pretty(&cache).map_err(|error| WorkspaceError::new("cache_write_failed", format!("failed to serialize cache: {error}")))?;
    fs::write(path, bytes).map_err(|error| WorkspaceError::from_io("write_failed", "failed to write cache", &error))
}
```

- [ ] **Step 5: Add placeholder command for ingest one raw file using parsed file blocks**

Add to `src-tauri/src/llm_wiki.rs`:

```rust
use crate::llm_wiki_ingest::{parse_file_blocks, write_ingest_outputs};

#[tauri::command]
pub fn llm_wiki_ingest_mock_output(
    root_path: String,
    raw_relative_path: String,
    hash: String,
    model: String,
    llm_output: String,
) -> Result<(), WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let blocks = parse_file_blocks(&llm_output)?;
    write_ingest_outputs(root, &raw_relative_path, &hash, &model, &blocks)
}
```

Register it temporarily for tests/manual smoke:

```rust
mod llm_wiki_ingest;

llm_wiki::llm_wiki_ingest_mock_output,
```

This command is acceptable in the plan because it writes through the same safe parser/writer and can later be used by the real LLM path.

- [ ] **Step 6: Run ingest tests**

Run:

```bash
cd src-tauri && cargo test ingest -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_ingest.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs src-tauri/src/lib.rs
git commit -m "feat: add llm wiki ingest writer"
```

### Task 5: Query, Digest, And Lint Core Commands

**Files:**
- Create: `src-tauri/src/llm_wiki_query.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add failing query/digest/lint tests**

Append:

```rust
use crate::llm_wiki_query::{
    mechanical_lint_report, search_wiki_pages, write_digest_page,
};

#[test]
fn search_wiki_pages_finds_query_terms_in_generated_wiki() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("wiki/entities/Rust.md"), "# Rust\n\n系统编程语言。\n").unwrap();

    let results = search_wiki_pages(root.path(), "系统编程").unwrap();

    assert_eq!(results[0].title, "Rust");
    assert!(results[0].path.ends_with("wiki/entities/Rust.md"));
}

#[test]
fn write_digest_page_saves_under_syntheses_and_updates_index_and_log() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let path = write_digest_page(root.path(), "Rust", "# Rust 综合\n").unwrap();

    assert!(path.ends_with("wiki/syntheses/Rust.md"));
    assert!(root.path().join("wiki/syntheses/Rust.md").is_file());
    assert!(std::fs::read_to_string(root.path().join("index.md")).unwrap().contains("[[Rust]]"));
    assert!(std::fs::read_to_string(root.path().join("log.md")).unwrap().contains("digest"));
}

#[test]
fn mechanical_lint_reports_broken_wikilinks() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("wiki/entities/A.md"), "# A\n\n[[Missing]]\n").unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("断链"));
    assert!(report.contains("[[Missing]]"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd src-tauri && cargo test "search_wiki_pages|write_digest_page|mechanical_lint" -- --nocapture
```

Expected: FAIL with unresolved `llm_wiki_query`.

- [ ] **Step 3: Add query result model**

Add to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiQueryResponse {
    pub answer: String,
    pub references: Vec<String>,
    pub insufficient_context: bool,
}
```

- [ ] **Step 4: Implement local search, digest writer, mechanical lint**

Create `src-tauri/src/llm_wiki_query.rs`:

```rust
use std::fs;
use std::path::Path;

use crate::llm_wiki_models::WikiSearchResult;
use crate::models::WorkspaceError;

pub fn search_wiki_pages(root: impl AsRef<Path>, query: &str) -> Result<Vec<WikiSearchResult>, WorkspaceError> {
    let wiki = root.as_ref().join("wiki");
    let mut results = Vec::new();
    search_dir(&wiki, query, &mut results)?;
    results.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(results)
}

fn search_dir(dir: &Path, query: &str, results: &mut Vec<WikiSearchResult>) -> Result<(), WorkspaceError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| WorkspaceError::from_io("read_failed", "failed to scan wiki", &error))? {
        let entry = entry.map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki entry", &error))?;
        let path = entry.path();
        if path.is_dir() {
            search_dir(&path, query, results)?;
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki page", &error))?;
        if content.contains(query) || path.file_stem().and_then(|stem| stem.to_str()).map(|stem| stem.contains(query)).unwrap_or(false) {
            let title = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("Untitled").to_string();
            let snippet = content.lines().find(|line| line.contains(query)).unwrap_or("").to_string();
            results.push(WikiSearchResult {
                path: path.to_string_lossy().to_string(),
                title,
                snippet,
            });
        }
    }
    Ok(())
}

pub fn write_digest_page(root: impl AsRef<Path>, title: &str, content: &str) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let relative = format!("wiki/syntheses/{title}.md");
    let path = root.join(&relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| WorkspaceError::from_io("write_failed", "failed to create syntheses directory", &error))?;
    }
    fs::write(&path, content).map_err(|error| WorkspaceError::from_io("write_failed", "failed to write digest", &error))?;
    append_line(root.join("index.md"), &format!("- [[{title}]]\n"))?;
    append_line(root.join("log.md"), &format!("\n## digest | {title}\n- {relative}\n"))?;
    Ok(relative)
}

pub fn mechanical_lint_report(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let wiki = root.as_ref().join("wiki");
    let mut stems = std::collections::BTreeSet::new();
    let mut targets = std::collections::BTreeSet::new();
    collect_existing_page_stems(&wiki, &mut stems)?;
    collect_wikilink_targets(&wiki, &mut targets)?;

    let mut report = "# LLM Wiki Lint Report\n\n## 断链\n\n".to_string();
    let mut found = false;
    for target in targets {
        if !stems.contains(&target) {
            report.push_str(&format!("- [[{target}]]\n"));
            found = true;
        }
    }
    if !found {
        report.push_str("无\n");
    }
    Ok(report)
}

fn append_line(path: impl AsRef<Path>, line: &str) -> Result<(), WorkspaceError> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.as_ref())
        .map_err(|error| WorkspaceError::from_io("write_failed", "failed to append wiki file", &error))?;
    file.write_all(line.as_bytes()).map_err(|error| WorkspaceError::from_io("write_failed", "failed to append wiki file", &error))
}

fn collect_existing_page_stems(wiki: &Path, stems: &mut std::collections::BTreeSet<String>) -> Result<(), WorkspaceError> {
    if !wiki.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(wiki).map_err(|error| WorkspaceError::from_io("read_failed", "failed to scan wiki", &error))? {
        let entry = entry.map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki entry", &error))?;
        let path = entry.path();
        if path.is_dir() {
            collect_existing_page_stems(&path, stems)?;
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
                stems.insert(stem.to_string());
            }
        }
    }
    Ok(())
}

fn collect_wikilink_targets(wiki: &Path, targets: &mut std::collections::BTreeSet<String>) -> Result<(), WorkspaceError> {
    if !wiki.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(wiki).map_err(|error| WorkspaceError::from_io("read_failed", "failed to scan wiki", &error))? {
        let entry = entry.map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki entry", &error))?;
        let path = entry.path();
        if path.is_dir() {
            collect_wikilink_targets(&path, targets)?;
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("md") {
            let content = fs::read_to_string(&path).map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki page", &error))?;
            let mut rest = content.as_str();
            while let Some(start) = rest.find("[[") {
                let after = &rest[start + 2..];
                let Some(end) = after.find("]]") else {
                    break;
                };
                let target = after[..end].split('|').next().unwrap_or("").trim();
                if !target.is_empty() {
                    targets.insert(target.to_string());
                }
                rest = &after[end + 2..];
            }
        }
    }
    Ok(())
}

pub fn mechanical_lint_report(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let wiki = root.as_ref().join("wiki");
    let mut stems = std::collections::BTreeSet::new();
    let mut targets = std::collections::BTreeSet::new();
    collect_existing_page_stems(&wiki, &mut stems)?;
    collect_wikilink_targets(&wiki, &mut targets)?;

    let mut report = "# LLM Wiki Lint Report\n\n## 断链\n\n".to_string();
    let mut found = false;
    for target in targets {
        if !stems.contains(&target) {
            report.push_str(&format!("- [[{target}]]\n"));
            found = true;
        }
    }
    if !found {
        report.push_str("无\n");
    }
    Ok(report)
}
```

- [ ] **Step 5: Add command wrappers**

Add to `src-tauri/src/llm_wiki.rs`:

```rust
use crate::llm_wiki_query::{
    mechanical_lint_report, search_wiki_pages, write_digest_page,
};
use crate::llm_wiki_models::{LlmWikiQueryResponse, WikiSearchResult};

#[tauri::command]
pub fn llm_wiki_search(root_path: String, query: String) -> Result<Vec<WikiSearchResult>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    search_wiki_pages(root, &query)
}

#[tauri::command]
pub fn llm_wiki_digest_mock(root_path: String, title: String, content: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    write_digest_page(root, &title, &content)
}

#[tauri::command]
pub fn llm_wiki_lint(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    mechanical_lint_report(root)
}
```

Register:

```rust
mod llm_wiki_query;

llm_wiki::llm_wiki_search,
llm_wiki::llm_wiki_digest_mock,
llm_wiki::llm_wiki_lint,
```

- [ ] **Step 6: Run query tests**

Run:

```bash
cd src-tauri && cargo test "search_wiki_pages|write_digest_page|mechanical_lint" -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_query.rs src-tauri/src/llm_wiki_tests.rs src-tauri/src/lib.rs
git commit -m "feat: add llm wiki query utilities"
```

### Task 6: Frontend LLM Wiki Client And Status View Model

**Files:**
- Create: `features/llm-wiki/index.ts`
- Create: `features/llm-wiki/lib/types.ts`
- Create: `features/llm-wiki/lib/llm-wiki-client.ts`
- Create: `features/llm-wiki/lib/status-view-model.ts`
- Create: `features/llm-wiki/lib/status-view-model.test.ts`

- [ ] **Step 1: Add failing frontend view-model tests**

Create `features/llm-wiki/lib/status-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLlmWikiStatusViewModel } from "./status-view-model";
import type { LlmWikiPanelState } from "./types";

describe("createLlmWikiStatusViewModel", () => {
    it("shows initialization action for ordinary workspaces", () => {
        const state: LlmWikiPanelState = {
            mode: "ordinary",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 0,
            pendingCount: 0,
            completedCount: 0,
            failedCount: 0,
            skippedCount: 0,
        };

        const view = createLlmWikiStatusViewModel(state);

        expect(view.title).toBe("普通 Markdown 工作区");
        expect(view.primaryAction).toBe("初始化 LLM Wiki");
        expect(view.statusLines).toContain("后台 LLM 未启用");
    });

    it("shows configuration action when llm wiki has no provider config", () => {
        const state: LlmWikiPanelState = {
            mode: "llm_wiki",
            llmConfigured: false,
            paused: false,
            totalRawFiles: 3,
            pendingCount: 3,
            completedCount: 0,
            failedCount: 0,
            skippedCount: 0,
        };

        const view = createLlmWikiStatusViewModel(state);

        expect(view.title).toBe("LLM Wiki");
        expect(view.primaryAction).toBe("配置 LLM");
        expect(view.statusLines).toContain("待处理：3");
    });

    it("shows resume action for paused llm wiki", () => {
        const state: LlmWikiPanelState = {
            mode: "llm_wiki",
            llmConfigured: true,
            paused: true,
            totalRawFiles: 2,
            pendingCount: 1,
            completedCount: 1,
            failedCount: 0,
            skippedCount: 0,
        };

        const view = createLlmWikiStatusViewModel(state);

        expect(view.primaryAction).toBe("恢复后台处理");
        expect(view.statusLines).toContain("状态：已暂停");
    });
});
```

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
npm run test -- features/llm-wiki/lib/status-view-model.test.ts
```

Expected: FAIL with missing module `./status-view-model`.

- [ ] **Step 3: Add frontend types**

Create `features/llm-wiki/lib/types.ts`:

```ts
export type LlmWikiMode = "ordinary" | "llm_wiki";

export interface LlmWikiWorkspaceStatus {
    mode: LlmWikiMode;
    hasLlmWiki: boolean;
    canInitialize: boolean;
    missingPaths: string[];
}

export interface PublicLlmProviderConfig {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
}

export interface RawScanResult {
    total: number;
    pending: string[];
    skipped: string[];
}

export interface LlmWikiPanelState {
    mode: LlmWikiMode;
    llmConfigured: boolean;
    paused: boolean;
    totalRawFiles: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    skippedCount: number;
}

export interface LlmWikiStatusViewModel {
    title: string;
    primaryAction: string;
    statusLines: string[];
}
```

- [ ] **Step 4: Add status view model**

Create `features/llm-wiki/lib/status-view-model.ts`:

```ts
import type {
    LlmWikiPanelState,
    LlmWikiStatusViewModel,
} from "./types";

export function createLlmWikiStatusViewModel(
    state: LlmWikiPanelState,
): LlmWikiStatusViewModel {
    if (state.mode === "ordinary") {
        return {
            title: "普通 Markdown 工作区",
            primaryAction: "初始化 LLM Wiki",
            statusLines: ["后台 LLM 未启用"],
        };
    }

    const statusLines = [
        `状态：${state.paused ? "已暂停" : "就绪"}`,
        `raw 文件：${state.totalRawFiles}`,
        `待处理：${state.pendingCount}`,
        `已完成：${state.completedCount}`,
        `失败：${state.failedCount}`,
        `已跳过：${state.skippedCount}`,
    ];

    return {
        title: "LLM Wiki",
        primaryAction: state.paused
            ? "恢复后台处理"
            : state.llmConfigured
                ? "重新扫描 raw"
                : "配置 LLM",
        statusLines,
    };
}
```

- [ ] **Step 5: Add Tauri client wrappers**

Create `features/llm-wiki/lib/llm-wiki-client.ts`:

```ts
import { tauriCore } from "@/common/lib/tauri";
import type {
    LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig,
    RawScanResult,
} from "./types";

async function invoke<T>(
    command: string,
    args: Record<string, unknown>,
): Promise<T> {
    const { invoke: tauriInvoke } = await tauriCore();
    return tauriInvoke<T>(command, args);
}

export function detectLlmWikiWorkspace(
    rootPath: string,
): Promise<LlmWikiWorkspaceStatus> {
    return invoke("llm_wiki_detect_workspace", { rootPath });
}

export function initializeLlmWikiWorkspace(rootPath: string) {
    return invoke("llm_wiki_initialize_workspace", { rootPath });
}

export function getLlmConfig(): Promise<PublicLlmProviderConfig | null> {
    return invoke("llm_config_get", {});
}

export function rescanRaw(rootPath: string): Promise<RawScanResult> {
    return invoke("llm_wiki_rescan_raw", { rootPath });
}

export function refreshKnowledgeGraph(rootPath: string): Promise<string> {
    return invoke("llm_wiki_refresh_graph", { rootPath });
}

export function runLint(rootPath: string): Promise<string> {
    return invoke("llm_wiki_lint", { rootPath });
}
```

Create `features/llm-wiki/index.ts`:

```ts
export { LlmWikiPanel } from "./components/llm-wiki-panel";
export { useLlmWikiWorkspace } from "./hooks/use-llm-wiki-workspace";
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm run test -- features/llm-wiki/lib/status-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/llm-wiki
git commit -m "feat: add llm wiki frontend client"
```

### Task 7: LLM Wiki Panel And Workspace Integration

**Files:**
- Create: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`
- Create: `features/llm-wiki/components/llm-wiki-panel.tsx`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Test: `features/llm-wiki/lib/status-view-model.test.ts`

- [ ] **Step 1: Create hook**

Create `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    detectLlmWikiWorkspace,
    getLlmConfig,
    initializeLlmWikiWorkspace,
    refreshKnowledgeGraph,
    rescanRaw,
    runLint,
} from "../lib/llm-wiki-client";
import { createLlmWikiStatusViewModel } from "../lib/status-view-model";
import type { LlmWikiPanelState, LlmWikiWorkspaceStatus } from "../lib/types";

export function useLlmWikiWorkspace(rootPath: string) {
    const [status, setStatus] = useState<LlmWikiWorkspaceStatus | null>(null);
    const [llmConfigured, setLlmConfigured] = useState(false);
    const [scanCounts, setScanCounts] = useState({
        totalRawFiles: 0,
        pendingCount: 0,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
    });
    const [message, setMessage] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        const [workspaceStatus, config] = await Promise.all([
            detectLlmWikiWorkspace(rootPath),
            getLlmConfig(),
        ]);
        setStatus(workspaceStatus);
        setLlmConfigured(Boolean(config?.hasApiKey && config.model));
    }, [rootPath]);

    useEffect(() => {
        void refresh().catch((error) => {
            setMessage(formatError(error, "加载 LLM Wiki 状态失败。"));
        });
    }, [refresh]);

    const initialize = useCallback(async () => {
        await initializeLlmWikiWorkspace(rootPath);
        await refresh();
    }, [refresh, rootPath]);

    const rescan = useCallback(async () => {
        const result = await rescanRaw(rootPath);
        setScanCounts({
            totalRawFiles: result.total,
            pendingCount: result.pending.length,
            completedCount: 0,
            failedCount: 0,
            skippedCount: result.skipped.length,
        });
        setMessage("raw 扫描完成。");
    }, [rootPath]);

    const lint = useCallback(async () => {
        const report = await runLint(rootPath);
        setMessage(report);
    }, [rootPath]);

    const graph = useCallback(async () => {
        await refreshKnowledgeGraph(rootPath);
        setMessage("知识关联图已刷新。");
    }, [rootPath]);

    const panelState: LlmWikiPanelState = {
        mode: status?.mode ?? "ordinary",
        llmConfigured,
        paused: false,
        ...scanCounts,
    };

    return {
        status,
        viewModel: createLlmWikiStatusViewModel(panelState),
        message,
        initialize,
        rescan,
        lint,
        graph,
        refresh,
    };
}

function formatError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string" && error.trim()) {
        return error;
    }
    return fallback;
}
```

- [ ] **Step 2: Create panel component**

Create `features/llm-wiki/components/llm-wiki-panel.tsx`:

```tsx
"use client";

import { useLlmWikiWorkspace } from "../hooks/use-llm-wiki-workspace";

interface LlmWikiPanelProps {
    rootPath: string;
}

export function LlmWikiPanel({ rootPath }: LlmWikiPanelProps) {
    const {
        status,
        viewModel,
        message,
        initialize,
        rescan,
        lint,
        graph,
    } = useLlmWikiWorkspace(rootPath);

    const runPrimary = () => {
        if (status?.mode === "ordinary") {
            void initialize();
            return;
        }
        void rescan();
    };

    return (
        <aside className="flex h-full w-72 shrink-0 flex-col border-l border-base-300 bg-base-100">
            <div className="border-b border-base-300 px-3 py-2">
                <h2 className="text-sm font-semibold">{viewModel.title}</h2>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
                <button className="btn btn-primary btn-sm" type="button" onClick={runPrimary}>
                    {viewModel.primaryAction}
                </button>
                <button className="btn btn-sm" type="button" onClick={() => void lint()}>
                    Lint
                </button>
                <button className="btn btn-sm" type="button" onClick={() => void graph()}>
                    刷新关联图
                </button>
                <div className="space-y-1">
                    {viewModel.statusLines.map((line) => (
                        <p key={line} className="text-xs text-base-content/70">{line}</p>
                    ))}
                </div>
                {message ? (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">
                        {message}
                    </pre>
                ) : null}
            </div>
        </aside>
    );
}
```

- [ ] **Step 3: Mount panel in workspace shell**

Modify `features/workspace/components/workspace-shell.tsx`:

```tsx
import { LlmWikiPanel } from "@/features/llm-wiki";
```

Find the top-level layout that renders `FileTreePanel`, `EditorStage`, and `OutlinePanel`. Wrap the existing right side with the new panel after the outline panel:

```tsx
<LlmWikiPanel rootPath={workspace.rootPath} />
```

Keep `OutlinePanel` in place. The panel is deliberately a fixed-width addition for this first version; do not remove the existing outline.

- [ ] **Step 4: Run frontend checks**

Run:

```bash
npm run lint
npm run test -- features/llm-wiki/lib/status-view-model.test.ts
```

Expected: lint exits 0; Vitest exits 0.

- [ ] **Step 5: Commit**

```bash
git add features/llm-wiki features/workspace/components/workspace-shell.tsx
git commit -m "feat: add llm wiki workspace panel"
```

### Task 8: Save Trigger For Raw Files

**Files:**
- Modify: `features/workspace/lib/workspace-save.ts`
- Modify: `features/workspace/lib/workspace-save.test.ts`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`

- [ ] **Step 1: Add failing save hook test**

Add to `features/workspace/lib/workspace-save.test.ts`:

```ts
it("calls afterSave only after a successful current save", async () => {
    const afterSaveCalls: Array<{ rootPath: string; path: string }> = [];
    const environment = createSaveEnvironment({
        invoke: async () => undefined,
        afterSave: async (event) => {
            afterSaveCalls.push(event);
        },
    });
    const queue = createTabSaveQueue(environment);

    await queue.saveTab("tab-1");

    expect(afterSaveCalls).toEqual([
        { rootPath: "/workspace", path: "/workspace/raw/notes/a.md" },
    ]);
});
```

If the existing test helper does not have `createSaveEnvironment`, add the same shape used by existing tests and include `afterSave` in the environment object.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- features/workspace/lib/workspace-save.test.ts
```

Expected: FAIL because `afterSave` is not part of `SaveTabEnvironment`.

- [ ] **Step 3: Add afterSave type and call**

Modify `features/workspace/lib/workspace-save.ts`:

```ts
export interface SaveCompletedEvent {
    rootPath: string;
    path: string;
}
```

Add to `SaveTabEnvironment`:

```ts
afterSave?: (event: SaveCompletedEvent) => MaybePromise<void>;
```

After successful `write_markdown_file` and `savedStillCurrent` calculation, add:

```ts
if (savedStillCurrent) {
    await environment.afterSave?.({
        rootPath: writePlan.rootPath,
        path: writePlan.path,
    });
}
```

- [ ] **Step 4: Add raw save trigger action in hook**

Add to `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`:

```ts
const handleRawFileSaved = useCallback(async (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    if (!normalized.includes("/raw/")) {
        return;
    }
    await rescan();
}, [rescan]);
```

Return `handleRawFileSaved`.

- [ ] **Step 5: Wire save trigger in WorkspaceShell**

In `features/workspace/components/workspace-shell.tsx`, get a callback from LLM Wiki state near the top of `WorkspaceShell`:

```tsx
const llmWiki = useLlmWikiWorkspace(workspace.rootPath);
```

Pass `afterSave` into `createTabSaveQueue`:

```ts
afterSave: async ({ path }) => {
    await llmWiki.handleRawFileSaved(path);
},
```

If this duplicates the hook used by `LlmWikiPanel`, refactor so `WorkspaceShell` owns the hook once and passes the state/actions to `LlmWikiPanel`. Do not create two independent polling hooks for the same workspace.

- [ ] **Step 6: Run save tests**

Run:

```bash
npm run test -- features/workspace/lib/workspace-save.test.ts
npm run lint
```

Expected: tests and lint pass.

- [ ] **Step 7: Commit**

```bash
git add features/workspace/lib/workspace-save.ts features/workspace/lib/workspace-save.test.ts features/workspace/components/workspace-shell.tsx features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/components/llm-wiki-panel.tsx
git commit -m "feat: trigger llm wiki scan on raw save"
```

### Task 9: Real LLM Ingest, Query, And Digest Calls

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/llm_wiki_llm.rs`
- Modify: `src-tauri/src/llm_wiki_ingest.rs`
- Modify: `src-tauri/src/llm_wiki_query.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add prompt assembly tests**

Append:

```rust
use crate::llm_wiki_ingest::{build_ingest_analysis_prompt, build_ingest_generation_prompt};

#[test]
fn ingest_prompts_include_raw_purpose_agents_and_index() {
    let analysis = build_ingest_analysis_prompt(
        "# Raw",
        "# Purpose",
        "# AGENTS",
        "# Index",
    );
    assert!(analysis.contains("# Raw"));
    assert!(analysis.contains("# Purpose"));
    assert!(analysis.contains("# AGENTS"));
    assert!(analysis.contains("# Index"));
    assert!(analysis.contains("entities"));
    assert!(analysis.contains("concepts"));

    let generation = build_ingest_generation_prompt("{}", "# Existing");
    assert!(generation.contains("---FILE:"));
    assert!(generation.contains("wiki/sources"));
}
```

- [ ] **Step 2: Run prompt tests to verify failure**

Run:

```bash
cd src-tauri && cargo test ingest_prompts -- --nocapture
```

Expected: FAIL because prompt functions do not exist.

- [ ] **Step 3: Add HTTP dependency and LLM call function**

Modify `src-tauri/Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
```

If the repo already pins a compatible direct `reqwest` version by then, align with the existing version and use the narrowest feature set needed for blocking JSON OpenAI-compatible calls.

In `src-tauri/src/llm_wiki_llm.rs`, add:

```rust
pub fn call_chat_completion(
    config: &LlmProviderConfig,
    messages: Vec<LlmChatMessage>,
) -> Result<String, WorkspaceError> {
    let request = build_openai_chat_request(&config.model, messages);
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let mut builder = reqwest::blocking::Client::new()
        .post(url)
        .json(&request);
    if let Some(api_key) = config.api_key.as_ref().filter(|key| !key.is_empty()) {
        builder = builder.bearer_auth(api_key);
    }
    let response = builder
        .send()
        .map_err(|error| WorkspaceError::new("llm_failed", format!("llm request failed: {error}")))?;
    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .map_err(|error| WorkspaceError::new("llm_failed", format!("llm response parse failed: {error}")))?;
    if !status.is_success() {
        return Err(WorkspaceError::new("llm_failed", format!("llm status {status}: {value}")));
    }
    value["choices"][0]["message"]["content"]
        .as_str()
        .map(|content| content.to_string())
        .ok_or_else(|| WorkspaceError::new("llm_failed", "llm response missing choices[0].message.content"))
}
```

- [ ] **Step 4: Add prompt builders**

In `src-tauri/src/llm_wiki_ingest.rs`, add:

```rust
pub fn build_ingest_analysis_prompt(raw: &str, purpose: &str, agents: &str, index: &str) -> String {
    format!(
        "You are maintaining a Karpathy-style LLM Wiki.\n\nAGENTS:\n{agents}\n\nPURPOSE:\n{purpose}\n\nINDEX:\n{index}\n\nRAW SOURCE:\n{raw}\n\nReturn strict JSON with source_summary, entities, concepts, connections, contradictions, and suggested_updates."
    )
}

pub fn build_ingest_generation_prompt(analysis_json: &str, existing_context: &str) -> String {
    format!(
        "Generate LLM Wiki markdown file blocks from this analysis.\n\nANALYSIS JSON:\n{analysis_json}\n\nEXISTING CONTEXT:\n{existing_context}\n\nReturn blocks exactly like:\n---FILE: wiki/sources/example.md---\n# Example\n---END FILE---\nInclude wiki/sources, wiki/entities, wiki/concepts, index.md, and log.md when needed."
    )
}
```

- [ ] **Step 5: Add real ingest command**

Add to `src-tauri/src/llm_wiki.rs`:

```rust
#[tauri::command]
pub fn llm_wiki_ingest_raw_file(root_path: String, raw_relative_path: String, hash: String) -> Result<(), WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = crate::llm_wiki_llm::load_llm_config_from_path(crate::llm_wiki_llm::default_llm_config_path()?)?;
    let raw = std::fs::read_to_string(root.join(&raw_relative_path))
        .map_err(|error| WorkspaceError::from_io("read_failed", "failed to read raw source", &error))?;
    let purpose = std::fs::read_to_string(root.join("purpose.md")).unwrap_or_default();
    let agents = std::fs::read_to_string(root.join("AGENTS.md")).unwrap_or_default();
    let index = std::fs::read_to_string(root.join("index.md")).unwrap_or_default();
    let analysis_prompt = crate::llm_wiki_ingest::build_ingest_analysis_prompt(&raw, &purpose, &agents, &index);
    let analysis = crate::llm_wiki_llm::call_chat_completion(&config, vec![
        crate::llm_wiki_llm::LlmChatMessage { role: "user".to_string(), content: analysis_prompt },
    ])?;
    let generation_prompt = crate::llm_wiki_ingest::build_ingest_generation_prompt(&analysis, "");
    let output = crate::llm_wiki_llm::call_chat_completion(&config, vec![
        crate::llm_wiki_llm::LlmChatMessage { role: "user".to_string(), content: generation_prompt },
    ])?;
    let blocks = crate::llm_wiki_ingest::parse_file_blocks(&output)?;
    crate::llm_wiki_ingest::write_ingest_outputs(root, &raw_relative_path, &hash, &config.model, &blocks)
}
```

Register:

```rust
llm_wiki::llm_wiki_ingest_raw_file,
```

- [ ] **Step 6: Add real query and digest command wrappers**

Add query/digest LLM commands to `src-tauri/src/llm_wiki.rs`:

```rust
#[tauri::command]
pub fn llm_wiki_query(root_path: String, question: String) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = crate::llm_wiki_llm::load_llm_config_from_path(crate::llm_wiki_llm::default_llm_config_path()?)?;
    let results = crate::llm_wiki_query::search_wiki_pages(&root, &question)?;
    if results.is_empty() {
        return Ok(LlmWikiQueryResponse { answer: "现有 wiki 中没有足够资料回答这个问题。".to_string(), references: Vec::new(), insufficient_context: true });
    }
    let context = results.iter().take(8).map(|result| format!("PAGE: {}\n{}\n", result.title, result.snippet)).collect::<Vec<_>>().join("\n");
    let prompt = format!("Answer using only these wiki pages. Cite pages as [[PageName]].\n\n{context}\n\nQuestion: {question}");
    let answer = crate::llm_wiki_llm::call_chat_completion(&config, vec![
        crate::llm_wiki_llm::LlmChatMessage { role: "user".to_string(), content: prompt },
    ])?;
    Ok(LlmWikiQueryResponse {
        answer,
        references: results.into_iter().take(8).map(|result| result.title).collect(),
        insufficient_context: false,
    })
}
```

Register:

```rust
llm_wiki::llm_wiki_query,
```

- [ ] **Step 7: Run prompt and compile tests**

Run:

```bash
cd src-tauri && cargo test ingest_prompts -- --nocapture
cd src-tauri && cargo test -- --nocapture
```

Expected: prompt tests pass; full Rust tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_ingest.rs src-tauri/src/llm_wiki_llm.rs src-tauri/src/llm_wiki_query.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: run llm wiki provider workflows"
```

### Task 10: Query/Digest UI Controls And Final Verification

**Files:**
- Modify: `features/llm-wiki/lib/llm-wiki-client.ts`
- Modify: `features/llm-wiki/components/llm-wiki-panel.tsx`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`
- Test: `features/llm-wiki/lib/status-view-model.test.ts`

- [ ] **Step 1: Extend frontend client for query**

Add to `features/llm-wiki/lib/types.ts`:

```ts
export interface LlmWikiQueryResponse {
    answer: string;
    references: string[];
    insufficientContext: boolean;
}
```

Add to `features/llm-wiki/lib/llm-wiki-client.ts`:

```ts
import type { LlmWikiQueryResponse } from "./types";

export function queryWiki(
    rootPath: string,
    question: string,
): Promise<LlmWikiQueryResponse> {
    return invoke("llm_wiki_query", { rootPath, question });
}
```

- [ ] **Step 2: Add query state to hook**

In `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`, import `queryWiki` and add:

```ts
const [queryAnswer, setQueryAnswer] = useState<string | null>(null);

const query = useCallback(async (question: string) => {
    const response = await queryWiki(rootPath, question);
    setQueryAnswer(response.answer);
}, [rootPath]);
```

Return `queryAnswer` and `query`.

- [ ] **Step 3: Add query form to panel**

In `features/llm-wiki/components/llm-wiki-panel.tsx`, import `useState` and add local state:

```tsx
const [question, setQuestion] = useState("");
```

Add controls in the panel body:

```tsx
<form
    className="space-y-2"
    onSubmit={(event) => {
        event.preventDefault();
        if (question.trim()) {
            void query(question.trim());
        }
    }}
>
    <textarea
        className="textarea textarea-bordered min-h-20 w-full text-sm"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="向当前 wiki 提问"
    />
    <button className="btn btn-sm w-full" type="submit">
        Query
    </button>
</form>
{queryAnswer ? (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">
        {queryAnswer}
    </pre>
) : null}
```

- [ ] **Step 4: Run full frontend verification**

Run:

```bash
npm run lint
npm run test
```

Expected: lint exits 0; Vitest exits 0.

- [ ] **Step 5: Run full Rust verification**

Run:

```bash
cd src-tauri && cargo test -- --nocapture
```

Expected: all Rust tests pass.

- [ ] **Step 6: Run desktop smoke**

Run:

```bash
npx tauri dev
```

Expected:

- App starts on macOS desktop.
- Opening a normal folder shows ordinary workspace mode.
- LLM Wiki panel shows initialization entry.
- Initializing creates `raw/`, `wiki/`, `index.md`, `log.md`, `purpose.md`, `AGENTS.md`, `llm-wiki-progress.md`.
- Rescan updates `llm-wiki-progress.md`.
- Refresh graph creates `wiki/knowledge-graph.md`.

- [ ] **Step 7: Commit**

```bash
git add features/llm-wiki features/workspace src-tauri package.json package-lock.json
git commit -m "feat: complete llm wiki workspace mode"
```

## Self-Review Checklist

- [ ] Spec coverage: init, raw-only ingest, default writes, concepts/syntheses, AGENTS.md, progress document, app-level LLM config, query, digest, lint, graph, desktop-only scope all map to tasks.
- [ ] Placeholder scan: run the red-flag search from the plan skill instructions against this file and remove every match before execution.
- [ ] Type consistency: Rust model names in command wrappers match `llm_wiki_models.rs`; frontend camelCase response types match serde `rename_all = "camelCase"`.
- [ ] Design drift: no vector search, web product, multimodal, web clipper, automatic migration, or non-macOS acceptance tasks are included.

## Final Verification Command Set

Run after all tasks:

```bash
npm run lint
npm run test
cd src-tauri && cargo test -- --nocapture
```

Expected: every command exits 0.
