use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use tauri::Url;

pub const WORKSPACE_WINDOW_LABEL: &str = "workspace-main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowRole {
    Workspace,
    Document,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowSession {
    Workspace,
    Document {
        file_name: String,
        display_path: String,
        real_path: String,
    },
    DocumentError {
        message: String,
        path: Option<String>,
    },
}

#[derive(Debug, Default)]
pub struct WindowSessionRegistry {
    workspace_window_label: Option<String>,
    document_windows: BTreeMap<PathBuf, DocumentWindowSession>,
    document_error_windows: BTreeMap<String, DocumentErrorWindowSession>,
}

#[derive(Debug, Clone)]
struct DocumentWindowSession {
    label: String,
    display_path: PathBuf,
    real_path: PathBuf,
}

#[derive(Debug, Clone)]
struct DocumentErrorWindowSession {
    message: String,
    path: Option<PathBuf>,
}

#[derive(Debug, Default)]
pub struct DirtyWorkspacePaths {
    paths: BTreeSet<PathBuf>,
}

impl DirtyWorkspacePaths {
    pub fn update(&mut self, paths: Vec<String>) {
        self.paths = paths
            .into_iter()
            .filter_map(|path| {
                if path.is_empty() {
                    return None;
                }

                let raw_path = PathBuf::from(path);
                Some(raw_path.canonicalize().unwrap_or(raw_path))
            })
            .collect();
    }

    pub fn contains(&self, path: &Path) -> bool {
        let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.paths.contains(&normalized)
    }

    pub fn clear(&mut self) {
        self.paths.clear();
    }
}

impl WindowSessionRegistry {
    pub fn claim_workspace_window(&mut self) -> String {
        self.workspace_window_label
            .get_or_insert_with(|| WORKSPACE_WINDOW_LABEL.to_string())
            .clone()
    }

    pub fn claim_document_window(
        &mut self,
        display_path: PathBuf,
        real_path: PathBuf,
        label: String,
    ) -> String {
        self.document_windows
            .entry(real_path.clone())
            .or_insert(DocumentWindowSession {
                label,
                display_path,
                real_path,
            })
            .label
            .clone()
    }

    pub fn claim_document_error_window(
        &mut self,
        label: String,
        message: String,
        path: Option<PathBuf>,
    ) -> String {
        self.document_error_windows
            .insert(label.clone(), DocumentErrorWindowSession { message, path });
        label
    }

    pub fn role_for_label(&self, label: &str) -> Option<WindowRole> {
        if self.workspace_window_label.as_deref() == Some(label) {
            return Some(WindowRole::Workspace);
        }

        if self
            .document_windows
            .values()
            .any(|session| session.label == label)
            || self.document_error_windows.contains_key(label)
        {
            return Some(WindowRole::Document);
        }

        None
    }

    pub fn session_for_label(&self, label: &str) -> Option<WindowSession> {
        if self.workspace_window_label.as_deref() == Some(label) {
            return Some(WindowSession::Workspace);
        }

        if let Some(session) = self
            .document_windows
            .values()
            .find(|session| session.label == label)
        {
            return Some(WindowSession::Document {
                file_name: session
                    .real_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Markdown")
                    .to_string(),
                display_path: path_to_string(&session.display_path),
                real_path: path_to_string(&session.real_path),
            });
        }

        self.document_error_windows
            .get(label)
            .map(|session| WindowSession::DocumentError {
                message: session.message.clone(),
                path: session.path.as_deref().map(path_to_string),
            })
    }

    pub fn remove_label(&mut self, label: &str) {
        if self.workspace_window_label.as_deref() == Some(label) {
            self.workspace_window_label = None;
        }
        self.document_windows
            .retain(|_, session| session.label != label);
        self.document_error_windows.remove(label);
    }

    pub fn has_document_windows(&self) -> bool {
        !self.document_windows.is_empty() || !self.document_error_windows.is_empty()
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[derive(Debug, Default)]
pub struct StartupOpenRoutingState {
    ready_observed: bool,
    initial_main_events_cleared: bool,
    default_launch: Option<bool>,
    supported_startup_document_opened: bool,
}

impl StartupOpenRoutingState {
    pub fn observe_ready(&mut self) {
        self.ready_observed = true;
    }

    pub fn observe_default_launch(&mut self, default_launch: bool) {
        self.default_launch = Some(default_launch);
    }

    pub fn observe_supported_document_opened_during_startup(&mut self) {
        if !self.initial_main_events_cleared {
            self.supported_startup_document_opened = true;
        }
    }

    pub fn should_create_workspace_on_initial_main_events_cleared(
        &mut self,
        has_document_windows: bool,
    ) -> bool {
        if !self.ready_observed || self.initial_main_events_cleared {
            return false;
        }

        self.initial_main_events_cleared = true;
        self.default_launch.unwrap_or(true)
            && !has_document_windows
            && !self.supported_startup_document_opened
    }
}

pub fn normalize_opened_url_path(url: &Url) -> Option<PathBuf> {
    if url.scheme() != "file" {
        return None;
    }

    url.to_file_path().ok()
}

pub fn is_supported_document_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown")
    )
}
