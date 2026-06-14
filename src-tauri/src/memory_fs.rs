use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::memory_models::{MemoryConfig, MemoryThreadFrontmatter, ThreadIndex, ThreadIndexEntry};
use crate::models::WorkspaceError;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
static LOCK_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);
const LOCK_STALE_AFTER_SECONDS: u64 = 60 * 60;

#[derive(Debug)]
pub(crate) struct MemoryWorkspaceLock {
    path: PathBuf,
    token: String,
}

impl Drop for MemoryWorkspaceLock {
    fn drop(&mut self) {
        let _ = remove_memory_lock_dir_if_token_matches(&self.path, &self.token);
    }
}

pub(crate) fn try_acquire_memory_lock(root: &Path) -> Result<MemoryWorkspaceLock, WorkspaceError> {
    ensure_directory(root)?;
    let mdx_dir = ensure_temp_dir(root)?;
    let lock_path = mdx_dir.join("memory.lock");
    let token = new_memory_lock_token();
    let created_at_unix = current_unix_seconds();
    let contents = format!(
        "token={token}\npid={}\ncreated_at_unix={created_at_unix}\n",
        std::process::id()
    );

    for attempt in 0..2 {
        match create_memory_lock_dir(&lock_path, &contents) {
            Ok(()) => {
                return Ok(MemoryWorkspaceLock {
                    path: lock_path.clone(),
                    token,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if attempt == 0 {
                    match recover_stale_memory_lock_dir(
                        &lock_path,
                        &token,
                        &contents,
                        created_at_unix,
                    )? {
                        StaleLockRecovery::Acquired => {
                            return Ok(MemoryWorkspaceLock {
                                path: lock_path.clone(),
                                token,
                            });
                        }
                        StaleLockRecovery::Retry => continue,
                        StaleLockRecovery::Busy => {}
                    }
                }
                return Err(memory_lock_busy());
            }
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "write_failed",
                    "failed to create memory lock directory",
                    &error,
                ));
            }
        }
    }

    Err(memory_lock_busy())
}

fn create_memory_lock_dir(lock_path: &Path, contents: &str) -> Result<(), std::io::Error> {
    fs::create_dir(lock_path)?;
    if let Err(error) = create_memory_lock_owner_file(lock_path, contents) {
        let _ = fs::remove_file(lock_path.join("owner"));
        let _ = fs::remove_dir(lock_path);
        return Err(error);
    }
    Ok(())
}

fn create_memory_lock_owner_file(lock_path: &Path, contents: &str) -> Result<(), std::io::Error> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path.join("owner"))?;
    if let Err(error) = file.write_all(contents.as_bytes()) {
        return Err(error);
    }
    file.sync_all()
}

enum StaleLockRecovery {
    Acquired,
    Retry,
    Busy,
}

fn recover_stale_memory_lock_dir(
    lock_path: &Path,
    recovery_token: &str,
    contents: &str,
    now_unix: u64,
) -> Result<StaleLockRecovery, WorkspaceError> {
    let lock_file = match read_memory_lock_owner(lock_path) {
        LockOwnerRead::Parsed(lock_file) => {
            if !memory_lock_is_stale(&lock_file, now_unix) {
                return Ok(StaleLockRecovery::Busy);
            }
            Some(lock_file)
        }
        LockOwnerRead::Malformed | LockOwnerRead::MissingOwner | LockOwnerRead::Unreadable => {
            if !memory_lock_dir_is_stale(lock_path, now_unix) {
                return Ok(StaleLockRecovery::Busy);
            }
            None
        }
        LockOwnerRead::MissingLock => return Ok(StaleLockRecovery::Retry),
    };

    let stale_path = lock_path.with_file_name(format!("memory.lock.stale-{recovery_token}"));
    match fs::rename(lock_path, &stale_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StaleLockRecovery::Retry);
        }
        Err(_) => return Ok(StaleLockRecovery::Busy),
    }

    match create_memory_lock_dir(lock_path, contents) {
        Ok(()) => {
            remove_stale_lock_dir(&stale_path, lock_file.as_ref());
            Ok(StaleLockRecovery::Acquired)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            restore_or_clean_stale_lock_dir(lock_path, &stale_path, lock_file.as_ref());
            Ok(StaleLockRecovery::Busy)
        }
        Err(error) => {
            restore_or_clean_stale_lock_dir(lock_path, &stale_path, lock_file.as_ref());
            Err(WorkspaceError::from_io(
                "write_failed",
                "failed to create memory lock directory",
                &error,
            ))
        }
    }
}

