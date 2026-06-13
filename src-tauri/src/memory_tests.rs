use std::sync::Arc;
use std::thread;

use tempfile::tempdir;

use crate::memory::{
    default_memory_config, memory_add, memory_archive, memory_capture_import,
    memory_detect_workspace, memory_distill_with_json_for_test, memory_get, memory_inbox_accept,
    memory_inbox_add, memory_inbox_get, memory_inbox_list, memory_inbox_reject,
    memory_initialize_workspace, memory_list, memory_promote, memory_recall,
    memory_repair_workspace, memory_search, memory_thread_get, memory_thread_list,
    memory_thread_save, memory_working_append, memory_working_get, memory_working_set,
    InboxAddRequest, InboxReviewRequest, MemoryAddRequest, MemoryCaptureImportRequest,
    MemoryDistillRequest, MemoryListFilter, MemoryPromoteRequest, MemoryRepairRequest,
    RecallRequest, ThreadListFilter, ThreadSaveRequest,
};
use crate::memory_fs::{
    append_memory_log_entry, read_workspace_file, recover_old_malformed_memory_lock_dir_for_test,
    try_acquire_memory_lock, write_workspace_file,
};

fn write_memory_lock_owner(root: &std::path::Path, contents: &str) {
    let lock_path = root.join(".mdx/memory.lock");
    std::fs::create_dir(&lock_path).unwrap();
    std::fs::write(lock_path.join("owner"), contents).unwrap();
}

fn sample_thread_body() -> String {
    "## Message 1 — user — 2026-06-12T09:00:01Z\n\nImplement auth middleware.\n\n## Message 2 — assistant — 2026-06-12T09:00:15Z\n\nPlan the work.\n".to_string()
}

fn memory_fixture_path(name: &str) -> String {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/memory")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

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

#[test]
fn memory_detect_reports_ordinary_workspace_before_initialization() {
    let root = tempdir().unwrap();

    let status = memory_detect_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert!(!status.has_memory);
    assert!(status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"memory".to_string()));
    assert!(status
        .missing_paths
        .contains(&"memory/working.md".to_string()));
    assert!(status
        .missing_paths
        .contains(&".mdx/memory-config.json".to_string()));
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
fn daemon_dispatch_health_reports_memory_status() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "GET",
        "/health",
        "",
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let body: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["ok"], true);
    assert_eq!(body["has_memory"], true);
    assert_eq!(
        body["workspace"],
        root.path().to_string_lossy().into_owned()
    );
}

#[test]
fn daemon_dispatch_memory_add_accepts_json_body() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/memory/add",
        r#"{"title":"Daemon memory","body":"Saved through HTTP dispatch.","tags":["daemon"],"source_thread":null,"importance":0.7,"confidence":0.8}"#,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    assert!(response.body.contains("\"ok\":true"));
    assert!(response.body.contains("\"title\":\"Daemon memory\""));
}

#[test]
fn memory_initialize_preserves_existing_markdown() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("existing.md"), "# Existing\n").unwrap();

    let result = memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert!(root.path().join("existing.md").is_file());
    assert!(result
        .preserved_paths
        .iter()
        .all(|path| path != "existing.md"));
}

#[test]
fn memory_initialize_preserves_existing_required_files() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("memory")).unwrap();
    std::fs::create_dir_all(root.path().join(".mdx")).unwrap();
    std::fs::write(root.path().join("memory/working.md"), "# User Working\n").unwrap();
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        "{\"version\":99}\n",
    )
    .unwrap();

    let result = memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(
        std::fs::read_to_string(root.path().join("memory/working.md")).unwrap(),
        "# User Working\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join(".mdx/memory-config.json")).unwrap(),
        "{\"version\":99}\n"
    );
    assert!(result
        .preserved_paths
        .contains(&"memory/working.md".to_string()));
    assert!(result
        .preserved_paths
        .contains(&".mdx/memory-config.json".to_string()));
}

