use std::collections::BTreeSet;
use std::path::Path;

use crate::llm_wiki_fs::{
    append_log_entry, build_knowledge_graph_markdown, detect_llm_wiki_workspace,
    ensure_default_agents_rules, initialize_llm_wiki_workspace, raw_file_hash, raw_file_metadata,
    read_knowledge_config, read_llm_wiki_log, scan_raw_file_metadata, update_progress_markdown,
    update_progress_markdown_with_processing, write_knowledge_config,
    write_knowledge_graph_markdown,
};
use crate::llm_wiki_ingest::{
    build_ingest_analysis_prompt, build_ingest_generation_prompt, read_cache,
    validate_raw_relative_path,
};
use crate::llm_wiki_ingest::{parse_file_blocks, write_ingest_outputs};
use crate::llm_wiki_llm::{
    call_chat_completion, default_llm_config_path, load_llm_config_from_path,
    load_optional_llm_config_from_path, save_llm_config_to_path, LlmChatMessage,
};
use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmProviderConfig, LlmProviderConfigUpdate, LlmWikiKnowledgeConfig,
    LlmWikiQueryResponse, LlmWikiWorkspaceStatus, PublicLlmProviderConfig, RawScanResult,
    WikiSearchResult,
};
use crate::llm_wiki_query::{
    mechanical_lint_report, read_required_managed_text, safe_read_regular_text, search_wiki_pages,
    write_digest_page,
};
use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

const RAW_RESCAN_PENDING_BATCH_SIZE: usize = 5;

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, WorkspaceError> + Send + 'static,
) -> Result<T, WorkspaceError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            WorkspaceError::new(
                "background_task_failed",
                format!("failed to join llm wiki background task: {error}"),
            )
        })?
}

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
pub async fn llm_wiki_rescan_raw(
    root_path: String,
    excluded_pending_paths: Option<Vec<String>>,
) -> Result<RawScanResult, WorkspaceError> {
    run_blocking(move || {
        let excluded_pending_paths = excluded_pending_paths.unwrap_or_default();
        if excluded_pending_paths.is_empty() {
            llm_wiki_rescan_raw_sync(root_path)
        } else {
            llm_wiki_rescan_raw_sync_with_exclusions(root_path, excluded_pending_paths)
        }
    })
    .await
}

pub fn llm_wiki_rescan_raw_sync(root_path: String) -> Result<RawScanResult, WorkspaceError> {
    llm_wiki_rescan_raw_sync_with_exclusions(root_path, Vec::new())
}

pub fn llm_wiki_rescan_raw_sync_with_exclusions(
    root_path: String,
    excluded_pending_paths: Vec<String>,
) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    ensure_default_agents_rules(&root)?;
    let config = read_knowledge_config(&root)?;
    if config.paused {
        update_progress_markdown(&root, "paused", &[], &[], &[], &config.skip_paths)?;
        return Ok(RawScanResult {
            total: 0,
            pending: Vec::new(),
            completed: Vec::new(),
            skipped: config.skip_paths,
        });
    }

    let excluded_pending_paths = normalize_excluded_pending_paths(excluded_pending_paths);
    let progress = scan_raw_progress(&root, &config, &excluded_pending_paths)?;

    let progress_status = if progress.pending.is_empty() {
        "completed"
    } else {
        "scanning"
    };

    update_progress_markdown(
        &root,
        progress_status,
        &progress.pending,
        &progress.completed,
        &[],
        &config.skip_paths,
    )?;

    Ok(RawScanResult {
        total: progress.total,
        pending: progress.pending,
        completed: progress.completed,
        skipped: config.skip_paths,
    })
}

#[tauri::command]
pub async fn llm_wiki_refresh_graph(root_path: String) -> Result<String, WorkspaceError> {
    run_blocking(move || llm_wiki_refresh_graph_sync(root_path)).await
}

