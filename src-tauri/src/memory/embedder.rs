//! Resolving, and if the user says so downloading, the embedding model.
//!
//! Every write to the library needs a vector, so a missing model is not a
//! degraded mode — it is memory being unavailable, and it says so. There is no
//! keyword-only fallback: an embedder that returns nothing meaningful would
//! still write vectors, and those vectors would quietly ruin the ranking of
//! every later search.

use std::path::{Path, PathBuf};

use mempal_runtime::embed::model2vec::Model2VecEmbedder;

use crate::memory::config::{hf_cache_dir, models_home_dir, GlobalMemoryConfig};
use crate::models::WorkspaceError;

/// The three files `model2vec-rs` needs before it will load a local directory.
const MODEL_FILES: [&str; 3] = ["tokenizer.json", "model.safetensors", "config.json"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelReadiness {
    Ready { model: String, dir: PathBuf },
    Missing { model: String, missing: Vec<String> },
}

impl ModelReadiness {
    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Ready { .. })
    }
}

/// Where a model's files are read from: the configured override, or the slug
/// of its repo id under `~/.mdx/models/`.
pub fn model_dir(config: &GlobalMemoryConfig) -> Result<PathBuf, WorkspaceError> {
    if let Some(local_dir) = config.embedding.local_dir.as_deref() {
        return Ok(PathBuf::from(local_dir));
    }

    Ok(models_home_dir()?.join(model_slug(&config.embedding.model)))
}

pub fn readiness(config: &GlobalMemoryConfig) -> Result<ModelReadiness, WorkspaceError> {
    let dir = model_dir(config)?;
    let missing = missing_files(&dir);

    if missing.is_empty() {
        Ok(ModelReadiness::Ready {
            model: config.embedding.model.clone(),
            dir,
        })
    } else {
        Ok(ModelReadiness::Missing {
            model: config.embedding.model.clone(),
            missing,
        })
    }
}

/// Builds the embedder from local files only.
///
/// This never reaches the network. Downloading is a separate, user-confirmed
/// action, so that opening a workspace can never turn into a few hundred
/// megabytes of traffic nobody asked for.
pub fn build_embedder(config: &GlobalMemoryConfig) -> Result<Model2VecEmbedder, WorkspaceError> {
    let dir = match readiness(config)? {
        ModelReadiness::Ready { dir, .. } => dir,
        ModelReadiness::Missing { model, missing } => {
            return Err(WorkspaceError::new(
                "embedding_model_missing",
                format!(
                    "the embedding model {model} is not downloaded yet ({} missing)",
                    missing.join(", ")
                ),
            ));
        }
    };

    Model2VecEmbedder::new(&dir.to_string_lossy()).map_err(|error| {
        WorkspaceError::new(
            "embedding_model_unreadable",
            format!("failed to load the embedding model from {}: {error}", dir.display()),
        )
    })
}

/// Downloads the model into `~/.mdx/models/<slug>/`.
///
/// The files land in a temporary directory first and are only moved into place
/// once all three are present, so an interrupted download leaves no directory
/// that looks ready but is not.
pub fn download_model(config: &GlobalMemoryConfig) -> Result<PathBuf, WorkspaceError> {
    let target = model_dir(config)?;
    if missing_files(&target).is_empty() {
        return Ok(target);
    }

    let cache = hf_cache_dir()?;
    std::fs::create_dir_all(&cache).map_err(|error| {
        WorkspaceError::from_io(
            "embedding_model_download_failed",
            "failed to create the model download cache",
            &error,
        )
    })?;

    let api = hf_hub::api::sync::ApiBuilder::new()
        .with_cache_dir(cache)
        .build()
        .map_err(|error| {
            WorkspaceError::new(
                "embedding_model_download_failed",
                format!("failed to reach the model host: {error}"),
            )
        })?;
    let repo = api.model(config.embedding.model.clone());

    let staging = target.with_file_name(format!(
        "{}.partial",
        target
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "model".to_string())
    ));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|error| {
        WorkspaceError::from_io(
            "embedding_model_download_failed",
            "failed to create the model staging directory",
            &error,
        )
    })?;

    for file in MODEL_FILES {
        let downloaded = repo.get(file).map_err(|error| {
            WorkspaceError::new(
                "embedding_model_download_failed",
                format!("failed to download {file}: {error}"),
            )
        })?;
        std::fs::copy(&downloaded, staging.join(file)).map_err(|error| {
            WorkspaceError::from_io(
                "embedding_model_download_failed",
                "failed to place a downloaded model file",
                &error,
            )
        })?;
    }

    let still_missing = missing_files(&staging);
    if !still_missing.is_empty() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(WorkspaceError::new(
            "embedding_model_download_failed",
            format!(
                "the download finished without {} — nothing was installed",
                still_missing.join(", ")
            ),
        ));
    }

    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&staging, &target).map_err(|error| {
        WorkspaceError::from_io(
            "embedding_model_download_failed",
            "failed to move the downloaded model into place",
            &error,
        )
    })?;

    Ok(target)
}

fn missing_files(dir: &Path) -> Vec<String> {
    MODEL_FILES
        .iter()
        .filter(|file| !dir.join(file).is_file())
        .map(|file| (*file).to_string())
        .collect()
}

/// `minishlab/potion-multilingual-128M` becomes `potion-multilingual-128M`.
fn model_slug(model: &str) -> String {
    model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '.' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_keeps_the_model_name_and_drops_the_org() {
        assert_eq!(
            model_slug("minishlab/potion-multilingual-128M"),
            "potion-multilingual-128M"
        );
        assert_eq!(model_slug("potion-base-8M"), "potion-base-8M");
        assert_eq!(model_slug("weird org/name with spaces"), "name-with-spaces");
    }

    #[test]
    fn a_directory_missing_one_file_is_not_ready() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("tokenizer.json"), "{}").expect("write");
        std::fs::write(dir.path().join("config.json"), "{}").expect("write");

        assert_eq!(missing_files(dir.path()), vec!["model.safetensors"]);
    }
}
