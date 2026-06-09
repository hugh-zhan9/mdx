use std::time::{Duration, SystemTime};

use tempfile::tempdir;

use crate::draft_store::{
    cleanup_expired_drafts_in_dir, draft_delete_in_dir, draft_get_in_dir,
    draft_list_for_workspace_in_dir, draft_save_in_dir, DraftSaveRequest,
};

#[test]
fn saves_and_reads_plaintext_markdown_draft() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let document_path = workspace.path().join("note.md");
    std::fs::write(&document_path, "# Original").unwrap();

    let result = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: document_path.to_string_lossy().into_owned(),
            display_path: Some("note.md".to_string()),
            markdown: "# Draft\n\nPlaintext body".to_string(),
            base_fingerprint: Some("base-fingerprint".to_string()),
            mode: "workspace".to_string(),
        },
    )
    .unwrap();
    assert!(home
        .path()
        .join("drafts")
        .join(format!("{}.json", result.draft_id))
        .is_file());

    let read = draft_get_in_dir(home.path(), document_path.to_string_lossy().into_owned()).unwrap();
    let draft = read.draft.unwrap();

    assert_eq!(draft.draft_id, result.draft_id);
    assert_eq!(
        draft.real_path,
        document_path.canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(draft.display_path, Some("note.md".to_string()));
    assert_eq!(draft.markdown, "# Draft\n\nPlaintext body");
    assert_eq!(draft.base_fingerprint, Some("base-fingerprint".to_string()));
    assert_eq!(draft.mode, "workspace");
    assert_eq!(draft.updated_at, result.updated_at);
    assert!(read.file_exists);
    assert_eq!(
        read.current_fingerprint,
        Some(crate::document::document_fingerprint("# Original"))
    );
}

#[test]
fn lists_workspace_orphan_drafts_when_original_file_is_missing() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let document_path = workspace.path().join("missing.md");

    let saved = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: document_path.to_string_lossy().into_owned(),
            display_path: Some("missing.md".to_string()),
            markdown: "# Unsaved".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();

    let list = draft_list_for_workspace_in_dir(
        home.path(),
        workspace.path().to_string_lossy().into_owned(),
    )
    .unwrap();

    assert_eq!(list.drafts.len(), 1);
    assert_eq!(list.drafts[0].draft_id, saved.draft_id);
    assert_eq!(
        list.drafts[0].real_path,
        workspace
            .path()
            .canonicalize()
            .unwrap()
            .join("missing.md")
            .to_string_lossy()
    );
    assert_eq!(list.drafts[0].display_path, Some("missing.md".to_string()));
    assert!(!list.drafts[0].file_exists);
}

#[test]
fn delete_is_idempotent_by_path() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let document_path = workspace.path().join("delete-me.md");
    std::fs::write(&document_path, "# Delete me").unwrap();

    draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: document_path.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Draft".to_string(),
            base_fingerprint: None,
            mode: "document".to_string(),
        },
    )
    .unwrap();

    let first = draft_delete_in_dir(
        home.path(),
        None,
        Some(document_path.to_string_lossy().into_owned()),
    )
    .unwrap();
    let second = draft_delete_in_dir(
        home.path(),
        None,
        Some(document_path.to_string_lossy().into_owned()),
    )
    .unwrap();

    assert!(first.deleted);
    assert!(!second.deleted);
    assert!(
        draft_get_in_dir(home.path(), document_path.to_string_lossy().into_owned())
            .unwrap()
            .draft
            .is_none()
    );
}

#[test]
fn cleanup_removes_only_expired_drafts() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let old_path = workspace.path().join("old.md");
    let fresh_path = workspace.path().join("fresh.md");
    std::fs::write(&old_path, "# Old").unwrap();
    std::fs::write(&fresh_path, "# Fresh").unwrap();

    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(86_400 * 10);
    let old = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: old_path.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Old draft".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();
    let fresh = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: fresh_path.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Fresh draft".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();
    set_stored_updated_at(
        home.path(),
        &old.draft_id,
        now - Duration::from_secs(86_400 * 8),
    );
    set_stored_updated_at(
        home.path(),
        &fresh.draft_id,
        now - Duration::from_secs(86_400),
    );

    let cleanup = cleanup_expired_drafts_in_dir(home.path(), 7, now).unwrap();

    assert_eq!(cleanup.deleted, 1);
    assert_eq!(cleanup.kept, 1);
    assert!(
        draft_get_in_dir(home.path(), old_path.to_string_lossy().into_owned())
            .unwrap()
            .draft
            .is_none()
    );
    assert!(
        draft_get_in_dir(home.path(), fresh_path.to_string_lossy().into_owned())
            .unwrap()
            .draft
            .is_some()
    );
}

#[test]
fn rejects_non_markdown_drafts() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let document_path = workspace.path().join("notes.txt");
    std::fs::write(&document_path, "plain text").unwrap();

    let error = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: document_path.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "plain text".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_markdown_path");
}

fn set_stored_updated_at(home_dir: &std::path::Path, draft_id: &str, updated_at: SystemTime) {
    let path = home_dir.join("drafts").join(format!("{draft_id}.json"));
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    value["updatedAt"] = serde_json::Value::String(
        updated_at
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string(),
    );
    std::fs::write(&path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}
