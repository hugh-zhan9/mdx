use tempfile::tempdir;

use crate::state_store::load_state_from_path;

#[test]
fn loads_empty_state_when_state_file_is_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    assert!(state.recent_workspace_root.is_none());
    assert!(state.workspaces.is_empty());
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
