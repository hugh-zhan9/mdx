use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "tiff",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageAssetResult {
    pub markdown_path: String,
    pub stored_path: String,
    pub used_fallback: bool,
}

#[tauri::command]
pub fn save_image_asset(
    root_path: Option<String>,
    current_file_path: Option<String>,
    name: String,
    bytes: Vec<u8>,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    save_image_asset_impl(root_path, current_file_path, name, bytes, None)
}

fn save_image_asset_impl(
    root_path: Option<String>,
    current_file_path: Option<String>,
    name: String,
    bytes: Vec<u8>,
    global_assets_dir: Option<&Path>,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    let _ = current_file_path;
    let extension = image_extension(&name)?;
    let filename = format!("{}.{}", sha256_hex(&bytes), extension);

    if let Some(root_path) = root_path {
        if let Ok(result) = save_workspace_asset(&root_path, &filename, &bytes) {
            return Ok(result);
        }
    }

    save_global_asset(&filename, &bytes, global_assets_dir)
}

#[cfg(test)]
pub fn save_image_asset_with_global_assets_dir(
    root_path: Option<String>,
    current_file_path: Option<String>,
    name: String,
    bytes: Vec<u8>,
    global_assets_dir: &Path,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    save_image_asset_impl(
        root_path,
        current_file_path,
        name,
        bytes,
        Some(global_assets_dir),
    )
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, WorkspaceError> {
    fs::read(path).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read file bytes", &error)
    })
}

fn save_workspace_asset(
    root_path: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<SaveImageAssetResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let assets_dir = root.join(".assets");
    let stored_path = write_deduped_asset(&assets_dir, filename, bytes)?;
    let markdown_path = format!(".assets/{filename}");

    Ok(SaveImageAssetResult {
        markdown_path,
        stored_path: path_to_string(&stored_path),
        used_fallback: false,
    })
}

fn save_global_asset(
    filename: &str,
    bytes: &[u8],
    global_assets_dir: Option<&Path>,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    let assets_dir = match global_assets_dir {
        Some(path) => path.to_path_buf(),
        None => mdx_home_dir()?.join("assets"),
    };
    let stored_path = write_deduped_asset(&assets_dir, filename, bytes)?;
    let stored_path = path_to_string(&stored_path);

    Ok(SaveImageAssetResult {
        markdown_path: stored_path.clone(),
        stored_path,
        used_fallback: true,
    })
}

fn write_deduped_asset(
    assets_dir: &Path,
    filename: &str,
    bytes: &[u8],
) -> Result<PathBuf, WorkspaceError> {
    fs::create_dir_all(assets_dir).map_err(|error| {
        WorkspaceError::from_io(
            "asset_write_failed",
            "failed to create assets directory",
            &error,
        )
    })?;

    let path = assets_dir.join(filename);
    if path.exists() {
        return Ok(path);
    }

    let temp_path = assets_dir.join(format!(".{filename}.tmp.{}", std::process::id()));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                WorkspaceError::from_io(
                    "asset_write_failed",
                    "failed to create temporary image asset",
                    &error,
                )
            })?;
        file.write_all(bytes).map_err(|error| {
            WorkspaceError::from_io(
                "asset_write_failed",
                "failed to write temporary image asset",
                &error,
            )
        })?;
        file.sync_all().map_err(|error| {
            WorkspaceError::from_io(
                "asset_write_failed",
                "failed to sync temporary image asset",
                &error,
            )
        })?;
    }

    match fs::rename(&temp_path, &path) {
        Ok(()) => Ok(path),
        Err(error) if path.exists() => {
            let _ = fs::remove_file(&temp_path);
            Ok(path)
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(WorkspaceError::from_io(
                "asset_write_failed",
                "failed to store image asset",
                &error,
            ))
        }
    }
}

fn image_extension(name: &str) -> Result<String, WorkspaceError> {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| WorkspaceError::new("invalid_name", "image asset needs a file extension"))?;

    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Ok(extension)
    } else {
        Err(WorkspaceError::new(
            "invalid_name",
            "unsupported image asset extension",
        ))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn mdx_home_dir() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| WorkspaceError::new("asset_path_failed", "home directory is not set"))?;
    Ok(PathBuf::from(home).join(".mdx"))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
