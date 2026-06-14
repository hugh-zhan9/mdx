# Codex Thread Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** User-approved requirement from 2026-06-14 conversation: MDX Memory `thread` must be able to preserve complete Codex conversation source text, and newly opened Codex sessions should be discoverable/importable into `memory/threads/codex/` instead of relying only on manual `memory_thread_save`.

**Goal:** Add a reliable Codex thread archival path that scans local Codex session JSONL files, imports them as Memory threads, and preserves the complete raw Codex JSONL source inside the saved thread record.

**Architecture:** Keep `memory/threads/<source>/*.md` as the canonical full-thread archive. Extend `memory_capture_scan` for `codex` to discover local JSONL transcripts from known Codex session directories, and extend Codex capture import so saved thread markdown contains both readable message sections and the complete raw JSONL source. Do not claim lifecycle-hook automation for Codex until a verified Codex hook exposes transcript paths; this feature provides scan/import automation over local transcript files.

**Tech Stack:** Rust/Tauri memory modules, serde/serde_json, mdx-cli memory commands, existing Markdown thread store, Cargo tests.

---

## Scope Check

This plan intentionally does not implement a Codex lifecycle hook. Current Codex integration has MCP and skills, but no verified pre-compact or session-end hook that passes a transcript path. The first complete solution is therefore:

- scan known local Codex transcript directories,
- import selected JSONL files,
- save a full raw source copy in `memory/threads/codex/*.md`,
- expose enough CLI/docs behavior for users and agents to run the archival step.

If Codex later exposes a lifecycle hook, it can call the same `memory capture import --source codex --file <jsonl>` path added here.

## File Structure

- Modify `src-tauri/src/memory_capture.rs`
  - Implement Codex transcript directory scanning.
  - Support real Codex JSONL event format in addition to the existing simple fixture format.
  - Preserve complete raw Codex JSONL in saved thread body.
- Modify `src-tauri/src/memory_models.rs`
  - Extend `MemoryCaptureScanResult` with structured transcript candidates while preserving existing `paths`.
- Modify `src-tauri/src/memory_tests.rs`
  - Add unit tests for scan discovery, real Codex JSONL import, raw source preservation, and import idempotency.
- Modify `src-tauri/src/cli_protocol_tests.rs`
  - Update JSON serialization expectations for the extended scan response.
- Modify `src-tauri/src/bin/mdx_cli.rs`
  - Add optional `--import` and `--distill` flags to `memory capture scan --source codex` so CLI can scan and archive discovered Codex sessions in one command.
- Modify `docs/memory-usage.md`
  - Document Codex thread archival commands and the difference between scan/import archival and pre-compact memory capture.
- Modify `docs/loopx/specs/memory.md`
  - Record the durable Memory contract for Codex thread archival.

## Implementation Rules

- Use TDD for each task.
- Do not read or store secrets from Codex auth/config files. Only scan `.jsonl` transcripts under session directories.
- Do not delete, move, or rewrite Codex session files.
- Do not store thread content in active memories unless the user asks for distillation or passes `--distill`.
- Thread import must be idempotent by `thread_id` and content hash using the existing `memory_thread_save` behavior.
- When parsing Codex JSONL, preserve the complete original JSONL text even if only some events are rendered into readable message sections.

### Task 1: Add Structured Capture Scan Candidates

**Files:**
- Modify: `src-tauri/src/memory_models.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`

- [ ] **Step 1: Write the failing protocol serialization test**

In `src-tauri/src/cli_protocol_tests.rs`, update `serializes_memory_capture_responses_as_snake_case_json` so `memory_capture_scan` includes one candidate:

```rust
memory_capture_scan: Some(crate::memory::MemoryCaptureScanResult {
    source: "codex".to_string(),
    status: "configured".to_string(),
    paths: vec!["/Users/example/.codex/sessions/2026/06/14/rollout-a.jsonl".to_string()],
    candidates: vec![crate::memory::MemoryCaptureCandidate {
        path: "/Users/example/.codex/sessions/2026/06/14/rollout-a.jsonl".to_string(),
        source: "codex".to_string(),
        thread_id: Some("codex:019ec385-5b76-7211-aa11-91e3d028f79f".to_string()),
        title: Some("Codex session 019ec385".to_string()),
        started_at: Some("2026-06-14T00:28:10.000Z".to_string()),
        modified_at: Some("2026-06-14T00:30:00.000Z".to_string()),
        bytes: 1234,
    }],
}),
```