enum LockOwnerRead {
    Parsed(MemoryLockFile),
    Malformed,
    MissingOwner,
    MissingLock,
    Unreadable,
}

fn read_memory_lock_owner(lock_path: &Path) -> LockOwnerRead {
    match fs::read_to_string(lock_path.join("owner")) {
        Ok(contents) => match parse_memory_lock_file(&contents) {
            Ok(lock_file) => LockOwnerRead::Parsed(lock_file),
            Err(()) => LockOwnerRead::Malformed,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if lock_path.exists() {
                LockOwnerRead::MissingOwner
            } else {
                LockOwnerRead::MissingLock
            }
        }
        Err(_) => LockOwnerRead::Unreadable,
    }
}

fn memory_lock_is_stale(lock_file: &MemoryLockFile, now_unix: u64) -> bool {
    now_unix.saturating_sub(lock_file.created_at_unix) >= LOCK_STALE_AFTER_SECONDS
}

fn memory_lock_dir_is_stale(lock_path: &Path, now_unix: u64) -> bool {
    let Ok(metadata) = fs::symlink_metadata(lock_path) else {
        return false;
    };

    let modified_unix = metadata.modified().ok().and_then(system_time_to_unix);
    let created_unix = metadata.created().ok().and_then(system_time_to_unix);
    let Some(metadata_unix) = modified_unix.into_iter().chain(created_unix).max() else {
        return false;
    };

    now_unix.saturating_sub(metadata_unix) >= LOCK_STALE_AFTER_SECONDS
}

fn system_time_to_unix(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn remove_memory_lock_dir_if_token_matches(
    lock_path: &Path,
    expected_token: &str,
) -> Result<(), std::io::Error> {
    let owner_path = lock_path.join("owner");
    let contents = fs::read_to_string(&owner_path)?;
    let Ok(lock_file) = parse_memory_lock_file(&contents) else {
        return Ok(());
    };
    if lock_file.token == expected_token {
        fs::remove_file(owner_path)?;
        fs::remove_dir(lock_path)?;
    }
    Ok(())
}

fn remove_stale_lock_dir(stale_path: &Path, lock_file: Option<&MemoryLockFile>) {
    if let Some(lock_file) = lock_file {
        let _ = remove_memory_lock_dir_if_token_matches(stale_path, &lock_file.token);
    } else {
        let _ = fs::remove_file(stale_path.join("owner"));
        let _ = fs::remove_dir(stale_path);
    }
}

fn restore_or_clean_stale_lock_dir(
    lock_path: &Path,
    stale_path: &Path,
    lock_file: Option<&MemoryLockFile>,
) {
    if fs::rename(stale_path, lock_path).is_err() {
        if let Some(lock_file) = lock_file {
            let _ = remove_memory_lock_dir_if_token_matches(stale_path, &lock_file.token);
        }
    }
}

#[derive(Debug)]
struct MemoryLockFile {
    token: String,
    created_at_unix: u64,
}

fn parse_memory_lock_file(contents: &str) -> Result<MemoryLockFile, ()> {
    let mut token = None;
    let mut pid = None;
    let mut created_at_unix = None;

    for line in contents.lines() {
        let (key, value) = line.split_once('=').ok_or(())?;
        match key {
            "token" if !value.is_empty() => token = Some(value.to_string()),
            "pid" => pid = Some(value.parse::<u32>().map_err(|_| ())?),
            "created_at_unix" => created_at_unix = Some(value.parse::<u64>().map_err(|_| ())?),
            _ => {}
        }
    }

    if pid.is_none() {
        return Err(());
    }

    Ok(MemoryLockFile {
        token: token.ok_or(())?,
        created_at_unix: created_at_unix.ok_or(())?,
    })
}

fn new_memory_lock_token() -> String {
    let counter = LOCK_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "{}-{}-{counter}",
        std::process::id(),
        current_unix_nanos_for_token()
    )
}

