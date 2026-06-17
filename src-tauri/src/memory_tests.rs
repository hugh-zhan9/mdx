use std::io::Write;
use std::sync::{Arc, MutexGuard};
use std::thread;

use tempfile::tempdir;

use crate::memory::{
    default_memory_config, memory_add, memory_archive, memory_capture_import, memory_capture_scan,
    memory_detect_workspace, memory_distill, memory_distill_with_json_for_test, memory_get,
    memory_inbox_accept, memory_inbox_add, memory_inbox_get, memory_inbox_list,
    memory_inbox_reject, memory_initialize_workspace, memory_list, memory_promote, memory_recall,
    memory_repair_workspace, memory_search, memory_thread_get, memory_thread_list,
    memory_thread_save, memory_working_append, memory_working_get, memory_working_set,
    InboxAddRequest, InboxReviewRequest, MemoryAddRequest, MemoryCaptureImportRequest,
    MemoryCaptureScanRequest, MemoryDistillRequest, MemoryListFilter, MemoryPromoteRequest,
    MemoryRepairRequest, RecallRequest, ThreadListFilter, ThreadSaveRequest,
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

fn canonical_test_path(path: impl AsRef<std::path::Path>) -> String {
    std::fs::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

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

#[test]
fn projection_rebuild_writes_memory_markdown_with_stable_frontmatter() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    storage
        .insert_memory_for_test(
            "memory-projection-1",
            "workspace:test",
            "workspace:test",
            "Agent backend",
            "Memory is external to Codex Claude Cursor.",
            &["architecture"],
            0.95,
        )
        .unwrap();

    let report = crate::memory_projection::rebuild_projection(root.path(), &mut storage).unwrap();

    assert_eq!(report.written, 1);
    let markdown =
        std::fs::read_to_string(root.path().join("memory/memories/agent-backend.md")).unwrap();
    assert!(markdown.contains("memory_id: memory-projection-1"));
    assert!(markdown.contains("kind: memory"));
    assert!(markdown.contains("Memory is external to Codex Claude Cursor."));
    let (frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<crate::memory::MemoryFrontmatter>(&markdown)
            .unwrap();
    assert_eq!(frontmatter.memory_id, "memory-projection-1");
    assert_eq!(frontmatter.tags, vec!["architecture"]);
    assert_eq!(frontmatter.confidence, Some(0.95));
    assert_eq!(body.trim(), "Memory is external to Codex Claude Cursor.");
}

#[test]
fn projection_rebuild_reports_conflict_without_overwriting_existing_markdown() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    storage
        .insert_memory_for_test(
            "memory-conflict-1",
            "workspace:test",
            "workspace:test",
            "Agent backend",
            "New DB memory body.",
            &["architecture"],
            0.95,
        )
        .unwrap();
    let path = root.path().join("memory/memories/agent-backend.md");
    std::fs::write(&path, "existing projection\n").unwrap();

    let report = crate::memory_projection::rebuild_projection(root.path(), &mut storage).unwrap();

    assert_eq!(report.written, 0);
    assert_eq!(report.conflicts, 1);
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "existing projection\n"
    );
}

#[test]
fn markdown_memory_import_preserves_existing_ids_and_unknown_message_count() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("memory/memories")).unwrap();
    std::fs::write(
        root.path().join("memory/memories/decision.md"),
        "---\nschema_version: 1\nkind: memory\nmemory_id: memory-old-1\ntitle: Old decision\nstatus: active\ncreated_at: 2026-06-14T00:00:00Z\n---\n\nUse DB first.\n",
    )
    .unwrap();
    std::fs::create_dir_all(root.path().join("memory/threads/codex")).unwrap();
    std::fs::write(
        root.path().join("memory/threads/codex/old-thread.md"),
        "---\nschema_version: 1\nkind: thread\nthread_id: codex:old\ntitle: Old thread\ncontent_hash: abc\n---\n\n## Message 1 - user\nhello\n",
    )
    .unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let report =
        crate::memory_storage_migration::import_markdown_memory_to_db(root.path(), &mut storage)
            .unwrap();

    assert_eq!(report.memories_imported, 1);
    assert_eq!(report.threads_imported, 1);
    let thread = storage.get_thread_for_test("codex:old").unwrap().unwrap();
    assert_eq!(thread.message_count, None);
}

#[test]
fn markdown_thread_import_is_idempotent_and_preserves_known_metadata() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("memory/threads/codex")).unwrap();
    std::fs::write(
        root.path().join("memory/threads/codex/known-thread.md"),
        "---\nschema_version: 1\nkind: thread\nthread_id: codex:known\ntitle: Known thread\ncontent_hash: abc\nstarted_at: 2026-06-14T00:00:00Z\nended_at: 2026-06-14T00:01:00Z\n---\n\n## Message 1 - user\nhello\n",
    )
    .unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    storage
        .upsert_thread(&crate::memory_storage::StoredThreadWrite {
            thread_id: "codex:known".to_string(),
            workspace_id: scope.workspace_id,
            agent_source: "codex".to_string(),
            session_pk: Some("session-known".to_string()),
            title: "Known thread".to_string(),
            body: "## Message 1 - user\nhello\n".to_string(),
            content_hash: "abc".to_string(),
            message_count: Some(7),
            distilled: Some(true),
            promoted_to_wiki: Some(true),
            created_at: "2026-06-14T00:00:00Z".to_string(),
            updated_at: "2026-06-14T00:01:00Z".to_string(),
        })
        .unwrap();

    let report =
        crate::memory_storage_migration::import_markdown_memory_to_db(root.path(), &mut storage)
            .unwrap();

    assert_eq!(report.threads_imported, 0);
    assert_eq!(report.skipped, 1);
    let thread = storage.get_thread_for_test("codex:known").unwrap().unwrap();
    assert_eq!(thread.session_pk.as_deref(), Some("session-known"));
    assert_eq!(thread.message_count, Some(7));
    assert_eq!(thread.distilled, Some(true));
    assert_eq!(thread.promoted_to_wiki, Some(true));
}

#[test]
fn storage_migration_dry_run_reports_copy_counts_without_switching_backend() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut sqlite =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    sqlite.initialize().unwrap();
    sqlite
        .insert_memory_for_test(
            "memory-1",
            "workspace:test",
            "workspace:test",
            "Decision",
            "Use DB first.",
            &["db"],
            0.9,
        )
        .unwrap();

    let report = crate::memory_storage_migration::dry_run_storage_migration(
        root.path(),
        "sqlite",
        "postgresql",
        Some("postgresql://example/mdx"),
    )
    .unwrap();

    assert_eq!(report.from, "sqlite");
    assert_eq!(report.to, "postgresql");
    assert_eq!(report.records_seen.get("memories"), Some(&1));
    assert!(!report.config_switched);
}

#[test]
fn storage_migration_copies_records_and_switches_config_after_success() {
    let root = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut sqlite =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    sqlite.initialize().unwrap();
    sqlite
        .insert_memory_for_test(
            "memory-1",
            "workspace:test",
            "workspace:test",
            "Decision",
            "Use DB first.",
            &["db"],
            0.9,
        )
        .unwrap();
    sqlite
        .upsert_thread(&crate::memory_storage::StoredThreadWrite {
            thread_id: "codex:migration".to_string(),
            workspace_id: crate::memory_storage::workspace_scope_for_root(root.path()).workspace_id,
            agent_source: "codex".to_string(),
            session_pk: None,
            title: "Migration thread".to_string(),
            body: "thread body".to_string(),
            content_hash: "sha256:migration".to_string(),
            message_count: Some(1),
            distilled: Some(false),
            promoted_to_wiki: Some(false),
            created_at: "2026-06-14T10:00:00Z".to_string(),
            updated_at: "2026-06-14T10:00:00Z".to_string(),
        })
        .unwrap();

    let report = crate::memory_storage_migration::run_storage_migration_to_sqlite_for_test(
        root.path(),
        target.path(),
    )
    .unwrap();

    assert_eq!(report.records_seen.get("memories"), Some(&1));
    assert_eq!(report.records_seen.get("threads"), Some(&1));
    assert_eq!(report.records_copied.get("memories"), Some(&1));
    assert_eq!(report.records_copied.get("threads"), Some(&1));
    assert!(report.config_switched);

    let config = crate::memory::load_memory_config_for_root(root.path()).unwrap();
    assert_eq!(config.storage.backend, "sqlite");

    let mut migrated =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(target.path()).unwrap();
    migrated.initialize().unwrap();
    assert_eq!(migrated.list_memory_records_for_migration().unwrap().len(), 1);
    assert_eq!(migrated.list_thread_records_for_migration().unwrap().len(), 1);
}

#[test]
fn daemon_storage_migration_dry_run_reports_invalid_request_flags() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let body = serde_json::json!({
        "from": "sqlite",
        "to": "postgresql",
        "target": "not-a-postgres-url",
        "dry_run": false,
        "resume": true
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/storage/migrate/dry-run",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["config_switched"], false);
    let errors = json["result"]["validation_errors"].as_array().unwrap();
    assert!(errors.iter().any(|value| value == "target_invalid"));
    assert!(errors.iter().any(|value| value == "dry_run_required"));
    assert!(errors
        .iter()
        .any(|value| value == "resume_not_supported_for_dry_run"));
}

#[test]
fn projection_rebuild_slugifies_non_ascii_as_dash() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    storage
        .insert_memory_for_test(
            "memory-slug-1",
            "workspace:test",
            "workspace:test",
            "Ägent backend",
            "Slug rules are stable.",
            &["architecture"],
            0.95,
        )
        .unwrap();

    let report = crate::memory_projection::rebuild_projection(root.path(), &mut storage).unwrap();

    assert_eq!(report.written, 1);
    assert!(root
        .path()
        .join("memory/memories/gent-backend.md")
        .is_file());
}

#[test]
fn projection_rebuild_disambiguates_duplicate_title_slugs() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    storage
        .insert_memory_for_test(
            "memory-duplicate-1",
            "workspace:test",
            "workspace:test",
            "Agent backend",
            "First memory body.",
            &["architecture"],
            0.95,
        )
        .unwrap();
    storage
        .insert_memory_for_test(
            "memory-duplicate-2",
            "workspace:test",
            "workspace:test",
            "Agent backend",
            "Second memory body.",
            &["architecture"],
            0.96,
        )
        .unwrap();

    let report = crate::memory_projection::rebuild_projection(root.path(), &mut storage).unwrap();

    assert_eq!(report.written, 2);
    assert_eq!(report.conflicts, 0);
    assert!(root
        .path()
        .join("memory/memories/agent-backend.md")
        .is_file());
    assert!(root
        .path()
        .join("memory/memories/agent-backend-memory-duplicate-2.md")
        .is_file());
}