Update the assertions in the same test:

```rust
assert!(json.contains(r#""memory_capture_scan":{"source":"codex","status":"configured""#));
assert!(json.contains(r#""candidates":[{"path":"/Users/example/.codex/sessions/2026/06/14/rollout-a.jsonl""#));
assert!(json.contains(r#""thread_id":"codex:019ec385-5b76-7211-aa11-91e3d028f79f""#));
assert!(json.contains(r#""bytes":1234"#));
assert!(!json.contains("threadId"));
assert!(!json.contains("modifiedAt"));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd src-tauri
cargo test serializes_memory_capture_responses_as_snake_case_json --lib
```

Expected: FAIL to compile because `MemoryCaptureCandidate` and `MemoryCaptureScanResult.candidates` do not exist.

- [ ] **Step 3: Add the scan candidate model**

In `src-tauri/src/memory_models.rs`, add this struct above `MemoryCaptureScanResult`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureCandidate {
    pub path: String,
    pub source: String,
    pub thread_id: Option<String>,
    pub title: Option<String>,
    pub started_at: Option<String>,
    pub modified_at: Option<String>,
    pub bytes: u64,
}
```

Change `MemoryCaptureScanResult` to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureScanResult {
    pub source: String,
    pub status: String,
    pub paths: Vec<String>,
    #[serde(default)]
    pub candidates: Vec<MemoryCaptureCandidate>,
}
```

- [ ] **Step 4: Update existing constructors**

Update every existing `MemoryCaptureScanResult { ... }` literal in tests and code to include:

```rust
candidates: Vec::new(),
```

At minimum this includes:

- `src-tauri/src/memory_capture.rs`
- `src-tauri/src/cli_protocol_tests.rs`

- [ ] **Step 5: Run focused serialization test**

Run:

```bash
cd src-tauri
cargo test serializes_memory_capture_responses_as_snake_case_json --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/memory_models.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/memory_capture.rs
git commit -m "feat: model memory capture scan candidates"
```

---

### Task 2: Discover Local Codex JSONL Transcript Files

**Files:**
- Modify: `src-tauri/src/memory_capture.rs`
- Modify: `src-tauri/src/memory_tests.rs`

- [ ] **Step 1: Write scan discovery tests**

In `src-tauri/src/memory_tests.rs`, add imports if not already present:

```rust
use std::fs;
```

Add these tests near the existing capture import tests:

```rust
#[test]
fn capture_scan_codex_discovers_jsonl_transcripts_from_configured_dirs() {
    let root = tempdir().unwrap();
    let codex_home = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let session_dir = codex_home.path().join("sessions/2026/06/14");
    fs::create_dir_all(&session_dir).unwrap();
    let transcript = session_dir.join("rollout-2026-06-14T08-00-00-019ecodex.jsonl");
    fs::write(
        &transcript,
        r#"{"timestamp":"2026-06-14T00:00:00.000Z","type":"session_meta","payload":{"id":"019ecodex","timestamp":"2026-06-14T00:00:00.000Z","cwd":"/tmp/project","model_provider":"openai"}}
{"timestamp":"2026-06-14T00:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello codex"}]}}
"#,
    )
    .unwrap();
    let _env = EnvVarGuard::set("MDX_CODEX_SESSION_DIRS", codex_home.path().join("sessions"));

    let result = memory_capture_scan(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureScanRequest {
            source: "codex".to_string(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "configured");
    assert_eq!(result.paths, vec![transcript.to_string_lossy().into_owned()]);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(
        result.candidates[0].thread_id.as_deref(),
        Some("codex:019ecodex")
    );
    assert_eq!(
        result.candidates[0].started_at.as_deref(),
        Some("2026-06-14T00:00:00.000Z")
    );
    assert!(result.candidates[0].bytes > 0);
}

#[test]
fn capture_scan_codex_ignores_non_jsonl_and_auth_files() {
    let root = tempdir().unwrap();
    let codex_home = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    fs::create_dir_all(codex_home.path().join("sessions")).unwrap();
    fs::write(codex_home.path().join("sessions/not-a-session.json"), "{}").unwrap();
    fs::write(codex_home.path().join("sessions/auth.jsonl"), "not jsonl").unwrap();
    let _env = EnvVarGuard::set("MDX_CODEX_SESSION_DIRS", codex_home.path().join("sessions"));

    let result = memory_capture_scan(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureScanRequest {
            source: "codex".to_string(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "configured");
    assert!(result.paths.is_empty());
    assert!(result.candidates.is_empty());
}
```