fn current_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn current_unix_nanos_for_token() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn memory_lock_busy() -> WorkspaceError {
    WorkspaceError::new("memory_lock_busy", "memory workspace lock is already held")
}

#[cfg(test)]
pub(crate) fn recover_old_malformed_memory_lock_dir_for_test(
    root: &Path,
) -> Result<MemoryWorkspaceLock, WorkspaceError> {
    let mdx_dir = ensure_temp_dir(root)?;
    let lock_path = mdx_dir.join("memory.lock");
    let token = new_memory_lock_token();
    let now_unix = current_unix_seconds()
        .saturating_add(LOCK_STALE_AFTER_SECONDS)
        .saturating_add(1);
    let contents = format!(
        "token={token}\npid={}\ncreated_at_unix={now_unix}\n",
        std::process::id()
    );

    match recover_stale_memory_lock_dir(&lock_path, &token, &contents, now_unix)? {
        StaleLockRecovery::Acquired => Ok(MemoryWorkspaceLock {
            path: lock_path,
            token,
        }),
        StaleLockRecovery::Retry | StaleLockRecovery::Busy => Err(memory_lock_busy()),
    }
}

pub(crate) fn ensure_directory(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "root_not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect memory workspace root", &error)
    })?;

    let file_type = metadata.file_type();
    if file_type.is_symlink() || !file_type.is_dir() {
        return Err(WorkspaceError::new(
            "not_directory",
            "memory workspace root is not a directory",
        ));
    }

    Ok(())
}

pub(crate) fn create_dir_if_missing(
    root: &Path,
    relative_path: &str,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    let path = root.join(relative_path);
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::Directory => {
            preserved_paths.push(relative_path.to_string());
            return Ok(());
        }
        ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict(
                "directory",
                "not a directory",
                relative_path,
            ));
        }
    }

    fs::create_dir_all(&path).map_err(|error| {
        WorkspaceError::from_io("create_failed", "failed to create memory directory", &error)
    })?;
    created_paths.push(relative_path.to_string());
    Ok(())
}

pub(crate) fn create_file_if_missing(
    root: &Path,
    relative_path: &str,
    contents: &str,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    if write_workspace_file_if_missing(root, relative_path, contents.as_bytes())? {
        created_paths.push(relative_path.to_string());
    } else {
        preserved_paths.push(relative_path.to_string());
    }
    Ok(())
}

pub(crate) fn create_json_file_if_missing<T: serde::Serialize>(
    root: &Path,
    relative_path: &str,
    value: &T,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    let contents = serde_json::to_string_pretty(value)
        .map(|json| format!("{json}\n"))
        .map_err(|error| {
            WorkspaceError::new(
                "serialize_failed",
                format!("failed to serialize memory json file: {error}"),
            )
        })?;

    create_file_if_missing(
        root,
        relative_path,
        &contents,
        created_paths,
        preserved_paths,
    )
}

#[allow(dead_code)]
pub(crate) fn read_workspace_file(
    root: &Path,
    relative_path: &str,
) -> Result<String, WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    ensure_existing_parent_directories(root, relative_path)?;
    ensure_file_target(root, relative_path)?;
    fs::read_to_string(root.join(relative_path)).map_err(|error| {
        WorkspaceError::from_io(
            "read_failed",
            "failed to read memory workspace file",
            &error,
        )
    })
}

