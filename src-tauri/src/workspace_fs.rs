use std::fs;
use std::fs::File;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::{
    AffectedPrefix, CreateFolderResult, CreateMarkdownFileResult, FileTreeNode, PathChangeResult,
    ScanWorkspaceResult, TrashPathResult, WorkspaceError,
};
use crate::path_guard::{
    canonicalize_in_workspace, canonicalize_workspace_root, is_allowed_markdown_file,
    is_ignored_dir, resolve_candidate_path, sanitize_filename,
};

const DEFAULT_MAX_TREE_ENTRIES: usize = 100_000;
const PREVIEW_TEXT_EXTENSIONS: &[&str] = &[
    "",
    "csv",
    "go",
    "java",
    "js",
    "json",
    "jsp",
    "mhtml",
    "ndjson",
    "properties",
    "py",
    "rst",
    "sh",
    "sql",
    "srt",
    "template",
    "ts",
    "txt",
    "xml",
    "xsd",
    "yaml",
    "yml",
];
const PREVIEW_BINARY_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "jfif", "gif", "webp", "awebp", "svg", "bmp", "avif", "heic",
    "tif", "tiff",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWorkspaceOptions {
    #[serde(default)]
    pub exclude_dirs: Vec<String>,
}

pub fn next_untitled_name(dir: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let dir = dir.as_ref();

    for index in 0.. {
        let name = if index == 0 {
            "Untitled.md".to_string()
        } else {
            format!("Untitled{index}.md")
        };

        if !path_has_entry(&dir.join(&name))? {
            return Ok(name);
        }
    }

    unreachable!("unbounded untitled filename search should always return")
}

#[tauri::command]
pub async fn scan_workspace(
    root_path: String,
    options: Option<ScanWorkspaceOptions>,
) -> Result<ScanWorkspaceResult, WorkspaceError> {
    run_blocking(move || scan_workspace_sync(root_path, options)).await
}

pub fn scan_workspace_sync(
    root_path: String,
    options: Option<ScanWorkspaceOptions>,
) -> Result<ScanWorkspaceResult, WorkspaceError> {
    scan_workspace_with_options(
        root_path,
        options.unwrap_or_default(),
        DEFAULT_MAX_TREE_ENTRIES,
    )
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, WorkspaceError> + Send + 'static,
) -> Result<T, WorkspaceError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            WorkspaceError::new(
                "background_task_failed",
                format!("failed to join workspace background task: {error}"),
            )
        })?
}

#[cfg(test)]
pub fn scan_workspace_with_limit(
    root_path: String,
    max_tree_entries: usize,
) -> Result<ScanWorkspaceResult, WorkspaceError> {
    scan_workspace_with_options(root_path, ScanWorkspaceOptions::default(), max_tree_entries)
}

pub fn scan_workspace_with_options(
    root_path: String,
    options: ScanWorkspaceOptions,
    max_tree_entries: usize,
) -> Result<ScanWorkspaceResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let mut state = ScanState::new(max_tree_entries, options.exclude_dirs);
    let nodes = scan_dir(&root, &root, &mut state)?;
    let warnings = if state.truncated {
        vec![format!(
            "Workspace tree is too large; showing the first {} entries.",
            state.entry_count
        )]
    } else {
        Vec::new()
    };

    Ok(ScanWorkspaceResult {
        root_path: path_to_string(&root),
        nodes,
        truncated: state.truncated,
        entry_count: state.entry_count,
        warnings,
    })
}

#[tauri::command]
pub fn read_markdown_file(root_path: String, path: String) -> Result<String, WorkspaceError> {
    let target = resolve_existing_markdown_path(root_path, path)?;
    ensure_markdown_path(&target.path)?;

    let mut file = open_markdown_file_read(&target)?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read markdown file", &error)
    })?;

    Ok(content)
}

#[tauri::command]
pub fn read_preview_text_file(root_path: String, path: String) -> Result<String, WorkspaceError> {
    let target = resolve_existing_preview_text_path(root_path, path)?;
    ensure_preview_text_path(&target.path)?;

    let mut file = open_markdown_file_read(&target)?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read preview text file", &error)
    })?;

    Ok(content)
}

