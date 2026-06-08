use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::OnceLock;

use crate::llm_wiki_context::{
    build_page_selection_prompt, build_wiki_context_with_selector_output, validate_wiki_page_path,
    WikiContextRequest,
};
use crate::llm_wiki_fs::{
    append_log_entry, build_knowledge_graph_markdown, detect_llm_wiki_workspace,
    ensure_default_agents_rules, initialize_llm_wiki_workspace, raw_file_metadata,
    read_knowledge_config, read_llm_wiki_log, scan_raw_file_metadata, update_progress_markdown,
    update_progress_markdown_with_processing, write_knowledge_config,
    write_knowledge_graph_markdown,
};
use crate::llm_wiki_ingest::{
    build_ingest_analysis_prompt, build_ingest_generation_prompt, read_cache,
    validate_raw_relative_path,
};
use crate::llm_wiki_ingest::{parse_file_blocks, write_ingest_outputs};
use crate::llm_wiki_links::{extract_stable_wikilinks, resolve_wiki_link_target};
use crate::llm_wiki_llm::{
    call_chat_completion_with_control, default_llm_config_path, load_llm_config_from_path,
    load_optional_llm_config_from_path, save_llm_config_to_path, LlmCallControl, LlmChatMessage,
};
use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmProviderConfig, LlmProviderConfigUpdate, LlmWikiFailedFile,
    LlmWikiKnowledgeConfig, LlmWikiOperationState, LlmWikiQueryResponse, LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig, RawScanResult, WikiContextBundle, WikiSearchResult,
};
use crate::llm_wiki_operation::{ensure_not_cancelled, LlmWikiOperationRegistry};
use crate::llm_wiki_query::{
    mechanical_lint_report, read_required_managed_text, search_wiki_pages, write_digest_page,
};
use crate::llm_wiki_raw::prepare_raw_source;
use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

const RAW_RESCAN_PENDING_BATCH_SIZE: usize = 5;
const DEFAULT_SELECTED_PAGE_LIMIT: usize = 8;
const DEFAULT_EXPANDED_PAGE_LIMIT: usize = 8;
const DEFAULT_CONTEXT_LIMIT_BYTES: usize = 64 * 1024;

fn operation_registry() -> &'static LlmWikiOperationRegistry {
    static REGISTRY: OnceLock<LlmWikiOperationRegistry> = OnceLock::new();
    REGISTRY.get_or_init(LlmWikiOperationRegistry::new)
}

struct OperationGuard {
    operation_id: Option<String>,
}

impl OperationGuard {
    fn operation_id(&self) -> Option<String> {
        self.operation_id.clone()
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        finish_operation(self.operation_id.as_deref());
    }
}

fn begin_operation(
    operation_id: Option<String>,
    operation: &str,
) -> Result<OperationGuard, WorkspaceError> {
    if let Some(operation_id) = operation_id.as_deref() {
        operation_registry().start_with_id(operation_id, operation)?;
    }
    Ok(OperationGuard { operation_id })
}

fn set_operation_stage(operation_id: Option<&str>, stage: &str) -> Result<(), WorkspaceError> {
    if let Some(operation_id) = operation_id {
        let registry = operation_registry();
        registry.set_stage(operation_id, stage)?;
        ensure_not_cancelled(registry, operation_id)?;
    }
    Ok(())
}

fn llm_call_control(operation_id: Option<&str>) -> LlmCallControl {
    let Some(operation_id) = operation_id else {
        return LlmCallControl::default();
    };
    let operation_id = operation_id.to_string();
    LlmCallControl::new_cancel_checker(move || operation_registry().is_cancelled(&operation_id))
}

fn call_chat_completion_for_operation(
    config: &LlmProviderConfig,
    messages: Vec<LlmChatMessage>,
    operation_id: Option<&str>,
) -> Result<String, WorkspaceError> {
    call_chat_completion_with_control(config, messages, llm_call_control(operation_id))
}

fn finish_operation(operation_id: Option<&str>) {
    if let Some(operation_id) = operation_id {
        operation_registry().finish(operation_id);
    }
}

fn write_digest_page_after_synthesis(
    root: &Path,
    title: &str,
    content: &str,
    operation_id: Option<&str>,
) -> Result<String, WorkspaceError> {
    set_operation_stage(operation_id, "writing_synthesis")?;
    write_digest_page(root, title, content)
}

