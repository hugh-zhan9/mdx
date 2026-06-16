use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

use crate::memory_agent_events::{capture_agent_event, AgentHookEvent};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

static SPOOL_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpoolImportReport {
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub quarantined: usize,
}

pub fn count_spool_files(root: impl AsRef<Path>) -> Result<usize, WorkspaceError> {
    count_final_json_files(&spool_dir(root.as_ref()))
}

pub fn count_quarantine_files(root: impl AsRef<Path>) -> Result<usize, WorkspaceError> {
    count_final_json_files(&root.as_ref().join(".mdx/memory-spool-quarantine"))
}

pub fn write_spool_event(
    root: impl AsRef<Path>,
    event: &AgentHookEvent,
) -> Result<PathBuf, WorkspaceError> {
    let bytes = serde_json::to_vec_pretty(event).map_err(|error| {
        WorkspaceError::new(
            "spool_encode_failed",
            format!("failed to encode memory spool event: {error}"),
        )
    })?;
    let spool_dir = spool_dir(root.as_ref());
    ensure_spool_dir(&spool_dir)?;
    let path = spool_dir.join(format!("{}.json", sha256_hex(&bytes)));
    if ensure_regular_file_or_missing(&path)? {
        return Ok(path);
    }
    let temp_path = temp_spool_path(&path);
    if ensure_regular_file_or_missing(&temp_path)? {
        return Err(WorkspaceError::new(
            "spool_file_invalid",
            "temporary memory spool event path already exists",
        ));
    }

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|error| {
            WorkspaceError::from_io(
                "spool_write_failed",
                "failed to create temporary memory spool event",
                &error,
            )
        })?;
    file.write_all(&bytes).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io(
            "spool_write_failed",
            "failed to write temporary memory spool event",
            &error,
        )
    })?;
    file.sync_all().map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io(
            "spool_write_failed",
            "failed to sync temporary memory spool event",
            &error,
        )
    })?;
    drop(file);

    if ensure_regular_file_or_missing(&path)? {
        let _ = fs::remove_file(&temp_path);
        return Ok(path);
    }
    fs::rename(&temp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io(
            "spool_write_failed",
            "failed to publish memory spool event",
            &error,
        )
    })?;
    sync_directory(&spool_dir)?;
    Ok(path)
}

pub fn import_spool(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<SpoolImportReport, WorkspaceError> {
    let root = root.as_ref();
    let spool_dir = spool_dir(root);
    match existing_spool_dir_kind(&spool_dir)? {
        SpoolDirKind::Missing => return Ok(empty_report()),
        SpoolDirKind::Directory => {}
        SpoolDirKind::Invalid => {
            return Err(WorkspaceError::new(
                "spool_dir_invalid",
                "memory spool path is not a real directory",
            ));
        }
    }

    let mut report = empty_report();
    let mut paths = read_spool_paths(&spool_dir)?;
    paths.sort();
    for path in paths {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                quarantine_spool_file(root, &path)?;
                report.quarantined += 1;
                continue;
            }
            Ok(metadata) if !metadata.file_type().is_file() => continue,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                quarantine_spool_file(root, &path)?;
                report.quarantined += 1;
                continue;
            }
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                quarantine_spool_file(root, &path)?;
                report.quarantined += 1;
                continue;
            }
        };
        let event = match serde_json::from_slice::<AgentHookEvent>(&bytes) {
            Ok(event) => event,
            Err(_) => {
                quarantine_spool_file(root, &path)?;
                report.quarantined += 1;
                continue;
            }
        };
        if capture_agent_event(storage, &event)?.inserted {
            report.imported += 1;
        } else {
            report.skipped_duplicates += 1;
        }
        fs::remove_file(&path).map_err(|error| {
            WorkspaceError::from_io(
                "spool_import_failed",
                "failed to remove imported memory spool file",
                &error,
            )
        })?;
    }
    Ok(report)
}

fn empty_report() -> SpoolImportReport {
    SpoolImportReport {
        imported: 0,
        skipped_duplicates: 0,
        quarantined: 0,
    }
}

fn read_spool_paths(spool_dir: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    fs::read_dir(spool_dir)
        .map_err(|error| {
            WorkspaceError::from_io(
                "spool_import_failed",
                "failed to read memory spool directory",
                &error,
            )
        })?
        .filter_map(|entry| match entry {
            Ok(entry) => {
                let path = entry.path();
                if is_final_spool_json_path(&path) {
                    Some(Ok(path))
                } else {
                    None
                }
            }
            Err(error) => Some(Err(WorkspaceError::from_io(
                "spool_import_failed",
                "failed to read memory spool entry",
                &error,
            ))),
        })
        .collect()
}

