use sha2::{Digest, Sha256};
use tempfile::tempdir;

use crate::llm_wiki::{
    llm_config_to_public, llm_wiki_ingest_mock_output, llm_wiki_query, llm_wiki_refresh_graph,
    llm_wiki_rescan_raw,
};
use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
    read_knowledge_config, scan_raw_files, update_progress_markdown,
    write_knowledge_graph_markdown, write_managed_file,
};
use crate::llm_wiki_ingest::{
    build_ingest_analysis_prompt, build_ingest_generation_prompt, is_safe_llm_wiki_output_path,
    parse_file_blocks, write_ingest_outputs, LlmWikiFileBlock,
};
use crate::llm_wiki_llm::{
    build_openai_chat_request, load_llm_config_from_path, load_optional_llm_config_from_path,
    save_llm_config_to_path, LlmChatMessage,
};
use crate::llm_wiki_models::LlmProviderConfig;
use crate::llm_wiki_models::LlmWikiCache;
use crate::llm_wiki_query::{mechanical_lint_report, search_wiki_pages, write_digest_page};

#[test]
fn llm_config_round_trips_outside_workspace_files() {
    let dir = tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap().join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    save_llm_config_to_path(&path, &config).unwrap();
    let loaded = load_llm_config_from_path(&path).unwrap();

    assert_eq!(loaded, config);
}

#[test]
fn llm_config_save_replaces_existing_config_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap().join("llm-config.json");
    let first = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "first-model".to_string(),
        api_key: Some("first-key".to_string()),
    };
    let second = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "second-model".to_string(),
        api_key: Some("second-key".to_string()),
    };

    save_llm_config_to_path(&path, &first).unwrap();
    save_llm_config_to_path(&path, &second).unwrap();

    assert_eq!(load_llm_config_from_path(&path).unwrap(), second);
}

#[cfg(unix)]
#[test]
fn llm_config_save_rejects_symlinked_parent_without_touching_target() {
    let dir = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let symlink_parent = dir.path().join("config");
    std::os::unix::fs::symlink(outside.path(), &symlink_parent).unwrap();
    let path = symlink_parent.join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    let error = save_llm_config_to_path(&path, &config).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!outside.path().join("llm-config.json").exists());
}

#[cfg(unix)]
#[test]
fn llm_config_save_rejects_symlinked_ancestor_without_touching_target() {
    let dir = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let symlink_ancestor = dir.path().join("mdx-home");
    std::os::unix::fs::symlink(outside.path(), &symlink_ancestor).unwrap();
    let path = symlink_ancestor.join(".mdx").join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    let error = save_llm_config_to_path(&path, &config).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!outside.path().join(".mdx").exists());
}

#[cfg(unix)]
#[test]
fn llm_config_load_rejects_symlinked_config_file() {
    let dir = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_config = outside.path().join("llm-config.json");
    std::fs::write(
        &outside_config,
        r#"{"baseUrl":"https://api.example.com/v1","model":"outside","apiKey":"secret"}"#,
    )
    .unwrap();
    let path = dir.path().join("llm-config.json");
    std::os::unix::fs::symlink(&outside_config, &path).unwrap();

    let error = load_llm_config_from_path(&path).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
}

#[test]
fn llm_config_optional_load_returns_none_only_for_confirmed_missing_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap().join("llm-config.json");

    let loaded = load_optional_llm_config_from_path(&path).unwrap();

    assert_eq!(loaded, None);
}

#[cfg(unix)]
#[test]
fn llm_config_optional_load_rejects_symlinked_config_file() {
    let dir = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_config = outside.path().join("llm-config.json");
    std::fs::write(
        &outside_config,
        r#"{"baseUrl":"https://api.example.com/v1","model":"outside","apiKey":"secret"}"#,
    )
    .unwrap();
    let path = dir.path().join("llm-config.json");
    std::os::unix::fs::symlink(&outside_config, &path).unwrap();

    let error = load_optional_llm_config_from_path(&path).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
}

