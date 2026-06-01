use tempfile::tempdir;

use crate::state_store::{
    load_state_from_path, save_state_to_path, AppState, PersistedPanelState, PersistedWindowSize,
    PersistedWorkspaceState, PersistedWorkspaceTab,
};

#[test]
fn loads_empty_state_when_state_file_is_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    assert!(state.recent_workspace_root.is_none());
    assert!(state.workspaces.is_empty());
    assert_eq!(state.window_size.width, 900.0);
    assert_eq!(state.window_size.height, 700.0);
}

#[test]
fn backs_up_corrupt_state_file_before_resetting() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    std::fs::write(&path, "{not json").unwrap();

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    let reset_state = load_state_from_path(&path).unwrap();
    assert_eq!(reset_state.state_version, 1);
    assert!(dir.path().read_dir().unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("state.json.corrupt.")
    }));
}

#[test]
fn saves_and_reloads_workspace_state() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    let state = AppState {
        state_version: 1,
        recent_workspace_root: Some("/tmp/ws".to_string()),
        workspaces: vec![PersistedWorkspaceState {
            root_path: "/tmp/ws".to_string(),
            tabs: vec![
                PersistedWorkspaceTab {
                    tab_id: "tab-1".to_string(),
                    path: "/tmp/ws/one.md".to_string(),
                    title: "one.md".to_string(),
                    dirty: false,
                    needs_rename_on_first_save: false,
                },
                PersistedWorkspaceTab {
                    tab_id: "tab-2".to_string(),
                    path: "/tmp/ws/two.md".to_string(),
                    title: "two.md".to_string(),
                    dirty: true,
                    needs_rename_on_first_save: true,
                },
            ],
            active_tab_id: Some("tab-2".to_string()),
            panels: PersistedPanelState {
                left_collapsed: true,
                left_width: 320,
                right_collapsed: false,
                right_width: 360,
            },
        }],
        window_size: PersistedWindowSize {
            width: 1440.0,
            height: 900.0,
        },
    };

    save_state_to_path(&path, &state).unwrap();

    let raw_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(raw_json["stateVersion"], 1);
    assert_eq!(raw_json["recentWorkspaceRoot"], "/tmp/ws");
    assert_eq!(raw_json["workspaces"][0]["activeTabId"], "tab-2");
    assert_eq!(raw_json["workspaces"][0]["panels"]["leftCollapsed"], true);
    assert_eq!(raw_json["windowSize"]["width"], 1440.0);

    let reloaded = load_state_from_path(&path).unwrap();
    assert_eq!(reloaded.recent_workspace_root.as_deref(), Some("/tmp/ws"));
    assert_eq!(reloaded.workspaces.len(), 1);

    let workspace = &reloaded.workspaces[0];
    assert_eq!(workspace.root_path, "/tmp/ws");
    assert_eq!(workspace.active_tab_id.as_deref(), Some("tab-2"));
    assert_eq!(workspace.tabs.len(), 2);
    assert_eq!(workspace.tabs[0].tab_id, "tab-1");
    assert_eq!(workspace.tabs[0].path, "/tmp/ws/one.md");
    assert_eq!(workspace.tabs[1].title, "two.md");
    assert!(workspace.tabs[1].dirty);
    assert!(workspace.tabs[1].needs_rename_on_first_save);
    assert!(workspace.panels.left_collapsed);
    assert_eq!(workspace.panels.left_width, 320);
    assert!(!workspace.panels.right_collapsed);
    assert_eq!(workspace.panels.right_width, 360);
    assert_eq!(reloaded.window_size.width, 1440.0);
    assert_eq!(reloaded.window_size.height, 900.0);
}
