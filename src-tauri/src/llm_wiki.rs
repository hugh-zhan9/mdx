use std::fs;

use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
    read_knowledge_config, scan_raw_files, update_progress_markdown,
};
use crate::llm_wiki_models::{InitializeLlmWikiResult, LlmWikiWorkspaceStatus, RawScanResult};
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
    fs::write(root.join("wiki/knowledge-graph.md"), &markdown).map_err(|error| {
        WorkspaceError::from_io(
            "write_failed",
            "failed to write llm wiki knowledge graph",
            &error,
        )
    })?;
    Ok(markdown)
}