pub(crate) fn write_workspace_file(
    root: &Path,
    relative_path: &str,
    contents: &[u8],
) -> Result<(), WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    let path = root.join(relative_path);
    ensure_parent_directories(root, relative_path)?;
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::File => {}
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict("file", "not a file", relative_path));
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "memory path has no parent"))?;
    ensure_directory(parent)?;

    let temp_dir = ensure_temp_dir(root)?;
    let tmp_path = temp_dir.join(unique_temp_filename(relative_path));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|error| {
                WorkspaceError::from_io("write_failed", "failed to create memory temp file", &error)
            })?;
        file.write_all(contents).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to write memory temp file", &error)
        })?;
        file.sync_all().map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to sync memory temp file", &error)
        })?;
    }

    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        WorkspaceError::from_io("write_failed", "failed to replace memory file", &error)
    })
}

pub(crate) fn write_new_markdown_file<F>(
    root: &Path,
    directory: &str,
    date: &str,
    slug: &str,
    render: F,
) -> Result<String, WorkspaceError>
where
    F: Fn(&str) -> Result<Vec<u8>, WorkspaceError>,
{
    validate_workspace_relative_path(directory)?;
    let slug = slugify_segment(slug);
    for suffix in 0..10_000 {
        let filename = if suffix == 0 {
            format!("{date}-{slug}.md")
        } else {
            format!("{date}-{slug}-{suffix}.md")
        };
        let relative_path = format!("{directory}/{filename}");
        validate_workspace_relative_path(&relative_path)?;
        let contents = render(&relative_path)?;
        match write_workspace_file_new(root, &relative_path, contents)? {
            NewFileWrite::Created => return Ok(relative_path),
            NewFileWrite::AlreadyExists => {}
        }
    }

    Err(WorkspaceError::new(
        "path_collision",
        "could not allocate a unique memory markdown path",
    ))
}

enum NewFileWrite {
    Created,
    AlreadyExists,
}

fn write_workspace_file_new(
    root: &Path,
    relative_path: &str,
    contents: Vec<u8>,
) -> Result<NewFileWrite, WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    let path = root.join(relative_path);
    ensure_parent_directories(root, relative_path)?;
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::File => return Ok(NewFileWrite::AlreadyExists),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict("file", "not a file", relative_path));
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "memory path has no parent"))?;
    ensure_directory(parent)?;

    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return match existing_path_kind(&path)? {
                ExistingPathKind::File => Ok(NewFileWrite::AlreadyExists),
                ExistingPathKind::Directory
                | ExistingPathKind::Symlink
                | ExistingPathKind::Other => {
                    Err(path_type_conflict("file", "not a file", relative_path))
                }
                ExistingPathKind::Missing => Err(WorkspaceError::from_io(
                    "write_failed",
                    "failed to create new memory file",
                    &error,
                )),
            };
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "write_failed",
                "failed to create new memory file",
                &error,
            ));
        }
    };

    file.write_all(&contents).map_err(|error| {
        let _ = fs::remove_file(&path);
        WorkspaceError::from_io("write_failed", "failed to write new memory file", &error)
    })?;
    file.sync_all().map_err(|error| {
        let _ = fs::remove_file(&path);
        WorkspaceError::from_io("write_failed", "failed to sync new memory file", &error)
    })?;

    Ok(NewFileWrite::Created)
}