pub fn llm_wiki_refresh_graph_sync(root_path: String) -> Result<String, WorkspaceError> {
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
pub async fn llm_wiki_ingest_raw_file(
    root_path: String,
    raw_relative_path: String,
) -> Result<(), WorkspaceError> {
    run_blocking(move || llm_wiki_ingest_raw_file_sync(root_path, raw_relative_path)).await
}

pub fn llm_wiki_ingest_raw_file_sync(
    root_path: String,
    raw_relative_path: String,
) -> Result<(), WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let knowledge_config = read_knowledge_config(&root)?;
    let raw_relative_path = validate_raw_relative_path(&root, &raw_relative_path)?;
    if knowledge_config
        .skip_paths
        .iter()
        .map(|path| path.trim().trim_matches('/').replace('\\', "/"))
        .any(|skip_path| {
            raw_relative_path == skip_path
                || raw_relative_path.starts_with(&format!("{skip_path}/"))
        })
    {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_raw_path",
            "llm wiki raw path is skipped by the current config",
        ));
    }
    raw_file_metadata(&root, &raw_relative_path)?;
    ensure_default_agents_rules(&root)?;
    let raw = safe_read_regular_text(&root, &root.join(&raw_relative_path), "llm wiki raw file")?;
    let hash = raw_file_hash(&raw_relative_path, raw.as_bytes());
    let purpose = read_optional_managed_text(&root, "purpose.md")?;
    let agents = read_optional_managed_text(&root, "AGENTS.md")?;
    let index = read_optional_managed_text(&root, "index.md")?;
    let _ = update_ingest_processing_progress(&root, &knowledge_config, &raw_relative_path);

    let analysis_prompt = build_ingest_analysis_prompt(&raw, &purpose, &agents, &index);
    let analysis_json = match call_chat_completion(
        &config,
        vec![
            system_message("You analyze raw notes for a local markdown knowledge base."),
            user_message(analysis_prompt),
        ],
    ) {
        Ok(output) => output,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!("ingest failed {raw_relative_path} analysis: {error}"),
            );
            return Err(error);
        }
    };
    let existing_context =
        format!("# Purpose\n{purpose}\n\n# AGENTS\n{agents}\n\n# Index\n{index}\n");
    let generation_prompt = build_ingest_generation_prompt(&analysis_json, &existing_context);
    let llm_output = match call_chat_completion(
        &config,
        vec![
            system_message("You generate strict markdown file blocks for an LLM Wiki parser."),
            user_message(generation_prompt),
        ],
    ) {
        Ok(output) => output,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!("ingest failed {raw_relative_path} generation: {error}"),
            );
            return Err(error);
        }
    };
    let blocks = match parse_file_blocks(&llm_output) {
        Ok(blocks) => blocks,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!(
                    "ingest failed {raw_relative_path} parse: {error}; llm output preview: {}",
                    llm_output_preview(&llm_output)
                ),
            );
            return Err(error);
        }
    };
    write_ingest_outputs(&root, &raw_relative_path, &hash, &config.model, &blocks)
}

struct RawProgressSnapshot {
    total: usize,
    pending: Vec<String>,
    completed: Vec<String>,
}

fn scan_raw_progress(
    root: &Path,
    config: &LlmWikiKnowledgeConfig,
    excluded_pending_paths: &BTreeSet<String>,
) -> Result<RawProgressSnapshot, WorkspaceError> {
    let files = scan_raw_file_metadata(root, config)?;
    let cache = read_cache(root)?;
    let mut pending = Vec::new();
    let mut completed = Vec::new();

    for file in &files {
        match cache.entries.get(&file.relative_path) {
            Some(entry)
                if entry.raw_size == Some(file.size)
                    && entry.raw_modified_ms == file.modified_ms =>
            {
                completed.push(file.relative_path.clone());
            }
            _ => {
                if pending.len() < RAW_RESCAN_PENDING_BATCH_SIZE
                    && !excluded_pending_paths.contains(&file.relative_path)
                {
                    pending.push(file.relative_path.clone());
                }
            }
        }
    }

    Ok(RawProgressSnapshot {
        total: files.len(),
        pending,
        completed,
    })
}

fn update_ingest_processing_progress(
    root: &Path,
    config: &LlmWikiKnowledgeConfig,
    raw_relative_path: &str,
) -> Result<(), WorkspaceError> {
    let excluded = BTreeSet::from([raw_relative_path.to_string()]);
    let progress = scan_raw_progress(root, config, &excluded)?;
    update_progress_markdown_with_processing(
        root,
        "processing",
        &progress.pending,
        &[raw_relative_path.to_string()],
        &progress.completed,
        &[],
        &config.skip_paths,
    )
}

fn normalize_excluded_pending_paths(paths: Vec<String>) -> BTreeSet<String> {
    paths
        .into_iter()
        .map(|path| path.trim().trim_matches('/').replace('\\', "/"))
        .filter(|path| path.starts_with("raw/"))
        .collect()
}