#[test]
fn memory_initialize_writes_expected_default_config() {
    let root = tempdir().unwrap();

    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let config: crate::memory_models::MemoryConfig = serde_json::from_str(
        &std::fs::read_to_string(root.path().join(".mdx/memory-config.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config, default_memory_config());
}

#[test]
fn memory_init_appends_a_memory_init_audit_event() {
    let root = tempdir().unwrap();

    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("memory_init"));
    assert!(log.contains("memory_init result=noop"));
}

#[test]
fn capture_imports_codex_jsonl_as_thread() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "codex".to_string(),
            path: memory_fixture_path("codex-session.jsonl"),
            title: Some("Codex fixture".to_string()),
            thread_id: Some("codex:fixture-1".to_string()),
            distill: false,
        },
    )
    .unwrap();

    assert_eq!(result.thread_id, "codex:fixture-1");
    assert_eq!(result.source, "codex");
    assert!(result.path.starts_with("memory/threads/codex/"));
    assert!(!result.distilled);
    assert_eq!(result.distill_status, "not_requested");
    assert_eq!(result.distill_error_code, None);
    assert!(result.distill_result.is_none());
    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert!(thread
        .body
        .contains("## Message 1 — user — 2026-06-13T08:00:00Z"));
    assert!(thread.body.contains("MDX memory supports Codex"));
}

#[test]
fn capture_import_reports_distill_unavailable_as_partial_success() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "codex".to_string(),
            path: memory_fixture_path("codex-session.jsonl"),
            title: Some("Codex fixture".to_string()),
            thread_id: Some("codex:distill-unavailable".to_string()),
            distill: true,
        },
    )
    .unwrap();

    assert_eq!(result.thread_id, "codex:distill-unavailable");
    assert!(result.path.starts_with("memory/threads/codex/"));
    assert!(!result.distilled);
    assert_eq!(result.distill_status, "failed");
    assert_eq!(
        result.distill_error_code.as_deref(),
        Some("distill_unavailable")
    );
    assert!(result
        .distill_error_message
        .as_deref()
        .unwrap()
        .contains("distill_unavailable"));
    assert!(result.distill_result.is_none());

    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert!(thread.body.contains("MDX memory supports Codex"));
}

#[test]
fn capture_imports_cursor_json_as_thread() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "cursor".to_string(),
            path: memory_fixture_path("cursor-session.json"),
            title: None,
            thread_id: None,
            distill: false,
        },
    )
    .unwrap();

    assert_eq!(result.source, "cursor");
    assert_eq!(result.thread_id, "cursor-fixture-1");
    assert!(result.path.starts_with("memory/threads/cursor/"));
    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert_eq!(thread.frontmatter.title, "cursor-fixture-1");
    assert!(thread.body.contains("Cursor transcript"));
    assert!(thread.body.contains("Imported from Cursor"));
}

#[test]
fn capture_imports_claude_code_json_as_thread() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "claude-code".to_string(),
            path: memory_fixture_path("claude-code-session.json"),
            title: None,
            thread_id: None,
            distill: false,
        },
    )
    .unwrap();

    assert_eq!(result.source, "claude-code");
    assert_eq!(result.thread_id, "claude-fixture-1");
    assert!(result.path.starts_with("memory/threads/claude-code/"));
    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    assert_eq!(thread.frontmatter.title, "claude-fixture-1");
    assert!(thread.body.contains("Claude Code transcript"));
    assert!(thread.body.contains("Imported from Claude Code"));
}

#[test]
fn memory_repair_recreates_missing_thread_index_and_preserves_markdown() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(root.path().join("memory/working.md"), "# User Working\n").unwrap();
    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Preserved decision".to_string(),
            body: "Existing memory stays intact.".to_string(),
            tags: vec!["repair".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    let before_record = std::fs::read_to_string(root.path().join(&record.path)).unwrap();
    std::fs::remove_file(root.path().join(".mdx/thread-index.json")).unwrap();

    let result = memory_repair_workspace(
        root.path().to_string_lossy().into_owned(),
        MemoryRepairRequest {
            rebuild_index: true,
        },
    )
    .unwrap();

    assert_eq!(result.repaired_paths, vec![".mdx/thread-index.json"]);
    assert_eq!(
        result.warnings,
        vec!["search index rebuild is handled by the search index task"]
    );
    assert!(root.path().join(".mdx/thread-index.json").is_file());
    assert_eq!(
        std::fs::read_to_string(root.path().join("memory/working.md")).unwrap(),
        "# User Working\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join(&record.path)).unwrap(),
        before_record
    );
    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("memory_repair"));
}