#[test]
fn distill_worker_writes_auto_accept_memory_with_provenance() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
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
    )
    .unwrap();

    assert_eq!(result.created_memories, 1);
    assert_eq!(result.created_inbox, 0);
    assert_eq!(storage.count_memories_for_test().unwrap(), 1);
    assert_eq!(
        storage
            .count_provenance_links_for_test("codex:session-1")
            .unwrap(),
        1
    );

    let repeated = crate::memory_distill_worker::run_distill_job_for_test(
        &mut storage,
        &provider,
        "workspace:test",
        "codex:session-1",
    )
    .unwrap();
    assert_eq!(repeated.created_memories, 0);
    assert_eq!(repeated.created_inbox, 0);
    assert_eq!(storage.count_memories_for_test().unwrap(), 1);
    assert_eq!(
        storage
            .count_provenance_links_for_test("codex:session-1")
            .unwrap(),
        1
    );
}

#[test]
fn distill_worker_idempotency_does_not_depend_on_candidate_order() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    let first_provider = crate::memory_provider::MockMemoryProvider::new(serde_json::json!({
        "candidates": [
            {
                "title": "Memory positioning",
                "body": "MDX Memory is an external agent backend for Codex, Claude, and Cursor.",
                "confidence": 0.94,
                "tags": ["memory"]
            },
            {
                "title": "Hook automation",
                "body": "MDX Memory capture should be triggered automatically by agent hooks.",
                "confidence": 0.93,
                "tags": ["hooks"]
            }
        ]
    }));
    let repeated_provider = crate::memory_provider::MockMemoryProvider::new(serde_json::json!({
        "candidates": [
            {
                "title": "Hook automation",
                "body": "MDX Memory capture should be triggered automatically by agent hooks.",
                "confidence": 0.93,
                "tags": ["hooks"]
            },
            {
                "title": "Memory positioning",
                "body": "MDX Memory is an external agent backend for Codex, Claude, and Cursor.",
                "confidence": 0.94,
                "tags": ["memory"]
            }
        ]
    }));

    let first = crate::memory_distill_worker::run_distill_job_for_test(
        &mut storage,
        &first_provider,
        "workspace:test",
        "codex:session-order",
    )
    .unwrap();
    let repeated = crate::memory_distill_worker::run_distill_job_for_test(
        &mut storage,
        &repeated_provider,
        "workspace:test",
        "codex:session-order",
    )
    .unwrap();

    assert_eq!(first.created_memories, 2);
    assert_eq!(repeated.created_memories, 0);
    assert_eq!(storage.count_memories_for_test().unwrap(), 2);
    assert_eq!(
        storage
            .count_provenance_links_for_test("codex:session-order")
            .unwrap(),
        2
    );
}

#[test]
fn memory_provider_propagates_llm_config_path_conflicts() {
    let root = tempdir().unwrap();
    let config_path = root.path().join("llm-config.json");
    std::fs::create_dir(&config_path).unwrap();

    let error = match crate::memory_provider::ReusedLlmProvider::from_config_path(&config_path) {
        Ok(_) => panic!("expected config path conflict"),
        Err(error) => error,
    };

    assert_eq!(error.error_code(), "path_type_conflict");
}

struct MemoryLlmConfigEnvGuard {
    _lock: MutexGuard<'static, ()>,
    home: Option<std::ffi::OsString>,
    userprofile: Option<std::ffi::OsString>,
}

impl MemoryLlmConfigEnvGuard {
    fn use_home(path: impl AsRef<std::path::Path>) -> Self {
        let lock = crate::llm_wiki_llm::test_llm_config_env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let home = std::env::var_os("HOME");
        let userprofile = std::env::var_os("USERPROFILE");
        let canonical_home = std::fs::canonicalize(path.as_ref()).unwrap();
        std::env::set_var("HOME", canonical_home);
        std::env::remove_var("USERPROFILE");
        Self {
            _lock: lock,
            home,
            userprofile,
        }
    }
}

impl Drop for MemoryLlmConfigEnvGuard {
    fn drop(&mut self) {
        if let Some(value) = self.home.take() {
            std::env::set_var("HOME", value);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(value) = self.userprofile.take() {
            std::env::set_var("USERPROFILE", value);
        } else {
            std::env::remove_var("USERPROFILE");
        }
    }
}

struct MemoryCodexCaptureEnvGuard {
    _lock: MutexGuard<'static, ()>,
    home: Option<std::ffi::OsString>,
    userprofile: Option<std::ffi::OsString>,
    codex_session_dirs: Option<std::ffi::OsString>,
}

impl MemoryCodexCaptureEnvGuard {
    fn use_home_and_session_dirs(
        home_path: impl AsRef<std::path::Path>,
        session_dirs: impl AsRef<std::ffi::OsStr>,
    ) -> Self {
        let lock = crate::llm_wiki_llm::test_llm_config_env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let home = std::env::var_os("HOME");
        let userprofile = std::env::var_os("USERPROFILE");
        let codex_session_dirs = std::env::var_os("MDX_CODEX_SESSION_DIRS");
        let canonical_home = std::fs::canonicalize(home_path.as_ref()).unwrap();
        std::env::set_var("HOME", canonical_home);
        std::env::remove_var("USERPROFILE");
        std::env::set_var("MDX_CODEX_SESSION_DIRS", session_dirs);
        Self {
            _lock: lock,
            home,
            userprofile,
            codex_session_dirs,
        }
    }
}

impl Drop for MemoryCodexCaptureEnvGuard {
    fn drop(&mut self) {
        if let Some(value) = self.home.take() {
            std::env::set_var("HOME", value);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(value) = self.userprofile.take() {
            std::env::set_var("USERPROFILE", value);
        } else {
            std::env::remove_var("USERPROFILE");
        }
        if let Some(value) = self.codex_session_dirs.take() {
            std::env::set_var("MDX_CODEX_SESSION_DIRS", value);
        } else {
            std::env::remove_var("MDX_CODEX_SESSION_DIRS");
        }
    }
}

#[test]
fn capture_scan_codex_discovers_jsonl_transcripts_from_configured_dirs() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let sessions = tempdir().unwrap();
    let nested = sessions.path().join("zz/2026/06/14");
    std::fs::create_dir_all(&nested).unwrap();
    let older_path = sessions.path().join("rollout-2026-06-13.jsonl");
    let newer_path = nested.join("rollout-2026-06-14.jsonl");
    std::fs::write(
        &older_path,
        r#"{"type":"session_meta","payload":{"id":"older-session-id","timestamp":"2026-06-13T10:00:00Z"}}"#,
    )
    .unwrap();
    std::fs::write(
        &newer_path,
        r#"{"type":"session_meta","payload":{"id":"newer-session-id","timestamp":"2026-06-14T10:00:00Z"}}"#,
    )
    .unwrap();

    let _guard =
        MemoryCodexCaptureEnvGuard::use_home_and_session_dirs(home.path(), sessions.path());
    let result = memory_capture_scan(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureScanRequest {
            source: "codex".to_string(),
        },
    )
    .unwrap();

    assert_eq!(result.source, "codex");
    assert_eq!(result.status, "configured");
    assert_eq!(result.paths.len(), 2);
    assert_eq!(result.candidates.len(), 2);
    assert_eq!(
        result.paths,
        vec![
            canonical_test_path(&newer_path),
            canonical_test_path(&older_path)
        ]
    );
    assert_eq!(result.paths[0], result.candidates[0].path);
    assert_eq!(result.candidates[0].source, "codex");
    assert_eq!(
        result.candidates[0].thread_id.as_deref(),
        Some("codex:newer-session-id")
    );
    assert_eq!(
        result.candidates[0].title.as_deref(),
        Some("Codex session newer-se")
    );
    assert_eq!(
        result.candidates[0].started_at.as_deref(),
        Some("2026-06-14T10:00:00Z")
    );
    assert!(result.candidates[0].modified_at.is_some());
    assert!(result.candidates[0].bytes > 0);
}

#[test]
fn capture_scan_codex_ignores_non_jsonl_and_auth_files() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let sessions = tempdir().unwrap();
    let transcript_path = sessions.path().join("rollout-keep.jsonl");
    let ignored_paths = [
        sessions.path().join("auth.jsonl"),
        sessions.path().join("rollout-ignore.json"),
        sessions.path().join("config.json"),
        sessions.path().join("not-rollout.jsonl"),
    ];
    std::fs::write(
        &transcript_path,
        r#"{"type":"session_meta","payload":{"id":"keep-session","timestamp":"2026-06-14T10:00:00Z"}}"#,
    )
    .unwrap();
    for path in ignored_paths {
        std::fs::write(path, "{}").unwrap();
    }

    let _guard =
        MemoryCodexCaptureEnvGuard::use_home_and_session_dirs(home.path(), sessions.path());
    let result = memory_capture_scan(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureScanRequest {
            source: "codex".to_string(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "configured");
    assert_eq!(result.paths, vec![canonical_test_path(&transcript_path)]);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(
        result.candidates[0].thread_id.as_deref(),
        Some("codex:keep-session")
    );
}

#[test]
fn capture_scan_codex_dedupes_configured_and_default_dirs() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let sessions = home.path().join(".codex/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    let transcript_path = sessions.join("rollout-duplicate-dir.jsonl");
    std::fs::write(
        &transcript_path,
        r#"{"type":"session_meta","payload":{"id":"dedupe-session","timestamp":"2026-06-14T10:00:00Z"}}"#,
    )
    .unwrap();

    let _guard = MemoryCodexCaptureEnvGuard::use_home_and_session_dirs(home.path(), &sessions);
    let result = memory_capture_scan(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureScanRequest {
            source: "codex".to_string(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "configured");
    assert_eq!(result.paths.len(), 1);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.paths[0], canonical_test_path(&transcript_path));
    assert_eq!(
        result.candidates[0].thread_id.as_deref(),
        Some("codex:dedupe-session")
    );
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
fn distill_prompt_requests_json_array_and_includes_thread_body() {
    let messages = crate::memory_distill::build_distill_messages_for_test(
        "Auth thread",
        "## Message 1 — user\n\nRemember JWT TTL.",
    );

    assert_eq!(messages[0].role, "system");
    assert!(messages[0].content.contains("Return only a JSON array"));
    assert_eq!(messages[1].role, "user");
    assert!(messages[1].content.contains("Auth thread"));
    assert!(messages[1].content.contains("Remember JWT TTL."));
}

#[test]
fn distill_extracts_json_array_from_fenced_output() {
    let json = crate::memory_distill::extract_json_array_for_test(
        "```json\n[{\"title\":\"A\",\"body\":\"B\",\"tags\":[],\"importance\":0.5,\"confidence\":0.8,\"source_message_refs\":[1]}]\n```",
    )
    .unwrap();

    let candidates = crate::memory_distill::parse_distill_candidates_for_test(&json).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].title, "A");
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
    assert_eq!(body["can_initialize"], false);
    assert_eq!(body["mode"], "memory");
    assert_eq!(body["missing_paths"].as_array().unwrap().len(), 0);
    assert_eq!(
        body["workspace"],
        root.path().to_string_lossy().into_owned()
    );
}

#[test]
fn diagnostics_reports_queue_spool_projection_and_recent_errors() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "GET",
        "/diagnostics",
        "",
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert!(json["result"]["queue"]["depth"].is_number());
    assert!(json["result"]["spool"]["pending"].is_number());
    assert!(json["result"]["projection"]["dirty_count"].is_number());
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
fn daemon_hook_event_captures_and_returns_recall_context() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.agent_backend.capture_enabled = true;
    config.agents.codex.enabled = true;
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Hook recall sentinel".to_string(),
            body: "Use hook recall sentinel context for submitted prompts through the daemon."
                .to_string(),
            tags: vec!["hook".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "session-1",
        "turn_id": "turn-1",
        "event_seq": 1,
        "idempotency_key": "codex:session-1:turn-1:UserPromptSubmit:1",
        "raw_payload": {
            "prompt": "Please use hook recall sentinel context."
        },
        "deadline_ms": 400
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], true);
    assert_eq!(json["disabled_reason"], serde_json::Value::Null);
    assert!(
        json["additional_context"]
            .as_str()
            .unwrap()
            .contains("Hook recall sentinel"),
        "{}",
        response.body
    );
    assert!(json["warnings"].as_array().is_some());

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    assert_eq!(storage.count_events().unwrap(), 1);
}