fn write_workspace_file_if_missing(
    root: &Path,
    relative_path: &str,
    contents: &[u8],
) -> Result<bool, WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    let path = root.join(relative_path);
    ensure_parent_directories(root, relative_path)?;
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::File => return Ok(false),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict("file", "not a file", relative_path));
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "memory path has no parent"))?;
    ensure_directory(parent)?;

    let temp_dir = ensure_temp_dir(root)?;
    let tmp_path = temp_dir.join(unique_temp_filename(relative_path));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|error| {
                WorkspaceError::from_io("write_failed", "failed to create memory temp file", &error)
            })?;
        file.write_all(contents).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to write memory temp file", &error)
        })?;
        file.sync_all().map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to sync memory temp file", &error)
        })?;
    }

    match fs::hard_link(&tmp_path, &path) {
        Ok(()) => {
            let _ = fs::remove_file(&tmp_path);
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = fs::remove_file(&tmp_path);
            match existing_path_kind(&path)? {
                ExistingPathKind::File => Ok(false),
                ExistingPathKind::Directory
                | ExistingPathKind::Symlink
                | ExistingPathKind::Other => {
                    Err(path_type_conflict("file", "not a file", relative_path))
                }
                ExistingPathKind::Missing => Err(WorkspaceError::from_io(
                    "write_failed",
                    "failed to create missing memory file",
                    &error,
                )),
            }
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp_path);
            Err(WorkspaceError::from_io(
                "write_failed",
                "failed to create missing memory file",
                &error,
            ))
        }
    }
}

#[allow(dead_code)]
pub(crate) fn append_workspace_file(
    root: &Path,
    relative_path: &str,
    entry: &str,
) -> Result<(), WorkspaceError> {
    let mut contents = read_workspace_file(root, relative_path)?;
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(entry);
    if !contents.ends_with('\n') {
        contents.push('\n');
    }
    write_workspace_file(root, relative_path, contents.as_bytes())
}

pub(crate) fn append_memory_log_entry(
    root: impl AsRef<Path>,
    entry: &str,
) -> Result<(), WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;
    append_workspace_file(root, "log.md", &format!("- {}\n", entry.trim()))
}

pub(crate) fn ensure_memory_ready(root: impl AsRef<Path>) -> Result<(), WorkspaceError> {
    let status = crate::memory::detect_memory_workspace(root.as_ref())?;
    if status.has_memory {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "memory_not_ready",
            "memory workspace is not initialized",
        ))
    }
}

pub(crate) fn render_markdown_with_frontmatter<T: serde::Serialize>(
    frontmatter: &T,
    body: &str,
) -> Result<String, WorkspaceError> {
    let yaml = serde_yaml_ng::to_string(frontmatter).map_err(|error| {
        WorkspaceError::new(
            "yaml_encode_failed",
            format!("failed to encode frontmatter: {error}"),
        )
    })?;
    Ok(format!("---\n{}---\n\n{}", yaml, body))
}

pub(crate) fn parse_markdown_frontmatter<T: serde::de::DeserializeOwned>(
    markdown: &str,
) -> Result<(T, String), WorkspaceError> {
    let rest = markdown
        .strip_prefix("---\n")
        .ok_or_else(|| WorkspaceError::new("invalid_frontmatter", "missing frontmatter start"))?;
    let (yaml, body) = rest
        .split_once("\n---\n")
        .ok_or_else(|| WorkspaceError::new("invalid_frontmatter", "missing frontmatter end"))?;
    let frontmatter = serde_yaml_ng::from_str::<T>(yaml).map_err(|error| {
        WorkspaceError::new(
            "yaml_decode_failed",
            format!("failed to decode frontmatter: {error}"),
        )
    })?;
    Ok((frontmatter, body.to_string()))
}

pub(crate) fn read_thread_index(root: &Path) -> Result<ThreadIndex, WorkspaceError> {
    let contents = read_workspace_file(root, ".mdx/thread-index.json")?;
    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "json_decode_failed",
            format!("failed to parse thread index: {error}"),
        )
    })
}

pub(crate) fn read_memory_config(root: &Path) -> Result<MemoryConfig, WorkspaceError> {
    let contents = read_workspace_file(root, ".mdx/memory-config.json")?;
    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "json_decode_failed",
            format!("failed to parse memory config: {error}"),
        )
    })
}

