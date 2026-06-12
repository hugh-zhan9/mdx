use tempfile::tempdir;

use crate::memory::{default_memory_config, memory_detect_workspace, memory_initialize_workspace};
use crate::memory_fs::{append_memory_log_entry, read_workspace_file, write_workspace_file};

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
