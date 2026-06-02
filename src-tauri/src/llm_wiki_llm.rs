use std::fs;
use std::path::{Path, PathBuf};

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

    let bytes = serde_json::to_vec_pretty(config).map_err(|error| {
        WorkspaceError::new(
            "llm_config_save_failed",
            format!("failed to serialize llm config: {error}"),
        )
    })?;

    fs::write(path, bytes).map_err(|error| {
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to write llm config",
            &error,
        )
    })
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