pub(crate) fn validate_thread_source(source: &str) -> Result<(), WorkspaceError> {
    match source {
        "codex" | "cursor" | "claude-code" | "import" | "manual" => Ok(()),
        _ => Err(WorkspaceError::new(
            "invalid_thread_source",
            "thread source must be one of codex, cursor, claude-code, import, manual",
        )),
    }
}

pub(crate) fn write_thread_index(root: &Path, index: &ThreadIndex) -> Result<(), WorkspaceError> {
    let contents = serde_json::to_vec_pretty(index).map_err(|error| {
        WorkspaceError::new(
            "json_encode_failed",
            format!("failed to encode thread index: {error}"),
        )
    })?;
    write_workspace_file(root, ".mdx/thread-index.json", &contents)
}

pub(crate) fn thread_index_entry(
    path: String,
    content_hash: String,
    frontmatter: &MemoryThreadFrontmatter,
) -> Result<ThreadIndexEntry, WorkspaceError> {
    Ok(ThreadIndexEntry {
        path,
        content_hash,
        updated_at: now_utc_rfc3339()?,
        thread_id: Some(frontmatter.thread_id.clone()),
        source: Some(frontmatter.source.clone()),
        title: Some(frontmatter.title.clone()),
        started_at: frontmatter.started_at.clone(),
        ended_at: frontmatter.ended_at.clone(),
        message_count: frontmatter.message_count,
        archived: Some(frontmatter.archived),
    })
}

pub(crate) fn normalize_markdown_body(body: &str) -> String {
    let trimmed = body.replace("\r\n", "\n").trim().to_string();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    }
}

pub(crate) fn sha256_prefixed(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

pub(crate) fn slugify_segment(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

pub(crate) fn date_prefix(iso_timestamp: Option<&str>) -> Result<String, WorkspaceError> {
    let timestamp = match iso_timestamp {
        Some(value) => {
            time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                .map_err(|error| {
                    WorkspaceError::new(
                        "invalid_timestamp",
                        format!("failed to parse timestamp: {error}"),
                    )
                })?
        }
        None => time::OffsetDateTime::now_utc(),
    };
    Ok(timestamp.date().to_string())
}

pub(crate) fn now_utc_rfc3339() -> Result<String, WorkspaceError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| {
            WorkspaceError::new(
                "time_format_failed",
                format!("failed to format timestamp: {error}"),
            )
        })
}

pub(crate) fn required_path_state(
    root: &Path,
    relative_path: &str,
    kind: RequiredPathKind,
) -> Result<RequiredPathState, WorkspaceError> {
    validate_workspace_relative_path(relative_path)?;
    let path_kind = existing_path_kind(&root.join(relative_path))?;
    Ok(match (path_kind, kind) {
        (ExistingPathKind::Missing, _) => RequiredPathState::Missing,
        (ExistingPathKind::Directory, RequiredPathKind::Directory)
        | (ExistingPathKind::File, RequiredPathKind::File) => RequiredPathState::Valid,
        _ => RequiredPathState::TypeConflict,
    })
}

pub(crate) enum RequiredPathKind {
    Directory,
    File,
}

pub(crate) enum RequiredPathState {
    Valid,
    Missing,
    TypeConflict,
}

enum ExistingPathKind {
    Missing,
    Directory,
    File,
    Symlink,
    Other,
}

fn existing_path_kind(path: &Path) -> Result<ExistingPathKind, WorkspaceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ExistingPathKind::Missing);
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "path_failed",
                "failed to inspect memory workspace path",
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

fn ensure_file_target(root: &Path, relative_path: &str) -> Result<(), WorkspaceError> {
    match existing_path_kind(&root.join(relative_path))? {
        ExistingPathKind::File => Ok(()),
        ExistingPathKind::Missing => Err(WorkspaceError::new(
            "not_found",
            format!("memory workspace file is missing: {relative_path}"),
        )),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("file", "not a file", relative_path))
        }
    }
}

