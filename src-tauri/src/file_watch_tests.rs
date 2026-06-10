use std::path::PathBuf;
use std::sync::mpsc::TryRecvError;

use crate::file_watch::{
    coalesce_watch_events, document_watch_targets, insert_test_watch_registration,
    is_markdown_or_assets_relevant, is_workspace_relevant_event, pending_events_from_notify_event,
    stop_watch_by_id, stop_watches_for_window_label, test_watch_state_contains, FileWatchKind,
    FileWatchState, PendingWatchEvent, WatchScope,
};
use notify::event::{DataChange, EventAttributes, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind};

#[test]
fn coalesces_repeated_change_events_by_path() {
    let events = vec![
        PendingWatchEvent {
            kind: FileWatchKind::Changed,
            path: PathBuf::from("/tmp/ws/a.md"),
            new_path: None,
            is_dir: false,
        },
        PendingWatchEvent {
            kind: FileWatchKind::Changed,
            path: PathBuf::from("/tmp/ws/a.md"),
            new_path: None,
            is_dir: false,
        },
    ];

    let coalesced = coalesce_watch_events(events);

    assert_eq!(coalesced.len(), 1);
    assert_eq!(coalesced[0].kind, FileWatchKind::Changed);
}

#[test]
fn coalesces_create_then_delete_as_no_event() {
    let events = vec![
        PendingWatchEvent {
            kind: FileWatchKind::Created,
            path: PathBuf::from("/tmp/ws/temp.md"),
            new_path: None,
            is_dir: false,
        },
        PendingWatchEvent {
            kind: FileWatchKind::Deleted,
            path: PathBuf::from("/tmp/ws/temp.md"),
            new_path: None,
            is_dir: false,
        },
    ];

    assert!(coalesce_watch_events(events).is_empty());
}

#[test]
fn document_watch_accepts_markdown_and_sibling_assets_only() {
    let doc = PathBuf::from("/tmp/ws/note.md");

    assert!(is_markdown_or_assets_relevant(
        &doc,
        &PathBuf::from("/tmp/ws/note.md")
    ));
    assert!(is_markdown_or_assets_relevant(
        &doc,
        &PathBuf::from("/tmp/ws/.assets/image.png")
    ));
    assert!(!is_markdown_or_assets_relevant(
        &doc,
        &PathBuf::from("/tmp/ws/other.md")
    ));
    assert!(!is_markdown_or_assets_relevant(
        &doc,
        &PathBuf::from("/tmp/ws/sub/other.md")
    ));
}

#[test]
fn document_watch_targets_include_existing_assets_directory_recursively() {
    let dir = tempfile::tempdir().unwrap();
    let assets_dir = dir.path().join(".assets");
    std::fs::create_dir(&assets_dir).unwrap();

    let targets = document_watch_targets(dir.path());

    assert_eq!(targets.len(), 2);
    assert_eq!(targets[0].path, dir.path());
    assert!(!targets[0].recursive);
    assert_eq!(targets[1].path, assets_dir);
    assert!(targets[1].recursive);
}

#[test]
fn workspace_watch_ignores_extensionless_non_markdown_file_events() {
    let dir = tempfile::tempdir().unwrap();
    let readme_path = dir.path().join("README");
    std::fs::write(&readme_path, "not markdown by extension").unwrap();
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };
    let notify_event = Event {
        kind: EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        paths: vec![readme_path],
        attrs: EventAttributes::new(),
    };

    let pending_events = pending_events_from_notify_event(&scope, notify_event);

    assert!(pending_events.is_empty());
}

#[test]
fn workspace_watch_accepts_notify_folder_remove_for_dotted_directory() {
    let dir = tempfile::tempdir().unwrap();
    let dotted_dir_path = dir.path().join("docs.v1");
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };
    let notify_event = Event {
        kind: EventKind::Remove(RemoveKind::Folder),
        paths: vec![dotted_dir_path.clone()],
        attrs: EventAttributes::new(),
    };

    let pending_events = pending_events_from_notify_event(&scope, notify_event);

    assert_eq!(pending_events.len(), 1);
    assert_eq!(pending_events[0].kind, FileWatchKind::Deleted);
    assert_eq!(pending_events[0].path, dotted_dir_path);
    assert!(pending_events[0].is_dir);
}