#[cfg(test)]
pub(crate) fn register_llm_wiki_operation_for_test(
    operation_id: Option<String>,
    operation: &str,
) -> Result<(), WorkspaceError> {
    if let Some(operation_id) = operation_id.as_deref() {
        operation_registry().start_with_id(operation_id, operation)?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn write_digest_page_after_synthesis_for_test(
    root: &Path,
    title: &str,
    content: &str,
    operation_id: &str,
) -> Result<String, WorkspaceError> {
    write_digest_page_after_synthesis(root, title, content, Some(operation_id))
}

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
pub fn llm_wiki_operation_cancel(operation_id: String) -> Result<(), WorkspaceError> {
    operation_registry().cancel(&operation_id)
}

#[tauri::command]
pub fn llm_wiki_operation_state(
    operation_id: String,
) -> Result<LlmWikiOperationState, WorkspaceError> {
    operation_registry().state(&operation_id)
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
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<RawScanResult, WorkspaceError> {
    run_blocking(move || {
        llm_wiki_rescan_raw_sync_with_failures(
            root_path,
            excluded_pending_paths.unwrap_or_default(),
            failed,
        )
    })
    .await
}

pub fn llm_wiki_rescan_raw_sync(root_path: String) -> Result<RawScanResult, WorkspaceError> {
    llm_wiki_rescan_raw_sync_with_failures(root_path, Vec::new(), None)
}

pub fn llm_wiki_rescan_raw_sync_with_exclusions(
    root_path: String,
    excluded_pending_paths: Vec<String>,
) -> Result<RawScanResult, WorkspaceError> {
    llm_wiki_rescan_raw_sync_with_failures(root_path, excluded_pending_paths, None)
}

pub fn llm_wiki_rescan_raw_sync_with_failures(
    root_path: String,
    excluded_pending_paths: Vec<String>,
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    ensure_default_agents_rules(&root)?;
    let config = read_knowledge_config(&root)?;
    let mut failed = merged_progress_failure_map(&root, failed)?;
    if config.paused {
        let progress_failed = failed_map_to_progress_entries(&failed);
        let model_failed = failed_map_to_model_entries(&failed);
        update_progress_markdown(
            &root,
            "paused",
            &[],
            &[],
            &progress_failed,
            &config.skip_paths,
        )?;
        return Ok(RawScanResult {
            total: 0,
            pending_total: 0,
            pending: Vec::new(),
            completed: Vec::new(),
            failed: model_failed,
            skipped: config.skip_paths,
        });
    }

    let excluded_pending_paths = normalize_excluded_pending_paths(excluded_pending_paths);
    let failed_paths = failed.keys().cloned().collect::<BTreeSet<_>>();
    let progress = scan_raw_progress(&root, &config, &excluded_pending_paths, &failed_paths)?;
    let completed_paths = progress.completed.iter().collect::<BTreeSet<_>>();
    remove_completed_failures(&mut failed, &completed_paths);
    let progress_failed = failed_map_to_progress_entries(&failed);
    let model_failed = failed_map_to_model_entries(&failed);

    let progress_status = if progress.pending_total == 0 {
        "completed"
    } else {
        "scanning"
    };

    update_progress_markdown(
        &root,
        progress_status,
        &progress.pending,
        &progress.completed,
        &progress_failed,
        &config.skip_paths,
    )?;

    Ok(RawScanResult {
        total: progress.total,
        pending_total: progress.pending_total,
        pending: progress.pending,
        completed: progress.completed,
        failed: model_failed,
        skipped: config.skip_paths,
    })
}

fn merged_progress_failure_map(
    root: &Path,
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<BTreeMap<String, String>, WorkspaceError> {
    let mut merged = read_progress_failed_entries(root)?;
    if let Some(failed) = failed {
        for (path, reason) in normalize_failed_files(failed) {
            merged.insert(path, reason);
        }
    }

    Ok(merged)
}

fn remove_completed_failures(
    failed: &mut BTreeMap<String, String>,
    completed_paths: &BTreeSet<&String>,
) {
    for path in completed_paths {
        failed.remove(*path);
    }
}

fn failed_map_to_progress_entries(failed: &BTreeMap<String, String>) -> Vec<(String, String)> {
    failed
        .iter()
        .map(|(path, reason)| (path.clone(), reason.clone()))
        .collect()
}

fn failed_map_to_model_entries(failed: &BTreeMap<String, String>) -> Vec<LlmWikiFailedFile> {
    failed
        .iter()
        .map(|(path, reason)| LlmWikiFailedFile {
            path: path.clone(),
            reason: reason.clone(),
        })
        .collect()
}

fn read_progress_failed_entries(root: &Path) -> Result<BTreeMap<String, String>, WorkspaceError> {
    let contents = match read_required_managed_text(root, "llm-wiki-progress.md") {
        Ok(contents) => contents,
        Err(error) if error.error_code() == "not_found" => return Ok(BTreeMap::new()),
        Err(error) => return Err(error),
    };

    let mut failed = BTreeMap::new();
    let Some(section) = progress_section(&contents, "Failed") else {
        return Ok(failed);
    };
    for line in section.lines().map(str::trim) {
        let Some(item) = line.strip_prefix("- ") else {
            continue;
        };
        if item == "None" {
            continue;
        }
        let Some((path, reason)) = item.split_once(": ") else {
            continue;
        };
        let path = path.trim().trim_matches('/').replace('\\', "/");
        if !path.starts_with("raw/") {
            continue;
        }
        let reason = reason.trim();
        if reason.is_empty() {
            continue;
        }
        failed.insert(path, reason.to_string());
    }

    Ok(failed)
}

fn progress_section<'a>(contents: &'a str, title: &str) -> Option<&'a str> {
    let heading = format!("## {title}");
    let (_, after_heading) = contents.split_once(&heading)?;
    Some(
        after_heading
            .split_once("\n## ")
            .map(|(section, _)| section)
            .unwrap_or(after_heading),
    )
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
    operation_id: Option<String>,
) -> Result<(), WorkspaceError> {
    let operation = begin_operation(operation_id, "ingest")?;
    let operation_id = operation.operation_id();
    run_blocking(move || {
        let _operation = operation;
        llm_wiki_ingest_raw_file_sync_with_operation(root_path, raw_relative_path, operation_id)
    })
    .await
}

#[allow(dead_code)]
pub fn llm_wiki_ingest_raw_file_sync(
    root_path: String,
    raw_relative_path: String,
) -> Result<(), WorkspaceError> {
    llm_wiki_ingest_raw_file_sync_with_operation(root_path, raw_relative_path, None)
}

pub(crate) fn llm_wiki_ingest_raw_file_sync_with_operation(
    root_path: String,
    raw_relative_path: String,
    operation_id: Option<String>,
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
    let raw_source = match prepare_raw_source(&root, &raw_relative_path) {
        Ok(raw_source) => raw_source,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!("ingest failed {raw_relative_path} raw source: {error}"),
            );
            return Err(error);
        }
    };
    set_operation_stage(operation_id.as_deref(), "reading_index")?;
    let purpose = read_optional_managed_text(&root, "purpose.md")?;
    let agents = read_optional_managed_text(&root, "AGENTS.md")?;
    let index = read_optional_managed_text(&root, "index.md")?;
    let _ = update_ingest_processing_progress(&root, &knowledge_config, &raw_relative_path);

    set_operation_stage(operation_id.as_deref(), "analyzing_raw")?;
    let analysis_prompt = build_ingest_analysis_prompt(&raw_source.text, &purpose, &agents, &index);
    let analysis_json = match call_chat_completion_for_operation(
        &config,
        vec![
            system_message("You analyze raw notes for a local markdown knowledge base."),
            user_message(analysis_prompt),
        ],
        operation_id.as_deref(),
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
    let selection_prompt = format!("{raw_relative_path}\n{analysis_json}");
    let related_context = related_context_or_log_failure(
        &root,
        &raw_relative_path,
        select_wiki_context_from_index(
            &root,
            &config,
            "ingest",
            &selection_prompt,
            index.clone(),
            operation_id.as_deref(),
        ),
    )?;
    let existing_context = format!(
        "# Purpose\n{purpose}\n\n# AGENTS\n{agents}\n\n# Index\n{index}\n\n# Related Wiki Pages\n{related_context}\n"
    );
    set_operation_stage(operation_id.as_deref(), "generating_updates")?;
    let generation_prompt = build_ingest_generation_prompt(&analysis_json, &existing_context);
    let llm_output = match call_chat_completion_for_operation(
        &config,
        vec![
            system_message("You generate strict markdown file blocks for an LLM Wiki parser."),
            user_message(generation_prompt),
        ],
        operation_id.as_deref(),
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
    set_operation_stage(operation_id.as_deref(), "writing_pages")?;
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
    set_operation_stage(operation_id.as_deref(), "writing_pages")?;
    write_ingest_outputs(
        &root,
        &raw_relative_path,
        &raw_source.hash,
        &config.model,
        &blocks,
    )?;
    set_operation_stage(operation_id.as_deref(), "completed")?;
    finish_operation(operation_id.as_deref());
    Ok(())
}

struct RawProgressSnapshot {
    total: usize,
    pending_total: usize,
    pending: Vec<String>,
    completed: Vec<String>,
}

fn scan_raw_progress(
    root: &Path,
    config: &LlmWikiKnowledgeConfig,
    excluded_pending_paths: &BTreeSet<String>,
    failed_paths: &BTreeSet<String>,
) -> Result<RawProgressSnapshot, WorkspaceError> {
    let files = scan_raw_file_metadata(root, config)?;
    let cache = read_cache(root)?;
    let mut pending_total = 0;
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
                if failed_paths.contains(&file.relative_path) {
                    continue;
                }
                pending_total += 1;
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
        pending_total,
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
    let failed = read_progress_failed_entries(root).unwrap_or_default();
    let failed_paths = failed.keys().cloned().collect::<BTreeSet<_>>();
    let progress = scan_raw_progress(root, config, &excluded, &failed_paths)?;
    let failed = failed_map_to_progress_entries(&failed);
    update_progress_markdown_with_processing(
        root,
        "processing",
        &progress.pending,
        &[raw_relative_path.to_string()],
        &progress.completed,
        &failed,
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

fn normalize_failed_files(files: Vec<LlmWikiFailedFile>) -> Vec<(String, String)> {
    files
        .into_iter()
        .filter_map(|file| {
            let path = file.path.trim().trim_matches('/').replace('\\', "/");
            if !path.starts_with("raw/") {
                return None;
            }
            let reason = file
                .reason
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let reason = if reason.is_empty() {
                "unknown".to_string()
            } else {
                reason
            };
            Some((path, reason))
        })
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
    let results = search_wiki_pages(&root, &query)?;
    if !query.trim().is_empty() {
        append_log_entry(&root, &format!("search {}", query.trim()))?;
    }
    Ok(results)
}

#[tauri::command]
pub async fn llm_wiki_query(
    root_path: String,
    question: String,
    operation_id: Option<String>,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let operation = begin_operation(operation_id, "query")?;
    let operation_id = operation.operation_id();
    run_blocking(move || {
        let _operation = operation;
        llm_wiki_query_sync_with_operation(root_path, question, operation_id)
    })
    .await
}

pub fn llm_wiki_query_sync(
    root_path: String,
    question: String,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    llm_wiki_query_sync_with_operation(root_path, question, None)
}

pub(crate) fn llm_wiki_query_sync_with_operation(
    root_path: String,
    question: String,
    operation_id: Option<String>,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_question",
            "llm wiki query question cannot be empty",
        ));
    }

    append_log_entry(&root, &format!("query {question}"))?;
    set_operation_stage(operation_id.as_deref(), "reading_index")?;
    let index = read_optional_managed_text(&root, "index.md")?;
    if !index_has_wiki_page_candidates(&index) {
        set_operation_stage(operation_id.as_deref(), "completed")?;
        finish_operation(operation_id.as_deref());
        return Ok(insufficient_query_context(Vec::new()));
    }

    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let context = select_wiki_context_with_index(
        &root,
        &config,
        "query",
        &question,
        index,
        operation_id.as_deref(),
    )?;
    let references = wiki_context_references_to_search_results(context.references);
    if context.markdown.trim().is_empty() || references.is_empty() {
        set_operation_stage(operation_id.as_deref(), "completed")?;
        finish_operation(operation_id.as_deref());
        return Ok(insufficient_query_context(references));
    }

    set_operation_stage(operation_id.as_deref(), "answering")?;
    let answer = call_chat_completion_for_operation(
        &config,
        vec![
            system_message(
                "You answer using only the supplied LLM Wiki context. Do not use raw documents. If the context is insufficient, say so in Chinese.",
            ),
            user_message(format!(
                "Question:\n{question}\n\nWiki context:\n{}\n\nAnswer in Chinese. Do not use information outside the wiki context or any raw documents.",
                context.markdown
            )),
        ],
        operation_id.as_deref(),
    )?;

    let response = LlmWikiQueryResponse {
        answer,
        references,
        insufficient_context: false,
    };
    set_operation_stage(operation_id.as_deref(), "completed")?;
    finish_operation(operation_id.as_deref());
    Ok(response)
}

#[tauri::command]
pub async fn llm_wiki_digest(
    root_path: String,
    title: String,
    prompt: String,
    operation_id: Option<String>,
) -> Result<String, WorkspaceError> {
    let operation = begin_operation(operation_id, "digest")?;
    let operation_id = operation.operation_id();
    run_blocking(move || {
        let _operation = operation;
        llm_wiki_digest_sync_with_operation(root_path, title, prompt, operation_id)
    })
    .await
}

#[allow(dead_code)]
pub fn llm_wiki_digest_sync(
    root_path: String,
    title: String,
    prompt: String,
) -> Result<String, WorkspaceError> {
    llm_wiki_digest_sync_with_operation(root_path, title, prompt, None)
}

pub(crate) fn llm_wiki_digest_sync_with_operation(
    root_path: String,
    title: String,
    prompt: String,
    operation_id: Option<String>,
) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    set_operation_stage(operation_id.as_deref(), "reading_index")?;
    let index = read_optional_managed_text(&root, "index.md")?;
    if !index_has_wiki_page_candidates(&index) {
        return Err(insufficient_digest_context());
    }

    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let context = select_wiki_context_with_index(
        &root,
        &config,
        "digest",
        &format!("{title}\n{prompt}"),
        index,
        operation_id.as_deref(),
    )?;
    if context.markdown.trim().is_empty() || context.references.is_empty() {
        return Err(insufficient_digest_context());
    }

    set_operation_stage(operation_id.as_deref(), "writing_synthesis")?;
    let content = call_chat_completion_for_operation(
        &config,
        vec![
            system_message(
                "You write concise LLM Wiki synthesis pages using only the supplied wiki context. Use Markdown and wikilinks where useful.",
            ),
            user_message(format!(
                "Digest title:\n{title}\n\nDigest request:\n{prompt}\n\nWiki context:\n{}\n\nWrite the complete markdown page in Chinese. Do not use information outside the wiki context or any raw documents.",
                context.markdown
            )),
        ],
        operation_id.as_deref(),
    )?;
    let path = write_digest_page_after_synthesis(&root, &title, &content, operation_id.as_deref())?;
    set_operation_stage(operation_id.as_deref(), "completed")?;
    finish_operation(operation_id.as_deref());
    Ok(path)
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
pub fn llm_wiki_lint(
    root_path: String,
    operation_id: Option<String>,
) -> Result<String, WorkspaceError> {
    let operation = begin_operation(operation_id, "lint")?;
    let operation_id = operation.operation_id();
    llm_wiki_lint_with_operation(root_path, operation_id)
}

pub(crate) fn llm_wiki_lint_with_operation(
    root_path: String,
    operation_id: Option<String>,
) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    set_operation_stage(operation_id.as_deref(), "mechanical_linting")?;
    let mut report = mechanical_lint_report(&root)?;
    let config = load_optional_llm_config_from_path(default_llm_config_path()?)?;
    if let Some(config) = config {
        set_operation_stage(operation_id.as_deref(), "semantic_linting")?;
        let index = read_optional_managed_text(&root, "index.md")?;
        let prompt = build_semantic_lint_prompt(&index, &report);
        match call_chat_completion_for_operation(
            &config,
            vec![
                system_message("You review local markdown knowledge base health."),
                user_message(prompt),
            ],
            operation_id.as_deref(),
        ) {
            Ok(semantic_report) => {
                report.push_str("## LLM 语义检查\n");
                report.push_str(semantic_report.trim());
                report.push('\n');
            }
            Err(error) => {
                report.push_str("## LLM 语义检查\n");
                report.push_str(&format!("LLM 语义检查失败：{error}\n"));
                set_operation_stage(operation_id.as_deref(), "completed")?;
                finish_operation(operation_id.as_deref());
                return Ok(report);
            }
        }
    } else {
        report.push_str("## LLM 语义检查\n");
        report.push_str("未配置 LLM，已跳过。\n");
    }
    append_log_entry(&root, "lint")?;
    set_operation_stage(operation_id.as_deref(), "completed")?;
    finish_operation(operation_id.as_deref());
    Ok(report)
}

