use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
    read_knowledge_config, scan_raw_files, update_progress_markdown,
    write_knowledge_graph_markdown,
};
use crate::llm_wiki_ingest::{parse_file_blocks, write_ingest_outputs};
use crate::llm_wiki_llm::{
    default_llm_config_path, load_optional_llm_config_from_path, save_llm_config_to_path,
};
use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmProviderConfig, LlmWikiWorkspaceStatus, PublicLlmProviderConfig,
    RawScanResult,
};
use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

#[tauri::command]
pub fn llm_wiki_detect_workspace(
    root_path: String,
) -> Result<LlmWikiWorkspaceStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    detect_llm_wiki_workspace(root)
}

#[tauri::command]
pub fn llm_wiki_initialize_workspace(
    root_path: String,
) -> Result<InitializeLlmWikiResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    initialize_llm_wiki_workspace(root)
}

#[tauri::command]
pub fn llm_wiki_rescan_raw(root_path: String) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = read_knowledge_config(&root)?;
    if config.paused {
        update_progress_markdown(&root, "paused", &[], &[], &[], &config.skip_paths)?;
        return Ok(RawScanResult {
            total: 0,
            pending: Vec::new(),
            skipped: config.skip_paths,
        });
    }

    let files = scan_raw_files(&root, &config)?;
    let pending = files
        .iter()
        .map(|file| file.relative_path.clone())
        .collect::<Vec<_>>();

    update_progress_markdown(&root, "scanning", &pending, &[], &[], &config.skip_paths)?;

    Ok(RawScanResult {
        total: pending.len(),
        pending,
        skipped: config.skip_paths,
    })
}

#[tauri::command]
pub fn llm_wiki_refresh_graph(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let markdown = build_knowledge_graph_markdown(&root)?;
    write_knowledge_graph_markdown(&root, &markdown)?;
    Ok(markdown)
}

#[tauri::command]
pub fn llm_wiki_ingest_mock_output(
    root_path: String,
    raw_relative_path: String,
    hash: String,
    model: String,
    llm_output: String,
) -> Result<(), WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let blocks = parse_file_blocks(&llm_output)?;
    write_ingest_outputs(&root, &raw_relative_path, &hash, &model, &blocks)
}

#[tauri::command]
pub fn llm_config_get() -> Result<Option<PublicLlmProviderConfig>, WorkspaceError> {
    Ok(load_optional_llm_config_from_path(default_llm_config_path()?)?.map(llm_config_to_public))
}

#[tauri::command]
pub fn llm_config_set(config: LlmProviderConfig) -> Result<(), WorkspaceError> {
    save_llm_config_to_path(default_llm_config_path()?, &config)
}

pub fn llm_config_to_public(config: LlmProviderConfig) -> PublicLlmProviderConfig {
    PublicLlmProviderConfig {
        base_url: config.base_url,
        model: config.model,
        has_api_key: config.api_key.is_some(),
    }
}