#[tauri::command]
pub fn read_preview_binary_file(
    root_path: String,
    path: String,
) -> Result<Vec<u8>, WorkspaceError> {
    let target = resolve_existing_preview_binary_path(root_path, path)?;
    ensure_preview_binary_path(&target.path)?;

    let mut file = open_markdown_file_read(&target)?;
    let mut content = Vec::new();
    file.read_to_end(&mut content).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read preview binary file", &error)
    })?;

    Ok(content)
}

#[tauri::command]
pub fn write_markdown_file(
    root_path: String,
    path: String,
    content: String,
) -> Result<(), WorkspaceError> {
    let path = resolve_workspace_file_path(root_path, path)?;

    match path {
        ResolvedWorkspacePath::Existing(target) => {
            ensure_markdown_path(&target.path)?;
            let mut file = open_markdown_file_write_existing(&target)?;
            file.write_all(content.as_bytes()).map_err(|error| {
                WorkspaceError::from_io("write_failed", "failed to write markdown file", &error)
            })
        }
        ResolvedWorkspacePath::Missing(target) => {
            ensure_markdown_path(&target.path)?;
            ensure_target_available(&target.path)?;
            let mut file = open_markdown_file_write_new(&target)?;
            file.write_all(content.as_bytes()).map_err(|error| {
                WorkspaceError::from_io("write_failed", "failed to write markdown file", &error)
            })
        }
    }
}

#[tauri::command]
pub fn create_markdown_file(
    root_path: String,
    parent_dir: String,
    name: Option<String>,
    temporary_untitled: Option<bool>,
) -> Result<CreateMarkdownFileResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let parent_dir = canonicalize_in_workspace(&root, parent_dir)?;
    ensure_directory(&parent_dir)?;

    let temporary_untitled = temporary_untitled.unwrap_or(false);
    let name = if temporary_untitled {
        next_untitled_name(&parent_dir)?
    } else {
        normalize_markdown_filename(name.as_deref().unwrap_or(""))?
    };
    let path = parent_dir.join(&name);

    ensure_target_available(&path)?;
    let target = WorkspaceFileTarget {
        relative_path: relative_to_root(&root, &path)?,
        path,
        root,
    };

    let _file = open_markdown_file_write_new(&target)?;

    Ok(CreateMarkdownFileResult {
        path: path_to_string(&target.path),
        name,
        needs_rename_on_first_save: temporary_untitled,
    })
}

#[tauri::command]
pub fn create_folder(
    root_path: String,
    parent_dir: String,
    name: String,
) -> Result<CreateFolderResult, WorkspaceError> {
    let parent_dir = canonicalize_in_workspace(root_path, parent_dir)?;
    ensure_directory(&parent_dir)?;
    let name = sanitize_filename(&name)?;
    let path = parent_dir.join(&name);

    ensure_target_available(&path)?;

    fs::create_dir(&path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "write_failed"
        };
        WorkspaceError::from_io(code, "failed to create folder", &error)
    })?;

    Ok(CreateFolderResult {
        path: path_to_string(&path),
        name,
    })
}

#[tauri::command]
pub fn rename_path(
    root_path: String,
    from_path: String,
    new_name: String,
) -> Result<PathChangeResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let from_path = canonicalize_in_workspace(&root, from_path)?;

    if from_path == root {
        return Err(WorkspaceError::new(
            "outside_workspace",
            "workspace root cannot be renamed",
        ));
    }

    let metadata = fs::metadata(&from_path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::NotFound {
            "not_found"
        } else {
            "rename_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect path before rename", &error)
    })?;
    let new_name = sanitize_filename(&new_name)?;
    if metadata.is_file() && !is_allowed_markdown_file(&new_name) {
        return Err(WorkspaceError::new(
            "invalid_name",
            "markdown files must end with .md or .markdown",
        ));
    }
    let new_path = from_path
        .parent()
        .ok_or_else(|| WorkspaceError::new("rename_failed", "path has no parent"))?
        .join(new_name);

    ensure_path_inside_root(&root, &new_path)?;
    ensure_target_available(&new_path)?;

    fs::rename(&from_path, &new_path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "rename_failed"
        };
        WorkspaceError::from_io(code, "failed to rename path", &error)
    })?;

    Ok(path_change_result(from_path, new_path, metadata.is_dir()))
}

