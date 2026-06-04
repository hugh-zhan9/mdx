use serde::Serialize;

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