Add this small test helper near other environment guards in `src-tauri/src/memory_tests.rs`:

```rust
struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: impl AsRef<std::path::Path>) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value.as_ref());
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(value) = self.previous.as_ref() {
            std::env::set_var(self.key, value);
        } else {
            std::env::remove_var(self.key);
        }
    }
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test capture_scan_codex_discovers_jsonl_transcripts_from_configured_dirs --lib
cargo test capture_scan_codex_ignores_non_jsonl_and_auth_files --lib
```

Expected: first FAILS because scan still returns `capture_scan_not_configured`; second may fail because the status is not `configured`.

- [ ] **Step 3: Implement Codex scan directory resolution**

In `src-tauri/src/memory_capture.rs`, add imports:

```rust
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
```

Replace `memory_capture_scan` with:

```rust
pub(crate) fn memory_capture_scan(
    _root: impl AsRef<std::path::Path>,
    request: MemoryCaptureScanRequest,
) -> Result<MemoryCaptureScanResult, WorkspaceError> {
    let source = validate_capture_source(&request.source)?;
    if source != "codex" {
        return Ok(MemoryCaptureScanResult {
            source: source.to_string(),
            status: "capture_scan_not_configured".to_string(),
            paths: Vec::new(),
            candidates: Vec::new(),
        });
    }

    let dirs = codex_session_dirs();
    if dirs.is_empty() {
        return Ok(MemoryCaptureScanResult {
            source: source.to_string(),
            status: "capture_scan_not_configured".to_string(),
            paths: Vec::new(),
            candidates: Vec::new(),
        });
    }

    let mut candidates = Vec::new();
    for dir in dirs {
        collect_codex_jsonl_candidates(&dir, &mut candidates)?;
    }
    candidates.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| right.path.cmp(&left.path))
    });
    candidates.dedup_by(|left, right| left.path == right.path);
    let paths = candidates.iter().map(|candidate| candidate.path.clone()).collect();

    Ok(MemoryCaptureScanResult {
        source: source.to_string(),
        status: "configured".to_string(),
        paths,
        candidates,
    })
}
```

Add helpers below `memory_capture_scan`:

```rust
fn codex_session_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(value) = std::env::var_os("MDX_CODEX_SESSION_DIRS") {
        for item in std::env::split_paths(&value) {
            if item.is_dir() {
                dirs.push(item);
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for candidate in [
            home.join(".codex/sessions"),
            home.join(".codex/archived_sessions"),
        ] {
            if candidate.is_dir() {
                dirs.push(candidate);
            }
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

fn collect_codex_jsonl_candidates(
    dir: &Path,
    candidates: &mut Vec<crate::memory_models::MemoryCaptureCandidate>,
) -> Result<(), WorkspaceError> {
    for entry in std::fs::read_dir(dir).map_err(|error| {
        WorkspaceError::new(
            "capture_scan_failed",
            format!("failed to scan Codex session directory: {error}"),
        )
    })? {
        let path = entry
            .map_err(|error| {
                WorkspaceError::new(
                    "capture_scan_failed",
                    format!("failed to read Codex session directory entry: {error}"),
                )
            })?
            .path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::new(
                "capture_scan_failed",
                format!("failed to inspect Codex session path: {error}"),
            )
        })?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_codex_jsonl_candidates(&path, candidates)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-"))
        {
            continue;
        }
        if let Some(candidate) = codex_capture_candidate(&path, &metadata)? {
            candidates.push(candidate);
        }
    }
    Ok(())
}
```

Add `codex_capture_candidate`:

```rust
fn codex_capture_candidate(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> Result<Option<crate::memory_models::MemoryCaptureCandidate>, WorkspaceError> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        WorkspaceError::new(
            "capture_scan_failed",
            format!("failed to read Codex session candidate: {error}"),
        )
    })?;
    let metadata_summary = codex_metadata_summary(&contents);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("unix:{}", duration.as_secs()));
    Ok(Some(crate::memory_models::MemoryCaptureCandidate {
        path: path.to_string_lossy().into_owned(),
        source: "codex".to_string(),
        thread_id: metadata_summary
            .id
            .map(|id| format!("codex:{}", id.trim_start_matches("codex:"))),
        title: metadata_summary.title,
        started_at: metadata_summary.started_at,
        modified_at,
        bytes: metadata.len(),
    }))
}
```