#[test]
fn workspace_watch_maps_one_sided_rename_from_to_delete() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("old.md");
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };
    let notify_event = Event {
        kind: EventKind::Modify(ModifyKind::Name(RenameMode::From)),
        paths: vec![old_path.clone()],
        attrs: EventAttributes::new(),
    };

    let pending_events = pending_events_from_notify_event(&scope, notify_event);

    assert_eq!(pending_events.len(), 1);
    assert_eq!(pending_events[0].kind, FileWatchKind::Deleted);
    assert_eq!(pending_events[0].path, old_path);
    assert_eq!(pending_events[0].new_path, None);
}

#[test]
fn workspace_watch_maps_one_sided_rename_to_to_create() {
    let dir = tempfile::tempdir().unwrap();
    let new_path = dir.path().join("new.md");
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };
    let notify_event = Event {
        kind: EventKind::Modify(ModifyKind::Name(RenameMode::To)),
        paths: vec![new_path.clone()],
        attrs: EventAttributes::new(),
    };

    let pending_events = pending_events_from_notify_event(&scope, notify_event);

    assert_eq!(pending_events.len(), 1);
    assert_eq!(pending_events[0].kind, FileWatchKind::Created);
    assert_eq!(pending_events[0].path, new_path);
    assert_eq!(pending_events[0].new_path, None);
}

#[test]
fn workspace_watch_does_not_emit_one_path_rename_without_new_path() {
    let dir = tempfile::tempdir().unwrap();
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };

    for rename_mode in [RenameMode::Any, RenameMode::Both, RenameMode::Other] {
        let notify_event = Event {
            kind: EventKind::Modify(ModifyKind::Name(rename_mode)),
            paths: vec![dir.path().join("maybe-renamed.md")],
            attrs: EventAttributes::new(),
        };

        let pending_events = pending_events_from_notify_event(&scope, notify_event);

        assert!(!pending_events
            .iter()
            .any(|event| event.kind == FileWatchKind::Renamed && event.new_path.is_none()));
    }
}

#[test]
fn workspace_watch_maps_two_path_rename_both_to_renamed() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("old.md");
    let new_path = dir.path().join("new.md");
    let scope = WatchScope::Workspace {
        root_path: dir.path().to_path_buf(),
    };
    let notify_event = Event {
        kind: EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        paths: vec![old_path.clone(), new_path.clone()],
        attrs: EventAttributes::new(),
    };

    let pending_events = pending_events_from_notify_event(&scope, notify_event);

    assert_eq!(pending_events.len(), 1);
    assert_eq!(pending_events[0].kind, FileWatchKind::Renamed);
    assert_eq!(pending_events[0].path, old_path);
    assert_eq!(pending_events[0].new_path, Some(new_path));
}

#[test]
fn workspace_relevance_accepts_explicit_directory_signal_for_dotted_rename() {
    let event = PendingWatchEvent {
        kind: FileWatchKind::Renamed,
        path: PathBuf::from("/tmp/ws/docs.v1"),
        new_path: Some(PathBuf::from("/tmp/ws/docs.v2")),
        is_dir: true,
    };

    assert!(is_workspace_relevant_event(&event));
}

#[test]
fn stop_watches_for_window_label_removes_only_matching_registrations() {
    let mut state = FileWatchState::default();
    let matching_first = insert_test_watch_registration(&mut state, "watch-1", "workspace-window");
    let other = insert_test_watch_registration(&mut state, "watch-2", "document-window");
    let matching_second = insert_test_watch_registration(&mut state, "watch-3", "workspace-window");

    let stopped = stop_watches_for_window_label(&mut state, "workspace-window");

    assert_eq!(stopped, 2);
    assert!(!test_watch_state_contains(&state, "watch-1"));
    assert!(test_watch_state_contains(&state, "watch-2"));
    assert!(!test_watch_state_contains(&state, "watch-3"));
    assert!(matching_first.try_recv().is_ok());
    assert!(matching_second.try_recv().is_ok());
    assert!(matches!(other.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn stop_watch_by_id_returns_watch_not_found_for_unknown_id() {
    let mut state = FileWatchState::default();

    let error = stop_watch_by_id(&mut state, "missing-watch").unwrap_err();

    assert_eq!(error.error_code(), "watch_not_found");
}
