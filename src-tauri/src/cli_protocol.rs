use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "cmd", rename_all = "kebab-case")]
pub enum CliRequest {
    New,
    Open {
        path: String,
    },
    List,
    Content {
        #[serde(default)]
        tab_id: Option<String>,
    },
    Selection {
        #[serde(default)]
        tab_id: Option<String>,
    },
    Insert {
        #[serde(default)]
        tab_id: Option<String>,
        text: String,
    },
    Save {
        #[serde(default)]
        tab_id: Option<String>,
    },
    Focus {
        #[serde(default)]
        tab_id: Option<String>,
    },
    Close {
        #[serde(default)]
        tab_id: Option<String>,
        #[serde(default)]
        force: Option<bool>,
    },
    CreateFile {
        #[serde(default)]
        parent_dir: Option<String>,
        #[serde(default)]
        name: Option<String>,
    },
    CreateFolder {
        #[serde(default)]
        parent_dir: Option<String>,
        #[serde(default)]
        name: Option<String>,
    },
    Rename {
        #[serde(default)]
        path: Option<String>,
        new_name: String,
    },
    LlmWikiQuery {
        question: String,
    },
    LlmWikiSearch {
        query: String,
    },
    LlmWikiStatus,
    LlmWikiIngest {
        #[serde(alias = "rawPath")]
        raw_path: String,
    },
    LlmWikiDigest {
        title: String,
        prompt: String,
    },
    LlmWikiLint,
    // The memory protocol.
    //
    // Material goes in, conclusions are drawn from it, and reading is `recall`
    // unless something narrower is wanted. The commands this replaced — inbox
    // review, working context, saved threads, the Markdown index, storage
    // migration — are gone with the concepts behind them: asking for one now
    // fails to parse rather than reaching a stub.
    MemoryStatus,
    MemoryInit,
    MemoryModel {
        /// Downloads the embedding model instead of only reporting on it.
        #[serde(default)]
        download: bool,
    },
    MemoryReindex,
    MemoryPurge {
        before: Option<String>,
    },
    MemoryAdd {
        body: String,
        #[serde(default)]
        source: Option<String>,
    },
    MemoryShow {
        drawer_id: String,
    },
    MemoryList {
        /// `material`, `conclusion`, or unset for both.
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        limit: Option<usize>,
    },
    MemoryDelete {
        drawer_id: String,
    },
    MemorySearch {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        wing: Option<String>,
        #[serde(default)]
        room: Option<String>,
    },
    MemoryContext {
        query: String,
        #[serde(default)]
        max_items: Option<usize>,
        #[serde(default)]
        dao_tian_limit: Option<usize>,
    },
    MemoryBrief {
        query: String,
    },
    MemoryRecall {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        max_items: Option<usize>,
    },
    MemoryDistill {
        statement: String,
        body: String,
        /// `concrete` (default) or `pattern`.
        #[serde(default)]
        tier: Option<String>,
        supporting_refs: Vec<String>,
    },
    MemoryGate {
        drawer_id: String,
    },
    MemoryAdopt {
        drawer_id: String,
        #[serde(default)]
        note: Option<String>,
    },
    MemoryDemote {
        drawer_id: String,
        /// `contradicted` | `obsolete` | `superseded` | `out_of_scope` | `unsafe`
        reason_type: String,
        reason: String,
        evidence_refs: Vec<String>,
        /// True retires the conclusion outright; false only demotes it.
        #[serde(default)]
        retire: bool,
    },
    MemoryPromote {
        target: String,
        #[serde(default)]
        ingest: bool,
        #[serde(default)]
        title: Option<String>,
    },
    MemoryCaptureScan {
        path: String,
    },
    MemoryCaptureImport {
        path: String,
    },
    MemoryLegacyImport {
        #[serde(default)]
        dry_run: bool,
    },
    MemoryExport {
        output_path: String,
    },
    MemoryImport {
        input_path: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct WorkspaceSnapshot {
    #[serde(alias = "rootPath")]
    pub root_path: Option<String>,
    #[serde(alias = "activeTabId")]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub tabs: Vec<TabSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct TabSnapshot {
    #[serde(alias = "tabId")]
    pub tab_id: String,
    pub path: String,
    pub title: String,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct SelectionSnapshot {
    pub has_selection: bool,
    pub selected_text: String,
    pub before: String,
    pub after: String,
    pub before_truncated: bool,
    pub after_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct CliWikiSearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub struct CliResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<TabSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_rename_on_first_save: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<SelectionSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<CliWikiSearchResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insufficient_context: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<CliWikiSearchResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_wiki_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_llm_wiki: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lint_report: Option<String>,
    /// What the memory command returned, encoded exactly as the memory layer
    /// hands it to the desktop app and to MCP.
    ///
    /// One field rather than one per command: the shape of each answer belongs
    /// to the memory layer, and a CLI that re-declared those shapes would be a
    /// second contract to keep in step with the first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_integrations: Option<Vec<crate::memory_models::MemoryIntegrationStatus>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_doctor: Option<crate::memory_models::MemoryDoctorReport>,
}

impl CliResponse {
    pub fn ok() -> Self {
        Self {
            ok: true,
            ..Self::default()
        }
    }

    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error_code: Some(code.into()),
            error: Some(message.into()),
            ..Self::default()
        }
    }
}

/// Runs one memory command against a workspace.
///
/// Both ways into the CLI end up here: the socket the desktop app listens on,
/// and the headless `--root` path used by agents and hooks. One implementation
/// means a command cannot mean one thing over the socket and something else
/// without a running app.
///
/// Everything goes through `memory::api`, the same door the Tauri commands and
/// the MCP server use, so the three surfaces differ only in spelling.
pub fn run_memory_request(root: &Path, request: CliRequest) -> CliResponse {
    use crate::memory::api;
    use crate::memory::models::retrieval::{ContextQuery, RecallQuery, SearchRequest};

    match request {
        CliRequest::MemoryStatus => memory_payload(api::status(root)),
        CliRequest::MemoryInit => memory_payload(initialize_memory(root)),
        CliRequest::MemoryModel { download } => memory_payload(if download {
            api::fetch_model()
        } else {
            api::model_status()
        }),
        CliRequest::MemoryReindex => memory_payload(api::rebuild_index()),
        CliRequest::MemoryPurge { before } => memory_payload(api::purge(before.clone())),
        CliRequest::MemoryAdd { body, source } => {
            memory_payload(api::add_material(root, api::AddMaterialRequest { body, source }))
        }
        CliRequest::MemoryShow { drawer_id } => memory_payload(api::show(&drawer_id)),
        CliRequest::MemoryList {
            kind,
            status,
            limit,
        } => memory_payload(api::list(
            root,
            api::ListFilter {
                kind,
                status,
                limit,
            },
        )),
        CliRequest::MemoryDelete { drawer_id } => memory_payload(api::delete(&drawer_id)),
        CliRequest::MemorySearch {
            query,
            limit,
            wing,
            room,
        } => match required_query(&query) {
            Some(query) => memory_payload(api::search(SearchRequest {
                query,
                wing,
                room,
                top_k: limit,
            })),
            None => invalid_query(),
        },
        CliRequest::MemoryContext {
            query,
            max_items,
            dao_tian_limit,
        } => match required_query(&query) {
            Some(query) => memory_payload(api::context(
                root,
                ContextQuery {
                    query,
                    max_items,
                    dao_tian_limit,
                },
            )),
            None => invalid_query(),
        },
        CliRequest::MemoryBrief { query } => match required_query(&query) {
            Some(query) => memory_payload(api::brief(
                root,
                ContextQuery {
                    query,
                    ..ContextQuery::default()
                },
            )),
            None => invalid_query(),
        },
        CliRequest::MemoryRecall {
            query,
            limit,
            max_items,
        } => match required_query(&query) {
            Some(query) => memory_payload(api::recall(
                root,
                RecallQuery {
                    query,
                    top_k: limit,
                    max_items,
                    ..RecallQuery::default()
                },
            )),
            None => invalid_query(),
        },
        CliRequest::MemoryDistill {
            statement,
            body,
            tier,
            supporting_refs,
        } => memory_payload(api::distill_conclusion(
            root,
            api::DistillRequestDto {
                statement,
                body,
                tier,
                supporting_refs,
            },
        )),
        CliRequest::MemoryGate { drawer_id } => memory_payload(api::conclusion_gate(&drawer_id)),
        CliRequest::MemoryAdopt { drawer_id, note } => memory_payload(api::adopt_conclusion(
            root,
            api::AdoptRequestDto { drawer_id, note },
        )),
        CliRequest::MemoryDemote {
            drawer_id,
            reason_type,
            reason,
            evidence_refs,
            retire,
        } => memory_payload(api::retire_conclusion(api::RetireRequestDto {
            drawer_id,
            reason_type,
            reason,
            evidence_refs,
            retire,
        })),
        CliRequest::MemoryPromote {
            target,
            ingest,
            title,
        } => memory_payload(crate::memory::wiki_promote::promote(
            root,
            crate::memory::wiki_promote::PromoteRequest {
                drawer_id: target,
                ingest,
                title,
            },
        )),
        CliRequest::MemoryCaptureScan { path } => {
            let path = PathBuf::from(path);
            if !path.exists() {
                return CliResponse::error(
                    "invalid_path",
                    format!("there is nothing at {}", path.display()),
                );
            }

            memory_payload(Ok::<_, crate::models::WorkspaceError>(CaptureTarget {
                room: api::room_preview(root, &path),
                path: path.to_string_lossy().into_owned(),
            }))
        }
        CliRequest::MemoryCaptureImport { path } => {
            memory_payload(api::import_path(root, Path::new(&path)))
        }
        CliRequest::MemoryLegacyImport { dry_run } => {
            if dry_run {
                memory_payload(api::legacy_preflight(root))
            } else {
                memory_payload(api::legacy_import(root))
            }
        }
        CliRequest::MemoryExport { output_path } => {
            memory_payload(api::export_bundle(root, Path::new(&output_path)))
        }
        CliRequest::MemoryImport { input_path } => {
            memory_payload(api::import_bundle(Path::new(&input_path)))
        }
        CliRequest::New
        | CliRequest::Open { .. }
        | CliRequest::List
        | CliRequest::Content { .. }
        | CliRequest::Selection { .. }
        | CliRequest::Insert { .. }
        | CliRequest::Save { .. }
        | CliRequest::Focus { .. }
        | CliRequest::Close { .. }
        | CliRequest::CreateFile { .. }
        | CliRequest::CreateFolder { .. }
        | CliRequest::Rename { .. }
        | CliRequest::LlmWikiQuery { .. }
        | CliRequest::LlmWikiSearch { .. }
        | CliRequest::LlmWikiStatus
        | CliRequest::LlmWikiIngest { .. }
        | CliRequest::LlmWikiDigest { .. }
        | CliRequest::LlmWikiLint => CliResponse::error(
            "not_a_memory_command",
            "this command does not belong to the memory protocol",
        ),
    }
}

/// Where a path would be filed if it were read into the library.
///
/// The preview half of the capture pair: the answer to "what happens if I
/// import this" before anything is stored, since material cannot be
/// un-remembered afterwards.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTarget {
    pub path: String,
    pub room: String,
}