#[test]
fn workspace_lock_serializes_memory_writes() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let lock = try_acquire_memory_lock(root.path()).unwrap();
    let busy = try_acquire_memory_lock(root.path()).unwrap_err();
    assert!(format!("{busy}").starts_with("memory_lock_busy:"));
    assert!(root.path().join(".mdx/memory.lock").is_dir());
    assert!(root.path().join(".mdx/memory.lock/owner").is_file());
    assert!(!root.path().join(".mdx/tmp/memory.lock").exists());

    drop(lock);

    let reacquired = try_acquire_memory_lock(root.path()).unwrap();
    assert!(root.path().join(".mdx/memory.lock").is_dir());
    drop(reacquired);
    assert!(!root.path().join(".mdx/memory.lock").exists());
}

#[test]
fn workspace_lock_token_mismatch_drop_preserves_recreated_lock_directory() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let lock = try_acquire_memory_lock(root.path()).unwrap();
    let lock_path = root.path().join(".mdx/memory.lock");
    std::fs::remove_file(lock_path.join("owner")).unwrap();
    std::fs::remove_dir(&lock_path).unwrap();
    write_memory_lock_owner(
        root.path(),
        "token=newer-owner\npid=0\ncreated_at_unix=4102444800\n",
    );

    drop(lock);

    let contents = std::fs::read_to_string(lock_path.join("owner")).unwrap();
    assert!(contents.contains("token=newer-owner"));
    assert!(lock_path.is_dir());
}

#[test]
fn workspace_lock_recovers_stale_lock_directory() {
    let stale_root = tempdir().unwrap();
    memory_initialize_workspace(stale_root.path().to_string_lossy().into_owned()).unwrap();
    write_memory_lock_owner(
        stale_root.path(),
        "token=stale-owner\npid=0\ncreated_at_unix=0\n",
    );

    let stale_lock = try_acquire_memory_lock(stale_root.path()).unwrap();
    let owner = std::fs::read_to_string(stale_root.path().join(".mdx/memory.lock/owner")).unwrap();
    assert!(!owner.contains("token=stale-owner"));
    drop(stale_lock);
}

#[test]
fn workspace_lock_fresh_missing_owner_directory_returns_busy() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let lock_path = root.path().join(".mdx/memory.lock");
    std::fs::create_dir(&lock_path).unwrap();

    let busy = try_acquire_memory_lock(root.path()).unwrap_err();

    assert!(format!("{busy}").starts_with("memory_lock_busy:"));
    assert!(lock_path.is_dir());
    assert!(!lock_path.join("owner").exists());
}

#[test]
fn workspace_lock_recovers_old_malformed_lock_directory() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    write_memory_lock_owner(root.path(), "not a valid lock owner\n");

    let lock = recover_old_malformed_memory_lock_dir_for_test(root.path()).unwrap();
    let owner = std::fs::read_to_string(root.path().join(".mdx/memory.lock/owner")).unwrap();

    assert!(!owner.contains("not a valid lock owner"));
    assert!(owner.contains("token="));
    drop(lock);
    assert!(!root.path().join(".mdx/memory.lock").exists());
}

#[test]
fn workspace_lock_non_stale_lock_directory_returns_busy() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    write_memory_lock_owner(
        root.path(),
        "token=active-owner\npid=0\ncreated_at_unix=4102444800\n",
    );

    let busy = try_acquire_memory_lock(root.path()).unwrap_err();

    assert!(format!("{busy}").starts_with("memory_lock_busy:"));
    let owner = std::fs::read_to_string(root.path().join(".mdx/memory.lock/owner")).unwrap();
    assert!(owner.contains("token=active-owner"));
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

    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Auth alpha".to_string(),
            body: "auth alpha decision".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.9),
            confidence: Some(0.9),
        },
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Auth beta".to_string(),
            body: "auth beta decision".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.8),
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "auth".to_string(),
            limit: None,
            byte_budget: None,
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();
    assert_eq!(result.memories.len(), 1);
    assert!(result.byte_count <= 64);
}