#[cfg(unix)]
#[test]
fn llm_config_load_metadata_error_uses_load_error_code() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let locked_dir = dir.path().canonicalize().unwrap().join("locked");
    std::fs::create_dir(&locked_dir).unwrap();
    std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o000)).unwrap();

    let error = load_llm_config_from_path(locked_dir.join("llm-config.json")).unwrap_err();

    std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(error.error_code(), "llm_config_load_failed");
}

#[cfg(unix)]
#[test]
fn llm_config_save_restricts_secret_file_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let path = dir
        .path()
        .canonicalize()
        .unwrap()
        .join("config")
        .join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    save_llm_config_to_path(&path, &config).unwrap();

    let parent_mode = std::fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let file_mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;

    assert_eq!(parent_mode, 0o700);
    assert_eq!(file_mode, 0o600);
}

#[test]
fn llm_config_debug_redacts_api_key() {
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    let debug = format!("{config:?}");

    assert!(debug.contains("api_key"));
    assert!(!debug.contains("secret-key"));
}

#[test]
fn llm_config_public_projection_does_not_expose_api_key() {
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
    };

    let public = llm_config_to_public(config);
    let json = serde_json::to_value(&public).unwrap();

    assert_eq!(public.base_url, "https://api.example.com/v1");
    assert_eq!(public.model, "test-model");
    assert!(public.has_api_key);
    assert!(json.get("apiKey").is_none());
    assert!(!json.to_string().contains("secret-key"));
}

#[test]
fn openai_chat_request_uses_model_and_messages() {
    let request = build_openai_chat_request(
        "model-a",
        vec![
            LlmChatMessage {
                role: "system".to_string(),
                content: "rules".to_string(),
            },
            LlmChatMessage {
                role: "user".to_string(),
                content: "question".to_string(),
            },
        ],
    );

    assert_eq!(request["model"], "model-a");
    assert_eq!(request["messages"][0]["role"], "system");
    assert_eq!(request["messages"][1]["content"], "question");
    assert_eq!(request["temperature"], 0.2);
}

#[test]
fn ingest_prompts_analysis_includes_context_and_extraction_targets() {
    let prompt = build_ingest_analysis_prompt("# Raw", "# Purpose", "# AGENTS", "# Index");

    assert!(prompt.contains("# Raw"));
    assert!(prompt.contains("# Purpose"));
    assert!(prompt.contains("# AGENTS"));
    assert!(prompt.contains("# Index"));
    assert!(prompt.contains("entities"));
    assert!(prompt.contains("concepts"));
}

#[test]
fn ingest_prompts_generation_requires_file_blocks_and_sources_paths() {
    let prompt = build_ingest_generation_prompt("{}", "# Existing");

    assert!(prompt.contains("{}"));
    assert!(prompt.contains("# Existing"));
    assert!(prompt.contains("---FILE:"));
    assert!(prompt.contains("wiki/sources"));
}

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
fn search_wiki_pages_finds_query_terms_in_generated_wiki() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/Rust.md",
        "系统编程语言。\n".as_bytes(),
    )
    .unwrap();

    let results = search_wiki_pages(root.path(), "系统编程").unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Rust");
    assert!(results[0].path.ends_with("wiki/entities/Rust.md"));
    assert!(results[0].snippet.contains("系统编程语言。"));
}

#[cfg(unix)]
#[test]
fn search_wiki_pages_skips_symlinked_wiki_file_without_reading_target() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_file = outside.path().join("Outside.md");
    std::fs::write(&outside_file, "secret outside term\n").unwrap();
    std::os::unix::fs::symlink(&outside_file, root.path().join("wiki/entities/Outside.md"))
        .unwrap();

    let results = search_wiki_pages(root.path(), "outside term").unwrap();

    assert!(results.is_empty());
}

