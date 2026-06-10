use tempfile::tempdir;

use crate::workspace_search::{workspace_search_sync, DirtySearchOverride, WorkspaceSearchRequest};

#[test]
fn searches_markdown_files_including_raw_by_default() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("raw/articles")).unwrap();
    std::fs::write(root.path().join("note.md"), "alpha\nbeta\n").unwrap();
    std::fs::write(root.path().join("raw/articles/source.md"), "raw alpha\n").unwrap();
    std::fs::write(root.path().join("book.pdf"), "alpha").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-1".to_string(),
    })
    .unwrap();

    let paths: Vec<_> = result
        .results
        .iter()
        .map(|item| item.path.as_str())
        .collect();
    assert!(paths.iter().any(|path| path.ends_with("note.md")));
    assert!(paths
        .iter()
        .any(|path| path.ends_with("raw/articles/source.md")));
    assert!(!paths.iter().any(|path| path.ends_with("book.pdf")));
}

#[test]
fn applies_dirty_override_instead_of_disk_contents() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "disk only\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "unsaved".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![DirtySearchOverride {
            path: file.to_string_lossy().into_owned(),
            markdown: "unsaved match\n".to_string(),
        }],
        request_id: "req-2".to_string(),
    })
    .unwrap();

    assert_eq!(result.results.len(), 1);
    assert!(result.results[0].dirty);
    assert_eq!(result.results[0].line_number, 1);
}

#[test]
fn skips_large_files_and_truncates_results() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("large.md"), "alpha alpha alpha").unwrap();
    std::fs::write(root.path().join("small.md"), "alpha\nalpha\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 8,
        max_results: 1,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-3".to_string(),
    })
    .unwrap();

    assert_eq!(result.skipped_large_files, 1);
    assert_eq!(result.results.len(), 1);
    assert!(result.truncated);
}