Add a small metadata struct and parser:

```rust
#[derive(Default)]
struct CodexMetadataSummary {
    id: Option<String>,
    title: Option<String>,
    started_at: Option<String>,
}

fn codex_metadata_summary(contents: &str) -> CodexMetadataSummary {
    for line in contents.lines().take(20) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|item| item.as_str()) == Some("session_meta") {
            let payload = value.get("payload").and_then(|item| item.as_object());
            let id = payload
                .and_then(|payload| payload.get("id"))
                .and_then(|item| item.as_str())
                .map(ToString::to_string);
            let started_at = payload
                .and_then(|payload| payload.get("timestamp"))
                .and_then(|item| item.as_str())
                .or_else(|| value.get("timestamp").and_then(|item| item.as_str()))
                .map(ToString::to_string);
            let title = id
                .as_ref()
                .map(|id| format!("Codex session {}", id.chars().take(8).collect::<String>()));
            return CodexMetadataSummary {
                id,
                title,
                started_at,
            };
        }
    }
    CodexMetadataSummary::default()
}
```

- [ ] **Step 4: Run focused scan tests**

Run:

```bash
cd src-tauri
cargo test capture_scan_codex_discovers_jsonl_transcripts_from_configured_dirs --lib
cargo test capture_scan_codex_ignores_non_jsonl_and_auth_files --lib
```

Expected: PASS.

- [ ] **Step 5: Run broader memory capture tests**

Run:

```bash
cd src-tauri
cargo test capture_ --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/memory_capture.rs src-tauri/src/memory_tests.rs
git commit -m "feat: scan local codex transcripts"
```

---

### Task 3: Preserve Complete Raw Codex JSONL In Saved Thread Body

**Files:**
- Modify: `src-tauri/src/memory_capture.rs`
- Modify: `src-tauri/src/memory_tests.rs`
- Create: `src-tauri/fixtures/memory/codex-real-session.jsonl`

- [ ] **Step 1: Add a real Codex JSONL fixture**

Create `src-tauri/fixtures/memory/codex-real-session.jsonl`:

```jsonl
{"timestamp":"2026-06-14T00:28:10.000Z","type":"session_meta","payload":{"id":"019ec385-5b76-7211-aa11-91e3d028f79f","timestamp":"2026-06-14T00:28:10.000Z","cwd":"/Users/example/project/mdx","originator":"Codex Desktop","model_provider":"openai"}}
{"timestamp":"2026-06-14T00:28:11.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"为什么 thread 没有记录？"}]}}
{"timestamp":"2026-06-14T00:28:12.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"当前 Codex 没有自动 thread 归档。"}]}}
{"timestamp":"2026-06-14T00:28:13.000Z","type":"event_msg","payload":{"type":"token_count","input_tokens":123,"output_tokens":45}}
```

- [ ] **Step 2: Write failing import preservation test**

In `src-tauri/src/memory_tests.rs`, add:

```rust
#[test]
fn capture_imports_real_codex_jsonl_and_preserves_raw_source() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "codex".to_string(),
            path: memory_fixture_path("codex-real-session.jsonl"),
            title: None,
            thread_id: None,
            distill: false,
        },
    )
    .unwrap();

    assert_eq!(
        result.thread_id,
        "codex:019ec385-5b76-7211-aa11-91e3d028f79f"
    );
    assert_eq!(result.title, "Codex session 019ec385");
    assert_eq!(result.message_count, 2);
    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert!(thread.body.contains("## Message 1 — user — 2026-06-14T00:28:11.000Z"));
    assert!(thread.body.contains("为什么 thread 没有记录？"));
    assert!(thread.body.contains("## Raw Codex JSONL"));
    assert!(thread.body.contains(r#""type":"session_meta""#));
    assert!(thread.body.contains(r#""type":"event_msg""#));
}
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
cd src-tauri
cargo test capture_imports_real_codex_jsonl_and_preserves_raw_source --lib
```

Expected: FAIL because the current Codex parser expects simple `{role,timestamp,content}` JSONL and does not preserve raw source.

- [ ] **Step 4: Implement real Codex JSONL parsing**

