use sha2::{Digest, Sha256};
use tempfile::tempdir;

use crate::llm_wiki::llm_wiki_refresh_graph;
use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
    read_knowledge_config, scan_raw_files, update_progress_markdown,
    write_knowledge_graph_markdown,
};

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
    assert!(!status.can_initialize);
    assert_eq!(status.mode, "ordinary");
    assert!(status.missing_paths.contains(&"raw".to_string()));
}

#[test]
fn initialize_errors_when_required_file_path_is_a_directory() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("index.md")).unwrap();

    let result = initialize_llm_wiki_workspace(root.path());

    let error = result.unwrap_err();
    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(root.path().join("index.md").is_dir());
}

#[cfg(unix)]
#[test]
fn initialize_errors_when_managed_directory_is_a_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("wiki")).unwrap();

    let result = initialize_llm_wiki_workspace(root.path());

    let error = result.unwrap_err();
    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!outside.path().join("sources").exists());
}

#[test]
fn scan_raw_files_only_includes_markdown_under_raw_and_respects_skip() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# A\n").unwrap();
    std::fs::write(root.path().join("raw/notes/b.txt"), "B\n").unwrap();
    std::fs::create_dir_all(root.path().join("raw/ignored")).unwrap();
    std::fs::write(root.path().join("raw/ignored/c.md"), "# C\n").unwrap();
    std::fs::write(
        root.path().join("wiki/sources/generated.md"),
        "# Generated\n",
    )
    .unwrap();
    std::fs::write(
        root.path().join(".llm-wiki/config.json"),
        r#"{"paused":false,"skipPaths":["raw/ignored"]}"#,
    )
    .unwrap();

    let config = read_knowledge_config(root.path()).unwrap();
    let files = scan_raw_files(root.path(), &config).unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].relative_path, "raw/notes/a.md");
    assert!(files[0].hash.starts_with("sha256:"));
}

#[test]
fn update_progress_markdown_writes_visible_status_document() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    update_progress_markdown(
        root.path(),
        "scanning",
        &["raw/notes/a.md".to_string()],
        &[],
        &[("raw/notes/b.md".to_string(), "llm_failed".to_string())],
        &["raw/ignored".to_string()],
    )
    .unwrap();

    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    assert!(progress.contains("# LLM Wiki Progress"));
    assert!(progress.contains("scanning"));
    assert!(progress.contains("raw/notes/a.md"));
    assert!(progress.contains("raw/notes/b.md"));
    assert!(progress.contains("llm_failed"));
    assert!(progress.contains("raw/ignored"));
}

