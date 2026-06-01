use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::models::WorkspaceError;

const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default = "default_state_version")]
    pub state_version: u32,
    #[serde(default)]
    pub recent_workspace_root: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<PersistedWorkspaceState>,
    #[serde(default)]
    pub window_size: PersistedWindowSize,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            state_version: STATE_VERSION,
            recent_workspace_root: None,
            workspaces: Vec::new(),
            window_size: PersistedWindowSize::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkspaceState {
    #[serde(default)]
    pub root_path: String,
    #[serde(default)]
    pub tabs: Vec<PersistedWorkspaceTab>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub panels: PersistedPanelState,
}

impl Default for PersistedWorkspaceState {
    fn default() -> Self {
        Self {
            root_path: String::new(),
            tabs: Vec::new(),
            active_tab_id: None,
            panels: PersistedPanelState::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkspaceTab {
    pub tab_id: String,
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub dirty: bool,
    #[serde(default)]
    pub needs_rename_on_first_save: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedPanelState {
    pub left_collapsed: bool,
    pub left_width: u32,
    pub right_collapsed: bool,
    pub right_width: u32,
}

impl Default for PersistedPanelState {
    fn default() -> Self {
        Self {
            left_collapsed: false,
            left_width: 280,
            right_collapsed: false,
            right_width: 240,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWindowSize {
    pub width: f64,
    pub height: f64,
}

impl Default for PersistedWindowSize {
    fn default() -> Self {
        Self {
            width: 1100.0,
            height: 720.0,
        }
    }
}

#[tauri::command]
pub fn load_app_state() -> Result<AppState, WorkspaceError> {
    load_state_from_path(default_state_path()?)
}

#[tauri::command]
pub fn save_app_state(state: AppState) -> Result<(), WorkspaceError> {
    save_state_to_path(default_state_path()?, &state)
}

pub fn load_state_from_path(path: impl AsRef<Path>) -> Result<AppState, WorkspaceError> {
    let path = path.as_ref();

    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<AppState>(&bytes) {
            Ok(mut state) => {
                if state.state_version == 0 {
                    state.state_version = STATE_VERSION;
                }
                Ok(state)
            }
            Err(_) => {
                backup_corrupt_state_file(path)?;
                let state = AppState::default();
                let _ = save_state_to_path(path, &state);
                Ok(state)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppState::default()),
        Err(error) => Err(WorkspaceError::from_io(
            "state_load_failed",
            "failed to read app state",
            &error,
        )),
    }
}

pub fn save_state_to_path(path: impl AsRef<Path>, state: &AppState) -> Result<(), WorkspaceError> {
    let path = path.as_ref();
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new("state_save_failed", "state path has no parent directory")
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        WorkspaceError::from_io(
            "state_save_failed",
            "failed to create state directory",
            &error,
        )
    })?;

    let bytes = serde_json::to_vec_pretty(state).map_err(|error| {
        WorkspaceError::new(
            "state_save_failed",
            format!("failed to serialize app state: {error}"),
        )
    })?;
    let temp_path = parent.join(format!(
        ".{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("state.json"),
        std::process::id(),
        timestamp_nanos()
    ));

    {
        let mut file = fs::File::create(&temp_path).map_err(|error| {
            WorkspaceError::from_io(
                "state_save_failed",
                "failed to create temporary state file",
                &error,
            )
        })?;
        file.write_all(&bytes).map_err(|error| {
            WorkspaceError::from_io(
                "state_save_failed",
                "failed to write temporary state file",
                &error,
            )
        })?;
        file.sync_all().map_err(|error| {
            WorkspaceError::from_io(
                "state_save_failed",
                "failed to sync temporary state file",
                &error,
            )
        })?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io("state_save_failed", "failed to replace state file", &error)
    })
}

fn backup_corrupt_state_file(path: &Path) -> Result<(), WorkspaceError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    let backup_path = parent.join(format!("{file_name}.corrupt.{}", timestamp_nanos()));

    fs::rename(path, &backup_path).map_err(|error| {
        WorkspaceError::from_io(
            "state_load_failed",
            "failed to back up corrupt state file",
            &error,
        )
    })
}

fn default_state_path() -> Result<PathBuf, WorkspaceError> {
    Ok(mdx_home_dir()?.join("state.json"))
}

fn mdx_home_dir() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| WorkspaceError::new("state_path_failed", "home directory is not set"))?;
    Ok(PathBuf::from(home).join(".mdx"))
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn default_state_version() -> u32 {
    STATE_VERSION
}
