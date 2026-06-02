use std::fs;
use std::io;
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

#[allow(dead_code)]
pub fn load_llm_config_from_path(
    path: impl AsRef<Path>,
) -> Result<LlmProviderConfig, WorkspaceError> {
    let path = path.as_ref();
    ensure_config_load_target(path)?;
    read_llm_config_from_path(path)
}

pub fn load_optional_llm_config_from_path(
    path: impl AsRef<Path>,
) -> Result<Option<LlmProviderConfig>, WorkspaceError> {
    let path = path.as_ref();
    if !prepare_optional_config_load_target(path)? {
        return Ok(None);
    }
    read_llm_config_from_path(path).map(Some)
}

fn read_llm_config_from_path(path: &Path) -> Result<LlmProviderConfig, WorkspaceError> {
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

    ensure_config_parent_dir(parent)?;
    ensure_config_file_target(path)?;

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

    replace_config_file(&temp_path, path)?;
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

fn ensure_config_parent_dir(path: &Path) -> Result<(), WorkspaceError> {
    ensure_no_existing_symlink_ancestor(path, PathOperation::Save)?;
    match existing_path_kind(path, PathOperation::Save)? {
        ExistingPathKind::Directory => restrict_config_dir(path),
        ExistingPathKind::Missing => {
            fs::create_dir_all(path).map_err(|error| {
                WorkspaceError::from_io(
                    "llm_config_save_failed",
                    "failed to create llm config directory",
                    &error,
                )
            })?;
            match existing_path_kind(path, PathOperation::Save)? {
                ExistingPathKind::Directory => restrict_config_dir(path),
                ExistingPathKind::Missing => Err(WorkspaceError::new(
                    "llm_config_save_failed",
                    "llm config directory was not created",
                )),
                ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
                    Err(path_type_conflict("directory", "not a directory"))
                }
            }
        }
        ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("directory", "not a directory"))
        }
    }
}

#[allow(dead_code)]
fn ensure_config_load_target(path: &Path) -> Result<(), WorkspaceError> {
    ensure_no_existing_symlink_ancestor(path, PathOperation::Load)?;
    match existing_path_kind(path, PathOperation::Load)? {
        ExistingPathKind::File => Ok(()),
        ExistingPathKind::Missing => Err(WorkspaceError::from_io(
            "llm_config_load_failed",
            "failed to read llm config",
            &io::Error::from(io::ErrorKind::NotFound),
        )),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("file", "not a file"))
        }
    }
}

fn prepare_optional_config_load_target(path: &Path) -> Result<bool, WorkspaceError> {
    ensure_no_existing_symlink_ancestor(path, PathOperation::Load)?;
    match existing_path_kind(path, PathOperation::Load)? {
        ExistingPathKind::File => Ok(true),
        ExistingPathKind::Missing => Ok(false),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("file", "not a file"))
        }
    }
}

fn ensure_config_file_target(path: &Path) -> Result<(), WorkspaceError> {
    match existing_path_kind(path, PathOperation::Save)? {
        ExistingPathKind::Missing | ExistingPathKind::File => Ok(()),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("file", "not a file"))
        }
    }
}

fn ensure_no_existing_symlink_ancestor(
    path: &Path,
    operation: PathOperation,
) -> Result<(), WorkspaceError> {
    for ancestor in path.ancestors().skip(1) {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match existing_path_kind(ancestor, operation)? {
            ExistingPathKind::Missing => {}
            ExistingPathKind::Directory => {}
            ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
                return Err(path_type_conflict("directory", "not a directory"));
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn replace_config_file(temp_path: &Path, path: &Path) -> Result<(), WorkspaceError> {
    if !matches!(
        existing_path_kind(path, PathOperation::Save)?,
        ExistingPathKind::File
    ) {
        return rename_config_file(temp_path, path);
    }

    let backup_path = path.with_file_name(format!(
        ".{}.backup.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("llm-config.json"),
        std::process::id(),
        timestamp_nanos()
    ));
    fs::rename(path, &backup_path).map_err(|error| {
        let _ = fs::remove_file(temp_path);
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to back up existing llm config before replace",
            &error,
        )
    })?;

    match fs::rename(temp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(error) => {
            let restore_result = fs::rename(&backup_path, path);
            let _ = fs::remove_file(temp_path);
            if let Err(restore_error) = restore_result {
                return Err(WorkspaceError::new(
                    "llm_config_save_failed",
                    format!(
                        "failed to replace llm config: {error}; failed to restore previous config: {restore_error}"
                    ),
                ));
            }
            Err(WorkspaceError::from_io(
                "llm_config_save_failed",
                "failed to replace llm config",
                &error,
            ))
        }
    }
}

#[cfg(not(windows))]
fn replace_config_file(temp_path: &Path, path: &Path) -> Result<(), WorkspaceError> {
    rename_config_file(temp_path, path)
}

fn rename_config_file(temp_path: &Path, path: &Path) -> Result<(), WorkspaceError> {
    fs::rename(temp_path, path).map_err(|error| {
        let _ = fs::remove_file(temp_path);
        WorkspaceError::from_io(
            "llm_config_save_failed",
            "failed to replace llm config",
            &error,
        )
    })
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingPathKind {
    Missing,
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathOperation {
    Load,
    Save,
}

fn existing_path_kind(
    path: &Path,
    operation: PathOperation,
) -> Result<ExistingPathKind, WorkspaceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(ExistingPathKind::Missing);
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                operation.inspect_error_code(),
                operation.inspect_error_message(),
                &error,
            ));
        }
    };

    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        Ok(ExistingPathKind::Symlink)
    } else if file_type.is_dir() {
        Ok(ExistingPathKind::Directory)
    } else if file_type.is_file() {
        Ok(ExistingPathKind::File)
    } else {
        Ok(ExistingPathKind::Other)
    }
}

impl PathOperation {
    fn inspect_error_code(self) -> &'static str {
        match self {
            Self::Load => "llm_config_load_failed",
            Self::Save => "llm_config_save_failed",
        }
    }

    fn inspect_error_message(self) -> &'static str {
        match self {
            Self::Load => "failed to inspect llm config before load",
            Self::Save => "failed to inspect llm config before save",
        }
    }
}

fn path_type_conflict(expected: &str, actual: &str) -> WorkspaceError {
    WorkspaceError::new(
        "path_type_conflict",
        format!("expected llm config {expected}, found {actual}"),
    )
}