fn llm_output_preview(output: &str) -> String {
    const PREVIEW_LIMIT: usize = 800;
    let mut preview = output
        .chars()
        .take(PREVIEW_LIMIT)
        .collect::<String>()
        .replace(
            |character: char| character.is_control() && character != '\n',
            " ",
        );
    if output.chars().count() > PREVIEW_LIMIT {
        preview.push_str("...");
    }
    preview.trim().to_string()
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
pub async fn llm_wiki_query(
    root_path: String,
    question: String,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    run_blocking(move || llm_wiki_query_sync(root_path, question)).await
}

pub fn llm_wiki_query_sync(
    root_path: String,
    question: String,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let references = search_wiki_pages(&root, &question)?;
    append_log_entry(&root, &format!("query {}", question.trim()))?;
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
pub async fn llm_wiki_digest(
    root_path: String,
    title: String,
    prompt: String,
) -> Result<String, WorkspaceError> {
    run_blocking(move || llm_wiki_digest_sync(root_path, title, prompt)).await
}

pub fn llm_wiki_digest_sync(
    root_path: String,
    title: String,
    prompt: String,
) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let references = search_wiki_pages(&root, &format!("{title}\n{prompt}"))?;
    if references.is_empty() {
        return Err(WorkspaceError::new(
            "insufficient_context",
            "当前知识库中没有足够上下文生成综述。",
        ));
    }

    let context = build_query_context(&root, &references)?;
    let content = call_chat_completion(
        &config,
        vec![
            system_message(
                "You write concise LLM Wiki synthesis pages using only the supplied wiki context. Use Markdown and wikilinks where useful.",
            ),
            user_message(format!(
                "Digest title:\n{title}\n\nDigest request:\n{prompt}\n\nWiki context:\n{context}\n\nWrite the complete markdown page in Chinese. Do not use information outside the wiki context."
            )),
        ],
    )?;
    write_digest_page(root, &title, &content)
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
    let report = mechanical_lint_report(&root)?;
    append_log_entry(&root, "lint")?;
    Ok(report)
}

#[tauri::command]
pub fn llm_wiki_get_config(root_path: String) -> Result<LlmWikiKnowledgeConfig, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    read_knowledge_config(root)
}

#[tauri::command]
pub fn llm_wiki_update_config(
    root_path: String,
    paused: bool,
    skip_paths: Option<Vec<String>>,
) -> Result<LlmWikiKnowledgeConfig, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let mut config = read_knowledge_config(&root)?;
    config.paused = paused;
    if let Some(skip_paths) = skip_paths {
        config.skip_paths = skip_paths;
    }
    write_knowledge_config(&root, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn llm_wiki_get_log(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    read_llm_wiki_log(root)
}

#[tauri::command]
pub fn llm_config_get() -> Result<Option<PublicLlmProviderConfig>, WorkspaceError> {
    Ok(load_optional_llm_config_from_path(default_llm_config_path()?)?.map(llm_config_to_public))
}

#[tauri::command]
pub fn llm_config_set(config: LlmProviderConfig) -> Result<(), WorkspaceError> {
    save_llm_config_to_path(default_llm_config_path()?, &config)
}

#[tauri::command]
pub fn llm_config_update(
    config: LlmProviderConfigUpdate,
) -> Result<PublicLlmProviderConfig, WorkspaceError> {
    let path = default_llm_config_path()?;
    let existing = if config.preserve_api_key {
        load_optional_llm_config_from_path(&path)?
    } else {
        None
    };
    let api_key = if config.preserve_api_key {
        existing.and_then(|config| config.api_key)
    } else {
        config
            .api_key
            .map(|api_key| api_key.trim().to_string())
            .filter(|api_key| !api_key.is_empty())
    };
    let next = LlmProviderConfig {
        base_url: config.base_url.trim().to_string(),
        model: config.model.trim().to_string(),
        api_key,
        api_mode: normalize_llm_api_mode(&config.api_mode)?,
    };

    save_llm_config_to_path(path, &next)?;
    Ok(llm_config_to_public(next))
}

pub fn llm_config_to_public(config: LlmProviderConfig) -> PublicLlmProviderConfig {
    PublicLlmProviderConfig {
        base_url: config.base_url,
        model: config.model,
        api_mode: normalize_public_llm_api_mode(&config.api_mode),
        has_api_key: config.api_key.is_some(),
    }
}

fn normalize_llm_api_mode(api_mode: &str) -> Result<String, WorkspaceError> {
    match api_mode.trim() {
        "" | "chat" => Ok("chat".to_string()),
        "responses" => Ok("responses".to_string()),
        other => Err(WorkspaceError::new(
            "llm_config_save_failed",
            format!("unsupported llm api mode: {other}"),
        )),
    }
}

fn normalize_public_llm_api_mode(api_mode: &str) -> String {
    match api_mode.trim() {
        "responses" => "responses".to_string(),
        _ => "chat".to_string(),
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
