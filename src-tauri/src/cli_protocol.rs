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
    MemoryStatus,
    MemoryInit,
    MemoryRepair {
        #[serde(default)]
        rebuild_index: bool,
    },
    MemoryExport {
        output_path: String,
        #[serde(default)]
        include_log: bool,
    },
    MemoryImport {
        input_path: String,
        #[serde(default = "default_memory_import_strategy")]
        strategy: String,
        #[serde(default)]
        dry_run: bool,
    },
    MemoryIndexStatus,
    MemoryIndexRebuild,
    MemoryThreadSave {
        source: String,
        #[serde(default)]
        thread_id: Option<String>,
        title: String,
        body: String,
    },
    MemoryThreadShow {
        target: String,
    },
    MemoryThreadList {
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryAdd {
        title: String,
        body: String,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        source_thread: Option<String>,
        #[serde(default)]
        importance: Option<f64>,
        #[serde(default)]
        confidence: Option<f64>,
    },
    MemoryShow {
        target: String,
    },
    MemoryList {
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemorySearch {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryArchive {
        target: String,
    },
    MemoryInboxList {
        #[serde(default)]
        include_reviewed: bool,
    },
    MemoryInboxAccept {
        inbox_id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        tags: Option<Vec<String>>,
    },
    MemoryInboxReject {
        inbox_id: String,
    },
    MemoryWorkingGet,
    MemoryWorkingSet {
        content: String,
    },
    MemoryWorkingAppend {
        section: String,
        text: String,
    },
    MemoryRecall {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        byte_budget: Option<usize>,
        #[serde(default)]
        include_working: Option<bool>,
        #[serde(default)]
        include_threads: Option<bool>,
        #[serde(default)]
        tag: Option<String>,
        #[serde(default)]
        since: Option<String>,
    },
    MemoryDistill {
        target: String,
        #[serde(default)]
        accept: Option<bool>,
        #[serde(default)]
        force: Option<bool>,
    },
    MemoryPromote {
        target: String,
        #[serde(default)]
        ingest: Option<bool>,
        #[serde(default)]
        title: Option<String>,
    },
    MemoryCaptureImport {
        source: String,
        #[serde(alias = "file")]
        path: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        thread_id: Option<String>,
        #[serde(default)]
        distill: bool,
    },
    MemoryCaptureScan {
        source: String,
    },
}

fn default_memory_import_strategy() -> String {
    "skip".to_string()
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_status: Option<crate::memory::MemoryWorkspaceStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_init: Option<crate::memory::InitializeMemoryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_repair: Option<crate::memory::MemoryRepairResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_export: Option<crate::memory::MemoryExportResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_import: Option<crate::memory::MemoryImportResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_index_status: Option<crate::memory::MemoryIndexStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_thread: Option<crate::memory::MemoryThreadRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_threads: Option<Vec<crate::memory::ThreadListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_entry: Option<crate::memory::MemoryRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_entries: Option<Vec<crate::memory::MemorySummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_inbox: Option<crate::memory::InboxRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_inbox_entries: Option<Vec<crate::memory::InboxRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_inbox_review: Option<crate::memory::InboxReviewResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_recall: Option<crate::memory::RecallResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_distill: Option<crate::memory::MemoryDistillResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_promote: Option<crate::memory::MemoryPromoteResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_capture_import: Option<crate::memory::MemoryCaptureImportResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_capture_scan: Option<crate::memory::MemoryCaptureScanResult>,
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
