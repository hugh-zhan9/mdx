//! Memory configuration, split the way the data is split.
//!
//! The library is global — one `palace.db` for every workspace — so what model
//! embeds it and how much of it is assembled into a context pack are global
//! settings. Whether memory is on at all, what gets captured, and which agents
//! are wired up are per-workspace, because those are decisions about one
//! project.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::assets::mdx_home_dir;
use crate::models::WorkspaceError;

pub const DEFAULT_EMBEDDING_MODEL: &str = "minishlab/potion-multilingual-128M";
pub const WORKSPACE_CONFIG_VERSION: u32 = 3;
pub const GLOBAL_CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryConfig {
    pub version: u32,
    pub embedding: EmbeddingConfig,
    pub retrieval: RetrievalConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfig {
    pub model: String,
    /// Overrides where the model files are read from. Normally left unset so
    /// the model lives under `~/.loam/models/`.
    #[serde(default)]
    pub local_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalConfig {
    pub top_k: usize,
    pub context_max_items: usize,
    pub dao_tian_limit: usize,
    pub include_cards: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMemoryConfig {
    pub version: u32,
    pub enabled: bool,
    pub capture: CaptureConfig,
    pub agents: AgentsConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConfig {
    pub enabled: bool,
    /// Explicitly chosen sources. Empty means nothing is captured, which is the
    /// default: material cannot be un-remembered once it is in the library, so
    /// capture starts off rather than on.
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsConfig {
    pub claude: AgentConfig,
    pub codex: AgentConfig,
    pub cursor: AgentConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub enabled: bool,
}

impl Default for GlobalMemoryConfig {
    fn default() -> Self {
        Self {
            version: GLOBAL_CONFIG_VERSION,
            embedding: EmbeddingConfig {
                model: DEFAULT_EMBEDDING_MODEL.to_string(),
                local_dir: None,
            },
            retrieval: RetrievalConfig {
                top_k: 8,
                context_max_items: 12,
                dao_tian_limit: 1,
                include_cards: false,
            },
        }
    }
}

impl Default for WorkspaceMemoryConfig {
    fn default() -> Self {
        Self {
            version: WORKSPACE_CONFIG_VERSION,
            enabled: false,
            capture: CaptureConfig {
                enabled: false,
                sources: Vec::new(),
            },
            agents: AgentsConfig {
                claude: AgentConfig { enabled: false },
                codex: AgentConfig { enabled: false },
                cursor: AgentConfig { enabled: false },
            },
        }
    }
}

/// Test-only redirection of the application home.
///
/// The alternative — pointing `HOME` at a scratch directory — is process-wide
/// and races every other test in the binary. This override is read by memory
/// code only, so nothing else in the suite can notice it.
#[cfg(test)]
static HOME_OVERRIDE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_home_override(path: Option<PathBuf>) {
    let mut guard = HOME_OVERRIDE
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    *guard = path;
}

fn mdx_home() -> Result<PathBuf, WorkspaceError> {
    #[cfg(test)]
    if let Some(path) = HOME_OVERRIDE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
    {
        return Ok(path);
    }

    mdx_home_dir()
}

pub fn memory_home_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(mdx_home()?.join("memory"))
}

pub fn models_home_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(mdx_home()?.join("models"))
}

pub fn hf_cache_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(mdx_home()?.join("hf-cache"))
}

pub fn global_config_path() -> Result<PathBuf, WorkspaceError> {
    Ok(memory_home_dir()?.join("config.json"))
}

pub fn workspace_config_path(root: &Path) -> PathBuf {
    root.join(".loam").join("memory-config.json")
}

pub fn read_global_config() -> Result<GlobalMemoryConfig, WorkspaceError> {
    let path = global_config_path()?;
    let Some(contents) = read_optional(&path)? else {
        return Ok(GlobalMemoryConfig::default());
    };

    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "memory_config_invalid",
            format!("{} is not valid memory configuration: {error}", path.display()),
        )
    })
}

pub fn write_global_config(config: &GlobalMemoryConfig) -> Result<(), WorkspaceError> {
    let path = global_config_path()?;
    write_json(&path, config)
}

/// Reads a workspace's memory configuration, rebuilding a pre-migration file.
///
/// A version 2 file describes a product that no longer exists — storage
/// backends, projection, distill thresholds, auto-accept. Rather than write a
/// migrator for settings, the old file is kept as `.v2.bak` and the new one
/// starts from defaults. Configuration is not user data; the memories are, and
/// those are untouched.
pub fn read_workspace_config(root: &Path) -> Result<WorkspaceMemoryConfig, WorkspaceError> {
    let path = workspace_config_path(root);
    let Some(contents) = read_optional(&path)? else {
        return Ok(WorkspaceMemoryConfig::default());
    };

    if is_pre_migration_config(&contents) {
        let backup = path.with_extension("json.v2.bak");
        std::fs::rename(&path, &backup).map_err(|error| {
            WorkspaceError::from_io(
                "memory_config_backup_failed",
                "failed to set the previous memory configuration aside",
                &error,
            )
        })?;
        let rebuilt = WorkspaceMemoryConfig::default();
        write_json(&path, &rebuilt)?;
        return Ok(rebuilt);
    }

    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "memory_config_invalid",
            format!("{} is not valid memory configuration: {error}", path.display()),
        )
    })
}

pub fn write_workspace_config(
    root: &Path,
    config: &WorkspaceMemoryConfig,
) -> Result<(), WorkspaceError> {
    write_json(&workspace_config_path(root), config)
}

fn is_pre_migration_config(contents: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(contents) else {
        return false;
    };
    let version = value.get("version").and_then(serde_json::Value::as_u64);

    version.is_some_and(|version| version < u64::from(WORKSPACE_CONFIG_VERSION))
        || value.get("storage").is_some()
        || value.get("projection").is_some()
}

fn read_optional(path: &Path) -> Result<Option<String>, WorkspaceError> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WorkspaceError::from_io(
            "memory_config_read_failed",
            "failed to read memory configuration",
            &error,
        )),
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), WorkspaceError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "memory_config_write_failed",
                "failed to create the memory configuration directory",
                &error,
            )
        })?;
    }

    let mut contents = serde_json::to_string_pretty(value).map_err(|error| {
        WorkspaceError::new(
            "memory_config_write_failed",
            format!("failed to encode memory configuration: {error}"),
        )
    })?;
    contents.push('\n');

    std::fs::write(path, contents).map_err(|error| {
        WorkspaceError::from_io(
            "memory_config_write_failed",
            "failed to write memory configuration",
            &error,
        )
    })
}

/// Shared scaffolding for tests that need a memory home of their own.
///
/// Lives here because the override does, and because both the engine and the
/// write-path tests have to take the same lock: the override and the library
/// handle are process-wide, so two tests redirecting the home at once would
/// read each other's library.
#[cfg(test)]
pub(crate) mod testing {
    use std::path::Path;

    static HOME_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    pub(crate) struct ScopedHome {
        dir: tempfile::TempDir,
    }

    impl ScopedHome {
        pub(crate) fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    impl Drop for ScopedHome {
        fn drop(&mut self) {
            super::set_home_override(None);
            crate::memory::engine::close_library();
        }
    }

    pub(crate) fn with_scoped_home<T>(test: impl FnOnce(&ScopedHome) -> T) -> T {
        let _lock = HOME_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let dir = tempfile::tempdir().expect("temp home");
        super::set_home_override(Some(dir.path().to_path_buf()));
        crate::memory::engine::close_library();
        let home = ScopedHome { dir };

        test(&home)
    }
}
