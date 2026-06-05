use std::path::PathBuf;

use tauri::Url;

use crate::window_sessions::{
    is_supported_document_path, normalize_opened_url_path, remove_destroyed_window_session,
    DirtyWorkspacePaths, StartupOpenRoutingState, WindowRole, WindowSession, WindowSessionRegistry,
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

    let first = registry.claim_document_window(
        real_path.clone(),
        real_path.clone(),
        "document-0".to_string(),
    );
    let second =
        registry.claim_document_window(real_path.clone(), real_path, "document-1".to_string());

    assert_eq!(first, "document-0");
    assert_eq!(second, "document-0");
    assert_eq!(
        registry.role_for_label("document-0"),
        Some(WindowRole::Document)
    );
    assert_eq!(registry.role_for_label("document-1"), None);
}

#[test]
fn registry_returns_document_session_for_window_label() {
    let mut registry = WindowSessionRegistry::default();
    let display_path = PathBuf::from("/tmp/link.md");
    let real_path = PathBuf::from("/tmp/note.md");

    let label = registry.claim_document_window(display_path, real_path, "document-0".to_string());
    let session = registry.session_for_label(&label);

    assert_eq!(
        session,
        Some(WindowSession::Document {
            file_name: "note.md".to_string(),
            display_path: "/tmp/link.md".to_string(),
            real_path: "/tmp/note.md".to_string(),
        })
    );
}

#[test]
fn registry_returns_document_error_session_for_window_label() {
    let mut registry = WindowSessionRegistry::default();

    let label = registry.claim_document_error_window(
        "document-error-0".to_string(),
        "无法解析这个 Markdown 文档路径。".to_string(),
        Some(PathBuf::from("/tmp/missing.md")),
    );
    let session = registry.session_for_label(&label);

    assert_eq!(
        session,
        Some(WindowSession::DocumentError {
            message: "无法解析这个 Markdown 文档路径。".to_string(),
            path: Some("/tmp/missing.md".to_string()),
        })
    );
    assert_eq!(
        registry.role_for_label("document-error-0"),
        Some(WindowRole::Document)
    );
}

#[test]
fn registry_removes_document_when_window_is_destroyed() {
    let mut registry = WindowSessionRegistry::default();
    let real_path = PathBuf::from("/tmp/note.md");

    let first = registry.claim_document_window(
        real_path.clone(),
        real_path.clone(),
        "document-0".to_string(),
    );
    registry.remove_label(&first);
    let second =
        registry.claim_document_window(real_path.clone(), real_path, "document-1".to_string());

    assert_eq!(second, "document-1");
    assert_eq!(registry.role_for_label("document-0"), None);
    assert_eq!(
        registry.role_for_label("document-1"),
        Some(WindowRole::Document)
    );
}

#[test]
fn removing_destroyed_window_releases_registry_lock_before_followup_work() {
    let registry = std::sync::Mutex::new(WindowSessionRegistry::default());
    {
        let mut registry = registry.lock().unwrap();
        registry.claim_workspace_window();
    }

    let removed_role = remove_destroyed_window_session(&registry, "workspace-main");

    assert_eq!(removed_role, Some(WindowRole::Workspace));
    assert!(
        registry.try_lock().is_ok(),
        "destroyed-window cleanup must not hold the registry lock after returning"
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

#[test]
fn startup_routing_does_not_create_workspace_when_ready_precedes_supported_opened() {
    let mut state = StartupOpenRoutingState::default();

    state.observe_ready();
    state.observe_default_launch(true);
    state.observe_supported_document_opened_during_startup();

    assert!(!state.should_create_workspace_on_initial_main_events_cleared(false));
}

#[test]
fn startup_routing_does_not_commit_workspace_before_initial_main_events_cleared() {
    let mut state = StartupOpenRoutingState::default();

    state.observe_ready();
    state.observe_default_launch(true);
    // No timeout or elapsed-time check commits startup routing before the first
    // main-event drain, so a later startup Opened event can still suppress it.
    state.observe_supported_document_opened_during_startup();

    assert!(!state.should_create_workspace_on_initial_main_events_cleared(false));
}

#[test]
fn startup_routing_does_not_create_workspace_for_non_default_launch() {
    let mut state = StartupOpenRoutingState::default();

    state.observe_ready();
    state.observe_default_launch(false);

    assert!(!state.should_create_workspace_on_initial_main_events_cleared(false));
}

#[test]
fn startup_routing_creates_workspace_for_default_launch_without_documents() {
    let mut state = StartupOpenRoutingState::default();

    state.observe_ready();
    state.observe_default_launch(true);

    assert!(state.should_create_workspace_on_initial_main_events_cleared(false));
}

#[test]
fn startup_routing_creates_workspace_when_launch_reason_is_unknown() {
    let mut state = StartupOpenRoutingState::default();

    state.observe_ready();

    assert!(state.should_create_workspace_on_initial_main_events_cleared(false));
}

#[test]
fn dirty_workspace_paths_canonicalizes_existing_paths() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "# Note\n").unwrap();

    let mut dirty = DirtyWorkspacePaths::default();
    dirty.update(vec![file.to_string_lossy().into_owned()]);

    assert!(dirty.contains(&file.canonicalize().unwrap()));
}

#[test]
fn dirty_workspace_paths_keeps_raw_path_when_canonicalization_fails() {
    let file = PathBuf::from("/tmp/mdx-missing-dirty-note.md");

    let mut dirty = DirtyWorkspacePaths::default();
    dirty.update(vec![file.to_string_lossy().into_owned()]);

    assert!(dirty.contains(&file));
}

#[test]
fn dirty_workspace_paths_clear_removes_stored_paths() {
    let file = PathBuf::from("/tmp/mdx-dirty-note.md");

    let mut dirty = DirtyWorkspacePaths::default();
    dirty.update(vec![file.to_string_lossy().into_owned()]);
    dirty.clear();

    assert!(!dirty.contains(&file));
}