fn ensure_temp_dir(root: &Path) -> Result<PathBuf, WorkspaceError> {
    let temp_dir = root.join(".mdx");
    match existing_path_kind(&temp_dir)? {
        ExistingPathKind::Directory => Ok(temp_dir),
        ExistingPathKind::Missing => {
            fs::create_dir_all(&temp_dir).map_err(|error| {
                WorkspaceError::from_io(
                    "create_failed",
                    "failed to create memory temp directory",
                    &error,
                )
            })?;
            Ok(temp_dir)
        }
        ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            Err(path_type_conflict("directory", "not a directory", ".mdx"))
        }
    }
}

fn ensure_existing_parent_directories(
    root: &Path,
    relative_path: &str,
) -> Result<(), WorkspaceError> {
    let path = root.join(relative_path);
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let relative_parent = parent
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside memory root"))?;

    let mut current = root.to_path_buf();
    for component in relative_parent.components() {
        current.push(component);
        let relative_component = relative_path_from_root(root, &current)?;
        match existing_path_kind(&current)? {
            ExistingPathKind::Directory => {}
            ExistingPathKind::Missing => return Ok(()),
            ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
                return Err(path_type_conflict(
                    "directory",
                    "not a directory",
                    &relative_component,
                ));
            }
        }
    }

    Ok(())
}

fn ensure_parent_directories(root: &Path, relative_path: &str) -> Result<(), WorkspaceError> {
    let path = root.join(relative_path);
    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "memory path has no parent"))?;
    let relative_parent = parent
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside memory root"))?;

    let mut current = root.to_path_buf();
    for component in relative_parent.components() {
        current.push(component);
        let relative_component = relative_path_from_root(root, &current)?;
        match existing_path_kind(&current)? {
            ExistingPathKind::Directory => {}
            ExistingPathKind::Missing => {
                fs::create_dir(&current).map_err(|error| {
                    WorkspaceError::from_io(
                        "create_failed",
                        "failed to create memory parent directory",
                        &error,
                    )
                })?;
            }
            ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
                return Err(path_type_conflict(
                    "directory",
                    "not a directory",
                    &relative_component,
                ));
            }
        }
    }

    Ok(())
}

fn validate_workspace_relative_path(relative_path: &str) -> Result<(), WorkspaceError> {
    if relative_path.is_empty()
        || relative_path.contains('\\')
        || relative_path.contains('\0')
        || Path::new(relative_path).is_absolute()
        || has_unsafe_slash_segment(relative_path)
    {
        return Err(invalid_workspace_path(relative_path));
    }

    let mut has_component = false;
    for component in Path::new(relative_path).components() {
        match component {
            std::path::Component::Normal(segment) => {
                let Some(segment) = segment.to_str() else {
                    return Err(invalid_workspace_path(relative_path));
                };
                if segment.is_empty() {
                    return Err(invalid_workspace_path(relative_path));
                }
                has_component = true;
            }
            _ => return Err(invalid_workspace_path(relative_path)),
        }
    }

    if !has_component {
        return Err(invalid_workspace_path(relative_path));
    }

    Ok(())
}

fn invalid_workspace_path(relative_path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "invalid_memory_workspace_path",
        format!("unsafe memory workspace path: {relative_path}"),
    )
}

fn has_unsafe_slash_segment(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn relative_path_from_root(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    path.strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside memory root"))
}

fn unique_temp_filename(relative_path: &str) -> String {
    let sanitized = relative_path.replace('/', "-");
    let process_id = std::process::id();
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(".{sanitized}.{process_id}.{counter}.{timestamp}.tmp")
}

fn path_type_conflict(expected: &str, actual: &str, relative_path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "path_type_conflict",
        format!("memory {expected} path exists but is {actual}: {relative_path}"),
    )
}