#[test]
fn recall_accepts_previous_memory_config_shape() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        r#"{
  "version": 1,
  "recall": { "default_limit": 10, "context_byte_budget": 65536 },
  "distill": {
    "enabled": false,
    "min_messages": 4,
    "skip_patterns": ["^Running terminal command"]
  },
  "capture": { "enabled": false, "sources": [] }
}
"#,
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Legacy config recall".to_string(),
            body: "legacy config recall succeeds".to_string(),
            tags: vec!["legacy".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.9),
            confidence: Some(0.9),
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "legacy".to_string(),
            limit: None,
            byte_budget: None,
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(result.memories.len(), 1);
    assert!(!result.truncated);
}

#[test]
fn memory_read_rejects_symlinked_parent_directory() {
    let root = tempdir().unwrap();
    let external = tempdir().unwrap();

    std::fs::create_dir_all(root.path().join(".mdx")).unwrap();
    std::fs::create_dir_all(external.path().join("memory")).unwrap();
    std::fs::write(external.path().join("memory/working.md"), "outside\n").unwrap();

    #[cfg(unix)]
    std::os::unix::fs::symlink(external.path().join("memory"), root.path().join("memory")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(external.path().join("memory"), root.path().join("memory"))
        .unwrap();

    let error = crate::memory::read_memory_workspace_file(
        root.path().to_string_lossy().into_owned(),
        "memory/working.md",
    )
    .unwrap_err();

    assert!(format!("{error}").starts_with("path_type_conflict:"));
}

#[test]
fn memory_append_log_entry_trims_and_appends_newline() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    append_memory_log_entry(root.path(), "  entry one  ").unwrap();

    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.ends_with("- entry one\n"));
}

