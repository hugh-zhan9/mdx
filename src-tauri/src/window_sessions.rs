use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::Url;

pub const WORKSPACE_WINDOW_LABEL: &str = "workspace-main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowRole {
    Workspace,
    Document,
}

#[derive(Debug, Default)]
pub struct WindowSessionRegistry {
    workspace_window_label: Option<String>,
    document_windows: BTreeMap<PathBuf, String>,
}

impl WindowSessionRegistry {
    pub fn claim_workspace_window(&mut self) -> String {
        self.workspace_window_label
            .get_or_insert_with(|| WORKSPACE_WINDOW_LABEL.to_string())
            .clone()
    }

    pub fn claim_document_window(&mut self, real_path: PathBuf, label: String) -> String {
        self.document_windows
            .entry(real_path)
            .or_insert(label)
            .clone()
    }

    pub fn role_for_label(&self, label: &str) -> Option<WindowRole> {
        if self.workspace_window_label.as_deref() == Some(label) {
            return Some(WindowRole::Workspace);
        }

        if self
            .document_windows
            .values()
            .any(|window_label| window_label == label)
        {
            return Some(WindowRole::Document);
        }

        None
    }

    pub fn remove_label(&mut self, label: &str) {
        if self.workspace_window_label.as_deref() == Some(label) {
            self.workspace_window_label = None;
        }
        self.document_windows
            .retain(|_, window_label| window_label != label);
    }

    pub fn has_document_windows(&self) -> bool {
        !self.document_windows.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct StartupOpenRoutingState {
    workspace_check_scheduled: bool,
    startup_check_finished: bool,
    supported_startup_document_opened: bool,
}

impl StartupOpenRoutingState {
    pub fn observe_ready(&mut self) -> bool {
        if self.workspace_check_scheduled {
            return false;
        }

        self.workspace_check_scheduled = true;
        true
    }

    pub fn observe_supported_document_opened_during_startup(&mut self) {
        if !self.startup_check_finished {
            self.supported_startup_document_opened = true;
        }
    }

    pub fn should_create_workspace_after_startup_delay(
        &mut self,
        has_document_windows: bool,
    ) -> bool {
        self.startup_check_finished = true;
        !has_document_windows && !self.supported_startup_document_opened
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
