use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceError {
    error_code: String,
    message: String,
}

impl WorkspaceError {
    pub fn new(error_code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error_code: error_code.into(),
            message: message.into(),
        }
    }

    #[allow(dead_code)]
    pub fn error_code(&self) -> &str {
        &self.error_code
    }

    pub fn from_io(
        error_code: impl Into<String>,
        message: impl Into<String>,
        error: &std::io::Error,
    ) -> Self {
        Self::new(error_code, format!("{}: {}", message.into(), error))
    }
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.error_code, self.message)
    }
}

impl std::error::Error for WorkspaceError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileTreeNode {
    #[serde(rename = "file")]
    File { name: String, path: String },
    #[serde(rename = "folder")]
    Folder {
        name: String,
        path: String,
        children: Vec<FileTreeNode>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanWorkspaceResult {
    pub root_path: String,
    pub nodes: Vec<FileTreeNode>,
    pub truncated: bool,
    pub entry_count: usize,
    pub warnings: Vec<String>,
}

/// One note, as a list of notes needs it.
///
/// `head` is the first bytes of the file rather than the whole document: a list
/// row shows a title and a line of prose, and reading a megabyte to draw forty
/// characters is a cost paid once per note in the workspace.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteIndexEntry {
    pub path: String,
    /// Milliseconds since the Unix epoch, or `None` when the file system did
    /// not report a modification time for this file.
    pub modified_ms: Option<i64>,
    pub head: String,
    /// Whether the file continues past `head`.
    pub head_truncated: bool,
}

/// Which notes a page is a page of.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteGroup {
    All,
    /// Changed within the last week.
    Recent,
    /// Sitting directly in the workspace root, filed under no folder.
    Unfiled,
}

/// How many notes each group holds, before any filter is applied.
///
/// Counted from the same pass that timed the notes, so the numbers cost nothing
/// beyond what ordering the list already required. They describe the workspace
/// rather than the page: a count that only counted the notes that fit on screen
/// would be a wrong answer to "how many are there".
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteGroupCounts {
    pub all: usize,
    pub recent: usize,
    pub unfiled: usize,
}

/// One page of notes, and what the workspace holds around it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotePageResult {
    pub root_path: String,
    /// This page, most recently edited first, with each note's beginning read.
    pub notes: Vec<NoteIndexEntry>,
    /// How many notes the group holds once the filter has been applied.
    pub matched: usize,
    pub counts: NoteGroupCounts,
    /// Whether the walk itself left files out, which its own limit can do.
    pub truncated: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMarkdownFileResult {
    pub path: String,
    pub name: String,
    pub needs_rename_on_first_save: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileResult {
    pub content: String,
    pub file_name: String,
    pub display_path: String,
    pub real_path: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveResult {
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStartResult {
    pub watch_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStopResult {
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub request_id: String,
    pub results: Vec<SearchResultItem>,
    pub skipped_large_files: usize,
    pub skipped_unreadable_files: usize,
    pub truncated: bool,
    pub searched_files: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub path: String,
    pub line_number: usize,
    pub column_start: usize,
    pub column_end: usize,
    pub line: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchCancelResult {
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchEventPayload {
    pub watch_id: String,
    pub root_path: Option<String>,
    pub path: String,
    pub new_path: Option<String>,
    pub fingerprint: Option<String>,
    pub event_time: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveResult {
    pub draft_id: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftGetResult {
    pub draft: Option<DraftRecord>,
    pub file_exists: bool,
    pub current_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftListResult {
    pub drafts: Vec<DraftSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftDeleteResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftCleanupResult {
    pub deleted: usize,
    pub kept: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub draft_id: String,
    pub real_path: String,
    pub display_path: Option<String>,
    pub mode: String,
    pub base_fingerprint: Option<String>,
    pub updated_at: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub draft_id: String,
    pub real_path: String,
    pub display_path: Option<String>,
    pub mode: String,
    pub base_fingerprint: Option<String>,
    pub updated_at: String,
    pub file_exists: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderResult {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedPrefix {
    pub old_prefix: String,
    pub new_prefix: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathChangeResult {
    pub old_path: String,
    pub new_path: String,
    pub affected_prefix: Option<AffectedPrefix>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashPathResult {
    pub trashed_path: String,
}
