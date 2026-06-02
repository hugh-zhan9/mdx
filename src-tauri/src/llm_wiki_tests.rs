use tempfile::tempdir;

use crate::llm_wiki_fs::{detect_llm_wiki_workspace, initialize_llm_wiki_workspace};

#[test]
fn detect_reports_ordinary_workspace_before_initialization() {
    let root = tempdir().unwrap();

    let status = detect_llm_wiki_workspace(root.path()).unwrap();

    assert!(!status.has_llm_wiki);
    assert!(status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"raw".to_string()));
    assert!(status.missing_paths.contains(&"wiki".to_string()));
    assert!(status.missing_paths.contains(&"AGENTS.md".to_string()));
}

#[test]
fn initialize_creates_llm_wiki_structure_without_migrating_markdown() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("existing.md"), "# Existing\n").unwrap();

    let result = initialize_llm_wiki_workspace(root.path()).unwrap();

    assert!(root.path().join("raw/notes").is_dir());
    assert!(root.path().join("raw/articles").is_dir());
    assert!(root.path().join("raw/assets").is_dir());
    assert!(root.path().join("wiki/sources").is_dir());
    assert!(root.path().join("wiki/entities").is_dir());
    assert!(root.path().join("wiki/concepts").is_dir());
    assert!(root.path().join("wiki/syntheses").is_dir());
    assert!(root.path().join("index.md").is_file());
    assert!(root.path().join("log.md").is_file());
    assert!(root.path().join("purpose.md").is_file());
    assert!(root.path().join("AGENTS.md").is_file());
    assert!(root.path().join("llm-wiki-progress.md").is_file());
    assert!(root.path().join(".llm-wiki/cache.json").is_file());
    assert!(root.path().join(".llm-wiki/config.json").is_file());
    assert!(root.path().join("existing.md").is_file());
    assert!(!root.path().join("raw/notes/existing.md").exists());
    assert!(!result.created_paths.is_empty());

    let cache_json: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(cache_json["version"], 1);
}

#[test]
fn initialize_is_idempotent_and_preserves_existing_agents_file() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path()).unwrap();
    std::fs::write(root.path().join("AGENTS.md"), "# Custom Rules\n").unwrap();

    initialize_llm_wiki_workspace(root.path()).unwrap();
    let second_result = initialize_llm_wiki_workspace(root.path()).unwrap();

    let agents = std::fs::read_to_string(root.path().join("AGENTS.md")).unwrap();
    assert_eq!(agents, "# Custom Rules\n");
    assert!(second_result.created_paths.is_empty());
    assert!(second_result
        .preserved_paths
        .contains(&"raw/notes".to_string()));
    assert!(second_result
        .preserved_paths
        .contains(&"wiki/sources".to_string()));
    assert!(second_result
        .preserved_paths
        .contains(&"index.md".to_string()));
    assert!(second_result
        .preserved_paths
        .contains(&"AGENTS.md".to_string()));
    assert!(second_result
        .preserved_paths
        .contains(&".llm-wiki/cache.json".to_string()));
}

#[test]
fn detect_reports_not_ready_when_required_directory_is_a_file() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("raw"), "not a directory").unwrap();

    let status = detect_llm_wiki_workspace(root.path()).unwrap();

    assert!(!status.has_llm_wiki);
    assert!(status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"raw".to_string()));
}

#[test]
fn initialize_errors_when_required_file_path_is_a_directory() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("index.md")).unwrap();

    let result = initialize_llm_wiki_workspace(root.path());

    assert!(result.is_err());
    assert!(root.path().join("index.md").is_dir());
}