In `src-tauri/src/memory_capture.rs`, replace `parse_codex_jsonl` with:

```rust
fn parse_codex_jsonl(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    let mut simple_messages = Vec::new();
    let mut codex_messages = Vec::new();
    let mut metadata = CodexMetadataSummary::default();

    for (index, line) in contents.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(line).map_err(|error| {
            WorkspaceError::new(
                "capture_parse_failed",
                format!("failed to parse Codex JSONL line {}: {error}", index + 1),
            )
        })?;
        if value.get("role").is_some()
            && value.get("timestamp").is_some()
            && value.get("content").is_some()
        {
            let message: TranscriptMessage = serde_json::from_value(value).map_err(|error| {
                WorkspaceError::new(
                    "capture_parse_failed",
                    format!("failed to parse Codex message line {}: {error}", index + 1),
                )
            })?;
            simple_messages.push(message);
            continue;
        }
        if value.get("type").and_then(|item| item.as_str()) == Some("session_meta") {
            metadata = codex_metadata_summary(contents);
            continue;
        }
        if let Some(message) = codex_message_from_event(&value) {
            codex_messages.push(message);
        }
    }

    if !simple_messages.is_empty() {
        return parsed_messages(None, None, simple_messages);
    }
    if codex_messages.is_empty() {
        return Err(WorkspaceError::new(
            "capture_parse_failed",
            "Codex JSONL transcript did not contain message events",
        ));
    }
    let started_at = codex_messages.first().map(|message| message.timestamp.clone());
    let ended_at = codex_messages.last().map(|message| message.timestamp.clone());
    let message_count = codex_messages.len();
    let mut body = render_messages(&codex_messages);
    body.push_str("\n## Raw Codex JSONL\n\n```jsonl\n");
    body.push_str(contents.trim_end());
    body.push_str("\n```\n");
    Ok(ParsedCapture {
        source_thread_id: metadata
            .id
            .map(|id| format!("codex:{}", id.trim_start_matches("codex:"))),
        title: metadata.title,
        body,
        started_at: metadata.started_at.or(started_at),
        ended_at,
        message_count,
    })
}
```

Add helper:

```rust
fn codex_message_from_event(value: &serde_json::Value) -> Option<TranscriptMessage> {
    if value.get("type").and_then(|item| item.as_str()) != Some("response_item") {
        return None;
    }
    let payload = value.get("payload")?;
    if payload.get("type").and_then(|item| item.as_str()) != Some("message") {
        return None;
    }
    let role = payload.get("role")?.as_str()?.to_string();
    let timestamp = value.get("timestamp")?.as_str()?.to_string();
    let mut content = Vec::new();
    for item in payload.get("content")?.as_array()? {
        if let Some(text) = item
            .get("text")
            .and_then(|text| text.as_str())
            .filter(|text| !text.trim().is_empty())
        {
            content.push(text.to_string());
        }
    }
    if content.is_empty() {
        return None;
    }
    Some(TranscriptMessage {
        role,
        timestamp,
        content: content.join("\n\n"),
    })
}
```

- [ ] **Step 5: Run Codex import tests**

Run:

```bash
cd src-tauri
cargo test capture_imports_codex_jsonl_as_thread --lib
cargo test capture_imports_real_codex_jsonl_and_preserves_raw_source --lib
```

Expected: PASS. Existing simple fixture import remains compatible, and real Codex event JSONL imports with raw source preserved.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/memory_capture.rs src-tauri/src/memory_tests.rs src-tauri/fixtures/memory/codex-real-session.jsonl
git commit -m "feat: preserve raw codex thread transcripts"
```

---

### Task 4: Add CLI Scan Import Mode For Codex Threads

**Files:**
- Modify: `src-tauri/src/bin/mdx_cli.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`

- [ ] **Step 1: Write CLI request parsing tests**

In `src-tauri/src/bin/mdx_cli.rs`, near `memory_capture_requests_use_socket_protocol_without_root`, add:

```rust
#[test]
fn memory_capture_scan_accepts_import_and_distill_flags() {
    let scan = CommandLine::Memory {
        root: None,
        command: MemoryCommand::Capture {
            command: MemoryCaptureCommand::Scan {
                source: "codex".to_string(),
                import_threads: true,
                distill: true,
            },
        },
    };

    assert_eq!(
        request_from_command(&scan).unwrap(),
        CliRequest::MemoryCaptureScan {
            source: "codex".to_string(),
            import_threads: true,
            distill: true,
        }
    );
}
```