#[test]
fn llm_wiki_query_returns_insufficient_context_without_llm_call_when_search_is_empty() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let response = llm_wiki_query(
        root.path().to_string_lossy().into_owned(),
        "missing-topic".to_string(),
    )
    .unwrap();

    assert!(response.insufficient_context);
    assert!(response.references.is_empty());
    assert!(response.answer.contains("没有足够上下文"));
}

#[test]
fn write_digest_page_saves_under_syntheses_and_updates_index_and_log() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let path = write_digest_page(root.path(), "Rust", "# Rust\n").unwrap();

    assert_eq!(path, "wiki/syntheses/Rust.md");
    assert!(root.path().join("wiki/syntheses/Rust.md").is_file());
    let index = std::fs::read_to_string(root.path().join("index.md")).unwrap();
    let log = std::fs::read_to_string(root.path().join("log.md")).unwrap();
    assert!(index.contains("[[Rust]]"));
    assert!(log.contains("digest"));
}

#[cfg(unix)]
#[test]
fn write_digest_page_rejects_symlinked_index_without_creating_digest() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_index = outside.path().join("index.md");
    std::fs::write(&outside_index, "# Outside\n").unwrap();
    std::fs::remove_file(root.path().join("index.md")).unwrap();
    std::os::unix::fs::symlink(&outside_index, root.path().join("index.md")).unwrap();

    let error = write_digest_page(root.path(), "Rust", "# Rust\n").unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!root.path().join("wiki/syntheses/Rust.md").exists());
}

#[cfg(unix)]
#[test]
fn write_digest_page_rejects_symlinked_log_without_creating_digest() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_log = outside.path().join("log.md");
    std::fs::write(&outside_log, "# Outside\n").unwrap();
    std::fs::remove_file(root.path().join("log.md")).unwrap();
    std::os::unix::fs::symlink(&outside_log, root.path().join("log.md")).unwrap();

    let error = write_digest_page(root.path(), "Rust", "# Rust\n").unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert!(!root.path().join("wiki/syntheses/Rust.md").exists());
}

#[test]
fn mechanical_lint_reports_broken_wikilinks() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/A.md",
        "[[Missing]]\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("断链"));
    assert!(report.contains("[[Missing]]"));
}

#[test]
fn mechanical_lint_accepts_heading_alias_and_extension_links() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/Page.md",
        "# Heading\n".as_bytes(),
    )
    .unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/A.md",
        "[[Page#Heading|Label]]\n[[Page.md#Heading]]\n[[#Local]]\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("断链"));
    assert!(report.contains("无"));
    assert!(!report.contains("[[Page"));
}

#[test]
fn mechanical_lint_accepts_wiki_root_qualified_path_links() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(root.path(), "wiki/concepts/B.md", "# B\n".as_bytes()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/A.md",
        "[[wiki/concepts/B.md#Heading|B]]\n[[concepts/B]]\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("无"));
    assert!(!report.contains("[[wiki/concepts/B"));
    assert!(!report.contains("[[concepts/B"));
}

#[test]
fn mechanical_lint_accepts_source_relative_path_links() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(root.path(), "wiki/entities/B.md", "# B\n".as_bytes()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/A.md",
        "[[B.markdown#Heading|B]]\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("无"));
    assert!(!report.contains("[[B"));
}

#[cfg(unix)]
#[test]
fn mechanical_lint_skips_symlinked_wiki_file_without_reading_target() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_file = outside.path().join("Outside.md");
    std::fs::write(&outside_file, "[[Missing]]\n").unwrap();
    std::os::unix::fs::symlink(&outside_file, root.path().join("wiki/entities/Outside.md"))
        .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("无"));
    assert!(!report.contains("[[Missing]]"));
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
fn detect_reports_not_ready_when_llm_wiki_metadata_directory_is_missing() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join(".llm-wiki")).unwrap();

    let status = detect_llm_wiki_workspace(root.path()).unwrap();

    assert!(!status.has_llm_wiki);
    assert!(status.can_initialize);
    assert!(status.missing_paths.contains(&".llm-wiki".to_string()));
    assert!(status
        .missing_paths
        .contains(&".llm-wiki/cache.json".to_string()));
    assert!(status
        .missing_paths
        .contains(&".llm-wiki/config.json".to_string()));
}