#[tauri::command]
pub fn move_path(
    root_path: String,
    from_path: String,
    target_dir: String,
) -> Result<PathChangeResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let from_path = canonicalize_in_workspace(&root, from_path)?;
    let target_dir = canonicalize_in_workspace(&root, target_dir)?;
    ensure_directory(&target_dir)?;

    if from_path == root {
        return Err(WorkspaceError::new(
            "outside_workspace",
            "workspace root cannot be moved",
        ));
    }

    let metadata = fs::metadata(&from_path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::NotFound {
            "not_found"
        } else {
            "move_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect path before move", &error)
    })?;

    if metadata.is_dir() && target_dir.starts_with(&from_path) {
        return Err(WorkspaceError::new(
            "move_into_self",
            "folder cannot be moved into itself or a descendant",
        ));
    }

    let name = from_path
        .file_name()
        .ok_or_else(|| WorkspaceError::new("move_failed", "path has no file name"))?;
    let new_path = target_dir.join(name);
    ensure_path_inside_root(&root, &new_path)?;
    ensure_target_available(&new_path)?;

    fs::rename(&from_path, &new_path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "move_failed"
        };
        WorkspaceError::from_io(code, "failed to move path", &error)
    })?;

    Ok(path_change_result(from_path, new_path, metadata.is_dir()))
}

#[tauri::command]
pub fn trash_path(root_path: String, path: String) -> Result<TrashPathResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let path = canonicalize_in_workspace(&root, path)?;

    if path == root {
        return Err(WorkspaceError::new(
            "outside_workspace",
            "workspace root cannot be moved to trash",
        ));
    }

    trash_path_impl(&path)?;

    Ok(TrashPathResult {
        trashed_path: path_to_string(&path),
    })
}

struct ScanState {
    max_tree_entries: usize,
    entry_count: usize,
    raw_entry_count: usize,
    truncated: bool,
    exclude_dirs: Vec<String>,
}

impl ScanState {
    fn new(max_tree_entries: usize, exclude_dirs: Vec<String>) -> Self {
        Self {
            max_tree_entries,
            entry_count: 0,
            raw_entry_count: 0,
            truncated: false,
            exclude_dirs: normalize_exclude_dirs(exclude_dirs),
        }
    }

    fn try_count_entry(&mut self) -> bool {
        if self.entry_count >= self.max_tree_entries {
            self.truncated = true;
            return false;
        }

        self.entry_count += 1;
        true
    }

    fn try_visit_raw_entry(&mut self) -> bool {
        if self.raw_entry_count >= self.max_tree_entries {
            self.truncated = true;
            return false;
        }

        self.raw_entry_count += 1;
        true
    }

    fn should_exclude_dir(&self, root: &Path, path: &Path, name: &str) -> bool {
        if is_ignored_dir(name) {
            return true;
        }

        let Ok(relative_path) = path.strip_prefix(root) else {
            return true;
        };
        let relative = normalize_relative_dir(relative_path);

        self.exclude_dirs.iter().any(|exclude| {
            name == exclude || relative == *exclude || relative.starts_with(&format!("{exclude}/"))
        })
    }
}

enum CandidateNode {
    File(PathBuf),
    Folder(PathBuf),
}

impl CandidateNode {
    fn name(&self) -> String {
        match self {
            CandidateNode::File(path) | CandidateNode::Folder(path) => path_name(path),
        }
    }

    fn sort_key(&self) -> (u8, String) {
        let kind = match self {
            CandidateNode::Folder(_) => 0,
            CandidateNode::File(_) => 1,
        };

        (kind, self.name().to_ascii_lowercase())
    }
}

