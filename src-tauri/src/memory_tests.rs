use tempfile::tempdir;

use crate::memory::{
    default_memory_config, memory_detect_workspace, memory_initialize_workspace, memory_thread_get,
    memory_thread_list, memory_thread_save, ThreadListFilter, ThreadSaveRequest,
};
use crate::memory_fs::{append_memory_log_entry, read_workspace_file, write_workspace_file};

fn sample_thread_body() -> String {
    "## Message 1 — user — 2026-06-12T09:00:01Z\n\nImplement auth middleware.\n\n## Message 2 — assistant — 2026-06-12T09:00:15Z\n\nPlan the work.\n".to_string()
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