#[test]
fn daemon_hook_event_hard_disabled_does_not_spool_or_capture() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.memory.enabled = false;
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "session-1",
        "turn_id": "turn-1",
        "event_seq": 1,
        "idempotency_key": "codex:session-1:turn-1:UserPromptSubmit:1",
        "raw_payload": {
            "prompt": "This hook must not be persisted."
        },
        "deadline_ms": 400
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], false);
    assert_eq!(json["disabled_reason"], "memory_disabled");
    assert_eq!(json["additional_context"], "");
    assert_eq!(json["warnings"], serde_json::json!(["memory_disabled"]));
    assert!(!root.path().join(".mdx/memory.sqlite").exists());
    assert!(!root.path().join(".mdx/memory-spool").exists());
}

#[test]
fn daemon_hook_event_recall_injection_disabled_captures_without_context() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.agent_backend.capture_enabled = true;
    config.agent_backend.recall_injection_enabled = false;
    config.agents.codex.enabled = true;
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Disabled recall injection sentinel".to_string(),
            body: "Disabled recall injection sentinel must not be injected.".to_string(),
            tags: vec!["hook".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "session-1",
        "turn_id": "turn-1",
        "event_seq": 1,
        "idempotency_key": "codex:session-1:turn-1:UserPromptSubmit:recall-disabled",
        "raw_payload": {
            "prompt": "Disabled recall injection sentinel"
        },
        "deadline_ms": 400
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], true);
    assert_eq!(json["disabled_reason"], serde_json::Value::Null);
    assert_eq!(json["additional_context"], "");
    assert_eq!(
        json["warnings"],
        serde_json::json!(["recall_injection_disabled"])
    );

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    assert_eq!(storage.count_events().unwrap(), 1);
}

#[test]
fn daemon_hook_event_config_error_degrades_to_success_response() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(root.path().join(".mdx/memory-config.json"), "{not-json").unwrap();
    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "session-1",
        "turn_id": "turn-1",
        "event_seq": 1,
        "idempotency_key": "codex:session-1:turn-1:UserPromptSubmit:config-error",
        "raw_payload": {
            "prompt": "config errors must not block hooks"
        },
        "deadline_ms": 400
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], false);
    assert_eq!(json["disabled_reason"], serde_json::Value::Null);
    assert_eq!(json["additional_context"], "");
    assert_eq!(json["warnings"], serde_json::json!(["json_decode_failed"]));
    assert!(!root.path().join(".mdx/memory.sqlite").exists());
}

#[test]
fn daemon_hook_event_storage_error_degrades_to_success_response() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.agent_backend.capture_enabled = true;
    config.agents.codex.enabled = true;
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    std::fs::create_dir(root.path().join(".mdx/memory.sqlite")).unwrap();
    let body = serde_json::json!({
        "agent_source": "codex",
        "event_name": "UserPromptSubmit",
        "workspace_root": root.path().to_string_lossy(),
        "cwd": root.path().to_string_lossy(),
        "session_id": "session-1",
        "turn_id": "turn-1",
        "event_seq": 1,
        "idempotency_key": "codex:session-1:turn-1:UserPromptSubmit:storage-error",
        "raw_payload": {
            "prompt": "storage errors must not block hooks"
        },
        "deadline_ms": 400
    })
    .to_string();

    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/hook/events",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let json: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["captured"], false);
    assert_eq!(json["disabled_reason"], serde_json::Value::Null);
    assert_eq!(json["additional_context"], "");
    assert_eq!(
        json["warnings"],
        serde_json::json!(["memory_db_path_invalid"])
    );
}

#[test]
fn config_set_disables_capture_without_deleting_history() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let body = serde_json::json!({
        "scope": "workspace",
        "key": "agent_backend.capture_enabled",
        "enabled": false
    })
    .to_string();
    let response = crate::memory_daemon::dispatch_for_test(
        root.path().to_string_lossy().into_owned(),
        "POST",
        "/config/set",
        &body,
    )
    .unwrap();

    assert_eq!(response.status, 200);
    let config = crate::memory::load_memory_config_for_root(root.path()).unwrap();
    assert!(!config.agent_backend.capture_enabled);
    assert!(root.path().join("memory").exists());
}

#[test]
fn daemon_dispatch_exposes_complete_memory_routes() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let routes = [
        ("GET", "/memory/status", ""),
        ("GET", "/memory/working", ""),
        ("GET", "/memory/index/status", ""),
        ("POST", "/memory/index/rebuild", ""),
        (
            "POST",
            "/memory/inbox/list",
            r#"{"include_reviewed":false}"#,
        ),
        (
            "POST",
            "/memory/distill",
            r#"{"target":"missing-thread","accept":false,"force":false}"#,
        ),
        (
            "POST",
            "/memory/promote",
            r#"{"target":"missing-memory","ingest":false,"title":null}"#,
        ),
        ("POST", "/memory/capture/scan", r#"{"source":"codex"}"#),
        ("GET", "/diagnostics", ""),
        (
            "POST",
            "/config/set",
            r#"{"scope":"workspace","key":"agent_backend.capture_enabled","enabled":false}"#,
        ),
    ];

    for (method, path, body) in routes {
        let response = crate::memory_daemon::dispatch_for_test(
            root.path().to_string_lossy().into_owned(),
            method,
            path,
            body,
        )
        .unwrap();
        assert_ne!(response.status, 404, "{method} {path}");
    }
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
fn sqlite_storage_initializes_schema_version_and_core_tables() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");

    assert_eq!(
        storage.schema_version().unwrap(),
        crate::memory_schema::MEMORY_SCHEMA_VERSION
    );
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
        assert!(
            storage.table_exists(table).unwrap(),
            "missing table {table}"
        );
    }
}

#[test]
#[ignore]
fn memory_postgres_storage_initializes_schema_version() {
    let url = std::env::var("MDX_MEMORY_POSTGRES_TEST_URL")
        .expect("MDX_MEMORY_POSTGRES_TEST_URL is required for this ignored test");
    let mut storage = crate::memory_storage_postgres::PostgresMemoryStorage::connect(&url)
        .expect("connect postgres storage");
    storage.initialize().expect("initialize postgres schema");
    assert_eq!(
        storage.schema_version().unwrap(),
        crate::memory_schema::MEMORY_SCHEMA_VERSION
    );
}

#[test]
fn sqlite_event_idempotency_only_ignores_idempotency_key_conflict() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");

    let event = |event_id: &str, idempotency_key: &str| crate::memory_storage::StoredAgentEvent {
        event_id: event_id.to_string(),
        session_pk: "session-pk-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_source: "codex".to_string(),
        event_name: "UserPromptSubmit".to_string(),
        turn_id: Some("turn-1".to_string()),
        event_seq: Some(1),
        idempotency_key: idempotency_key.to_string(),
        raw_payload: serde_json::json!({"prompt":"hello"}),
        payload_hash: "hash-1".to_string(),
        created_at: "2026-06-14T10:00:00Z".to_string(),
    };

    assert!(storage
        .insert_event_idempotent(&event("event-1", "idem-1"))
        .unwrap());
    assert!(!storage
        .insert_event_idempotent(&event("event-2", "idem-1"))
        .unwrap());
    assert!(storage
        .insert_event_idempotent(&event("event-1", "idem-2"))
        .is_err());
    assert_eq!(storage.count_events().unwrap(), 1);
}

#[test]
fn sqlite_job_idempotency_only_ignores_idempotency_key_conflict() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");

    let job = |job_id: &str, idempotency_key: &str| crate::memory_storage::StoredJob {
        job_id: job_id.to_string(),
        workspace_id: "workspace-1".to_string(),
        kind: "memory.distill".to_string(),
        status: "queued".to_string(),
        idempotency_key: idempotency_key.to_string(),
        payload: serde_json::json!({"session_pk":"session-pk-1","range_hash":"range-1"}),
        attempts: 0,
        next_run_at: "2026-06-14T10:00:00Z".to_string(),
        created_at: "2026-06-14T10:00:00Z".to_string(),
        updated_at: "2026-06-14T10:00:00Z".to_string(),
        last_error: None,
    };

    assert!(storage
        .enqueue_job_idempotent(&job("job-1", "idem-1"))
        .unwrap());
    assert!(!storage
        .enqueue_job_idempotent(&job("job-2", "idem-1"))
        .unwrap());
    assert!(storage
        .enqueue_job_idempotent(&job("job-1", "idem-2"))
        .is_err());
}

#[test]
fn sqlite_job_enqueue_rejects_invalid_rfc3339_timestamps() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");

    let result = storage.enqueue_job_idempotent(&crate::memory_storage::StoredJob {
        job_id: "job-invalid-time".to_string(),
        workspace_id: "workspace-1".to_string(),
        kind: "memory.distill".to_string(),
        status: "queued".to_string(),
        idempotency_key: "idem-invalid-time".to_string(),
        payload: serde_json::json!({"session_pk":"session-pk-1","range_hash":"range-1"}),
        attempts: 0,
        next_run_at: "2026-06-14 10:00:00".to_string(),
        created_at: "2026-06-14T10:00:00Z".to_string(),
        updated_at: "2026-06-14T10:00:00Z".to_string(),
        last_error: None,
    });

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().error_code(),
        "memory_job_timestamp_invalid"
    );
}

#[cfg(unix)]
#[test]
fn sqlite_storage_rejects_symlink_database_path() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    std::os::unix::fs::symlink(
        root.path().join("target.sqlite"),
        root.path().join(".mdx/memory.sqlite"),
    )
    .unwrap();

    let result = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path());
    assert!(result.is_err());
    assert_eq!(result.err().unwrap().error_code(), "memory_db_path_invalid");
}

#[test]
fn sqlite_session_upsert_preserves_session_timestamps() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");
    storage
        .upsert_session(&crate::memory_storage::StoredAgentSession {
            session_pk: "session-pk-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_source: "codex".to_string(),
            session_id: "session-1".to_string(),
            project_key: "project-1".to_string(),
            cwd: Some(root.path().to_string_lossy().into_owned()),
            model: Some("gpt-5".to_string()),
            started_at: "2026-06-14T10:00:00Z".to_string(),
            ended_at: Some("2026-06-14T10:05:00Z".to_string()),
            message_count: Some(2),
            event_count: 1,
            status: "ended".to_string(),
        })
        .unwrap();

    let timestamps = storage
        .session_timestamps_for_test("codex", "session-1")
        .unwrap()
        .unwrap();
    assert_eq!(timestamps.0, "2026-06-14T10:00:00Z");
    assert_eq!(timestamps.1.as_deref(), Some("2026-06-14T10:05:00Z"));
}