fn scan_dir(
    root: &Path,
    dir: &Path,
    state: &mut ScanState,
) -> Result<Vec<FileTreeNode>, WorkspaceError> {
    let mut entries = Vec::new();
    let remaining_capacity = state.max_tree_entries.saturating_sub(state.entry_count);

    if remaining_capacity == 0 {
        state.truncated = true;
        return Ok(Vec::new());
    }

    for entry in fs::read_dir(dir).map_err(|error| map_scan_io_error(error, dir))? {
        if !state.try_visit_raw_entry() {
            break;
        }

        if entries.len() >= remaining_capacity {
            state.truncated = true;
            break;
        }

        let entry = entry.map_err(|error| map_scan_io_error(error, dir))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry
            .file_type()
            .map_err(|error| map_scan_io_error(error, dir))?;

        if file_type.is_dir() {
            if state.should_exclude_dir(root, &path, &name) {
                continue;
            }

            if let Ok(canonical_path) = fs::canonicalize(&path) {
                if canonical_path.starts_with(root) {
                    entries.push(CandidateNode::Folder(canonical_path));
                }
            }
        } else if file_type.is_file() && !is_hidden_file(&name) {
            if let Ok(canonical_path) = fs::canonicalize(&path) {
                if canonical_path.starts_with(root) {
                    entries.push(CandidateNode::File(canonical_path));
                }
            }
        }
    }

    entries.sort_by_key(CandidateNode::sort_key);

    let mut nodes = Vec::new();
    for entry in entries {
        if !state.try_count_entry() {
            break;
        }

        match entry {
            CandidateNode::File(path) => nodes.push(FileTreeNode::File {
                name: path_name(&path),
                path: path_to_string(&path),
            }),
            CandidateNode::Folder(path) => {
                let children = if state.truncated {
                    Vec::new()
                } else {
                    scan_dir(root, &path, state)?
                };

                nodes.push(FileTreeNode::Folder {
                    name: path_name(&path),
                    path: path_to_string(&path),
                    children,
                });
            }
        }
    }

    Ok(nodes)
}

fn is_hidden_file(name: &str) -> bool {
    name.starts_with('.')
}

fn resolve_workspace_file_path(
    root_path: String,
    path: String,
) -> Result<ResolvedWorkspacePath, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let path = resolve_candidate_path(&root, Path::new(&path));

    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceError::new(
                    "outside_workspace",
                    "symlink leaf targets cannot be written through workspace commands",
                ));
            }

            let path = canonicalize_in_workspace(&root, &path)?;
            return Ok(ResolvedWorkspacePath::Existing(WorkspaceFileTarget {
                relative_path: relative_to_root(&root, &path)?,
                path,
                root,
            }));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            let code = if error.kind() == io::ErrorKind::PermissionDenied {
                "permission_denied"
            } else {
                "path_failed"
            };

            return Err(WorkspaceError::from_io(
                code,
                "failed to inspect workspace path",
                &error,
            ));
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("outside_workspace", "path has no parent"))?;
    let parent = canonicalize_in_workspace(&root, parent)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| WorkspaceError::new("invalid_name", "path has no file name"))?;
    let path = parent.join(file_name);
    Ok(ResolvedWorkspacePath::Missing(WorkspaceFileTarget {
        relative_path: relative_to_root(&root, &path)?,
        path,
        root,
    }))
}

fn ensure_path_inside_root(root: &Path, path: &Path) -> Result<(), WorkspaceError> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "outside_workspace",
            "path is outside the workspace root",
        ))
    }
}

fn ensure_directory(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::metadata(path).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::NotFound {
            "not_found"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect directory", &error)
    })?;

    if metadata.is_dir() {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "not_directory",
            "path is not a directory",
        ))
    }
}

fn ensure_markdown_path(path: &Path) -> Result<(), WorkspaceError> {
    if is_allowed_markdown_file(path) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "invalid_name",
            "markdown files must end with .md or .markdown",
        ))
    }
}

fn ensure_preview_text_path(path: &Path) -> Result<(), WorkspaceError> {
    if is_allowed_preview_text_file(path) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "invalid_name",
            "preview text files must use a supported text extension",
        ))
    }
}

fn ensure_preview_binary_path(path: &Path) -> Result<(), WorkspaceError> {
    if is_allowed_preview_binary_file(path) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "invalid_name",
            "preview binary files must end with .pdf or a supported image extension",
        ))
    }
}

fn ensure_target_available(path: &Path) -> Result<(), WorkspaceError> {
    if path_has_entry(path)? {
        Err(WorkspaceError::new(
            "already_exists",
            "target path already exists",
        ))
    } else {
        Ok(())
    }
}

fn path_has_entry(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => {
            let code = if error.kind() == io::ErrorKind::PermissionDenied {
                "permission_denied"
            } else {
                "path_failed"
            };

            Err(WorkspaceError::from_io(
                code,
                format!("failed to inspect {}", path_to_string(path)),
                &error,
            ))
        }
    }
}