/// Turns memory on for a workspace and binds it to a project in the library.
///
/// No directory tree is created: memory lives in one library under the user's
/// home, and the only per-workspace state is the configuration file.
fn initialize_memory(
    root: &Path,
) -> Result<crate::memory::api::MemoryStatus, crate::models::WorkspaceError> {
    let mut config = crate::memory::config::read_workspace_config(root)?;
    config.enabled = true;
    crate::memory::config::write_workspace_config(root, &config)?;
    crate::memory::api::bind_project(root)?;

    crate::memory::api::status(root)
}

/// A query with something in it, or nothing.
///
/// An empty query is refused here rather than passed on: searching for nothing
/// would open the library and embed an empty string to answer a question nobody
/// asked.
fn required_query(query: &str) -> Option<String> {
    let trimmed = query.trim();

    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn invalid_query() -> CliResponse {
    CliResponse::error("invalid_query", "query must not be empty")
}

fn memory_payload<T: Serialize>(
    result: Result<T, crate::models::WorkspaceError>,
) -> CliResponse {
    match result {
        Ok(value) => match serde_json::to_value(value) {
            Ok(memory) => CliResponse {
                ok: true,
                memory: Some(memory),
                ..CliResponse::default()
            },
            Err(error) => CliResponse::error(
                "memory_encode_failed",
                format!("failed to encode the memory result: {error}"),
            ),
        },
        Err(error) => CliResponse::error(error.error_code(), error.to_string()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliProtocolError {
    error_code: String,
    message: String,
}

impl CliProtocolError {
    pub fn new(error_code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error_code: error_code.into(),
            message: message.into(),
        }
    }

    pub fn error_code(&self) -> &str {
        &self.error_code
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for CliProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.error_code, self.message)
    }
}

impl std::error::Error for CliProtocolError {}

pub fn resolve_cli_path(
    snapshot: &WorkspaceSnapshot,
    input: &str,
) -> Result<String, CliProtocolError> {
    if input.trim().is_empty() {
        return Err(CliProtocolError::new(
            "invalid_path",
            "path must not be empty",
        ));
    }

    let Some(root_path) = snapshot.root_path.as_deref() else {
        return Err(CliProtocolError::new(
            "no_workspace",
            "no active workspace root is available",
        ));
    };

    let root = normalize_path_lexically(Path::new(root_path));
    let input = Path::new(input);
    let candidate = if input.is_absolute() {
        normalize_path_lexically(input)
    } else {
        normalize_path_lexically(&root.join(input))
    };

    if !candidate.starts_with(&root) {
        return Err(CliProtocolError::new(
            "outside_workspace",
            "path is outside the active workspace",
        ));
    }

    Ok(candidate.to_string_lossy().into_owned())
}

pub fn list_response_from_snapshot(snapshot: &WorkspaceSnapshot) -> CliResponse {
    CliResponse {
        ok: true,
        root_path: snapshot.root_path.clone(),
        active_tab_id: snapshot.active_tab_id.clone(),
        tabs: snapshot.tabs.clone(),
        ..CliResponse::default()
    }
}

pub fn cli_wiki_search_results_from_models(
    results: Vec<crate::llm_wiki_models::WikiSearchResult>,
) -> Vec<CliWikiSearchResult> {
    results
        .into_iter()
        .map(|result| CliWikiSearchResult {
            path: result.path,
            title: result.title,
            snippet: result.snippet,
        })
        .collect()
}

pub fn active_or_requested_tab<'a>(
    snapshot: &'a WorkspaceSnapshot,
    tab_id: Option<&str>,
) -> Result<&'a TabSnapshot, CliProtocolError> {
    let target = tab_id
        .map(str::to_owned)
        .or_else(|| snapshot.active_tab_id.clone())
        .ok_or_else(|| CliProtocolError::new("tab_not_found", "no active tab"))?;

    snapshot
        .tabs
        .iter()
        .find(|tab| tab.tab_id == target)
        .ok_or_else(|| CliProtocolError::new("tab_not_found", "tab was not found"))
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }

    normalized
}