fn build_semantic_lint_prompt(index: &str, mechanical_report: &str) -> String {
    format!(
        "Review this LLM Wiki mechanically generated report and index. Report potential contradictions, stale claims, duplicate pages, missing concepts, and follow-up questions in Chinese. Do not modify files.\n\nIndex:\n{index}\n\nMechanical report:\n{mechanical_report}"
    )
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

fn wiki_context_references_to_search_results(
    references: Vec<crate::llm_wiki_models::WikiContextReference>,
) -> Vec<WikiSearchResult> {
    references
        .into_iter()
        .map(|reference| WikiSearchResult {
            path: reference.path,
            title: reference.title,
            snippet: reference.snippet,
        })
        .collect()
}

fn insufficient_query_context(references: Vec<WikiSearchResult>) -> LlmWikiQueryResponse {
    LlmWikiQueryResponse {
        answer: "当前知识库中没有足够上下文回答这个问题。".to_string(),
        references,
        insufficient_context: true,
    }
}

fn insufficient_digest_context() -> WorkspaceError {
    WorkspaceError::new(
        "insufficient_context",
        "当前知识库中没有足够上下文生成综述。",
    )
}

fn default_context_request(purpose: &str, prompt: &str) -> WikiContextRequest {
    WikiContextRequest {
        purpose: purpose.to_string(),
        prompt: prompt.to_string(),
        max_selected_pages: DEFAULT_SELECTED_PAGE_LIMIT,
        max_expanded_pages: DEFAULT_EXPANDED_PAGE_LIMIT,
        max_context_bytes: DEFAULT_CONTEXT_LIMIT_BYTES,
    }
}

fn select_wiki_context_with_index(
    root: &Path,
    config: &LlmProviderConfig,
    purpose: &str,
    prompt: &str,
    index: String,
    operation_id: Option<&str>,
) -> Result<WikiContextBundle, WorkspaceError> {
    if !index_has_wiki_page_candidates(&index) {
        return Ok(WikiContextBundle {
            references: Vec::new(),
            markdown: String::new(),
            selection_reason: Some("index has no wiki page candidates".to_string()),
        });
    }

    let request = default_context_request(purpose, prompt);
    let selection_prompt = build_page_selection_prompt(&index, &request);
    set_operation_stage(operation_id, "selecting_pages")?;
    let selection_output = call_chat_completion_for_operation(
        config,
        vec![
            system_message("You select LLM Wiki pages. Return strict JSON only."),
            user_message(selection_prompt),
        ],
        operation_id,
    )?;

    set_operation_stage(operation_id, "reading_pages")?;
    build_wiki_context_with_selector_output(root, request, &selection_output)
}

fn select_wiki_context_from_index(
    root: &Path,
    config: &LlmProviderConfig,
    purpose: &str,
    prompt: &str,
    index: String,
    operation_id: Option<&str>,
) -> Result<WikiContextBundle, WorkspaceError> {
    select_wiki_context_with_index(root, config, purpose, prompt, index, operation_id)
}

pub(crate) fn related_context_or_log_failure(
    root: &Path,
    raw_relative_path: &str,
    result: Result<WikiContextBundle, WorkspaceError>,
) -> Result<String, WorkspaceError> {
    match result {
        Ok(bundle) => Ok(bundle.markdown),
        Err(error) => {
            let _ = append_log_entry(
                root,
                &format!("ingest failed {raw_relative_path} related context: {error}"),
            );
            Err(error)
        }
    }
}

fn index_has_wiki_page_candidates(index: &str) -> bool {
    if extract_stable_wikilinks(index)
        .into_iter()
        .filter_map(|link| resolve_wiki_link_target(&link.target))
        .any(|path| validate_wiki_page_path(&path).is_ok())
    {
        return true;
    }

    index
        .split(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '[' | ']' | '(' | ')' | '|' | ',' | ';' | ':' | '"' | '\''
                )
        })
        .any(|token| {
            let candidate = token
                .trim_matches(|character: char| {
                    matches!(character, '-' | '*' | '`' | '<' | '>' | '.' | '!' | '?')
                })
                .trim_end_matches('#');
            let path = if candidate.starts_with("wiki/") {
                candidate.to_string()
            } else if candidate.starts_with("sources/")
                || candidate.starts_with("entities/")
                || candidate.starts_with("concepts/")
                || candidate.starts_with("syntheses/")
            {
                format!("wiki/{candidate}")
            } else {
                return false;
            };

            validate_wiki_page_path(&path).is_ok()
        })
}

#[cfg(test)]
pub(crate) fn index_has_wiki_page_candidates_for_test(index: &str) -> bool {
    index_has_wiki_page_candidates(index)
}

#[cfg(test)]
pub(crate) fn build_query_context_from_selection_for_test(
    root: &Path,
    question: String,
    selector_output: &str,
) -> Result<WikiContextBundle, WorkspaceError> {
    build_wiki_context_with_selector_output(
        root,
        default_context_request("query", &question),
        selector_output,
    )
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