enum ResolvedWorkspacePath {
    Existing(WorkspaceFileTarget),
    Missing(WorkspaceFileTarget),
}

struct WorkspaceFileTarget {
    root: PathBuf,
    relative_path: PathBuf,
    path: PathBuf,
}

fn resolve_existing_markdown_path(
    root_path: String,
    path: String,
) -> Result<WorkspaceFileTarget, WorkspaceError> {
    match resolve_workspace_file_path(root_path, path)? {
        ResolvedWorkspacePath::Existing(path) => Ok(path),
        ResolvedWorkspacePath::Missing(_) => Err(WorkspaceError::new(
            "not_found",
            "markdown file does not exist",
        )),
    }
}

fn resolve_existing_preview_text_path(
    root_path: String,
    path: String,
) -> Result<WorkspaceFileTarget, WorkspaceError> {
    match resolve_workspace_file_path(root_path, path)? {
        ResolvedWorkspacePath::Existing(path) => Ok(path),
        ResolvedWorkspacePath::Missing(_) => Err(WorkspaceError::new(
            "not_found",
            "preview text file does not exist",
        )),
    }
}

fn resolve_existing_preview_binary_path(
    root_path: String,
    path: String,
) -> Result<WorkspaceFileTarget, WorkspaceError> {
    match resolve_workspace_file_path(root_path, path)? {
        ResolvedWorkspacePath::Existing(path) => Ok(path),
        ResolvedWorkspacePath::Missing(_) => Err(WorkspaceError::new(
            "not_found",
            "preview binary file does not exist",
        )),
    }
}

fn is_allowed_preview_text_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    PREVIEW_TEXT_EXTENSIONS.contains(&extension.as_str())
        || matches!(extension.as_str(), "html" | "htm")
}

fn is_allowed_preview_binary_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    let extension = extension.to_ascii_lowercase();

    PREVIEW_BINARY_EXTENSIONS.contains(&extension.as_str())
}

fn relative_to_root(root: &Path, path: &Path) -> Result<PathBuf, WorkspaceError> {
    path.strip_prefix(root)
        .map(Path::to_path_buf)
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside workspace root"))
}

fn open_markdown_file_read(target: &WorkspaceFileTarget) -> Result<File, WorkspaceError> {
    open_workspace_file(target, WorkspaceOpenMode::Read)
}

fn open_markdown_file_write_existing(target: &WorkspaceFileTarget) -> Result<File, WorkspaceError> {
    open_workspace_file(target, WorkspaceOpenMode::WriteExisting)
}

fn open_markdown_file_write_new(target: &WorkspaceFileTarget) -> Result<File, WorkspaceError> {
    open_workspace_file(target, WorkspaceOpenMode::CreateNew)
}

#[derive(Clone, Copy)]
enum WorkspaceOpenMode {
    Read,
    WriteExisting,
    CreateNew,
}

#[cfg(not(unix))]
fn open_workspace_file(
    _target: &WorkspaceFileTarget,
    _mode: WorkspaceOpenMode,
) -> Result<File, WorkspaceError> {
    Err(WorkspaceError::new(
        "unsupported_platform",
        "workspace file IO is only supported on Unix/macOS in this MVP",
    ))
}