#[test]
fn sqlite_session_upsert_preserves_known_message_count_when_incoming_unknown() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");
    let mut session = crate::memory_storage::StoredAgentSession {
        session_pk: "session-pk-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_source: "codex".to_string(),
        session_id: "session-1".to_string(),
        project_key: "project-1".to_string(),
        cwd: Some(root.path().to_string_lossy().into_owned()),
        model: Some("gpt-5".to_string()),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        ended_at: None,
        message_count: Some(7),
        event_count: 3,
        status: "active".to_string(),
    };
    storage.upsert_session(&session).unwrap();

    session.message_count = None;
    session.event_count = 0;
    storage.upsert_session(&session).unwrap();

    let stored = storage
        .get_session_by_agent_id("codex", "session-1")
        .unwrap()
        .unwrap();
    assert_eq!(stored.message_count, Some(7));
    assert_eq!(stored.event_count, 3);
}

#[test]
fn sqlite_insert_event_increments_existing_session_count_only_on_insert() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path())
            .expect("open sqlite storage");
    storage.initialize().expect("initialize schema");
    storage
        .upsert_session(&crate::memory_storage::StoredAgentSession {
            session_pk: "session-pk-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_source: "codex".to_string(),
            session_id: "session-1".to_string(),
            project_key: "project-1".to_string(),
            cwd: None,
            model: None,
            started_at: "2026-06-14T10:00:00Z".to_string(),
            ended_at: None,
            message_count: None,
            event_count: 0,
            status: "active".to_string(),
        })
        .unwrap();
    let event = crate::memory_storage::StoredAgentEvent {
        event_id: "event-1".to_string(),
        session_pk: "session-pk-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_source: "codex".to_string(),
        event_name: "UserPromptSubmit".to_string(),
        turn_id: Some("turn-1".to_string()),
        event_seq: Some(1),
        idempotency_key: "idem-1".to_string(),
        raw_payload: serde_json::json!({"prompt":"hello"}),
        payload_hash: "hash-1".to_string(),
        created_at: "2026-06-14T10:00:00Z".to_string(),
    };

    assert!(storage.insert_event_idempotent(&event).unwrap());
    assert!(!storage.insert_event_idempotent(&event).unwrap());

    let stored = storage
        .get_session_by_agent_id("codex", "session-1")
        .unwrap()
        .unwrap();
    assert_eq!(stored.event_count, 1);
}

#[test]
fn agent_event_capture_is_idempotent_and_preserves_unknown_message_count() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
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
    let session = storage
        .get_session_by_agent_id("codex", "session-1")
        .unwrap()
        .unwrap();
    assert_eq!(session.message_count, None);
    assert_eq!(session.event_count, 1);
}

#[test]
fn codex_user_prompt_submit_hook_formats_additional_context() {
    let output = crate::memory_hooks::format_hook_output(
        "codex",
        "UserPromptSubmit",
        Some("Memory context\n- Keep Memory as agent backend."),
    )
    .unwrap();

    let json: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(
        json["hookSpecificOutput"]["hookEventName"],
        "UserPromptSubmit"
    );
    assert_eq!(
        json["hookSpecificOutput"]["additionalContext"],
        "Memory context\n- Keep Memory as agent backend."
    );
}

#[test]
fn disabled_hook_returns_empty_success_output() {
    let output = crate::memory_hooks::format_hook_output("codex", "Stop", None).unwrap();
    assert_eq!(output, "");
}

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
    )
    .unwrap();

    assert_eq!(event.agent_source, "codex");
    assert_eq!(event.event_name, "UserPromptSubmit");
    assert_eq!(event.session_id, "codex-session");
    assert_eq!(event.turn_id.as_deref(), Some("turn-9"));
    assert!(event
        .idempotency_key
        .contains("codex:codex-session:UserPromptSubmit"));
}

#[test]
fn normalizes_hook_payload_aliases_and_trims_empty_fields() {
    let payload = serde_json::json!({
        "session_id": "   ",
        "conversationId": " claude-session ",
        "turnId": " turn-10 ",
        "workspaceRoot": "  ",
        "workspace_roots": [" /tmp/alias-project "],
        "eventSeq": 42
    });

    let event = crate::memory_hooks::normalize_hook_payload(
        "claude",
        "UserPromptSubmit",
        "/tmp/project",
        &payload,
        Some(250),
    )
    .unwrap();

    assert_eq!(event.session_id, "claude-session");
    assert_eq!(event.turn_id.as_deref(), Some("turn-10"));
    assert_eq!(event.cwd.as_deref(), Some("/tmp/alias-project"));
    assert_eq!(event.event_seq, Some(42));
    assert_eq!(event.deadline_ms, Some(250));
}

#[test]
fn hook_idempotency_key_is_stable_for_reordered_payload_keys() {
    let first = serde_json::json!({
        "session_id": "codex-session",
        "turn_id": "turn-1",
        "prompt": "remember this"
    });
    let second = serde_json::json!({
        "prompt": "remember this",
        "turn_id": "turn-1",
        "session_id": "codex-session"
    });

    let first_event = crate::memory_hooks::normalize_hook_payload(
        "codex",
        "UserPromptSubmit",
        "/tmp/project",
        &first,
        None,
    )
    .unwrap();
    let second_event = crate::memory_hooks::normalize_hook_payload(
        "codex",
        "UserPromptSubmit",
        "/tmp/project",
        &second,
        None,
    )
    .unwrap();

    assert_eq!(first_event.idempotency_key, second_event.idempotency_key);
}

#[test]
fn hook_fixture_smoke_captures_codex_claude_cursor_events() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    for (agent, event, fixture) in [
        (
            "codex",
            "UserPromptSubmit",
            include_str!("../tests/fixtures/memory-hooks/codex-user-prompt.json"),
        ),
        (
            "claude",
            "Stop",
            include_str!("../tests/fixtures/memory-hooks/claude-stop.json"),
        ),
        (
            "cursor",
            "Stop",
            include_str!("../tests/fixtures/memory-hooks/cursor-stop.json"),
        ),
    ] {
        let payload: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let normalized = crate::memory_hooks::normalize_hook_payload(
            agent,
            event,
            &root.path().to_string_lossy(),
            &payload,
            Some(400),
        )
        .unwrap();
        assert_eq!(normalized.agent_source, agent);
        assert_eq!(normalized.event_name, event);
    }
}

#[test]
fn unsupported_hook_event_returns_empty_even_with_context() {
    let output = crate::memory_hooks::format_hook_output(
        "codex",
        "Stop",
        Some("Do not inject this into Stop."),
    )
    .unwrap();

    assert_eq!(output, "");
}

#[test]
fn claude_supported_hook_outputs_plain_context() {
    let output = crate::memory_hooks::format_hook_output(
        "claude",
        "UserPromptSubmit",
        Some("Memory context"),
    )
    .unwrap();

    assert_eq!(output, "Memory context");
}

#[cfg(unix)]
#[test]
fn spool_write_rejects_symlink_spool_directory() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let target = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(target.path(), root.path().join(".mdx/memory-spool")).unwrap();

    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: "codex".to_string(),
        event_name: "UserPromptSubmit".to_string(),
        workspace_root: root.path().to_string_lossy().into_owned(),
        cwd: None,
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        event_seq: Some(1),
        idempotency_key: "codex:session-1:turn-1:UserPromptSubmit:1".to_string(),
        raw_payload: serde_json::json!({"prompt":"hello"}),
        deadline_ms: None,
    };

    let result = crate::memory_spool::write_spool_event(root.path(), &event);

    assert!(result.is_err());
    assert_eq!(result.err().unwrap().error_code(), "spool_dir_invalid");
}

#[cfg(unix)]
#[test]
fn spool_write_and_import_reject_symlink_mdx_parent() {
    let root = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(target.path(), root.path().join(".mdx")).unwrap();

    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: "codex".to_string(),
        event_name: "UserPromptSubmit".to_string(),
        workspace_root: root.path().to_string_lossy().into_owned(),
        cwd: None,
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        event_seq: Some(1),
        idempotency_key: "codex:session-1:turn-1:UserPromptSubmit:1".to_string(),
        raw_payload: serde_json::json!({"prompt":"hello"}),
        deadline_ms: None,
    };

    let write_result = crate::memory_spool::write_spool_event(root.path(), &event);
    assert!(write_result.is_err());
    assert_eq!(
        write_result.err().unwrap().error_code(),
        "spool_parent_dir_invalid"
    );

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(target.path()).unwrap();
    storage.initialize().unwrap();
    let import_result = crate::memory_spool::import_spool(root.path(), &mut storage);
    assert!(import_result.is_err());
    assert_eq!(
        import_result.err().unwrap().error_code(),
        "spool_dir_invalid"
    );
}

#[test]
fn spool_import_ignores_inflight_temp_files() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let spool_dir = root.path().join(".mdx/memory-spool");
    std::fs::create_dir_all(&spool_dir).unwrap();
    std::fs::write(spool_dir.join(".event.json.123.tmp"), b"{not json").unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let report = crate::memory_spool::import_spool(root.path(), &mut storage).unwrap();

    assert_eq!(report.imported, 0);
    assert_eq!(report.skipped_duplicates, 0);
    assert_eq!(report.quarantined, 0);
    assert!(spool_dir.join(".event.json.123.tmp").exists());
}

#[cfg(unix)]
#[test]
fn spool_import_rejects_symlink_quarantine_directory() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let spool_dir = root.path().join(".mdx/memory-spool");
    std::fs::create_dir_all(&spool_dir).unwrap();
    std::fs::write(spool_dir.join("bad.json"), b"{not json").unwrap();
    let target = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(
        target.path(),
        root.path().join(".mdx/memory-spool-quarantine"),
    )
    .unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let result = crate::memory_spool::import_spool(root.path(), &mut storage);

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().error_code(),
        "spool_quarantine_dir_invalid"
    );
}

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

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let report = crate::memory_spool::import_spool(root.path(), &mut storage).unwrap();

    assert_eq!(report.imported, 1);
    assert_eq!(report.skipped_duplicates, 0);
    assert_eq!(storage.count_events().unwrap(), 1);

    crate::memory_spool::write_spool_event(root.path(), &event).unwrap();
    let duplicate_report = crate::memory_spool::import_spool(root.path(), &mut storage).unwrap();

    assert_eq!(duplicate_report.imported, 0);
    assert_eq!(duplicate_report.skipped_duplicates, 1);
    assert_eq!(storage.count_events().unwrap(), 1);
}

