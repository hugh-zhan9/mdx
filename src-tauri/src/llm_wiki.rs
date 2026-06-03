use crate::llm_wiki_fs::{
    build_knowledge_graph_markdown, detect_llm_wiki_workspace, initialize_llm_wiki_workspace,
    read_knowledge_config, scan_raw_files, update_progress_markdown,
    write_knowledge_graph_markdown,
};
use crate::llm_wiki_ingest::{
    build_ingest_analysis_prompt, build_ingest_generation_prompt, validate_raw_relative_path,
};
use crate::llm_wiki_ingest::{parse_file_blocks, write_ingest_outputs};
use crate::llm_wiki_llm::{
    call_chat_completion, default_llm_config_path, load_llm_config_from_path,
    load_optional_llm_config_from_path, save_llm_config_to_path, LlmChatMessage,
};
use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmProviderConfig, LlmWikiQueryResponse, LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig, RawScanResult, WikiSearchResult,
};
use crate::llm_wiki_query::{
    mechanical_lint_report, read_required_managed_text, safe_read_regular_text, search_wiki_pages,
    write_digest_page,
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
pub fn llm_wiki_ingest_raw_file(
    root_path: String,
    raw_relative_path: String,
    hash: String,
) -> Result<(), WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let raw_relative_path = validate_raw_relative_path(&root, &raw_relative_path)?;
    let raw = safe_read_regular_text(&root, &root.join(&raw_relative_path), "llm wiki raw file")?;
    let purpose = read_optional_managed_text(&root, "purpose.md")?;
    let agents = read_optional_managed_text(&root, "AGENTS.md")?;
    let index = read_optional_managed_text(&root, "index.md")?;

    let analysis_prompt = build_ingest_analysis_prompt(&raw, &purpose, &agents, &index);
    let analysis_json = call_chat_completion(
        &config,
        vec![
            system_message("You analyze raw notes for a local markdown knowledge base."),
            user_message(analysis_prompt),
        ],
    )?;
    let existing_context =
        format!("# Purpose\n{purpose}\n\n# AGENTS\n{agents}\n\n# Index\n{index}\n");
    let generation_prompt = build_ingest_generation_prompt(&analysis_json, &existing_context);
    let llm_output = call_chat_completion(
        &config,
        vec![
            system_message("You generate strict markdown file blocks for an LLM Wiki parser."),
            user_message(generation_prompt),
        ],
    )?;
    let blocks = parse_file_blocks(&llm_output)?;
    write_ingest_outputs(&root, &raw_relative_path, &hash, &config.model, &blocks)
}

#[tauri::command]
pub fn llm_wiki_search(
    root_path: String,
    query: String,
) -> Result<Vec<WikiSearchResult>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    search_wiki_pages(root, &query)
}

#[tauri::command]
pub fn llm_wiki_query(
    root_path: String,
    question: String,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let references = search_wiki_pages(&root, &question)?;
    if references.is_empty() {
        return Ok(LlmWikiQueryResponse {
            answer: "当前知识库中没有足够上下文回答这个问题。".to_string(),
            references,
            insufficient_context: true,
        });
    }

    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let context = build_query_context(&root, &references)?;
    let answer = call_chat_completion(
        &config,
        vec![
            system_message(
                "You answer using only the supplied LLM Wiki context. If the context is insufficient, say so in Chinese.",
            ),
            user_message(format!(
                "Question:\n{question}\n\nWiki context:\n{context}\n\nAnswer in Chinese. Do not use information outside the wiki context."
            )),
        ],
    )?;

    Ok(LlmWikiQueryResponse {
        answer,
        references,
        insufficient_context: false,
    })
}

#[tauri::command]
pub fn llm_wiki_digest_mock(
    root_path: String,
    title: String,
    content: String,
) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    write_digest_page(root, &title, &content)
}

#[tauri::command]
pub fn llm_wiki_lint(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    mechanical_lint_report(root)
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

fn read_optional_managed_text(
    root: &std::path::Path,
    relative: &str,
) -> Result<String, WorkspaceError> {
    match read_required_managed_text(root, relative) {
        Ok(contents) => Ok(contents),
        Err(error) if error.error_code() == "not_found" => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn build_query_context(
    root: &std::path::Path,
    references: &[WikiSearchResult],
) -> Result<String, WorkspaceError> {
    let mut context = String::new();
    for reference in references.iter().take(8) {
        let contents = safe_read_regular_text(root, &root.join(&reference.path), "wiki page")?;
        context.push_str("---PAGE: ");
        context.push_str(&reference.path);
        context.push_str("---\n");
        context.push_str(&contents);
        if !contents.ends_with('\n') {
            context.push('\n');
        }
    }
    Ok(context)
}

fn system_message(content: &str) -> LlmChatMessage {
    LlmChatMessage {
        role: "system".to_string(),
        content: content.to_string(),
    }
}

fn user_message(content: String) -> LlmChatMessage {
    LlmChatMessage {
        role: "user".to_string(),
        content,
    }
}
