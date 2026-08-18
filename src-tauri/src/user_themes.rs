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

/// Every `.css` file directly inside `~/.loam/themes/`.
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

/// Longest file name accepted, so a name can never be the thing that fails.
const MAX_THEME_FILE_NAME_BYTES: usize = 96;

/// Writes one theme file into the user's theme directory.
///
/// The directory is ours to choose and the name is ours to check: the caller
/// sends a file name and CSS text, and nothing here lets either of them name a
/// place outside that directory. Same size cap as the reader enforces, so
/// anything this writes is something it can read back.
///
/// The text itself is not parsed or judged. A theme is data, and what a theme
/// means belongs to the front end that holds the contract — a file this refused
/// to write because it disliked a declaration would be a second, disagreeing
/// opinion about that contract.
#[tauri::command]
pub fn save_user_theme(file_name: String, css: String) -> Result<String, WorkspaceError> {
    let directory = user_themes_dir()?;
    save_user_theme_in_dir(&directory, &file_name, &css)
}

pub fn save_user_theme_in_dir(
    directory: &Path,
    file_name: &str,
    css: &str,
) -> Result<String, WorkspaceError> {
    let name = theme_file_name(file_name)?;

    if css.len() as u64 > MAX_THEME_FILE_BYTES {
        return Err(WorkspaceError::new(
            "theme_too_large",
            format!("主题超过 {} KiB 上限", MAX_THEME_FILE_BYTES / 1024),
        ));
    }

    fs::create_dir_all(directory).map_err(|error| {
        WorkspaceError::from_io("theme_dir_create_failed", "无法创建主题目录", &error)
    })?;

    let path = directory.join(&name);
    fs::write(&path, css).map_err(|error| {
        WorkspaceError::from_io("theme_write_failed", "无法写入主题文件", &error)
    })?;

    Ok(path.to_string_lossy().to_string())
}

/// The file name to write, or why it is not one.
///
/// One segment, ending in `.css`, not hidden. Everything a name could otherwise
/// be — a path, a traversal, an empty string — is refused rather than repaired:
/// a name this had to fix is a name the user would not recognise in their own
/// directory.
fn theme_file_name(file_name: &str) -> Result<String, WorkspaceError> {
    let trimmed = file_name.trim();
    let refuse = |reason: &str| {
        Err(WorkspaceError::new(
            "theme_name_invalid",
            format!("主题文件名不可用：{reason}"),
        ))
    };

    if trimmed.is_empty() {
        return refuse("不能为空");
    }

    if trimmed.len() > MAX_THEME_FILE_NAME_BYTES {
        return refuse("过长");
    }

    if !trimmed.to_ascii_lowercase().ends_with(".css") {
        return refuse("必须以 .css 结尾");
    }

    if trimmed.starts_with('.') {
        return refuse("不能以点开头");
    }

    if trimmed.contains('\0') {
        return refuse("含有非法字符");
    }

    // One plain segment: this rejects `a/b.css`, `../b.css` and every absolute
    // form, on every platform's separators rather than only this one's.
    let mut components = Path::new(trimmed).components();
    let Some(std::path::Component::Normal(only)) = components.next() else {
        return refuse("必须是单个文件名");
    };

    if components.next().is_some() || only != std::ffi::OsStr::new(trimmed) {
        return refuse("必须是单个文件名");
    }

    if trimmed.contains('\\') {
        return refuse("必须是单个文件名");
    }

    Ok(trimmed.to_string())
}

/// Shows the theme directory in the file manager, making it first if it is not
/// there — a directory that is only described and never opened is a path the user
/// has to retype.
#[tauri::command]
pub fn reveal_user_themes_dir() -> Result<String, WorkspaceError> {
    let directory = user_themes_dir()?;

    fs::create_dir_all(&directory).map_err(|error| {
        WorkspaceError::from_io("theme_dir_create_failed", "无法创建主题目录", &error)
    })?;

    reveal_directory_os(&directory)?;

    Ok(directory.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
fn reveal_directory_os(directory: &Path) -> Result<(), WorkspaceError> {
    std::process::Command::new("open")
        .arg("--")
        .arg(directory)
        .status()
        .map_err(|error| {
            WorkspaceError::from_io("theme_dir_open_failed", "无法打开主题目录", &error)
        })
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(WorkspaceError::new(
                    "theme_dir_open_failed",
                    format!("打开主题目录失败，退出码 {status}"),
                ))
            }
        })
}

#[cfg(not(target_os = "macos"))]
fn reveal_directory_os(_directory: &Path) -> Result<(), WorkspaceError> {
    Err(WorkspaceError::new(
        "theme_dir_open_failed",
        "只在 macOS 上支持打开主题目录",
    ))
}

/// The directory user themes live in, under the same `~/.loam` the rest of the
/// product already uses for drafts and assets.
pub fn user_themes_dir() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            WorkspaceError::new("theme_path_failed", "home directory is not set")
        })?;
    Ok(PathBuf::from(home).join(".loam").join("themes"))
}