#[test]
fn queue_distill_for_session_is_idempotent_and_lists_ready_jobs() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    assert!(crate::memory_queue::enqueue_distill_for_session(
        &mut storage,
        "workspace-1",
        "session-pk-1",
        "range-hash-1"
    )
    .unwrap());
    assert!(!crate::memory_queue::enqueue_distill_for_session(
        &mut storage,
        "workspace-1",
        "session-pk-1",
        "range-hash-1"
    )
    .unwrap());

    let jobs = storage.list_ready_jobs(10).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].kind, "memory.distill");
    assert_eq!(jobs[0].status, "queued");
    assert_eq!(jobs[0].idempotency_key, "distill:session-pk-1:range-hash-1");
}

#[test]
fn sqlite_ready_jobs_use_time_comparison_not_string_comparison() {
    let root = tempfile::tempdir().unwrap();
    crate::memory::initialize_memory_workspace(root.path()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();

    storage
        .enqueue_job_idempotent(&crate::memory_storage::StoredJob {
            job_id: "job-ready".to_string(),
            workspace_id: "workspace-1".to_string(),
            kind: "memory.distill".to_string(),
            status: "queued".to_string(),
            idempotency_key: "ready-without-fraction".to_string(),
            payload: serde_json::json!({"session_pk":"session-pk-1","range_hash":"range-1"}),
            attempts: 0,
            next_run_at: "2026-06-14T10:00:00Z".to_string(),
            created_at: "2026-06-14T10:00:00Z".to_string(),
            updated_at: "2026-06-14T10:00:00Z".to_string(),
            last_error: None,
        })
        .unwrap();

    let jobs = storage.list_ready_jobs(10).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].job_id, "job-ready");
}

#[test]
fn partial_memory_config_deserialization_uses_nested_defaults() {
    let config: crate::memory_models::MemoryConfig = serde_json::from_str(
        r#"{
  "version": 2,
  "agent_backend": { "capture_enabled": true },
  "agents": { "claude": { "enabled": true } },
  "provider": { "model": "gpt-4.1-mini" }
}
"#,
    )
    .unwrap();

    assert!(config.agent_backend.capture_enabled);
    assert!(config.agent_backend.enabled);
    assert!(config.agent_backend.recall_injection_enabled);
    assert!(config.agent_backend.distill_enabled);
    assert!(!config.agent_backend.auto_accept);
    assert_eq!(config.agent_backend.context_byte_budget, 4096);
    assert!(config.agents.claude.enabled);
    assert!(!config.agents.claude.paused);
    assert!(!config.agents.codex.enabled);
    assert!(!config.agents.cursor.enabled);
    assert_eq!(config.provider.mode, "reuse_llm");
    assert_eq!(config.provider.model.as_deref(), Some("gpt-4.1-mini"));

    let config: crate::memory_models::MemoryConfig = serde_json::from_str(
        r#"{
  "version": 2,
  "recall": { "embeddings": {} }
}
"#,
    )
    .unwrap();

    assert!(!config.recall.embeddings.enabled);
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

#[test]
fn claude_code_source_uses_claude_agent_shutdown() {
    let mut config = crate::memory::default_memory_config();
    config.agent_backend.capture_enabled = true;

    let resolved = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::Capture,
        Some("claude-code"),
    );

    assert!(!resolved.enabled);
    assert_eq!(resolved.reason.as_deref(), Some("claude_disabled"));
}

#[test]
fn recall_injection_disabled_allows_capture_without_enqueue() {
    let mut config = crate::memory::default_memory_config();
    config.agent_backend.recall_injection_enabled = false;

    let resolved = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::RecallInjection,
        None,
    );

    assert!(!resolved.enabled);
    assert_eq!(
        resolved.reason.as_deref(),
        Some("recall_injection_disabled")
    );
    assert!(resolved.allow_db_write);
    assert!(resolved.allow_spool_write);
    assert!(!resolved.allow_enqueue);
    assert!(resolved.allow_projection);
}

#[test]
fn memory_export_writes_manifest_and_import_dry_run_reports_records() {
    let root = tempdir().unwrap();
    let target = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Bundle memory".to_string(),
            body: "Export this memory.".to_string(),
            tags: vec!["bundle".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.5),
            confidence: Some(0.8),
        },
    )
    .unwrap();

    let bundle_path = root.path().join("memory-bundle");
    let export = crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle_path.to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();
    assert!(std::path::Path::new(&export.manifest_path).is_file());

    let dry_run = crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle_path.to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: true,
        },
    )
    .unwrap();
    assert_eq!(dry_run.records_seen, 1);
    assert_eq!(dry_run.records_imported, 0);
    let target_records = memory_list(
        target.path().to_string_lossy().into_owned(),
        MemoryListFilter {
            tag: None,
            since: None,
            include_archived: true,
        },
    )
    .unwrap();
    assert_eq!(target_records.len(), 0);
}

#[test]
fn memory_export_respects_workspace_lock() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let _lock = try_acquire_memory_lock(root.path()).unwrap();

    let error = crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: root
                .path()
                .join("memory-bundle")
                .to_string_lossy()
                .into_owned(),
            include_log: false,
        },
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "memory_lock_busy");
}

#[test]
fn memory_bundle_import_rebuilds_thread_index() {
    let root = tempdir().unwrap();
    let target = tempdir().unwrap();
    let bundle = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("manual:bundle-thread".to_string()),
            title: "Bundle thread".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: vec!["bundle".to_string()],
        },
    )
    .unwrap();
    crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle.path().to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();

    crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle.path().to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: false,
        },
    )
    .unwrap();

    let threads = memory_thread_list(
        target.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: Some("manual".to_string()),
            since: None,
        },
    )
    .unwrap();

    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].thread_id, "manual:bundle-thread");
    assert_eq!(threads[0].title, "Bundle thread");
}

#[test]
fn memory_bundle_skip_import_copies_missing_records_once() {
    let root = tempdir().unwrap();
    let target = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Skip bundle memory".to_string(),
            body: "Import this memory once.".to_string(),
            tags: vec!["bundle".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.5),
            confidence: Some(0.8),
        },
    )
    .unwrap();
    let bundle_path = root.path().join("memory-bundle");
    crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle_path.to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();

    let imported = crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle_path.to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: false,
        },
    )
    .unwrap();
    assert_eq!(imported.records_imported, 1);
    assert_eq!(imported.records_skipped, 0);
    let target_records = memory_list(
        target.path().to_string_lossy().into_owned(),
        MemoryListFilter {
            tag: None,
            since: None,
            include_archived: true,
        },
    )
    .unwrap();
    assert_eq!(target_records.len(), 1);

    let skipped = crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle_path.to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: false,
        },
    )
    .unwrap();
    assert_eq!(skipped.records_imported, 0);
    assert_eq!(skipped.records_skipped, 1);
}

#[test]
fn memory_bundle_import_rejects_manifest_path_traversal() {
    let root = tempdir().unwrap();
    let target = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Traversal bundle memory".to_string(),
            body: "Export this memory.".to_string(),
            tags: vec!["bundle".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.5),
            confidence: Some(0.8),
        },
    )
    .unwrap();
    let bundle_path = root.path().join("memory-bundle");
    crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle_path.to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();
    let manifest_path = bundle_path.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&manifest_path).unwrap()).unwrap();
    manifest["files"] = serde_json::json!(["../evil.md"]);
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let error = crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle_path.to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: true,
        },
    )
    .unwrap_err();
    assert!(format!("{error}").starts_with("invalid_bundle_path:"));
}

#[cfg(unix)]
#[test]
fn memory_bundle_export_skips_symlinked_directory_to_outside_file() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(outside.path().join("outside.md"), "outside secret").unwrap();
    symlink(
        outside.path(),
        root.path().join("memory/memories/linked-outside"),
    )
    .unwrap();

    let bundle_path = root.path().join("memory-bundle");
    let export = crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle_path.to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();

    assert!(!export
        .copied_paths
        .iter()
        .any(|path| path.contains("linked-outside")));
    assert!(!bundle_path
        .join("memory/memories/linked-outside/outside.md")
        .exists());
}

#[cfg(unix)]
#[test]
fn memory_bundle_import_skips_dangling_target_symlink_without_external_write() {
    use std::os::unix::fs::symlink;

    let source = tempdir().unwrap();
    let target = tempdir().unwrap();
    let outside = tempdir().unwrap();
    memory_initialize_workspace(source.path().to_string_lossy().into_owned()).unwrap();
    memory_initialize_workspace(target.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        source.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Imported".to_string(),
            body: "Should not write through symlink.".to_string(),
            tags: vec!["bundle".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.5),
            confidence: Some(0.8),
        },
    )
    .unwrap();
    let bundle_path = source.path().join("memory-bundle");
    let export = crate::memory::memory_export_bundle(
        source.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: bundle_path.to_string_lossy().into_owned(),
            include_log: false,
        },
    )
    .unwrap();
    let imported_path = export
        .copied_paths
        .iter()
        .find(|path| path.starts_with("memory/memories/"))
        .unwrap()
        .clone();
    let outside_target = outside.path().join("dangling.md");
    symlink(&outside_target, target.path().join(&imported_path)).unwrap();

    let import = crate::memory::memory_import_bundle(
        target.path().to_string_lossy().into_owned(),
        crate::memory::MemoryImportRequest {
            input_path: bundle_path.to_string_lossy().into_owned(),
            strategy: "skip".to_string(),
            dry_run: false,
        },
    )
    .unwrap();

    assert_eq!(import.records_imported, 0);
    assert_eq!(import.records_skipped, 1);
    assert!(!outside_target.exists());
    assert!(std::fs::symlink_metadata(target.path().join(imported_path))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn memory_bundle_export_rejects_output_under_memory_source_dirs() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let error = crate::memory::memory_export_bundle(
        root.path().to_string_lossy().into_owned(),
        crate::memory::MemoryExportRequest {
            output_path: root
                .path()
                .join("memory/memories/bundle")
                .to_string_lossy()
                .into_owned(),
            include_log: false,
        },
    )
    .unwrap_err();

    assert!(format!("{error}").starts_with("invalid_bundle_output:"));
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
    assert!(thread.body.contains("## Conversation"));
    assert!(thread
        .body
        .contains("user:\n\nRemember that MDX memory supports Codex."));
    assert!(thread.body.contains("MDX memory supports Codex"));
}

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
    let conversation_index = thread.body.find("## Conversation").unwrap();
    let raw_index = thread.body.find("## Raw Codex JSONL").unwrap();
    assert!(conversation_index < raw_index);
    assert!(thread
        .body
        .contains("user:\n\nPlease preserve this real Codex user text."));
    assert!(thread
        .body
        .contains("assistant:\n\nI will preserve the complete raw Codex JSONL source."));
    assert!(thread.body.contains("## Raw Codex JSONL\n\n```jsonl\n"));
    assert!(thread
        .body
        .contains("Please preserve this real Codex user text."));
    assert!(thread
        .body
        .contains("I will preserve the complete raw Codex JSONL source."));
    assert!(thread.body.contains("## Raw Codex JSONL"));
    assert!(thread.body.contains(
        r#""type":"session_meta","payload":{"id":"019ec385-5b76-7211-aa11-91e3d028f79f""#
    ));
    assert!(thread
        .body
        .contains(r#""type":"event_msg","payload":{"message":"session configured""#));
}

#[test]
fn capture_imports_codex_jsonl_with_backticks_without_inflating_message_count() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();

    let result = memory_capture_import(
        root.path().to_string_lossy().into_owned(),
        MemoryCaptureImportRequest {
            source: "codex".to_string(),
            path: memory_fixture_path("codex-fenced-raw-session.jsonl"),
            title: None,
            thread_id: None,
            distill: false,
        },
    )
    .unwrap();

    assert_eq!(result.message_count, 2);

    let thread =
        memory_thread_get(root.path().to_string_lossy().into_owned(), result.thread_id).unwrap();
    let conversation_index = thread.body.find("## Conversation").unwrap();
    let raw_index = thread.body.find("## Raw Codex JSONL").unwrap();
    assert!(conversation_index < raw_index);
    assert!(thread.body.contains("## Raw Codex JSONL\n\n````jsonl\n"));
    assert!(thread.body.contains("````jsonl"));
    assert!(thread.body.contains("``` and ## Message fake heading"));
    assert_eq!(thread.frontmatter.message_count, Some(2));
}