#[test]
fn memory_write_rejects_symlinked_parent_directory() {
    let root = tempdir().unwrap();
    let external = tempdir().unwrap();

    std::fs::create_dir_all(external.path().join("memory")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(external.path().join("memory"), root.path().join("memory")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(external.path().join("memory"), root.path().join("memory"))
        .unwrap();

    let error = write_workspace_file(root.path(), "memory/working.md", b"new").unwrap_err();

    assert!(format!("{error}").starts_with("path_type_conflict:"));
}

#[test]
fn memory_read_and_write_reject_paths_outside_workspace() {
    let root = tempdir().unwrap();

    let read_parent_error = read_workspace_file(root.path(), "../escape.md").unwrap_err();
    let write_parent_error = write_workspace_file(root.path(), "../escape.md", b"new").unwrap_err();
    let read_absolute_error = read_workspace_file(
        root.path(),
        root.path().join("absolute.md").to_str().unwrap(),
    )
    .unwrap_err();
    let write_absolute_error = write_workspace_file(
        root.path(),
        root.path().join("absolute.md").to_str().unwrap(),
        b"new",
    )
    .unwrap_err();

    assert!(format!("{read_parent_error}").starts_with("invalid_memory_workspace_path:"));
    assert!(format!("{write_parent_error}").starts_with("invalid_memory_workspace_path:"));
    assert!(format!("{read_absolute_error}").starts_with("invalid_memory_workspace_path:"));
    assert!(format!("{write_absolute_error}").starts_with("invalid_memory_workspace_path:"));
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
    assert_eq!(
        result.path,
        "memory/threads/manual/2026-06-12-cursor-abc123.md"
    );
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

    let first =
        memory_thread_save(root.path().to_string_lossy().into_owned(), request.clone()).unwrap();
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
    let first =
        memory_thread_save(root.path().to_string_lossy().into_owned(), request.clone()).unwrap();
    request
        .body
        .push_str("\n## Message 3 — user — 2026-06-12T10:00:00Z\n\nShip it.\n");
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

#[test]
fn thread_list_filters_by_since() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    for (thread_id, started_at) in [
        ("old", "2026-06-10T09:00:00Z"),
        ("new", "2026-06-12T09:00:00Z"),
    ] {
        memory_thread_save(
            root.path().to_string_lossy().into_owned(),
            ThreadSaveRequest {
                source: "manual".to_string(),
                thread_id: Some(thread_id.to_string()),
                title: format!("{thread_id} thread"),
                body: sample_thread_body(),
                started_at: Some(started_at.to_string()),
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
            source: None,
            since: Some("2026-06-11T00:00:00Z".to_string()),
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].thread_id, "new");
}

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
            source_message_refs: Vec::new(),
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
fn memory_add_preserves_same_title_records() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let first = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Repeated decision".to_string(),
            body: "First body".to_string(),
            tags: Vec::new(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    let second = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Repeated decision".to_string(),
            body: "Second body".to_string(),
            tags: Vec::new(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    assert_ne!(first.path, second.path);
    assert_ne!(first.frontmatter.memory_id, second.frontmatter.memory_id);
    assert!(
        memory_get(root.path().to_string_lossy().into_owned(), first.path)
            .unwrap()
            .body
            .contains("First body")
    );
    assert!(
        memory_get(root.path().to_string_lossy().into_owned(), second.path)
            .unwrap()
            .body
            .contains("Second body")
    );
}

#[test]
fn memory_add_preserves_concurrent_same_title_records() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let root_path = Arc::new(root.path().to_path_buf());
    let mut handles = Vec::new();

    for index in 0..8 {
        let root_path = Arc::clone(&root_path);
        handles.push(thread::spawn(move || {
            crate::memory_store::memory_add(
                root_path.as_ref().clone(),
                MemoryAddRequest {
                    title: "Concurrent decision".to_string(),
                    body: format!("Body {index}"),
                    tags: Vec::new(),
                    source_thread: None,
                    source_message_refs: Vec::new(),
                    importance: None,
                    confidence: None,
                },
            )
            .unwrap()
        }));
    }

    let records = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    let mut paths = records
        .iter()
        .map(|record| record.path.clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();

    assert_eq!(paths.len(), records.len());
    for record in records {
        assert!(root.path().join(record.path).is_file());
    }
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
            source_message_refs: Vec::new(),
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
            source_message_refs: Vec::new(),
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
            source_message_refs: Vec::new(),
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
            source_message_refs: Vec::new(),
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
            source_message_refs: Vec::new(),
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
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
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
            source_message_refs: Vec::new(),
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
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(result
        .working
        .as_deref()
        .unwrap_or_default()
        .contains("Ship JWT auth"));
    assert!(result.truncated);
    assert!(result.byte_count <= 256);
}

#[test]
fn recall_byte_budget_applies_after_thread_aggregation() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("thread-auth".to_string()),
            title: "Auth middleware discussion with a long summary title".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "missing".to_string(),
            limit: Some(10),
            byte_budget: Some(16),
            include_working: false,
            include_threads: false,
            thread_ids: vec!["thread-auth".to_string()],
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(result.threads.is_empty());
    assert!(result.truncated);
    assert!(result.byte_count <= 16);
}

#[test]
fn recall_include_threads_returns_matching_thread_summaries_without_full_text() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("thread-auth".to_string()),
            title: "Auth middleware discussion".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "auth".to_string(),
            limit: Some(10),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: true,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(result.threads.len(), 1);
    assert_eq!(result.threads[0].memory_id, "thread-auth");
    assert!(!result.threads[0].title.contains("Message 1"));
}

#[test]
fn recall_reports_index_degraded_when_sqlite_is_missing_and_scan_fallback_succeeds() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token lifetime".to_string(),
            body: "Access tokens expire after 15 minutes.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "JWT".to_string(),
            limit: Some(10),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(result.memories.len(), 1);
    assert_eq!(result.memories[0].title, "JWT access token lifetime");
    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("markdown fallback")));
}

