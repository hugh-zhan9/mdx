//! The window's background image.
//!
//! Deliberately not a theme. A theme is a file of colours that can be read back,
//! copied and shared (`user_themes.rs`), and `docs/loopx/specs/theme.md` promises
//! that a theme **cannot load anything** — the promise that makes an unfamiliar
//! theme safe to try. A background image is one picture on one machine, so it
//! lives here instead: the front end keeps a preference naming a file, and this
//! module owns the copy of that file.
//!
//! The image is copied into `~/.loam/background/` rather than referenced where
//! the user found it. A reference would make the background disappear the first
//! time a photo is moved out of Downloads, and it would put an arbitrary path
//! from outside the application into a value the window reads on every start.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::assets::{
    IMAGE_EXTENSIONS, image_extension, loam_home_dir, sha256_hex, write_deduped_asset,
};
use crate::models::WorkspaceError;

/// Largest image accepted.
///
/// A budget for memory rather than for disk: the background is decoded by the
/// WebView and held for as long as the window is open, so a 60 MP photograph
/// costs the same whether or not any of it is visible.
pub const MAX_BACKGROUND_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackgroundImageResult {
    /// The name to store in the preference and to pass back to `load`.
    pub file_name: String,
}

/// Stores the chosen image, replacing whatever was there.
///
/// The bytes come from the WebView's own file picker, so this is handed content
/// rather than a path: nothing here can be pointed at a file the user did not
/// choose.
#[tauri::command]
pub fn save_background_image(
    name: String,
    bytes: Vec<u8>,
) -> Result<SaveBackgroundImageResult, WorkspaceError> {
    save_background_image_in_dir(&background_dir()?, &name, &bytes)
}

/**
 * Answers with the image's bytes, raw.
 *
 * `tauri::ipc::Response` rather than a serialisable struct, which is a departure
 * from `load_image_asset` next door and a deliberate one: a `Vec<u8>` in a
 * command's return value is serialised as a JSON array of numbers, and a twelve
 * megabyte wallpaper becomes tens of megabytes of JSON text to parse into
 * twelve million JS numbers. A document image is small and is loaded when it
 * scrolls into view; this one is up to the cap and is read on the way to the
 * first painted frame of every window, so it is worth the different shape.
 *
 * The MIME type does not come back with it — a raw response is only bytes — so
 * the caller derives it from the extension, which is part of the name this
 * module generated.
 */
#[tauri::command]
pub fn load_background_image(file_name: String) -> Result<tauri::ipc::Response, WorkspaceError> {
    let bytes = load_background_image_in_dir(&background_dir()?, &file_name)?;

    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn clear_background_image() -> Result<(), WorkspaceError> {
    clear_background_image_in_dir(&background_dir()?)
}

pub fn save_background_image_in_dir(
    directory: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<SaveBackgroundImageResult, WorkspaceError> {
    let extension = image_extension(name)?;

    if bytes.len() > MAX_BACKGROUND_BYTES {
        return Err(WorkspaceError::new(
            "background_too_large",
            format!(
                "背景图超过 {} MiB 上限",
                MAX_BACKGROUND_BYTES / (1024 * 1024)
            ),
        ));
    }

    // Named by content, like every other stored image, so choosing the same
    // picture twice is one file and the name never has to be made unique.
    let file_name = format!("{}.{}", sha256_hex(bytes), extension);
    write_deduped_asset(directory, &file_name, bytes)?;

    // One background at a time is what the preference can express, so the ones
    // it can no longer name are removed. Without this the directory grows by a
    // photograph every time someone tries another picture.
    remove_background_files(directory, Some(&file_name));

    Ok(SaveBackgroundImageResult { file_name })
}

pub fn load_background_image_in_dir(
    directory: &Path,
    file_name: &str,
) -> Result<Vec<u8>, WorkspaceError> {
    let name = background_file_name(file_name)?;
    // Checked and then discarded: what the extension is worth here is the
    // refusal of a name that is not an image at all.
    image_extension(&name)?;
    let path = directory.join(&name);

    // `symlink_metadata`, so a link is seen as a link and not followed. The
    // preference is ordinary storage the user can edit; a name in it must not be
    // able to reach a file outside this directory by any route.
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "background_not_found"
        } else {
            "background_read_failed"
        };
        WorkspaceError::from_io(code, "无法读取背景图", &error)
    })?;

    if !metadata.is_file() {
        return Err(WorkspaceError::new(
            "background_not_found",
            "背景图不是普通文件",
        ));
    }

    if metadata.len() > MAX_BACKGROUND_BYTES as u64 {
        return Err(WorkspaceError::new(
            "background_too_large",
            format!(
                "背景图超过 {} MiB 上限",
                MAX_BACKGROUND_BYTES / (1024 * 1024)
            ),
        ));
    }

    fs::read(&path).map_err(|error| {
        WorkspaceError::from_io("background_read_failed", "无法读取背景图", &error)
    })
}

pub fn clear_background_image_in_dir(directory: &Path) -> Result<(), WorkspaceError> {
    remove_background_files(directory, None);

    Ok(())
}

/// Deletes the copies this module made, except `keep`.
///
/// Only its own copies: a name has to be a content hash and an image extension,
/// which is the shape `save_background_image_in_dir` writes and nothing else.
/// That is what keeps this from being "delete everything in this directory" —
/// a file someone put here by hand stays, and so does another save's in-flight
/// temporary, which is named `.<file>.tmp-…` and would otherwise be deleted
/// mid-write by an overlapping save.
///
/// Failures are not reported, and the front end does not pretend otherwise.
/// Every file here is a copy of an image the user still has, so one that cannot
/// be deleted is wasted disk rather than lost work — and refusing to set a new
/// background because an old one is locked would be the wrong trade. Only plain
/// files are touched: a directory or a symlink is left alone rather than
/// followed.
fn remove_background_files(directory: &Path, keep: Option<&str>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };

        if Some(name) == keep || !is_stored_background_name(name) {
            continue;
        }

        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let _ = fs::remove_file(&path);
            }
            _ => {}
        }
    }
}

/// Whether `name` has the shape this module writes: a SHA-256 hex digest and an
/// image extension.
fn is_stored_background_name(name: &str) -> bool {
    let Some((digest, extension)) = name.rsplit_once('.') else {
        return false;
    };

    digest.len() == 64
        && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        && IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

/// The stored name as a single plain file name, or why it is not one.
///
/// Refused rather than repaired, on every platform's separators rather than only
/// this one's: a name this had to fix would be a name pointing at a file nobody
/// chose.
fn background_file_name(file_name: &str) -> Result<String, WorkspaceError> {
    let trimmed = file_name.trim();
    let refuse = |reason: &str| {
        Err(WorkspaceError::new(
            "background_name_invalid",
            format!("背景图文件名不可用：{reason}"),
        ))
    };

    if trimmed.is_empty() {
        return refuse("不能为空");
    }

    if trimmed.starts_with('.') {
        return refuse("不能以点开头");
    }

    if trimmed.contains('\0') || trimmed.contains('\\') {
        return refuse("含有非法字符");
    }

    let mut components = Path::new(trimmed).components();
    let Some(Component::Normal(only)) = components.next() else {
        return refuse("必须是单个文件名");
    };

    if components.next().is_some() || only != std::ffi::OsStr::new(trimmed) {
        return refuse("必须是单个文件名");
    }

    Ok(trimmed.to_string())
}

/// Where the copy lives. Singular, because only one can be in effect.
pub fn background_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(loam_home_dir()?.join("background"))
}