#[cfg(unix)]
#[test]
fn detect_reports_not_ready_when_llm_wiki_metadata_directory_is_a_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join(".llm-wiki")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".llm-wiki")).unwrap();

    let status = detect_llm_wiki_workspace(root.path()).unwrap();

    assert!(!status.has_llm_wiki);
    assert!(!status.can_initialize);
    assert!(status.missing_paths.contains(&".llm-wiki".to_string()));
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

#[cfg(unix)]
#[test]
fn read_knowledge_config_rejects_llm_wiki_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::remove_dir_all(root.path().join(".llm-wiki")).unwrap();
    std::fs::write(
        outside.path().join("config.json"),
        r#"{"paused":false,"skipPaths":["raw/leaked"]}"#,
    )
    .unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".llm-wiki")).unwrap();

    let error = read_knowledge_config(root.path()).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
}

#[cfg(unix)]
#[test]
fn read_knowledge_config_rejects_config_file_symlink() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    let outside_config = outside.path().join("config.json");
    std::fs::write(
        &outside_config,
        r#"{"paused":false,"skipPaths":["raw/leaked"]}"#,
    )
    .unwrap();
    std::fs::remove_file(root.path().join(".llm-wiki/config.json")).unwrap();
    std::os::unix::fs::symlink(&outside_config, root.path().join(".llm-wiki/config.json")).unwrap();

    let error = read_knowledge_config(root.path()).unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
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
fn rescan_raw_returns_no_pending_files_when_config_is_paused() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# A\n").unwrap();
    std::fs::write(
        root.path().join(".llm-wiki/config.json"),
        r#"{"paused":true,"skipPaths":[]}"#,
    )
    .unwrap();

    let result = llm_wiki_rescan_raw(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.total, 0);
    assert!(result.pending.is_empty());
    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    assert!(progress.contains("paused"));
    assert!(!progress.contains("raw/notes/a.md"));
}

#[cfg(unix)]
#[test]
fn rescan_raw_does_not_scan_invalid_raw_when_config_is_paused() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(
        root.path().join(".llm-wiki/config.json"),
        r#"{"paused":true,"skipPaths":["raw/skipped"]}"#,
    )
    .unwrap();
    std::fs::remove_dir_all(root.path().join("raw")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("raw")).unwrap();

    let result = llm_wiki_rescan_raw(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.total, 0);
    assert!(result.pending.is_empty());
    assert_eq!(result.skipped, vec!["raw/skipped".to_string()]);
    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    assert!(progress.contains("paused"));
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
fn graph_markdown_does_not_fallback_wiki_prefix_link_to_source_relative_unknown_section() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/other")).unwrap();
    std::fs::write(
        root.path().join("wiki/entities/A.md"),
        "# A\n\n[[wiki/other/B]]\n",
    )
    .unwrap();
    std::fs::write(root.path().join("wiki/entities/other/B.md"), "# B\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(!markdown.contains(&graph_edge(
        "wiki/entities/A.md",
        "wiki/entities/other/B.md"
    )));
}