#[cfg(unix)]
fn open_workspace_file(
    target: &WorkspaceFileTarget,
    mode: WorkspaceOpenMode,
) -> Result<File, WorkspaceError> {
    use std::ffi::{CString, OsStr};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Component;

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, WorkspaceError> {
        CString::new(value.as_bytes()).map_err(|_| {
            WorkspaceError::new(
                "invalid_name",
                "path component contains an interior NUL byte",
            )
        })
    }

    fn file_from_fd(fd: libc::c_int) -> Result<File, WorkspaceError> {
        if fd < 0 {
            Err(map_openat_error(io::Error::last_os_error(), "path_failed"))
        } else {
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }

    fn open_root_dir(root: &Path) -> Result<File, WorkspaceError> {
        let path = os_str_to_cstring(root.as_os_str())?;
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        file_from_fd(fd)
    }

    fn open_child_dir(parent: &File, name: &OsStr) -> Result<File, WorkspaceError> {
        let name = os_str_to_cstring(name)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0,
            )
        };
        file_from_fd(fd)
    }

    fn open_leaf(
        parent: &File,
        name: &OsStr,
        mode: WorkspaceOpenMode,
    ) -> Result<File, WorkspaceError> {
        let (flags, permissions, fallback_error_code) = match mode {
            WorkspaceOpenMode::Read => (
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0,
                "read_failed",
            ),
            WorkspaceOpenMode::WriteExisting => (
                libc::O_WRONLY | libc::O_TRUNC | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0,
                "write_failed",
            ),
            WorkspaceOpenMode::CreateNew => (
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o644,
                "write_failed",
            ),
        };
        let name = os_str_to_cstring(name)?;
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags, permissions) };
        if fd < 0 {
            Err(map_openat_error(
                io::Error::last_os_error(),
                fallback_error_code,
            ))
        } else {
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }

    let mut dir = open_root_dir(&target.root)?;
    let mut components = target.relative_path.components().peekable();

    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(WorkspaceError::new(
                "outside_workspace",
                "workspace file path contains an invalid component",
            ));
        };

        if components.peek().is_some() {
            dir = open_child_dir(&dir, name)?;
        } else {
            return open_leaf(&dir, name, mode);
        }
    }

    Err(WorkspaceError::new(
        "invalid_name",
        "workspace file path has no leaf name",
    ))
}

#[cfg(unix)]
fn map_openat_error(error: io::Error, fallback_error_code: &'static str) -> WorkspaceError {
    let code = match error.raw_os_error() {
        Some(libc::EEXIST) => "already_exists",
        Some(libc::ENOENT) => "not_found",
        Some(libc::ELOOP) | Some(libc::ENOTDIR) => "outside_workspace",
        _ if error.kind() == io::ErrorKind::PermissionDenied => "permission_denied",
        _ => fallback_error_code,
    };
    WorkspaceError::from_io(code, "failed to open workspace file", &error)
}

fn normalize_markdown_filename(name: &str) -> Result<String, WorkspaceError> {
    let mut name = sanitize_filename(name)?;

    if Path::new(&name).extension().is_none() {
        name.push_str(".md");
    }

    if is_allowed_markdown_file(&name) {
        Ok(name)
    } else {
        Err(WorkspaceError::new(
            "invalid_name",
            "markdown files must end with .md or .markdown",
        ))
    }
}

fn path_change_result(old_path: PathBuf, new_path: PathBuf, is_dir: bool) -> PathChangeResult {
    let affected_prefix = if is_dir {
        Some(AffectedPrefix {
            old_prefix: path_to_string(&old_path),
            new_prefix: path_to_string(&new_path),
        })
    } else {
        None
    };

    PathChangeResult {
        old_path: path_to_string(&old_path),
        new_path: path_to_string(&new_path),
        affected_prefix,
    }
}

fn map_scan_io_error(error: io::Error, path: &Path) -> WorkspaceError {
    let code = if error.kind() == io::ErrorKind::PermissionDenied {
        "permission_denied"
    } else {
        "scan_failed"
    };
    WorkspaceError::from_io(
        code,
        format!("failed to scan {}", path_to_string(path)),
        &error,
    )
}

fn path_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn normalize_exclude_dirs(paths: Vec<String>) -> Vec<String> {
    let mut normalized = paths
        .into_iter()
        .map(|path| path.replace('\\', "/"))
        .map(|path| path.trim().trim_matches('/').to_string())
        .filter(|path| !path.is_empty())
        .filter(|path| !path.split('/').any(|part| part == "." || part == ".."))
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalize_relative_dir(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(target_os = "macos")]
fn trash_path_impl(path: &Path) -> Result<(), WorkspaceError> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};

    let mut trash_context = trash::TrashContext::default();
    trash_context.set_delete_method(DeleteMethod::NsFileManager);
    trash_context.delete(path).map_err(|error| {
        WorkspaceError::new("trash_failed", format!("failed to trash path: {error}"))
    })
}

#[cfg(not(target_os = "macos"))]
fn trash_path_impl(_path: &Path) -> Result<(), WorkspaceError> {
    Err(WorkspaceError::new(
        "trash_failed",
        "moving files to trash is only enabled on macOS",
    ))
}