fn count_final_json_files(dir: &Path) -> Result<usize, WorkspaceError> {
    match existing_mdx_child_dir_kind(dir)? {
        SpoolDirKind::Missing => Ok(0),
        SpoolDirKind::Invalid => Err(WorkspaceError::new(
            "spool_dir_invalid",
            "memory spool path is not a real directory",
        )),
        SpoolDirKind::Directory => fs::read_dir(dir)
            .map_err(|error| {
                WorkspaceError::from_io(
                    "spool_import_failed",
                    "failed to read memory spool directory",
                    &error,
                )
            })?
            .try_fold(0usize, |count, entry| {
                let entry = entry.map_err(|error| {
                    WorkspaceError::from_io(
                        "spool_import_failed",
                        "failed to read memory spool entry",
                        &error,
                    )
                })?;
                let path = entry.path();
                if !is_final_spool_json_path(&path) {
                    return Ok(count);
                }
                let metadata = fs::symlink_metadata(&path).map_err(|error| {
                    WorkspaceError::from_io(
                        "spool_import_failed",
                        "failed to inspect memory spool entry",
                        &error,
                    )
                })?;
                if metadata.file_type().is_file() {
                    Ok(count + 1)
                } else {
                    Ok(count)
                }
            }),
    }
}

fn is_final_spool_json_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
        return false;
    };
    !file_name.starts_with('.') && file_name.ends_with(".json")
}

fn quarantine_spool_file(root: &Path, path: &Path) -> Result<(), WorkspaceError> {
    let quarantine_dir = root.join(".mdx/memory-spool-quarantine");
    let mdx_dir = quarantine_dir.parent().ok_or_else(|| {
        WorkspaceError::new(
            "spool_quarantine_dir_invalid",
            "memory spool quarantine path has no parent",
        )
    })?;
    ensure_real_directory(mdx_dir, "spool_parent_dir_invalid")?;
    ensure_real_directory(&quarantine_dir, "spool_quarantine_dir_invalid")?;
    let file_name = path
        .file_name()
        .map(|file_name| file_name.to_owned())
        .unwrap_or_else(|| std::ffi::OsString::from("spool-event.json"));
    let quarantine_path = quarantine_dir.join(file_name);
    fs::rename(path, quarantine_path).map_err(|error| {
        WorkspaceError::from_io(
            "spool_import_failed",
            "failed to quarantine memory spool file",
            &error,
        )
    })
}

fn spool_dir(root: &Path) -> PathBuf {
    root.join(".mdx/memory-spool")
}

fn ensure_spool_dir(spool_dir: &Path) -> Result<(), WorkspaceError> {
    let mdx_dir = spool_dir.parent().ok_or_else(|| {
        WorkspaceError::new("spool_dir_invalid", "memory spool path has no parent")
    })?;
    ensure_real_directory(mdx_dir, "spool_parent_dir_invalid")?;
    ensure_real_directory(spool_dir, "spool_dir_invalid")
}

fn ensure_real_directory(path: &Path, invalid_code: &'static str) -> Result<(), WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_dir() {
                return Err(WorkspaceError::new(
                    invalid_code,
                    "memory spool path is not a real directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|error| {
                WorkspaceError::from_io(
                    "spool_write_failed",
                    "failed to create memory spool directory",
                    &error,
                )
            })?;
            let metadata = fs::symlink_metadata(path).map_err(|error| {
                WorkspaceError::from_io(
                    "spool_write_failed",
                    "failed to inspect created memory spool directory",
                    &error,
                )
            })?;
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_dir() {
                return Err(WorkspaceError::new(
                    invalid_code,
                    "memory spool path is not a real directory",
                ));
            }
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "spool_write_failed",
                "failed to inspect memory spool directory",
                &error,
            ));
        }
    }
    Ok(())
}

fn ensure_regular_file_or_missing(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_file() {
                return Err(WorkspaceError::new(
                    "spool_file_invalid",
                    "memory spool event path is not a regular file",
                ));
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(WorkspaceError::from_io(
            "spool_write_failed",
            "failed to inspect memory spool event path",
            &error,
        )),
    }
}

fn temp_spool_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|file_name| file_name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "event.json".to_string());
    let counter = SPOOL_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ))
}

enum SpoolDirKind {
    Missing,
    Directory,
    Invalid,
}

fn existing_spool_dir_kind(spool_dir: &Path) -> Result<SpoolDirKind, WorkspaceError> {
    existing_mdx_child_dir_kind(spool_dir)
}

fn existing_mdx_child_dir_kind(child_dir: &Path) -> Result<SpoolDirKind, WorkspaceError> {
    let mdx_dir = child_dir.parent().ok_or_else(|| {
        WorkspaceError::new("spool_dir_invalid", "memory spool path has no parent")
    })?;
    match fs::symlink_metadata(mdx_dir) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_dir() {
                return Ok(SpoolDirKind::Invalid);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SpoolDirKind::Missing);
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "spool_import_failed",
                "failed to inspect memory spool parent directory",
                &error,
            ));
        }
    }
    match fs::symlink_metadata(child_dir) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_dir() {
                Ok(SpoolDirKind::Invalid)
            } else {
                Ok(SpoolDirKind::Directory)
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SpoolDirKind::Missing),
        Err(error) => Err(WorkspaceError::from_io(
            "spool_import_failed",
            "failed to inspect memory spool directory",
            &error,
        )),
    }
}

fn sync_directory(path: &Path) -> Result<(), WorkspaceError> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            WorkspaceError::from_io(
                "spool_write_failed",
                "failed to sync memory spool directory",
                &error,
            )
        })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}