#[test]
fn graph_markdown_normalizes_dot_segments_and_root_links() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir_all(root.path().join("wiki/entities/nested")).unwrap();
    std::fs::write(
        root.path().join("wiki/entities/nested/A.md"),
        "# A\n\n[[./B]]\n[[../C]]\n[[../../outside/D]]\n[[/wiki/concepts/D]]\n[[/concepts/E]]\n",
    )
    .unwrap();
    std::fs::write(root.path().join("wiki/entities/nested/B.md"), "# B\n").unwrap();
    std::fs::write(root.path().join("wiki/entities/C.md"), "# C\n").unwrap();
    std::fs::create_dir_all(root.path().join("wiki/concepts")).unwrap();
    std::fs::write(root.path().join("wiki/concepts/D.md"), "# D\n").unwrap();
    std::fs::write(root.path().join("wiki/concepts/E.md"), "# E\n").unwrap();

    let markdown = build_knowledge_graph_markdown(root.path()).unwrap();

    assert!(markdown.contains(&graph_edge(
        "wiki/entities/nested/A.md",
        "wiki/entities/nested/B.md"
    )));
    assert!(markdown.contains(&graph_edge(
        "wiki/entities/nested/A.md",
        "wiki/entities/C.md"
    )));
    assert!(markdown.contains(&graph_edge(
        "wiki/entities/nested/A.md",
        "wiki/concepts/D.md"
    )));
    assert!(markdown.contains(&graph_edge(
        "wiki/entities/nested/A.md",
        "wiki/concepts/E.md"
    )));
    assert!(!markdown.contains("outside"));
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

#[test]
fn ingest_parse_file_blocks_returns_ordered_paths_and_strips_marker_newline() {
    let blocks = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n---FILE: index.md---\n# Index\n---END FILE---",
    )
    .unwrap();

    assert_eq!(
        blocks,
        vec![
            LlmWikiFileBlock {
                path: "wiki/sources/a.md".to_string(),
                content: "# A\n".to_string(),
            },
            LlmWikiFileBlock {
                path: "index.md".to_string(),
                content: "# Index\n".to_string(),
            },
        ]
    );
}

#[test]
fn ingest_output_path_guard_allows_only_managed_markdown_outputs() {
    assert!(is_safe_llm_wiki_output_path("wiki/entities/A.md"));
    assert!(is_safe_llm_wiki_output_path("wiki/sources/a-file_1.md"));
    assert!(is_safe_llm_wiki_output_path("index.md"));

    for path in [
        "../outside.md",
        "/tmp/outside.md",
        "wiki\\entities\\A.md",
        "raw/notes/a.md",
        ".llm-wiki/config.json",
        ".env",
        "purpose.md",
        "wiki/entities/.hidden.md",
        "",
        "wiki/./entities/A.md",
        "wiki//entities/A.md",
        "wiki/sources/café.md",
        "wiki/entities/",
        "wiki/entities/A.txt",
    ] {
        assert!(!is_safe_llm_wiki_output_path(path), "{path}");
    }
}

