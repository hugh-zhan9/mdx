use std::path::PathBuf;

use tauri::Url;

use crate::window_sessions::{
    is_supported_document_path, normalize_opened_url_path, WindowRole, WindowSessionRegistry,
};

#[test]
fn registry_keeps_one_workspace_window() {
    let mut registry = WindowSessionRegistry::default();

    let first = registry.claim_workspace_window();
    let second = registry.claim_workspace_window();

    assert_eq!(first, "workspace-main");
    assert_eq!(second, "workspace-main");
    assert_eq!(
        registry.role_for_label("workspace-main"),
        Some(WindowRole::Workspace)
    );
}

#[test]
fn registry_deduplicates_document_windows_by_real_path() {
    let mut registry = WindowSessionRegistry::default();
    let real_path = PathBuf::from("/tmp/note.md");

    let first = registry.claim_document_window(real_path.clone(), "document-0".to_string());
    let second = registry.claim_document_window(real_path, "document-1".to_string());

    assert_eq!(first, "document-0");
    assert_eq!(second, "document-0");
    assert_eq!(
        registry.role_for_label("document-0"),
        Some(WindowRole::Document)
    );
    assert_eq!(registry.role_for_label("document-1"), None);
}

#[test]
fn registry_removes_document_when_window_is_destroyed() {
    let mut registry = WindowSessionRegistry::default();
    let real_path = PathBuf::from("/tmp/note.md");

    let first = registry.claim_document_window(real_path.clone(), "document-0".to_string());
    registry.remove_label(&first);
    let second = registry.claim_document_window(real_path, "document-1".to_string());

    assert_eq!(second, "document-1");
    assert_eq!(registry.role_for_label("document-0"), None);
    assert_eq!(
        registry.role_for_label("document-1"),
        Some(WindowRole::Document)
    );
}

#[test]
fn opened_url_path_accepts_file_urls_and_rejects_non_files() {
    let file_url = Url::from_file_path("/tmp/note.md").unwrap();
    let http_url = Url::parse("https://example.com/note.md").unwrap();

    assert_eq!(
        normalize_opened_url_path(&file_url).unwrap(),
        PathBuf::from("/tmp/note.md")
    );
    assert!(normalize_opened_url_path(&http_url).is_none());
    assert!(is_supported_document_path(
        PathBuf::from("/tmp/note.md").as_path()
    ));
    assert!(is_supported_document_path(
        PathBuf::from("/tmp/note.markdown").as_path()
    ));
    assert!(!is_supported_document_path(
        PathBuf::from("/tmp/note.mdx").as_path()
    ));
}
