use tempfile::tempdir;

use crate::workspace_search::{
    workspace_search_sync, workspace_search_sync_after_scan, DirtySearchOverride,
    WorkspaceSearchRequest,
};

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
    std::fs::write(root.path().join("small.md"), "alpha\n").unwrap();

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

#[test]
fn skips_files_larger_than_exact_max_file_bytes() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("too-large.md"), "alpha\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 5,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-4".to_string(),
    })
    .unwrap();

    assert_eq!(result.skipped_large_files, 1);
    assert_eq!(result.searched_files, 0);
    assert!(result.results.is_empty());
}

#[cfg(unix)]
#[test]
fn skips_symlink_directory_targets_that_are_hidden_or_ignored() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join(".git")).unwrap();
    std::fs::create_dir_all(root.path().join("node_modules")).unwrap();
    std::fs::write(root.path().join(".git/hidden.md"), "alpha\n").unwrap();
    std::fs::write(root.path().join("node_modules/package.md"), "alpha\n").unwrap();
    symlink(root.path().join(".git"), root.path().join("visible-git")).unwrap();
    symlink(
        root.path().join("node_modules"),
        root.path().join("visible-modules"),
    )
    .unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-5".to_string(),
    })
    .unwrap();

    assert!(result.results.is_empty());
    assert_eq!(result.searched_files, 0);
}

#[test]
fn returns_utf16_columns_for_case_insensitive_matches_after_non_ascii_text() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("note.md"), "😀中文 ALPHA\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-6".to_string(),
    })
    .unwrap();

    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].column_start, 5);
    assert_eq!(result.results[0].column_end, 10);
}

#[test]
fn returns_multiple_non_overlapping_matches_on_same_line() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("note.md"), "alpha alpha alpha\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: true,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-7".to_string(),
    })
    .unwrap();

    let columns: Vec<_> = result
        .results
        .iter()
        .map(|item| (item.column_start, item.column_end))
        .collect();
    assert_eq!(columns, vec![(0, 5), (6, 11), (12, 17)]);
}

#[test]
fn max_matches_per_file_limits_actual_matches_not_matching_lines() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("note.md"), "alpha alpha alpha\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: true,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 2,
        dirty_overrides: vec![],
        request_id: "req-8".to_string(),
    })
    .unwrap();

    let columns: Vec<_> = result
        .results
        .iter()
        .map(|item| (item.column_start, item.column_end))
        .collect();
    assert_eq!(columns, vec![(0, 5), (6, 11)]);
}

#[test]
fn skips_stale_candidate_files_that_disappear_after_scan() {
    let root = tempdir().unwrap();
    let stale = root.path().join("stale.md");
    let kept = root.path().join("kept.md");
    std::fs::write(&stale, "alpha stale\n").unwrap();
    std::fs::write(&kept, "alpha kept\n").unwrap();
    let stale = stale.canonicalize().unwrap();

    let result = workspace_search_sync_after_scan(
        WorkspaceSearchRequest {
            root_path: root.path().to_string_lossy().into_owned(),
            query: "alpha".to_string(),
            case_sensitive: false,
            max_file_bytes: 2_097_152,
            max_results: 20,
            max_matches_per_file: 20,
            dirty_overrides: vec![],
            request_id: "req-9".to_string(),
        },
        |candidates| {
            assert!(candidates.contains(&stale));
            std::fs::remove_file(&stale).unwrap();
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(result.skipped_unreadable_files, 1);
    assert_eq!(result.results.len(), 1);
    assert!(result.results[0].path.ends_with("kept.md"));
}
