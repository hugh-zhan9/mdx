use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::llm_wiki_models::LlmProviderConfig;
use crate::models::WorkspaceError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LlmChatMessage {
    pub role: String,
    pub content: String,
}

pub fn load_llm_config_from_path(
    path: impl AsRef<Path>,
) -> Result<LlmProviderConfig, WorkspaceError> {
    let path = path.as_ref();
    let bytes = fs::read(path).map_err(|error| {
        WorkspaceError::from_io(
            "llm_config_load_failed",
            "failed to read llm config",
            &error,
        )
    })?;

    serde_json::from_slice(&bytes).map_err(|error| {
        WorkspaceError::new(
            "llm_config_parse_failed",
            format!("failed to parse llm config: {error}"),
        )
    })
}

pub fn save_llm_config_to_path(
    path: impl AsRef<Path>,
    config: &LlmProviderConfig,
) -> Result<(), WorkspaceError> {
    let path = path.as_ref();
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(
            "llm_config_save_failed",
            "llm config path has no parent directory",
        )
    })?;

    fs::create_dir_all(parent).map_err(|error| {
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to create llm config directory",
            &error,
        )
    })?;
    restrict_config_dir(parent)?;

    let bytes = serde_json::to_vec_pretty(config).map_err(|error| {
        WorkspaceError::new(
            "llm_config_save_failed",
            format!("failed to serialize llm config: {error}"),
        )
    })?;
    let temp_path = parent.join(format!(
        ".{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("llm-config.json"),
        std::process::id(),
        timestamp_nanos()
    ));

    {
        let mut file = create_secret_temp_file(&temp_path)?;
        file.write_all(&bytes).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            WorkspaceError::from_io(
                "llm_config_save_failed",
                "failed to write temporary llm config",
                &error,
            )
        })?;
        file.sync_all().map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            WorkspaceError::from_io(
                "llm_config_save_failed",
                "failed to sync temporary llm config",
                &error,
            )
        })?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to replace llm config",
            &error,
        )
    })?;
    restrict_config_file(path)
}

#[allow(dead_code)]
pub fn build_openai_chat_request(model: &str, messages: Vec<LlmChatMessage>) -> serde_json::Value {
    json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    })
}

pub fn default_llm_config_path() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            WorkspaceError::new("llm_config_path_failed", "home directory is not set")
        })?;
    Ok(PathBuf::from(home).join(".mdx").join("llm-config.json"))
}

#[cfg(unix)]
fn restrict_config_dir(path: &Path) -> Result<(), WorkspaceError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to restrict llm config directory permissions",
            &error,
        )
    })
}

#[cfg(not(unix))]
fn restrict_config_dir(_path: &Path) -> Result<(), WorkspaceError> {
    Ok(())
}

#[cfg(unix)]
fn create_secret_temp_file(path: &Path) -> Result<fs::File, WorkspaceError> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| {
            WorkspaceError::from_io(
                "llm_config_save_failed",
                "failed to create temporary llm config",
                &error,
            )
        })
}

#[cfg(not(unix))]
fn create_secret_temp_file(path: &Path) -> Result<fs::File, WorkspaceError> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            WorkspaceError::from_io(
                "llm_config_save_failed",
                "failed to create temporary llm config",
                &error,
            )
        })
}

#[cfg(unix)]
fn restrict_config_file(path: &Path) -> Result<(), WorkspaceError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to restrict llm config file permissions",
            &error,
        )
    })
}

#[cfg(not(unix))]
fn restrict_config_file(_path: &Path) -> Result<(), WorkspaceError> {
    Ok(())
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
