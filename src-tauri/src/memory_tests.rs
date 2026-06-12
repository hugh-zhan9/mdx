use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard, OnceLock};

use tempfile::tempdir;

use crate::memory::{
    default_memory_config, memory_add, memory_archive, memory_detect_workspace, memory_get,
    memory_initialize_workspace, memory_list, memory_promote, memory_recall, memory_search,
    memory_thread_get, memory_thread_list, memory_thread_save, memory_working_append,
    memory_working_get, memory_working_set, MemoryAddRequest, MemoryListFilter,
    MemoryPromoteRequest, RecallRequest, ThreadListFilter, ThreadSaveRequest,
};
use crate::memory_fs::{append_memory_log_entry, read_workspace_file, write_workspace_file};

fn sample_thread_body() -> String {
    "## Message 1 — user — 2026-06-12T09:00:01Z\n\nImplement auth middleware.\n\n## Message 2 — assistant — 2026-06-12T09:00:15Z\n\nPlan the work.\n".to_string()
}

fn llm_config_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct LlmConfigEnvGuard {
    _lock: MutexGuard<'static, ()>,
    home: Option<OsString>,
    userprofile: Option<OsString>,
}

impl LlmConfigEnvGuard {
    fn use_home(path: impl AsRef<std::path::Path>) -> Self {
        let lock = llm_config_env_lock().lock().unwrap();
        let home = std::env::var_os("HOME");
        let userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", path.as_ref());
        std::env::remove_var("USERPROFILE");
        Self {
            _lock: lock,
            home,
            userprofile,
        }
    }
}

impl Drop for LlmConfigEnvGuard {
    fn drop(&mut self) {
        if let Some(value) = self.home.as_ref() {
            std::env::set_var("HOME", value);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(value) = self.userprofile.as_ref() {
            std::env::set_var("USERPROFILE", value);
        } else {
            std::env::remove_var("USERPROFILE");
        }
    }
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

    assert!(result
        .working
        .as_deref()
        .unwrap_or_default()
        .contains("Ship JWT auth"));
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
    let fake_home = root.path().join("home-file");
    std::fs::write(&fake_home, "not a directory").unwrap();
    let _env_guard = LlmConfigEnvGuard::use_home(&fake_home);
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

    let error = memory_promote(
        root.path().to_string_lossy().into_owned(),
        MemoryPromoteRequest {
            target: "cursor:abc123".to_string(),
            ingest: true,
            title: None,
        },
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_config_load_failed");
    let thread = memory_thread_get(
        root.path().to_string_lossy().into_owned(),
        "cursor:abc123".to_string(),
    )
    .unwrap();
    assert!(!thread.frontmatter.promoted_to_wiki);
}