#[test]
fn graph_markdown_uses_wikilinks_without_inferred_labels() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("wiki/entities/A.md"), "# A\n\n[[B]]\n").unwrap();
    std::fs::write(root.path().join("wiki/concepts/B.md"), "# B\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains("```mermaid"));
    assert!(markdown.contains("[\"A\"]"));
    assert!(markdown.contains("[\"B\"]"));
    assert!(markdown.contains(" --> "));
    assert!(!markdown.contains("-->|"));
}

#[test]
fn graph_markdown_handles_aliases_self_anchors_and_duplicate_basenames() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/nested")).unwrap();
    std::fs::write(
        root.path().join("wiki/entities/A.md"),
        "# A\n\n[[B|Bee]]\n[[#Background]]\n[[nested/Topic.md]]\n",
    )
    .unwrap();
    std::fs::write(root.path().join("wiki/concepts/B.md"), "# B\n").unwrap();
    std::fs::write(root.path().join("wiki/entities/Topic.md"), "# Topic\n").unwrap();
    std::fs::write(
        root.path().join("wiki/entities/nested/Topic.md"),
        "# Topic\n",
    )
    .unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains("[\"A\"]"));
    assert!(markdown.contains("[\"B\"]"));
    assert!(markdown.contains("[\"Topic\"]"));
    assert!(markdown.contains(&graph_edge("wiki/entities/A.md", "wiki/concepts/B.md")));
    assert!(markdown.contains(&graph_edge(
        "wiki/entities/A.md",
        "wiki/entities/nested/Topic.md"
    )));
    assert!(!markdown.contains("Bee"));
    assert!(!markdown.contains("Background"));
    assert!(markdown.contains(&graph_id("wiki/entities/Topic.md")));
    assert!(markdown.contains(&graph_id("wiki/entities/nested/Topic.md")));
    assert_ne!(
        markdown.find(&graph_id("wiki/entities/Topic.md")),
        markdown.find(&graph_id("wiki/entities/nested/Topic.md"))
    );
}

#[test]
fn graph_markdown_does_not_resolve_ambiguous_bare_basenames() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/nested")).unwrap();
    std::fs::write(root.path().join("wiki/entities/A.md"), "# A\n\n[[Topic]]\n").unwrap();
    std::fs::write(root.path().join("wiki/entities/Topic.md"), "# Topic\n").unwrap();
    std::fs::write(
        root.path().join("wiki/entities/nested/Topic.md"),
        "# Topic\n",
    )
    .unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains(&format!("{}[\"A\"]", graph_id("wiki/entities/A.md"))));
    assert!(!markdown.contains(&graph_edge("wiki/entities/A.md", "wiki/entities/Topic.md")));
    assert!(!markdown.contains(&graph_edge(
        "wiki/entities/A.md",
        "wiki/entities/nested/Topic.md"
    )));
}

#[test]
fn graph_markdown_resolves_root_qualified_slash_links_before_source_relative() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/concepts")).unwrap();
    std::fs::write(
        root.path().join("wiki/entities/A.md"),
        "# A\n\n[[wiki/concepts/B]]\n[[concepts/B]]\n[[entities/concepts/B]]\n",
    )
    .unwrap();
    std::fs::write(root.path().join("wiki/concepts/B.md"), "# B\n").unwrap();
    std::fs::write(root.path().join("wiki/entities/concepts/B.md"), "# B\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains(&graph_edge("wiki/entities/A.md", "wiki/concepts/B.md")));
    assert!(markdown.contains(&graph_edge(
        "wiki/entities/A.md",
        "wiki/entities/concepts/B.md"
    )));
}

#[test]
fn graph_markdown_does_not_fallback_wiki_root_link_to_source_relative() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/concepts")).unwrap();
    std::fs::write(
        root.path().join("wiki/entities/A.md"),
        "# A\n\n[[wiki/concepts/B]]\n",
    )
    .unwrap();
    std::fs::write(root.path().join("wiki/entities/concepts/B.md"), "# B\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(!markdown.contains(&graph_edge(
        "wiki/entities/A.md",
        "wiki/entities/concepts/B.md"
    )));
}

#[test]
fn graph_markdown_uses_collision_proof_node_ids_for_similar_paths() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/foo")).unwrap();
    std::fs::write(root.path().join("wiki/entities/foo-bar.md"), "# Foo Bar\n").unwrap();
    std::fs::write(root.path().join("wiki/entities/foo/bar.md"), "# Bar\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();
    let ids = markdown
        .lines()
        .filter_map(|line| {
            line.trim()
                .split_once("[\"")
                .map(|(id, _)| id.trim().to_string())
        })
        .filter(|id| id.starts_with("wiki_"))
        .collect::<std::collections::BTreeSet<_>>();

    assert_eq!(ids.len(), 2);
    assert!(!ids.contains("wiki_entities_foo_bar"));
}

#[test]
fn refresh_graph_is_idempotent_and_excludes_generated_graph_page() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("wiki/entities/A.md"), "# A\n\n[[B]]\n").unwrap();
    std::fs::write(root.path().join("wiki/concepts/B.md"), "# B\n").unwrap();

    let first = llm_wiki_refresh_graph(root.path().to_string_lossy().into_owned()).unwrap();
    let second = llm_wiki_refresh_graph(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(first, second);
    assert!(!second.contains("knowledge-graph"));
    assert!(!second.contains("Knowledge Graph\"]"));
}

#[cfg(unix)]
#[test]
fn scan_raw_files_rejects_raw_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(outside.path().join("notes")).unwrap();
    std::fs::write(outside.path().join("notes/leaked.md"), "# Leaked\n").unwrap();
    std::fs::remove_dir_all(root.path().join("raw")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("raw")).unwrap();

    let config = read_knowledge_config(root.path()).unwrap();
    let error = scan_raw_files(root.path(), &config).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
}

#[cfg(unix)]
#[test]
fn graph_markdown_rejects_wiki_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(outside.path().join("entities")).unwrap();
    std::fs::write(outside.path().join("entities/A.md"), "# A\n\n[[B]]\n").unwrap();
    std::fs::remove_dir_all(root.path().join("wiki")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("wiki")).unwrap();

    let error = build_knowledge_graph_markdown(root.path()).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
}

#[cfg(unix)]
#[test]
fn refresh_graph_rejects_wiki_symlink_without_external_write() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join("wiki")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("wiki")).unwrap();

    let error = llm_wiki_refresh_graph(root.path().to_string_lossy().into_owned()).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!outside.path().join("knowledge-graph.md").exists());
}

#[cfg(unix)]
#[test]
fn refresh_graph_rejects_symlinked_graph_file_without_external_write() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_file = outside.path().join("knowledge-graph.md");
    std::fs::write(&outside_file, "outside-original").unwrap();
    std::fs::remove_file(root.path().join("wiki/knowledge-graph.md")).ok();
    std::os::unix::fs::symlink(&outside_file, root.path().join("wiki/knowledge-graph.md")).unwrap();

    let error = llm_wiki_refresh_graph(root.path().to_string_lossy().into_owned()).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(
        std::fs::read_to_string(outside_file).unwrap(),
        "outside-original"
    );
}

#[cfg(unix)]
#[test]
fn update_progress_rejects_symlinked_progress_file_without_external_write() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_file = outside.path().join("progress.md");
    std::fs::write(&outside_file, "outside-original").unwrap();
    std::fs::remove_file(root.path().join("llm-wiki-progress.md")).unwrap();
    std::os::unix::fs::symlink(&outside_file, root.path().join("llm-wiki-progress.md")).unwrap();

    let error = update_progress_markdown(root.path(), "scanning", &[], &[], &[], &[]).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(
        std::fs::read_to_string(outside_file).unwrap(),
        "outside-original"
    );
}

#[cfg(unix)]
#[test]
fn update_progress_rejects_llm_wiki_temp_dir_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join(".llm-wiki")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".llm-wiki")).unwrap();

    let error = update_progress_markdown(root.path(), "scanning", &[], &[], &[], &[]).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn write_graph_rejects_llm_wiki_temp_dir_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join(".llm-wiki")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".llm-wiki")).unwrap();

    let error = write_knowledge_graph_markdown(root.path(), "# Knowledge Graph\n").unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn write_graph_markdown_writes_regular_managed_graph_file() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    write_knowledge_graph_markdown(root.path(), "# Knowledge Graph\n").unwrap();

    assert_eq!(
        std::fs::read_to_string(root.path().join("wiki/knowledge-graph.md")).unwrap(),
        "# Knowledge Graph\n"
    );
}

fn graph_edge(source: &str, target: &str) -> String {
    format!("  {} --> {}\n", graph_id(source), graph_id(target))
}

fn graph_id(relative_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(relative_path.as_bytes());
    let digest = hasher.finalize();
    let mut id = String::from("wiki_");
    for byte in digest.iter().take(12) {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}