#[test]
fn capture_import_reports_distill_unavailable_as_partial_success() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let _env = MemoryLlmConfigEnvGuard::use_home(home.path());
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
    assert!(result.warnings.is_empty());
    let status =
        crate::memory::memory_index_status(root.path().to_string_lossy().into_owned()).unwrap();
    assert_eq!(status.document_count, 1);
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
fn memory_repair_recreates_required_paths_and_rebuilds_indexes() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Repair required paths".to_string(),
            body: "Repair should rebuild the search index after required paths return.".to_string(),
            tags: vec!["repair".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("manual:repair-thread".to_string()),
            title: "Repair thread".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    std::fs::remove_file(root.path().join("memory/working.md")).unwrap();
    std::fs::remove_file(root.path().join("memory/MEMORY.md")).unwrap();
    std::fs::remove_file(root.path().join(".mdx/memory-config.json")).unwrap();
    std::fs::remove_file(root.path().join(".mdx/thread-index.json")).unwrap();
    std::fs::remove_file(root.path().join("log.md")).unwrap();

    let result = memory_repair_workspace(
        root.path().to_string_lossy().into_owned(),
        MemoryRepairRequest {
            rebuild_index: true,
        },
    )
    .unwrap();

    for path in [
        "memory/working.md",
        "memory/MEMORY.md",
        ".mdx/memory-config.json",
        ".mdx/thread-index.json",
        "log.md",
    ] {
        assert!(
            result.repaired_paths.contains(&path.to_string()),
            "missing repaired path {path}"
        );
        assert!(root.path().join(path).is_file(), "{path}");
    }

    let status =
        crate::memory::memory_index_status(root.path().to_string_lossy().into_owned()).unwrap();
    assert_eq!(status.document_count, 1);
    let threads = memory_thread_list(
        root.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: None,
            since: None,
        },
    )
    .unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].thread_id, "manual:repair-thread");
}

#[test]
fn recall_finds_memory_added_after_index_rebuild() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Needle after index".to_string(),
            body: "The indexed recall path must find this post-rebuild memory.".to_string(),
            tags: vec!["needle".to_string()],
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
            query: "post-rebuild".to_string(),
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
    assert_eq!(result.memories[0].title, "Needle after index");
    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("sqlite database missing")));
}

#[test]
fn recall_uses_markdown_fallback_when_valid_index_is_dirty() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();

    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Dirty projection fallback".to_string(),
            body: "Recall must find markdown when the valid sqlite projection is stale."
                .to_string(),
            tags: vec!["projection".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    {
        let conn = rusqlite::Connection::open(root.path().join(".mdx/search.sqlite")).unwrap();
        conn.execute(
            "DELETE FROM fts_memories
             WHERE rowid IN (SELECT rowid FROM documents WHERE doc_id = ?)",
            [&record.frontmatter.memory_id],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM documents WHERE doc_id = ?",
            [&record.frontmatter.memory_id],
        )
        .unwrap();
    }
    crate::search_index::mark_dirty(root.path(), "test_stale_projection").unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "stale".to_string(),
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

    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("markdown fallback")));
    assert_eq!(result.memories.len(), 1);
    assert_eq!(result.memories[0].title, "Dirty projection fallback");
    let status =
        crate::memory::memory_index_status(root.path().to_string_lossy().into_owned()).unwrap();
    assert!(status.dirty);
    assert_eq!(status.index_status, "dirty");

    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();
    let clean_status =
        crate::memory::memory_index_status(root.path().to_string_lossy().into_owned()).unwrap();
    assert!(!clean_status.dirty);
    assert_eq!(clean_status.index_status, "clean");
    assert!(!root.path().join(".mdx/search-index-dirty").exists());
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
fn workspace_lock_recovers_orphaned_owner_pid() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    write_memory_lock_owner(
        root.path(),
        "token=orphan-owner\npid=999999\ncreated_at_unix=4102444800\n",
    );

    let recovered = try_acquire_memory_lock(root.path()).unwrap();

    let owner = std::fs::read_to_string(root.path().join(".mdx/memory.lock/owner")).unwrap();
    assert!(!owner.contains("token=orphan-owner"));
    drop(recovered);
    assert!(!root.path().join(".mdx/memory.lock").exists());
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
fn recall_accepts_camel_case_memory_config_shape() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(
        root.path().join(".mdx/memory-config.json"),
        r#"{
  "version": 1,
  "recall": {
    "defaultLimit": 1,
    "contextByteBudget": 64,
    "halfLifeDays": 30,
    "embeddings": { "enabled": false }
  },
  "distill": {
    "enabled": false,
    "minMessages": 4,
    "skipPatterns": ["^Running terminal command"],
    "autoAccept": false,
    "confidenceThreshold": 0.85
  },
  "capture": { "enabled": false, "sources": [] }
}
"#,
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Camel config recall".to_string(),
            body: "camel config recall succeeds".to_string(),
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
            query: "camel".to_string(),
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
fn memory_read_failure_includes_relative_path() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("memory")).unwrap();
    std::fs::write(root.path().join("memory/bad.md"), [0xff]).unwrap();

    let error = read_workspace_file(root.path(), "memory/bad.md").unwrap_err();
    let message = format!("{error}");

    assert!(message.contains("failed to read memory workspace file"));
    assert!(message.contains("memory/bad.md"));
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
fn thread_list_does_not_decode_thread_body() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let saved = memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("manual:frontmatter-only".to_string()),
            title: "Frontmatter only".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(root.path().join(saved.path))
        .unwrap();
    file.write_all(b"\n\xff\xfe\xfd").unwrap();

    let items = memory_thread_list(
        root.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].thread_id, "manual:frontmatter-only");
    assert_eq!(items[0].title, "Frontmatter only");
}

#[test]
fn thread_list_uses_index_without_opening_thread_files() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let saved = memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("manual:index-only".to_string()),
            title: "Index only".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: Some("2026-06-12T09:05:00Z".to_string()),
            model: Some("gpt-5".to_string()),
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();
    std::fs::remove_file(root.path().join(saved.path)).unwrap();

    let items = memory_thread_list(
        root.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].thread_id, "manual:index-only");
    assert_eq!(items[0].source, "manual");
    assert_eq!(items[0].title, "Index only");
    assert_eq!(items[0].started_at.as_deref(), Some("2026-06-12T09:00:00Z"),);
    assert_eq!(items[0].message_count, Some(2));
}

#[test]
fn thread_list_supports_legacy_index_without_opening_thread_files() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    write_workspace_file(
        root.path(),
        ".mdx/thread-index.json",
        br#"{
  "version": 1,
  "threads": {
    "codex:legacy": {
      "path": "memory/threads/codex/2026-06-12-codex-legacy.md",
      "content_hash": "sha256:legacy",
      "updated_at": "2026-06-12T09:00:00Z"
    }
  }
}
"#,
    )
    .unwrap();

    let items = memory_thread_list(
        root.path().to_string_lossy().into_owned(),
        ThreadListFilter {
            source: Some("codex".to_string()),
            since: Some("2026-06-11T00:00:00Z".to_string()),
        },
    )
    .unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].thread_id, "codex:legacy");
    assert_eq!(items[0].source, "codex");
    assert_eq!(items[0].started_at.as_deref(), Some("2026-06-12"));
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
fn memory_add_succeeds_when_search_index_is_corrupt_projection() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    std::fs::write(root.path().join(".mdx/search.sqlite"), "not sqlite").unwrap();

    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Corrupt index write".to_string(),
            body: "Source of truth write should survive a corrupt projection.".to_string(),
            tags: vec!["index".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    assert!(root.path().join(&record.path).is_file());
    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("memory_index_sync_failed"));
    assert!(log.contains("memory_add"));
}

#[test]
fn memory_archive_succeeds_when_search_index_is_corrupt_projection() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Archive corrupt index".to_string(),
            body: "Archiving should survive a corrupt projection.".to_string(),
            tags: vec!["index".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();
    std::fs::write(root.path().join(".mdx/search.sqlite"), "not sqlite").unwrap();

    let archived = memory_archive(
        root.path().to_string_lossy().into_owned(),
        record.frontmatter.memory_id,
    )
    .unwrap();

    assert_eq!(archived.frontmatter.status, "archived");
    let log = read_workspace_file(root.path(), "log.md").unwrap();
    assert!(log.contains("memory_index_sync_failed"));
    assert!(log.contains("memory_archive"));
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
fn db_recall_respects_byte_budget_and_never_reads_thread_body_by_default() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let now = "2026-06-12T09:00:00Z";
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO memories (
            memory_id,
            workspace_id,
            project_key,
            title,
            body,
            status,
            tags,
            importance,
            confidence,
            created_at,
            updated_at,
            archived_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?9, NULL)",
        rusqlite::params![
            "memory-backend",
            &scope.workspace_id,
            &scope.project_key,
            "Memory backend",
            "Memory backend uses sqlite storage for recall snippets.",
            r#"["backend"]"#,
            0.8_f64,
            0.9_f64,
            now
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, 'hash-1', 1, 0, 0, ?5, ?5)",
        rusqlite::params![
            "thread-1",
            &scope.workspace_id,
            "Unrelated thread",
            "full thread body must not appear",
            now
        ],
    )
    .unwrap();

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        RecallRequest {
            query: "Memory backend".to_string(),
            limit: Some(5),
            byte_budget: Some(80),
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
    assert!(result.byte_count <= 80);
    assert!(result.threads.is_empty());
    assert!(!format!("{result:?}").contains("full thread body must not appear"));
}

#[test]
fn db_recall_explicit_thread_ids_are_not_lost_to_fuzzy_limit() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, ?5, 1, 0, 0, ?6, ?7)",
        rusqlite::params![
            "thread-auth",
            &scope.workspace_id,
            "Auth exact thread",
            "explicit thread body must not appear",
            "hash-exact",
            "2026-06-12T09:00:00Z",
            "2026-06-12T09:00:00Z",
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, ?5, 1, 0, 0, ?6, ?7)",
        rusqlite::params![
            "thread-auth-extra",
            &scope.workspace_id,
            "Auth fuzzy thread",
            "fuzzy thread body must not appear",
            "hash-fuzzy",
            "2026-06-12T09:00:00Z",
            "2026-06-12T10:00:00Z",
        ],
    )
    .unwrap();

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        RecallRequest {
            query: "missing".to_string(),
            limit: Some(1),
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

    assert_eq!(result.threads.len(), 1);
    assert_eq!(result.threads[0].memory_id, "thread-auth");
    assert!(!format!("{result:?}").contains("explicit thread body must not appear"));
    assert!(!format!("{result:?}").contains("fuzzy thread body must not appear"));
}