In `src-tauri/src/cli_protocol_tests.rs`, update the `MemoryCaptureScan` parse test to include `import` and `distill`:

```rust
let request: CliRequest = serde_json::from_str(
    r#"{"cmd":"memory-capture-scan","source":"codex","import":true,"distill":true}"#,
)
.unwrap();

assert!(matches!(
    request,
    CliRequest::MemoryCaptureScan {
        source,
        import_threads: true,
        distill: true,
    } if source == "codex"
));
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test memory_capture_scan_accepts_import_and_distill_flags --lib
cargo test parses_memory_capture_scan_request --lib
```

Expected: FAIL because `MemoryCaptureScan` has no `import` or `distill` fields.

- [ ] **Step 3: Extend CLI protocol request**

In `src-tauri/src/cli_protocol.rs`, change:

```rust
MemoryCaptureScan {
    source: String,
},
```

to:

```rust
MemoryCaptureScan {
    source: String,
    #[serde(default, rename = "import")]
    import_threads: bool,
    #[serde(default)]
    distill: bool,
},
```

- [ ] **Step 4: Extend CLI command flags**

In `src-tauri/src/bin/mdx_cli.rs`, change `MemoryCaptureCommand::Scan`:

```rust
Scan {
    #[arg(long)]
    source: String,
},
```

to:

```rust
Scan {
    #[arg(long)]
    source: String,
    #[arg(long = "import")]
    import_threads: bool,
    #[arg(long)]
    distill: bool,
},
```

Update `request_from_command` for scan:

```rust
MemoryCaptureCommand::Scan {
    source,
    import_threads,
    distill,
} => CliRequest::MemoryCaptureScan {
    source: source.clone(),
    import_threads: *import_threads,
    distill: *distill,
},
```

- [ ] **Step 5: Wire import mode in headless execution**

In `execute_memory_capture_headless`, update the scan match arm so normal scan still returns scan results, while `--import` imports every discovered candidate:

```rust
MemoryCaptureCommand::Scan {
    source,
    import_threads,
    distill,
} => {
    let scan = memory::memory_capture_scan(
        root_path.clone(),
        memory::MemoryCaptureScanRequest {
            source: source.clone(),
        },
    );
    match scan {
        Ok(scan_result) if *import_threads => {
            let mut imported = Vec::new();
            for path in &scan_result.paths {
                let result = memory::memory_capture_import(
                    root_path.clone(),
                    memory::MemoryCaptureImportRequest {
                        source: source.clone(),
                        path: path.clone(),
                        title: None,
                        thread_id: None,
                        distill: *distill,
                    },
                );
                match result {
                    Ok(result) => imported.push(result),
                    Err(error) => return workspace_error_response(error),
                }
            }
            CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_capture_scan: Some(scan_result),
                content: Some(format!("imported {} {source} thread(s)", imported.len())),
                ..CliResponse::default()
            }
        }
        Ok(scan_result) => CliResponse {
            ok: true,
            root_path: Some(root_path),
            memory_capture_scan: Some(scan_result),
            ..CliResponse::default()
        },
        Err(error) => workspace_error_response(error),
    }
}
```

If `execute_memory_capture_headless` currently delegates through socket protocol, make the same `import`/`distill` fields travel through `CliRequest`, and implement import mode in `memory_capture_scan_response_for_root`.

- [ ] **Step 6: Run CLI tests**

Run:

```bash
cd src-tauri
cargo test memory_capture_scan_accepts_import_and_distill_flags --lib
cargo test parses_memory_capture_scan_request --lib
cargo test memory_capture_requests_use_socket_protocol_without_root --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/cli_server.rs
git commit -m "feat: import codex capture scan results"
```

---

### Task 5: Document Codex Thread Archival Workflow

**Files:**
- Modify: `docs/memory-usage.md`
- Modify: `docs/loopx/specs/memory.md`
- Modify: `src-tauri/src/memory_agent_setup.rs`

- [ ] **Step 1: Update user documentation**

In `docs/memory-usage.md`, under `## 保存对话 Thread`, add:

```markdown
### Codex 自动发现与归档

Codex Desktop 会在本机保存 JSONL 会话文件。MDX Memory 可以扫描这些文件并导入为完整 thread 原文归档：

```bash
mdx-cli memory --root /path/to/workspace capture scan --source codex
mdx-cli memory --root /path/to/workspace capture scan --source codex --import
```

默认扫描：

```text
~/.codex/sessions
~/.codex/archived_sessions
```

如果 Codex 会话目录不在默认位置，可以指定：

```bash
export MDX_CODEX_SESSION_DIRS="$HOME/.codex/sessions:$HOME/.codex/archived_sessions"
```

导入后的 thread 位于：

```text
memory/threads/codex/*.md
```

保存的 Codex thread 包含可读的 `## Message N` 区块，也包含 `## Raw Codex JSONL`，用于保留完整原始会话事件。`capture scan --source codex --import` 不是 pre-compact hook；它是对本机 Codex transcript 文件的扫描归档。需要提炼长期记忆时再使用 `--distill` 或单独运行 `memory distill`。
```

- [ ] **Step 2: Update memory spec**

In `docs/loopx/specs/memory.md`, add under the Thread section:

```markdown
- Codex thread archival must preserve the complete raw Codex JSONL source in the saved thread body, in addition to readable message sections.
- `memory capture scan --source codex` discovers local transcript JSONL files from configured/default Codex session directories; it must not scan auth/config files.
- Codex capture scan is transcript-file discovery, not a lifecycle hook. Automatic pre-compact memory capture remains limited to agents that provide a transcript path to hooks.
```

- [ ] **Step 3: Update generated mdx-memory skill text**

In `src-tauri/src/memory_agent_setup.rs`, update `mdx_memory_skill` text in the `Full Thread Archival` section so future installed skills say:

```text
For Codex, first try `memory capture scan --source codex` to discover local JSONL transcripts, then import a selected file or run scan with `--import` when available. Saved Codex threads include readable messages plus raw JSONL provenance. Codex still has no verified lifecycle hook; scan/import is the supported automatic archival path.
```

- [ ] **Step 4: Run doc/skill text checks**

Run:

```bash
rg -n "Raw Codex JSONL|capture scan --source codex|lifecycle hook" docs/memory-usage.md docs/loopx/specs/memory.md src-tauri/src/memory_agent_setup.rs
```

Expected: all three files contain the relevant Codex archival wording.

- [ ] **Step 5: Commit**

```bash
git add docs/memory-usage.md docs/loopx/specs/memory.md src-tauri/src/memory_agent_setup.rs
git commit -m "docs: describe codex thread archival"
```

---

### Task 6: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run focused Memory tests**

Run:

```bash
cd src-tauri
cargo test capture_ --lib
cargo test thread_save --lib
cargo test memory_capture --lib
```

Expected: PASS.

- [ ] **Step 2: Run protocol and CLI tests**

Run:

```bash
cd src-tauri
cargo test cli_protocol_tests::serializes_memory_capture_responses_as_snake_case_json --lib
cargo test memory_capture_requests_use_socket_protocol_without_root --lib
```

Expected: PASS.

- [ ] **Step 3: Run full Rust library tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test against the user's memory workspace**

Run:

```bash
src-tauri/target/release/mdx-cli memory --root "/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox" capture scan --source codex
```

Expected: output includes discovered Codex JSONL paths from `~/.codex/sessions` or `~/.codex/archived_sessions`.

Then run a dry manual import on one known safe small fixture or a copied test file, not a private production transcript:

```bash
src-tauri/target/release/mdx-cli memory --root "/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox" capture import --source codex --file src-tauri/fixtures/memory/codex-real-session.jsonl --thread-id codex:fixture-real-smoke
```

Expected: creates or skips `memory/threads/codex/*fixture-real-smoke*.md`; `memory thread show codex:fixture-real-smoke` contains `## Raw Codex JSONL`.

---

## Self-Review

- Spec coverage: The plan covers full raw Codex thread preservation, transcript discovery, scan/import CLI workflow, idempotent thread storage, and documentation of non-hook semantics.
- Placeholder scan: No task contains `TBD`, `TODO`, or unspecified edge-case instructions.
- Type consistency: `MemoryCaptureCandidate`, extended `MemoryCaptureScanResult`, and scan import flags are introduced before later tasks reference them.
- Design drift: The plan does not claim automatic lifecycle hook capture. It implements a verifiable scan/import workflow over local Codex transcript files and leaves future hook integration as a caller of the same import path.
