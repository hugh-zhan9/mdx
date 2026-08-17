use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::models::WorkspaceError;

/// Largest theme file read at all. Mirrors `MAX_THEME_FILE_BYTES` on the
/// front end, and enforced here as well so an oversized file is never read into
/// memory in the first place.
const MAX_THEME_FILE_BYTES: u64 = 64 * 1024;

/// One file from the user's theme directory, as text.
///
/// The contents are handed over unparsed: this layer owns file access, and
/// deciding what a theme means belongs to the front end, which holds the
/// contract. Splitting it that way also means the parser can be tested without
/// a filesystem.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserThemeFile {
    pub file_name: String,
    /// The CSS text, or `None` when the file could not be read.
    pub text: Option<String>,
    /// Why the file could not be read, for the settings panel to show.
    pub error: Option<String>,
}

/// Every `.css` file directly inside `~/.mdx/themes/`.
///
/// A missing directory is not an error — most users will never create one — and
/// answers with an empty list. A file that cannot be read is reported in place
/// rather than dropped: a theme that vanishes without explanation is a state the
/// user cannot diagnose.
#[tauri::command]
pub fn list_user_themes() -> Result<Vec<UserThemeFile>, WorkspaceError> {
    let directory = user_themes_dir()?;
    read_user_themes_in_dir(&directory)
}

pub fn read_user_themes_in_dir(
    directory: &Path,
) -> Result<Vec<UserThemeFile>, WorkspaceError> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Vec::new());
        }
        Err(error) => {
            return Err(WorkspaceError::new(
                "theme_dir_read_failed",
                format!("无法读取主题目录：{error}"),
            ));
        }
    };

    let mut themes = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            // A name that is not valid UTF-8 cannot become a theme id, and a
            // theme with no addressable id cannot be selected or persisted.
            continue;
        };
        if !file_name.to_ascii_lowercase().ends_with(".css") {
            continue;
        }

        // `symlink_metadata` rather than `metadata`, so a symlink is seen as a
        // symlink. A link is not followed: the directory is a place for the
        // user's own files, and following links out of it would make the
        // enclosing directory a weaker boundary than it looks.
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                themes.push(UserThemeFile {
                    file_name: file_name.to_string(),
                    text: None,
                    error: Some(format!("无法读取：{error}")),
                });
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            themes.push(UserThemeFile {
                file_name: file_name.to_string(),
                text: None,
                error: Some("符号链接不被读取".to_string()),
            });
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        if metadata.len() > MAX_THEME_FILE_BYTES {
            themes.push(UserThemeFile {
                file_name: file_name.to_string(),
                text: None,
                error: Some(format!(
                    "文件超过 {} KiB 上限",
                    MAX_THEME_FILE_BYTES / 1024
                )),
            });
            continue;
        }

        match fs::read_to_string(&path) {
            Ok(text) => themes.push(UserThemeFile {
                file_name: file_name.to_string(),
                text: Some(text),
                error: None,
            }),
            // A theme file that is not UTF-8 is not a theme file. Reported, not
            // skipped, so the user learns which file it was.
            Err(error) => themes.push(UserThemeFile {
                file_name: file_name.to_string(),
                text: None,
                error: Some(format!("无法按 UTF-8 读取：{error}")),
            }),
        }
    }

    // Sorted by name so the settings list has a stable order across refreshes;
    // `read_dir` gives no ordering guarantee.
    themes.sort_by(|left, right| left.file_name.cmp(&right.file_name));

    Ok(themes)
}

/// The directory user themes live in, under the same `~/.mdx` the rest of the
/// product already uses for drafts and assets.
pub fn user_themes_dir() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            WorkspaceError::new("theme_path_failed", "home directory is not set")
        })?;
    Ok(PathBuf::from(home).join(".mdx").join("themes"))
}