#[test]
fn ingest_parse_file_blocks_rejects_unsafe_output_path() {
    let error = parse_file_blocks("---FILE: raw/notes/a.md---\n# A\n---END FILE---").unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_rejects_purpose_output_path() {
    let error = parse_file_blocks("---FILE: purpose.md---\n# Purpose\n---END FILE---").unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_rejects_unicode_output_paths() {
    for output in [
        "---FILE: wiki/sources/café.md---\n# Cafe\n---END FILE---",
        "---FILE: wiki/sources/cafe\u{301}.md---\n# Cafe\n---END FILE---",
    ] {
        let error = parse_file_blocks(output).unwrap_err();

        assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
    }
}

#[test]
fn ingest_parse_file_blocks_rejects_duplicate_output_paths() {
    let error = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n---FILE: wiki/sources/a.md---\n# Again\n---END FILE---",
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "duplicate_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_rejects_case_variant_duplicate_output_paths() {
    let error = parse_file_blocks(
        "---FILE: wiki/sources/A.md---\n# A\n---END FILE---\n---FILE: wiki/sources/a.md---\n# Again\n---END FILE---",
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "duplicate_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_rejects_dot_segment_duplicate_output_paths() {
    let error = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n---FILE: wiki/./sources/a.md---\n# Again\n---END FILE---",
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_rejects_repeated_separator_output_path() {
    let error =
        parse_file_blocks("---FILE: wiki//sources/a.md---\n# A\n---END FILE---").unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
}

#[test]
fn ingest_parse_file_blocks_preserves_end_marker_text_inside_content() {
    let blocks = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n\n```text\n---END FILE---\n```\n---END FILE---",
    )
    .unwrap();

    assert_eq!(
        blocks[0].content,
        "# A\n\n```text\n---END FILE---\n```\n".to_string()
    );
}

#[test]
fn ingest_parse_file_blocks_rejects_prose_after_ambiguous_end_marker() {
    let error = parse_file_blocks(
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\nMore prose that would be truncated\n",
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_parse_failed");
}

#[test]
fn ingest_write_outputs_writes_files_and_updates_cache_entry() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A\n---END FILE---").unwrap();

    write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(root.path().join("wiki/sources/a.md")).unwrap(),
        "# A\n"
    );
    let cache: LlmWikiCache = serde_json::from_str(
        &std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
    )
    .unwrap();
    let entry = cache.entries.get("raw/notes/a.md").unwrap();
    assert_eq!(entry.source_page, "wiki/sources/a.md");
    assert_eq!(entry.hash, "sha256:test");
    assert_eq!(entry.model, "test-model");
    assert_ne!(entry.ingested_at, "now");
}

#[test]
fn ingest_write_outputs_rejects_unsafe_block_without_partial_write() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let blocks = vec![
        LlmWikiFileBlock {
            path: "wiki/sources/a.md".to_string(),
            content: "# A\n".to_string(),
        },
        LlmWikiFileBlock {
            path: "raw/notes/generated.md".to_string(),
            content: "# Bad\n".to_string(),
        },
    ];

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
    assert!(!root.path().join("wiki/sources/a.md").exists());
}

#[test]
fn ingest_write_outputs_rejects_duplicate_output_paths_without_partial_write() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let blocks = vec![
        LlmWikiFileBlock {
            path: "wiki/sources/a.md".to_string(),
            content: "# A\n".to_string(),
        },
        LlmWikiFileBlock {
            path: "wiki/sources/a.md".to_string(),
            content: "# Again\n".to_string(),
        },
    ];

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "duplicate_llm_wiki_output_path");
    assert!(!root.path().join("wiki/sources/a.md").exists());
}

#[test]
fn ingest_write_outputs_rejects_case_variant_duplicate_paths_without_partial_write_or_cache_update()
{
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let initial_cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();
    let blocks = vec![
        LlmWikiFileBlock {
            path: "wiki/sources/A.md".to_string(),
            content: "# A\n".to_string(),
        },
        LlmWikiFileBlock {
            path: "wiki/sources/a.md".to_string(),
            content: "# Again\n".to_string(),
        },
    ];

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "duplicate_llm_wiki_output_path");
    assert!(!root.path().join("wiki/sources/A.md").exists());
    assert!(!root.path().join("wiki/sources/a.md").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
        initial_cache
    );
}

#[test]
fn ingest_write_outputs_rejects_dot_segment_duplicate_paths_without_partial_write_or_cache_update()
{
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let initial_cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();
    let blocks = vec![
        LlmWikiFileBlock {
            path: "wiki/sources/a.md".to_string(),
            content: "# A\n".to_string(),
        },
        LlmWikiFileBlock {
            path: "wiki/./sources/a.md".to_string(),
            content: "# Again\n".to_string(),
        },
    ];

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
    assert!(!root.path().join("wiki/sources/a.md").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
        initial_cache
    );
}

#[test]
fn llm_wiki_managed_writer_rejects_unsafe_relative_paths_without_external_write() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    initialize_llm_wiki_workspace(&root).unwrap();

    for path in [
        "../outside.md",
        "/tmp/outside.md",
        "wiki\\sources\\a.md",
        "wiki/./sources/a.md",
        "wiki//sources/a.md",
        "",
    ] {
        let error = write_managed_file(&root, path, b"outside").unwrap_err();

        assert_eq!(error.error_code(), "invalid_llm_wiki_managed_path");
    }
    assert!(!parent.path().join("outside.md").exists());
}