#[test]
fn recall_can_include_explicit_thread_excerpt_but_not_default_thread_body() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("thread-auth".to_string()),
            title: "Auth middleware discussion".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let default_result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "Implement auth middleware".to_string(),
            limit: Some(10),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: true,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();
    assert!(default_result.threads.is_empty());
    assert!(default_result.memories.is_empty());

    let explicit_result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "missing".to_string(),
            limit: Some(10),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            thread_ids: vec!["thread-auth".to_string()],
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(explicit_result.threads.len(), 1);
    assert_eq!(explicit_result.threads[0].memory_id, "thread-auth");
    assert_eq!(
        explicit_result.threads[0].title,
        "Auth middleware discussion"
    );
    assert!(!explicit_result.threads[0]
        .title
        .contains("Implement auth middleware"));
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
            source_message_refs: Vec::new(),
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
fn search_index_rebuild_recovers_memory_search_from_markdown() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token lifetime".to_string(),
            body: "Access tokens expire after 15 minutes.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();

    let status =
        crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(status.index_status, "clean");
    assert!(root.path().join(".mdx/search.sqlite").is_file());
    let results = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: "JWT".to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    )
    .unwrap();
    assert_eq!(results.items.len(), 1);
    assert_eq!(results.items[0].title, "JWT access token lifetime");
}

#[test]
fn recall_limit_zero_returns_no_memories_with_available_index() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token lifetime".to_string(),
            body: "Access tokens expire after 15 minutes.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "JWT".to_string(),
            limit: Some(0),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(result.memories.is_empty());
    assert!(!result.index_degraded);
}

#[test]
fn search_index_search_reports_unavailable_without_recreating_missing_index() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "JWT access token lifetime".to_string(),
            body: "Access tokens expire after 15 minutes.".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    let index_path = root.path().join(".mdx/search.sqlite");
    assert!(index_path.is_file());
    std::fs::remove_file(&index_path).unwrap();

    let error = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: "JWT".to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "index_unavailable");
    assert!(!index_path.exists());
}

#[test]
fn search_index_query_tokenization_handles_punctuation_quotes_and_unicode() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "C plus plus tokenizer note".to_string(),
            body: "Write C plus plus examples with access token checks.".to_string(),
            tags: vec!["compiler".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "鉴权 token note".to_string(),
            body: "鉴权 token 需要短过期时间。".to_string(),
            tags: vec!["auth".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    let punctuation = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: "C++".to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    )
    .unwrap();
    assert_eq!(punctuation.items.len(), 1);
    assert_eq!(punctuation.items[0].title, "C plus plus tokenizer note");

    let quoted = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: r#""access-token""#.to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    )
    .unwrap();
    assert_eq!(quoted.items.len(), 1);
    assert_eq!(quoted.items[0].title, "C plus plus tokenizer note");

    let unicode = crate::memory::memory_index_search(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryIndexSearchRequest {
            query: "鉴权 token".to_string(),
            limit: 10,
            kinds: vec!["memory".to_string()],
        },
    )
    .unwrap();
    assert_eq!(unicode.items.len(), 1);
    assert_eq!(unicode.items[0].title, "鉴权 token note");
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

    assert_eq!(
        promoted.promoted_path,
        "raw/promoted/2026-06-12-implement-auth-middleware.md"
    );
    assert!(root.path().join(&promoted.promoted_path).is_file());
}