#[test]
fn db_recall_scopes_memories_to_workspace_and_matches_tags() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    for (memory_id, workspace_id, project_key, title, body, tags, importance) in [
        (
            "memory-current",
            scope.workspace_id.as_str(),
            scope.project_key.as_str(),
            "Current scoped memory",
            "This body does not include the query token.",
            r#"["architecture"]"#,
            0.5_f64,
        ),
        (
            "memory-foreign",
            "workspace:foreign",
            "workspace:foreign",
            "Foreign architecture memory",
            "Architecture content from another workspace must not leak.",
            r#"["architecture"]"#,
            1.0_f64,
        ),
    ] {
        conn.execute(
            "INSERT INTO memories (
                memory_id,
                workspace_id,
                project_key,
                title,
                body,
                status,
                tags,
                importance,
                confidence,
                created_at,
                updated_at,
                archived_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, 0.9, ?8, ?8, NULL)",
            rusqlite::params![
                memory_id,
                workspace_id,
                project_key,
                title,
                body,
                tags,
                importance,
                "2026-06-12T09:00:00Z"
            ],
        )
        .unwrap();
    }

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        RecallRequest {
            query: "architecture".to_string(),
            limit: Some(5),
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
    assert_eq!(result.memories[0].memory_id, "memory-current");
    assert!(!format!("{result:?}").contains("Foreign architecture memory"));
}

#[test]
fn db_recall_applies_exact_tag_filter_before_row_limit() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    for index in 0..24 {
        conn.execute(
            "INSERT INTO memories (
                memory_id,
                workspace_id,
                project_key,
                title,
                body,
                status,
                tags,
                importance,
                confidence,
                created_at,
                updated_at,
                archived_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, 1.0, 0.9, ?7, ?7, NULL)",
            rusqlite::params![
                format!("memory-decoy-{index}"),
                &scope.workspace_id,
                &scope.project_key,
                format!("Needle decoy {index}"),
                "Needle decoy body with the query token.",
                r#"["decoy"]"#,
                "2026-06-12T09:00:00Z"
            ],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO memories (
            memory_id,
            workspace_id,
            project_key,
            title,
            body,
            status,
            tags,
            importance,
            confidence,
            created_at,
            updated_at,
            archived_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, 0.1, 0.9, ?7, ?7, NULL)",
        rusqlite::params![
            "memory-target-tag",
            &scope.workspace_id,
            &scope.project_key,
            "Needle target",
            "Needle target body with the query token.",
            r#"["target"]"#,
            "2026-06-12T09:00:00Z"
        ],
    )
    .unwrap();

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        RecallRequest {
            query: "needle".to_string(),
            limit: Some(1),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: Some("target".to_string()),
            since: None,
        },
    )
    .unwrap();

    assert_eq!(result.memories.len(), 1);
    assert_eq!(result.memories[0].memory_id, "memory-target-tag");
}

#[test]
fn db_recall_include_threads_respects_since_filter() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, 'hash-old', 1, 0, 0, ?5, ?5)",
        rusqlite::params![
            "thread-old",
            &scope.workspace_id,
            "Auth thread before cutoff",
            "old thread body must not appear",
            "2026-06-01T09:00:00Z",
        ],
    )
    .unwrap();

    let result = crate::memory_recall_engine::recall_from_storage(
        &mut storage,
        RecallRequest {
            query: "auth".to_string(),
            limit: Some(5),
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: true,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: Some("2026-06-10T00:00:00Z".to_string()),
        },
    )
    .unwrap();

    assert!(result.threads.is_empty());
    assert!(!format!("{result:?}").contains("old thread body must not appear"));
}

#[test]
fn recall_uses_markdown_fallback_when_db_has_threads_but_no_memories() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Thread-only DB fallback sentinel".to_string(),
            body: "Markdown memory must still be recalled while DB memories are unmigrated."
                .to_string(),
            tags: vec!["fallback".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, 'hash-thread-only', 1, 0, 0, ?5, ?5)",
        rusqlite::params![
            "thread-only-db",
            &scope.workspace_id,
            "Thread-only DB row",
            "thread-only db body must not appear",
            "2026-06-12T09:00:00Z",
        ],
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "fallback sentinel".to_string(),
            limit: Some(5),
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
    assert_eq!(result.memories[0].title, "Thread-only DB fallback sentinel");
    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("markdown fallback")));
}

#[test]
fn recall_uses_markdown_fallback_when_db_memories_are_partially_migrated() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Migrated markdown memory".to_string(),
            body: "This memory is represented by the DB row.".to_string(),
            tags: vec!["migration".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Unmigrated markdown memory".to_string(),
            body: "partial-only markdown memory must still be recalled.".to_string(),
            tags: vec!["migration".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.7),
            confidence: Some(0.9),
        },
    )
    .unwrap();

    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO memories (
            memory_id,
            workspace_id,
            project_key,
            title,
            body,
            status,
            tags,
            importance,
            confidence,
            created_at,
            updated_at,
            archived_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, 0.8, 0.9, ?7, ?7, NULL)",
        rusqlite::params![
            "memory-migrated",
            &scope.workspace_id,
            &scope.project_key,
            "Migrated markdown memory",
            "This memory is represented by the DB row.",
            r#"["migration"]"#,
            "2026-06-12T09:00:00Z"
        ],
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "partial-only".to_string(),
            limit: Some(5),
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
    assert_eq!(result.memories[0].title, "Unmigrated markdown memory");
    assert!(result.index_degraded);
}

#[test]
fn recall_uses_markdown_fallback_when_sqlite_db_missing_even_with_clean_index() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Missing sqlite fallback sentinel".to_string(),
            body: "A clean search index must not hide a missing memory sqlite database."
                .to_string(),
            tags: vec!["fallback".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.8),
            confidence: Some(0.9),
        },
    )
    .unwrap();
    crate::memory::memory_index_rebuild(root.path().to_string_lossy().into_owned()).unwrap();
    assert!(root.path().join(".mdx/search.sqlite").is_file());
    assert!(!root.path().join(".mdx/memory.sqlite").exists());

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "fallback sentinel".to_string(),
            limit: Some(5),
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
    assert_eq!(result.memories[0].title, "Missing sqlite fallback sentinel");
    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("sqlite database missing")));
}

#[test]
fn db_recall_facade_budgets_once_with_working_memory() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_working_set(
        root.path().to_string_lossy().into_owned(),
        "# Working Memory\n\n## Focus\n- Keep enough active context in working memory.\n"
            .to_string(),
    )
    .unwrap();
    let mut storage =
        crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root.path()).unwrap();
    storage.initialize().unwrap();
    let scope = crate::memory_storage::workspace_scope_for_root(root.path());
    let conn = rusqlite::Connection::open(root.path().join(".mdx/memory.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO memories (
            memory_id,
            workspace_id,
            project_key,
            title,
            body,
            status,
            tags,
            importance,
            confidence,
            created_at,
            updated_at,
            archived_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, 1.0, 0.9, ?7, ?7, NULL)",
        rusqlite::params![
            "memory-large",
            &scope.workspace_id,
            &scope.project_key,
            "Budget large memory",
            "Budget large memory snippet ".repeat(20),
            r#"["budget"]"#,
            "2026-06-12T09:00:00Z"
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads (
            thread_id,
            workspace_id,
            agent_source,
            session_pk,
            title,
            body,
            content_hash,
            message_count,
            distilled,
            promoted_to_wiki,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, 'manual', NULL, ?3, ?4, 'hash-budget', 1, 0, 0, ?5, ?5)",
        rusqlite::params![
            "budget-thread",
            &scope.workspace_id,
            "Tiny",
            "budget thread body must not appear",
            "2026-06-12T09:00:00Z",
        ],
    )
    .unwrap();

    let result = memory_recall(
        root.path().to_string_lossy().into_owned(),
        RecallRequest {
            query: "budget".to_string(),
            limit: Some(5),
            byte_budget: Some(180),
            include_working: true,
            include_threads: true,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert!(result.memories.is_empty());
    assert_eq!(result.threads.len(), 1);
    assert_eq!(result.threads[0].memory_id, "budget-thread");
    assert!(result.truncated);
    assert!(result.byte_count <= 180);
    assert!(!format!("{result:?}").contains("budget thread body must not appear"));
}

#[test]
fn recall_request_serde_defaults_include_working_to_true() {
    let request: RecallRequest = serde_json::from_str(
        r#"{
          "query": "auth",
          "limit": null,
          "byte_budget": null,
          "include_threads": false,
          "thread_ids": [],
          "include_wiki_refs": false,
          "include_wiki_snippets": false,
          "tag": null,
          "since": null
        }"#,
    )
    .unwrap();

    assert!(request.include_working);
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
fn recall_include_wiki_refs_returns_matching_wiki_pages() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    crate::llm_wiki_fs::initialize_llm_wiki_workspace(root.path()).unwrap();
    write_workspace_file(
        root.path(),
        "wiki/auth.md",
        b"# Auth\n\nJWT access tokens expire after 15 minutes.\n",
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
            include_wiki_refs: true,
            include_wiki_snippets: true,
            tag: None,
            since: None,
        },
    )
    .unwrap();

    assert_eq!(result.wiki_refs.len(), 1);
    assert_eq!(result.wiki_refs[0].path, "wiki/auth.md");
    assert_eq!(result.wiki_refs[0].title, "auth");
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
    assert!(result.index_degraded);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("sqlite database missing")));
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
fn promote_can_copy_memory_record_to_raw_promoted_without_ingest() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Promote memory".to_string(),
            body: "This memory should become raw promoted material.".to_string(),
            tags: vec!["wiki".to_string()],
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: Some(0.7),
            confidence: Some(0.8),
        },
    )
    .unwrap();

    let result = memory_promote(
        root.path().to_string_lossy().into_owned(),
        MemoryPromoteRequest {
            target: record.frontmatter.memory_id,
            ingest: false,
            title: Some("Promoted Memory".to_string()),
        },
    )
    .unwrap();

    assert!(result.promoted_path.starts_with("raw/promoted/"));
    let promoted = std::fs::read_to_string(root.path().join(result.promoted_path)).unwrap();
    assert!(promoted.contains("kind: promoted_memory"));
    assert!(promoted.contains("source_memory:"));
    assert!(promoted.contains("title: Promoted Memory"));
    assert!(promoted.contains("This memory should become raw promoted material."));
}