#[test]
fn ingest_write_outputs_rejects_raw_path_outside_raw() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("index.md"), "# Index\n").unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A\n---END FILE---").unwrap();

    let error = write_ingest_outputs(
        root.path(),
        "index.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_raw_path");
    assert!(!root.path().join("wiki/sources/a.md").exists());
}

#[cfg(unix)]
#[test]
fn ingest_write_outputs_rejects_raw_symlink_ancestor_to_workspace_file_without_write_or_cache_update(
) {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::create_dir(root.path().join("other")).unwrap();
    std::fs::write(root.path().join("other/a.md"), "# Raw A\n").unwrap();
    std::fs::remove_dir(root.path().join("raw/notes")).unwrap();
    std::os::unix::fs::symlink(root.path().join("other"), root.path().join("raw/notes")).unwrap();
    let initial_cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A\n---END FILE---").unwrap();

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_raw_path");
    assert!(!root.path().join("wiki/sources/a.md").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
        initial_cache
    );
}

#[test]
fn ingest_mock_output_command_uses_same_safe_writer() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();

    llm_wiki_ingest_mock_output(
        root.path().to_string_lossy().into_owned(),
        "raw/notes/a.md".to_string(),
        "sha256:test".to_string(),
        "test-model".to_string(),
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(root.path().join("wiki/sources/a.md")).unwrap(),
        "# A\n"
    );
}

#[test]
fn ingest_mock_output_rejects_ambiguous_truncated_output_without_write_or_cache_update() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let initial_cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();

    let error = llm_wiki_ingest_mock_output(
        root.path().to_string_lossy().into_owned(),
        "raw/notes/a.md".to_string(),
        "sha256:test".to_string(),
        "test-model".to_string(),
        "---FILE: wiki/sources/a.md---\n# A\n---END FILE---\nMore prose that would be truncated\n"
            .to_string(),
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_parse_failed");
    assert!(!root.path().join("wiki/sources/a.md").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
        initial_cache
    );
}

#[test]
fn ingest_mock_output_rejects_unicode_output_path_without_write_or_cache_update() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let initial_cache = std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap();

    let error = llm_wiki_ingest_mock_output(
        root.path().to_string_lossy().into_owned(),
        "raw/notes/a.md".to_string(),
        "sha256:test".to_string(),
        "test-model".to_string(),
        "---FILE: wiki/sources/café.md---\n# Cafe\n---END FILE---".to_string(),
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_output_path");
    assert!(!root.path().join("wiki/sources/café.md").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join(".llm-wiki/cache.json")).unwrap(),
        initial_cache
    );
}

#[cfg(unix)]
#[test]
fn ingest_write_outputs_rejects_symlinked_output_target_without_external_write() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let outside_file = outside.path().join("a.md");
    std::fs::write(&outside_file, "outside-original").unwrap();
    std::os::unix::fs::symlink(&outside_file, root.path().join("wiki/sources/a.md")).unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A\n---END FILE---").unwrap();

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(
        std::fs::read_to_string(outside_file).unwrap(),
        "outside-original"
    );
}

#[cfg(unix)]
#[test]
fn ingest_write_outputs_rejects_symlinked_cache_file_without_external_write() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/notes/a.md"), "# Raw A\n").unwrap();
    let outside_cache = outside.path().join("cache.json");
    std::fs::write(&outside_cache, r#"{"version":1,"entries":{}}"#).unwrap();
    std::fs::remove_file(root.path().join(".llm-wiki/cache.json")).unwrap();
    std::os::unix::fs::symlink(&outside_cache, root.path().join(".llm-wiki/cache.json")).unwrap();
    let blocks = parse_file_blocks("---FILE: wiki/sources/a.md---\n# A\n---END FILE---").unwrap();

    let error = write_ingest_outputs(
        root.path(),
        "raw/notes/a.md",
        "sha256:test",
        "test-model",
        &blocks,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "path_type_conflict");
    assert_eq!(
        std::fs::read_to_string(outside_cache).unwrap(),
        r#"{"version":1,"entries":{}}"#
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
