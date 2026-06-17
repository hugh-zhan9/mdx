use tempfile::tempdir;

use crate::state_store::{
    load_state_from_path, save_state_to_path, AppPreferences, AppState, PersistedPanelState,
    PersistedWindowSize, PersistedWorkspaceState, PersistedWorkspaceTab,
};

#[test]
fn loads_empty_state_when_state_file_is_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    assert!(state.recent_workspace_root.is_none());
    assert!(state.workspaces.is_empty());
    assert_eq!(state.window_size.width, 1280.0);
    assert_eq!(state.window_size.height, 820.0);
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
fn app_preferences_include_file_watch_and_search_defaults() {
    let preferences = AppPreferences::default();

    assert!(preferences.file_watch_enabled);
    assert_eq!(preferences.search_max_file_bytes, 2_097_152);
    assert_eq!(preferences.search_max_results, 200);
    assert_eq!(preferences.search_max_matches_per_file, 20);
}

#[test]
fn old_state_without_new_preferences_uses_defaults() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    std::fs::write(
        &path,
        r#"{
          "stateVersion": 1,
          "recentWorkspaceRoot": "/tmp/ws",
          "preferences": {
            "fileTreeExcludeDirs": ["vendor"]
          },
          "workspaces": [],
          "windowSize": { "width": 1280, "height": 820 }
        }"#,
    )
    .unwrap();

    let state = load_state_from_path(&path).unwrap();

    assert_eq!(state.preferences.file_tree_exclude_dirs, vec!["vendor"]);
    assert!(state.preferences.file_watch_enabled);
    assert_eq!(state.preferences.search_max_file_bytes, 2_097_152);
    assert_eq!(state.preferences.search_max_results, 200);
    assert_eq!(state.preferences.search_max_matches_per_file, 20);
}

#[test]
fn saves_and_reloads_workspace_state() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    let state = AppState {
        state_version: 1,
        recent_workspace_root: Some("/tmp/ws".to_string()),
        preferences: AppPreferences {
            file_tree_exclude_dirs: vec!["vendor".to_string(), "docs/archive".to_string()],
            file_watch_enabled: false,
            search_max_file_bytes: 1_048_576,
            search_max_results: 100,
            search_max_matches_per_file: 10,
        },
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
    assert_eq!(raw_json["preferences"]["fileTreeExcludeDirs"][0], "vendor");
    assert_eq!(raw_json["preferences"]["fileWatchEnabled"], false);
    assert_eq!(raw_json["preferences"]["searchMaxFileBytes"], 1_048_576);
    assert_eq!(raw_json["preferences"]["searchMaxResults"], 100);
    assert_eq!(raw_json["preferences"]["searchMaxMatchesPerFile"], 10);
    assert_eq!(raw_json["workspaces"][0]["activeTabId"], "tab-2");
    assert_eq!(raw_json["workspaces"][0]["panels"]["leftCollapsed"], true);
    assert_eq!(raw_json["windowSize"]["width"], 1440.0);

    let reloaded = load_state_from_path(&path).unwrap();
    assert_eq!(reloaded.recent_workspace_root.as_deref(), Some("/tmp/ws"));
    assert_eq!(
        reloaded.preferences.file_tree_exclude_dirs,
        vec!["vendor".to_string(), "docs/archive".to_string()]
    );
    assert!(!reloaded.preferences.file_watch_enabled);
    assert_eq!(reloaded.preferences.search_max_file_bytes, 1_048_576);
    assert_eq!(reloaded.preferences.search_max_results, 100);
    assert_eq!(reloaded.preferences.search_max_matches_per_file, 10);
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

#[test]
fn save_normalizes_invalid_app_state_values() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    let state = AppState {
        state_version: 0,
        recent_workspace_root: Some("/tmp/ws".to_string()),
        preferences: AppPreferences {
            file_tree_exclude_dirs: vec![
                " vendor ".to_string(),
                "vendor".to_string(),
                "../outside".to_string(),
            ],
            file_watch_enabled: true,
            search_max_file_bytes: 1,
            search_max_results: 10_000,
            search_max_matches_per_file: 0,
        },
        workspaces: vec![
            PersistedWorkspaceState {
                root_path: "".to_string(),
                tabs: Vec::new(),
                active_tab_id: None,
                panels: PersistedPanelState::default(),
            },
            PersistedWorkspaceState {
                root_path: "/tmp/ws".to_string(),
                tabs: vec![
                    PersistedWorkspaceTab {
                        tab_id: " tab-1 ".to_string(),
                        path: "/tmp/ws/one.md".to_string(),
                        title: " ".to_string(),
                        dirty: false,
                        needs_rename_on_first_save: false,
                    },
                    PersistedWorkspaceTab {
                        tab_id: "tab-2".to_string(),
                        path: "/other/two.md".to_string(),
                        title: "two.md".to_string(),
                        dirty: false,
                        needs_rename_on_first_save: false,
                    },
                ],
                active_tab_id: Some("tab-1".to_string()),
                panels: PersistedPanelState {
                    left_collapsed: false,
                    left_width: 10,
                    right_collapsed: false,
                    right_width: 900,
                },
            },
        ],
        window_size: PersistedWindowSize {
            width: f64::NAN,
            height: 100.2,
        },
    };

    save_state_to_path(&path, &state).unwrap();

    let saved = load_state_from_path(&path).unwrap();
    assert_eq!(saved.state_version, 1);
    assert_eq!(saved.preferences.file_tree_exclude_dirs, vec!["vendor"]);
    assert_eq!(saved.preferences.search_max_file_bytes, 1_024);
    assert_eq!(saved.preferences.search_max_results, 5_000);
    assert_eq!(saved.preferences.search_max_matches_per_file, 1);
    assert_eq!(saved.workspaces.len(), 1);
    assert_eq!(saved.workspaces[0].tabs.len(), 1);
    assert_eq!(saved.workspaces[0].tabs[0].tab_id, "tab-1");
    assert_eq!(saved.workspaces[0].tabs[0].title, "Untitled");
    assert_eq!(saved.workspaces[0].panels.left_width, 160);
    assert_eq!(saved.workspaces[0].panels.right_width, 640);
    assert_eq!(saved.window_size.width, 1280.0);
    assert_eq!(saved.window_size.height, 640.0);
}