#[test]
fn promote_memory_record_serializes_frontmatter_safely() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let record = memory_add(
        root.path().to_string_lossy().into_owned(),
        MemoryAddRequest {
            title: "Memory with yaml title".to_string(),
            body: "Body remains plain markdown.".to_string(),
            tags: Vec::new(),
            source_thread: None,
            source_message_refs: Vec::new(),
            importance: None,
            confidence: None,
        },
    )
    .unwrap();

    let result = memory_promote(
        root.path().to_string_lossy().into_owned(),
        MemoryPromoteRequest {
            target: record.frontmatter.memory_id,
            ingest: false,
            title: Some("A: B # not comment".to_string()),
        },
    )
    .unwrap();

    let promoted = std::fs::read_to_string(root.path().join(result.promoted_path)).unwrap();
    let (frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<serde_json::Value>(&promoted).unwrap();
    assert_eq!(frontmatter["kind"], "promoted_memory");
    assert_eq!(frontmatter["title"], "A: B # not comment");
    assert!(body.contains("Body remains plain markdown."));
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
fn distill_without_force_reuses_existing_inbox_run() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-idempotent".to_string()),
            title: "Distill idempotent".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();
    let json = r#"[{
      "title": "Use JWT",
      "body": "Use JWT for access tokens.",
      "tags": ["auth"],
      "importance": 0.8,
      "confidence": 0.9,
      "source_message_refs": [1]
    }]"#;

    let first = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-idempotent".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();
    let second = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-idempotent".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();

    assert_eq!(first.inbox_count, 1);
    assert_eq!(second.inbox_count, 1);
    assert_eq!(
        first.inbox[0].frontmatter.inbox_id,
        second.inbox[0].frontmatter.inbox_id
    );
    let inbox = memory_inbox_list(root.path().to_string_lossy().into_owned(), true).unwrap();
    assert_eq!(inbox.len(), 1);
}

#[test]
fn distill_force_creates_new_inbox_run() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-force".to_string()),
            title: "Distill force".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();
    let json = r#"[{
      "title": "Use JWT",
      "body": "Use JWT for access tokens.",
      "tags": ["auth"],
      "importance": 0.8,
      "confidence": 0.9,
      "source_message_refs": [1]
    }]"#;

    memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-force".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();
    memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-force".to_string(),
            accept: false,
            force: true,
        },
        json,
    )
    .unwrap();

    let inbox = memory_inbox_list(root.path().to_string_lossy().into_owned(), true).unwrap();
    assert_eq!(inbox.len(), 2);
    assert_ne!(
        inbox[0].frontmatter.distill_run_id,
        inbox[1].frontmatter.distill_run_id
    );
}

#[test]
fn distill_auto_accepts_candidates_above_configured_threshold() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.distill.auto_accept = true;
    config.distill.confidence_threshold = 80;
    write_workspace_file(
        root.path(),
        ".mdx/memory-config.json",
        serde_json::to_string_pretty(&config).unwrap().as_bytes(),
    )
    .unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-auto".to_string()),
            title: "Distill auto".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let result = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-auto".to_string(),
            accept: false,
            force: false,
        },
        r#"[{
          "title": "Use JWT",
          "body": "Use JWT for access tokens.",
          "tags": ["auth"],
          "importance": 0.8,
          "confidence": 0.9,
          "source_message_refs": [1]
        }]"#,
    )
    .unwrap();

    assert_eq!(result.memory_count, 1);
    assert_eq!(result.inbox_count, 0);
    assert_eq!(result.memories[0].frontmatter.title, "Use JWT");
}

#[test]
fn distill_without_force_reuses_mixed_auto_accept_results() {
    let root = tempdir().unwrap();
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let mut config = default_memory_config();
    config.distill.auto_accept = true;
    config.distill.confidence_threshold = 80;
    write_workspace_file(
        root.path(),
        ".mdx/memory-config.json",
        serde_json::to_string_pretty(&config).unwrap().as_bytes(),
    )
    .unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "codex".to_string(),
            thread_id: Some("codex:distill-mixed".to_string()),
            title: "Distill mixed".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();
    let json = r#"[{
      "title": "High confidence",
      "body": "Accept this memory.",
      "tags": ["auth"],
      "importance": 0.8,
      "confidence": 0.9,
      "source_message_refs": [1]
    }, {
      "title": "Low confidence",
      "body": "Review this memory.",
      "tags": ["auth"],
      "importance": 0.5,
      "confidence": 0.7,
      "source_message_refs": [2]
    }]"#;

    let first = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-mixed".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();
    let second = memory_distill_with_json_for_test(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "codex:distill-mixed".to_string(),
            accept: false,
            force: false,
        },
        json,
    )
    .unwrap();

    assert_eq!(first.memory_count, 1);
    assert_eq!(first.inbox_count, 1);
    assert_eq!(second.memory_count, 1);
    assert_eq!(second.inbox_count, 1);
    let memories = memory_list(
        root.path().to_string_lossy().into_owned(),
        MemoryListFilter {
            tag: Some("auth".to_string()),
            since: None,
            include_archived: false,
        },
    )
    .unwrap();
    let inbox = memory_inbox_list(root.path().to_string_lossy().into_owned(), true).unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(inbox.len(), 1);
}

#[test]
fn distill_uses_configured_llm_provider_and_writes_inbox() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let _env = MemoryLlmConfigEnvGuard::use_home(home.path());
    memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    memory_thread_save(
        root.path().to_string_lossy().into_owned(),
        ThreadSaveRequest {
            source: "manual".to_string(),
            thread_id: Some("manual:llm-distill".to_string()),
            title: "LLM distill".to_string(),
            body: sample_thread_body(),
            started_at: Some("2026-06-12T09:00:00Z".to_string()),
            ended_at: None,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )
    .unwrap();

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let addr = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::{Read, Write};
        let mut request = [0_u8; 4096];
        let read = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..read]);
        assert!(request.contains("POST /v1/responses HTTP/1.1"));

        let body = serde_json::json!({
            "output": [{
                "content": [{
                    "type": "output_text",
                    "text": "[{\"title\":\"Use auth middleware\",\"body\":\"The project discussed auth middleware implementation planning.\",\"tags\":[\"auth\"],\"importance\":0.7,\"confidence\":0.9,\"source_message_refs\":[1,2]}]"
                }]
            }]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let config_dir = home.path().join(".mdx");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(
        config_dir.join("llm-config.json"),
        serde_json::json!({
            "baseUrl": format!("http://{}/v1", addr),
            "model": "test-model",
            "apiKey": null,
            "apiMode": "responses"
        })
        .to_string(),
    )
    .unwrap();

    let result = memory_distill(
        root.path().to_string_lossy().into_owned(),
        MemoryDistillRequest {
            target: "manual:llm-distill".to_string(),
            accept: false,
            force: false,
        },
    )
    .unwrap();
    server.join().unwrap();

    assert_eq!(result.candidate_count, 1);
    assert_eq!(result.inbox_count, 1);
    assert_eq!(result.inbox[0].frontmatter.title, "Use auth middleware");
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

#[test]
fn agent_setup_updates_only_mdx_managed_blocks() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let claude_dir = home.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(
        claude_dir.join("CLAUDE.md"),
        format!(
            "User intro\n\n{}\nold generated mdx block\n{}\n\nUser footer\n",
            crate::memory_agent_setup::MDX_MEMORY_BLOCK_BEGIN,
            crate::memory_agent_setup::MDX_MEMORY_BLOCK_END
        ),
    )
    .unwrap();
    let paths = crate::memory_agent_setup::AgentSetupPaths {
        home: home.path().to_path_buf(),
        mdx_cli: "mdx-cli".to_string(),
        mdx_mcp: "mdx-mcp".to_string(),
        hook_script: home.path().join(".mdx-memory-precompact-hook.mjs"),
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
    )
    .unwrap();

    let claude = changes
        .iter()
        .find(|change| change.path.ends_with(".claude/CLAUDE.md"))
        .expect("claude markdown change");
    assert!(claude.contents.contains("User intro"));
    assert!(claude.contents.contains("User footer"));
    assert!(!claude.contents.contains("old generated mdx block"));
    assert!(claude
        .contents
        .contains(crate::memory_agent_setup::MDX_MEMORY_BLOCK_BEGIN));
    assert!(claude.contents.contains("mdx-cli memory --root"));
    assert!(claude
        .contents
        .contains(root.path().to_string_lossy().as_ref()));
    assert!(claude.contents.contains("hook claude PreCompact"));
}

#[test]
fn agent_setup_uninstall_removes_owned_skill_file() {
    let home = tempdir().unwrap();
    let skill_path = home.path().join(".claude/skills/mdx-memory/SKILL.md");
    std::fs::create_dir_all(skill_path.parent().unwrap()).unwrap();
    std::fs::write(&skill_path, "name: mdx-memory\n").unwrap();
    let paths = crate::memory_agent_setup::AgentSetupPaths {
        home: home.path().to_path_buf(),
        mdx_cli: "mdx-cli".to_string(),
        mdx_mcp: "mdx-mcp".to_string(),
        hook_script: home.path().join(".mdx-memory-precompact-hook.mjs"),
    };

    let changes =
        crate::memory_agent_setup::plan_memory_agent_uninstall(Some("claude"), &paths).unwrap();
    let skill = changes
        .iter()
        .find(|change| change.path == skill_path)
        .expect("claude skill remove change");
    assert_eq!(
        skill.action,
        crate::memory_agent_setup::AgentSetupChangeAction::RemoveFile
    );

    crate::memory_agent_setup::apply_agent_setup_changes(&changes).unwrap();
    assert!(!skill_path.exists());
}

#[test]
fn agent_setup_claude_hook_uses_command_string() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let paths = crate::memory_agent_setup::AgentSetupPaths {
        home: home.path().to_path_buf(),
        mdx_cli: "/tmp/mdx cli".to_string(),
        mdx_mcp: "mdx-mcp".to_string(),
        hook_script: home.path().join(".mdx-memory-precompact-hook.mjs"),
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
    )
    .unwrap();
    let hooks = changes
        .iter()
        .find(|change| change.path.ends_with(".claude/hooks/hooks.json"))
        .expect("claude hooks change");
    let json: serde_json::Value = serde_json::from_str(&hooks.contents).unwrap();
    let hook = &json["hooks"]["PreCompact"][0]["hooks"][0];
    let command = hook["command"].as_str().expect("command string");
    assert!(command.contains("memory --root"));
    assert!(command.contains(root.path().to_string_lossy().as_ref()));
    assert!(command.contains("hook claude PreCompact"));
    assert!(hook.get("args").is_none());
}

#[test]
fn doctor_reports_codex_claude_cursor_statuses() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();

    let report = crate::memory_agent_setup::memory_agent_doctor_for_home(
        &root.path().to_string_lossy(),
        home.path(),
    )
    .unwrap();

    assert!(!report.ok);
    let agents = report
        .statuses
        .iter()
        .map(|status| status.agent_source.as_str())
        .collect::<Vec<_>>();
    assert_eq!(agents, vec!["codex", "claude", "cursor"]);
    for status in &report.statuses {
        assert!(!status.installed);
        assert!(!status.enabled);
        assert!(!status.authorized);
        assert_eq!(status.doctor_status, "not_installed_or_configured");
    }
    for agent in ["codex", "claude", "cursor"] {
        assert!(report.warnings.iter().any(|warning| warning.contains(agent)
            && warning.contains("not installed or not configured")));
    }
}