#[test]
fn promote_preserves_existing_promoted_files() {
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
    std::fs::create_dir_all(root.path().join("raw/promoted")).unwrap();
    std::fs::write(
        root.path()
            .join("raw/promoted/2026-06-12-implement-auth-middleware.md"),
        "existing promoted material",
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

    assert_eq!(
        std::fs::read_to_string(
            root.path()
                .join("raw/promoted/2026-06-12-implement-auth-middleware.md")
        )
        .unwrap(),
        "existing promoted material"
    );
    assert_eq!(
        promoted.promoted_path,
        "raw/promoted/2026-06-12-implement-auth-middleware-1.md"
    );
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

#[test]
fn promote_with_failed_ingest_does_not_mark_thread_promoted() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    crate::llm_wiki_fs::initialize_llm_wiki_workspace(root.path()).unwrap();
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

    let error = crate::memory_promote::memory_promote_with_ingest_for_test(
        root.path(),
        MemoryPromoteRequest {
            target: "cursor:abc123".to_string(),
            ingest: true,
            title: None,
        },
        |_, _| Err(crate::WorkspaceError::new("llm_failed", "injected failure")),
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_failed");
    let thread = memory_thread_get(
        root.path().to_string_lossy().into_owned(),
        "cursor:abc123".to_string(),
    )
    .unwrap();
    assert!(!thread.frontmatter.promoted_to_wiki);
}

#[test]
fn inbox_accept_creates_active_memory_and_marks_candidate_accepted() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let candidate = memory_inbox_add(
        root.path().to_string_lossy().into_owned(),
        InboxAddRequest {
            title: "Persist inbox decisions".to_string(),
            body: "Inbox candidates are reviewed before becoming active memory.".to_string(),
            source_thread: Some("codex:session-5".to_string()),
            source_message_refs: vec!["msg-1".to_string(), "msg-2".to_string()],
            importance: Some(0.8),
            confidence: Some(0.7),
            tags: vec!["workflow".to_string()],
            distill_run_id: Some("distill-1".to_string()),
        },
    )
    .unwrap();

    let result = memory_inbox_accept(
        root.path().to_string_lossy().into_owned(),
        InboxReviewRequest {
            inbox_id: candidate.frontmatter.inbox_id.clone(),
            title: Some("Reviewed inbox decision".to_string()),
            body: Some("Reviewed body becomes the active memory.".to_string()),
            tags: Some(vec!["reviewed".to_string(), "workflow".to_string()]),
        },
    )
    .unwrap();

    assert_eq!(result.status, "accepted");
    let memory = memory_get(
        root.path().to_string_lossy().into_owned(),
        result.accepted_memory_id.clone().unwrap(),
    )
    .unwrap();
    assert_eq!(memory.frontmatter.title, "Reviewed inbox decision");
    assert_eq!(
        memory.body.trim(),
        "Reviewed body becomes the active memory."
    );
    assert_eq!(
        memory.frontmatter.source_thread,
        Some("codex:session-5".to_string())
    );
    assert_eq!(
        memory.frontmatter.source_message_refs,
        vec!["msg-1".to_string(), "msg-2".to_string()]
    );
    let memory_markdown = read_workspace_file(root.path(), &memory.path).unwrap();
    assert!(memory_markdown.contains("source_message_refs:"));
    assert!(memory_markdown.contains("- msg-1"));
    assert!(memory_markdown.contains("- msg-2"));
    assert_eq!(memory.frontmatter.tags, vec!["reviewed", "workflow"]);

    let reviewed = memory_inbox_get(
        root.path().to_string_lossy().into_owned(),
        candidate.frontmatter.inbox_id,
    )
    .unwrap();
    assert_eq!(reviewed.frontmatter.status, "accepted");
    assert_eq!(reviewed.frontmatter.title, "Reviewed inbox decision");
    assert_eq!(
        reviewed.body.trim(),
        "Reviewed body becomes the active memory."
    );
    assert_eq!(reviewed.frontmatter.tags, vec!["reviewed", "workflow"]);
    assert_eq!(
        reviewed.frontmatter.accepted_memory_id,
        Some(memory.frontmatter.memory_id)
    );
}

#[test]
fn inbox_accept_is_idempotent_for_already_accepted_candidate() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let candidate = memory_inbox_add(
        root.path().to_string_lossy().into_owned(),
        InboxAddRequest {
            title: "Accepted once".to_string(),
            body: "Only one active memory should be created.".to_string(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
            tags: vec!["inbox".to_string()],
            distill_run_id: None,
        },
    )
    .unwrap();
    let request = InboxReviewRequest {
        inbox_id: candidate.frontmatter.inbox_id,
        title: None,
        body: None,
        tags: None,
    };

    let first =
        memory_inbox_accept(root.path().to_string_lossy().into_owned(), request.clone()).unwrap();
    let second = memory_inbox_accept(root.path().to_string_lossy().into_owned(), request).unwrap();

    assert_eq!(second.status, "accepted");
    assert_eq!(second.accepted_memory_id, first.accepted_memory_id);
    assert!(second.memory.is_some());

    let memories = memory_list(
        root.path().to_string_lossy().into_owned(),
        MemoryListFilter::default(),
    )
    .unwrap();
    assert_eq!(memories.len(), 1);
}

#[test]
fn distill_with_json_writes_candidates_to_inbox() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-1".to_string()),
            title: "Auth discussion".to_string(),
            body: sample_thread_body(),
            started_at: None,
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let json = r#"[{
      "title": "Use JWT",
      "body": "The project uses JWT access tokens.",
      "tags": ["auth"],
      "importance": 0.8,
      "confidence": 0.9,
      "source_message_refs": [1, 2]
    }]"#;
    let result = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-1".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();

    assert!(!result.accepted);
    assert_eq!(result.candidate_count, 1);
    assert_eq!(result.inbox_count, 1);
    assert_eq!(result.memory_count, 0);
    assert_eq!(result.inbox[0].frontmatter.title, "Use JWT");
    assert_eq!(
        result.inbox[0].frontmatter.source_thread,
        Some("codex:distill-1".to_string())
    );
    assert_eq!(
        result.inbox[0].frontmatter.source_message_refs,
        vec!["1".to_string(), "2".to_string()]
    );

    let inbox = memory_inbox_list(root.path().to_string_lossy().into_owned(), false).unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].frontmatter.title, "Use JWT");
}

#[test]
fn distill_with_json_accept_true_writes_active_memories() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-2".to_string()),
            title: "Auth discussion".to_string(),
            body: sample_thread_body(),
            started_at: None,
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let json = r#"[{
      "title": "Keep auth middleware small",
      "body": "Auth middleware should only validate tokens and attach identity.",
      "tags": ["auth", "architecture"],
      "importance": 0.7,
      "confidence": 0.85,
      "source_message_refs": [2]
    }]"#;
    let result = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-2".to_string(),
            accept: true,
            force: false,
        },
        json,
    )
    .unwrap();

    assert!(result.accepted);
    assert_eq!(result.candidate_count, 1);
    assert_eq!(result.inbox_count, 0);
    assert_eq!(result.memory_count, 1);
    assert_eq!(
        result.memories[0].frontmatter.title,
        "Keep auth middleware small"
    );
    assert_eq!(
        result.memories[0].frontmatter.source_thread,
        Some("codex:distill-2".to_string())
    );
    assert_eq!(
        result.memories[0].frontmatter.source_message_refs,
        vec!["2".to_string()]
    );

    let inbox = memory_inbox_list(root.path().to_string_lossy().into_owned(), true).unwrap();
    assert!(inbox.is_empty());
    let memories = memory_list(
        root.path().to_string_lossy().into_owned(),
        MemoryListFilter::default(),
    )
    .unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0].title, "Keep auth middleware small");
}

#[test]
fn inbox_reject_marks_candidate_rejected_and_list_hides_reviewed_by_default() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let rejected = memory_inbox_add(
        root.path().to_string_lossy().into_owned(),
        InboxAddRequest {
            title: "Reject this candidate".to_string(),
            body: "This should not become active memory.".to_string(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
            tags: vec!["inbox".to_string()],
            distill_run_id: None,
        },
    )
    .unwrap();
    let pending = memory_inbox_add(
        root.path().to_string_lossy().into_owned(),
        InboxAddRequest {
            title: "Keep this pending".to_string(),
            body: "This still needs review.".to_string(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
            tags: Vec::new(),
            distill_run_id: None,
        },
    )
    .unwrap();

    let result = memory_inbox_reject(
        root.path().to_string_lossy().into_owned(),
        rejected.frontmatter.inbox_id.clone(),
    )
    .unwrap();
    assert_eq!(result.status, "rejected");
    assert_eq!(result.accepted_memory_id, None);

    let pending_only =
        memory_inbox_list(root.path().to_string_lossy().into_owned(), false).unwrap();
    assert_eq!(pending_only.len(), 1);
    assert_eq!(
        pending_only[0].frontmatter.inbox_id,
        pending.frontmatter.inbox_id
    );

    let all = memory_inbox_list(root.path().to_string_lossy().into_owned(), true).unwrap();
    assert_eq!(all.len(), 2);
    assert!(all
        .iter()
        .any(|record| record.frontmatter.status == "rejected"));
}
