use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::memory_fs::ensure_memory_ready;
use crate::memory_models::{
    MemoryExportRequest, MemoryExportResult, MemoryImportRequest, MemoryImportResult,
};
use crate::models::WorkspaceError;

const BUNDLE_VERSION: u32 = 1;
const BUNDLE_DIRS: &[&str] = &["memory/memories", "memory/inbox", "memory/threads"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
struct MemoryBundleManifest {
    version: u32,
    files: Vec<String>,
    records_exported: usize,
    memory_count: usize,
    inbox_count: usize,
    thread_count: usize,
    log_included: bool,
}

pub fn memory_export_bundle(
    root: impl AsRef<Path>,
    request: MemoryExportRequest,
) -> Result<MemoryExportResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let output = PathBuf::from(request.output_path);
    reject_output_inside_bundle_source_dirs(root, &output)?;
    fs::create_dir_all(&output).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            "failed to create bundle directory",
            &error,
        )
    })?;

    let mut copied_paths = Vec::new();
    for relative_dir in BUNDLE_DIRS {
        let source_dir = root.join(relative_dir);
        if !source_dir.exists() {
            continue;
        }
        copy_dir_files(root, &source_dir, &output, &mut copied_paths)?;
    }
    if request.include_log && root.join("log.md").is_file() {
        copy_relative_file(root, &output, "log.md")?;
        copied_paths.push("log.md".to_string());
    }
    copied_paths.sort();

    let memory_count = copied_paths
        .iter()
        .filter(|path| is_record_path(path, "memory/memories"))
        .count();
    let inbox_count = copied_paths
        .iter()
        .filter(|path| is_record_path(path, "memory/inbox"))
        .count();
    let thread_count = copied_paths
        .iter()
        .filter(|path| is_record_path(path, "memory/threads"))
        .count();
    let records_exported = memory_count + inbox_count + thread_count;
    let log_included = copied_paths.iter().any(|path| path == "log.md");

    let manifest = MemoryBundleManifest {
        version: BUNDLE_VERSION,
        files: copied_paths.clone(),
        records_exported,
        memory_count,
        inbox_count,
        thread_count,
        log_included,
    };
    let manifest_path = output.join("manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|error| {
        WorkspaceError::new(
            "bundle_manifest_encode_failed",
            format!("failed to encode bundle manifest: {error}"),
        )
    })?;
    fs::write(&manifest_path, format!("{manifest_json}\n")).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            "failed to write bundle manifest",
            &error,
        )
    })?;

    Ok(MemoryExportResult {
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        output_path: output.to_string_lossy().into_owned(),
        version: BUNDLE_VERSION,
        records_exported,
        files_exported: copied_paths.len(),
        memory_count,
        inbox_count,
        thread_count,
        log_included,
        copied_paths,
    })
}

pub fn memory_import_bundle(
    root: impl AsRef<Path>,
    request: MemoryImportRequest,
) -> Result<MemoryImportResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    if request.strategy != "skip" {
        return Err(WorkspaceError::new(
            "unsupported_strategy",
            format!("unsupported memory import strategy: {}", request.strategy),
        ));
    }

    let input = PathBuf::from(&request.input_path);
    let manifest_path = input.join("manifest.json");
    let manifest_json = fs::read_to_string(&manifest_path).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_manifest_read_failed",
            "failed to read bundle manifest",
            &error,
        )
    })?;
    let manifest: MemoryBundleManifest = serde_json::from_str(&manifest_json).map_err(|error| {
        WorkspaceError::new(
            "bundle_manifest_decode_failed",
            format!("failed to decode bundle manifest: {error}"),
        )
    })?;
    if manifest.version != BUNDLE_VERSION {
        return Err(WorkspaceError::new(
            "unsupported_bundle_version",
            format!("unsupported memory bundle version: {}", manifest.version),
        ));
    }

    let files = validated_manifest_files(&manifest)?;
    let files_seen = files.len();
    let records_seen = files.iter().filter(|path| is_any_record_path(path)).count();
    let mut copied_paths = Vec::new();
    let mut skipped_paths = Vec::new();

    for relative in files {
        let source = input.join(&relative);
        let target = root.join(&relative);
        if target_conflicts_for_skip(root, &relative)? {
            skipped_paths.push(relative);
            continue;
        }
        if request.dry_run {
            skipped_paths.push(relative);
            continue;
        }
        let Some(parent) = target.parent() else {
            return Err(WorkspaceError::new(
                "invalid_bundle_path",
                "bundle path has no parent directory",
            ));
        };
        fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_import_failed",
                "failed to create import directory",
                &error,
            )
        })?;
        let source_metadata = fs::symlink_metadata(&source).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_import_failed",
                "failed to inspect bundle source file",
                &error,
            )
        })?;
        if !source_metadata.file_type().is_file() || source_metadata.file_type().is_symlink() {
            return Err(WorkspaceError::new(
                "bundle_import_failed",
                format!("bundle source path is not a regular file: {relative}"),
            ));
        }
        fs::copy(&source, &target).map_err(|error| {
            WorkspaceError::from_io("bundle_import_failed", "failed to copy bundle file", &error)
        })?;
        copied_paths.push(relative);
    }

    copied_paths.sort();
    skipped_paths.sort();
    let records_imported = copied_paths
        .iter()
        .filter(|path| is_any_record_path(path))
        .count();
    let records_skipped = skipped_paths
        .iter()
        .filter(|path| is_any_record_path(path))
        .count();

    if !request.dry_run && records_imported > 0 && crate::search_index::has_index(root) {
        crate::search_index::rebuild(root)?;
    }

    Ok(MemoryImportResult {
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        input_path: input.to_string_lossy().into_owned(),
        strategy: request.strategy,
        dry_run: request.dry_run,
        records_seen,
        records_imported,
        records_skipped,
        files_seen,
        files_imported: copied_paths.len(),
        files_skipped: skipped_paths.len(),
        copied_paths,
        skipped_paths,
    })
}

fn copy_dir_files(
    root: &Path,
    dir: &Path,
    output: &Path,
    copied_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    for entry in fs::read_dir(dir).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            "failed to scan memory bundle files",
            &error,
        )
    })? {
        let path = entry
            .map_err(|error| {
                WorkspaceError::from_io(
                    "bundle_export_failed",
                    "failed to read memory bundle file",
                    &error,
                )
            })?
            .path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_export_failed",
                "failed to inspect memory bundle file",
                &error,
            )
        })?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_dir_files(root, &path, output, copied_paths)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            WorkspaceError::new("outside_workspace", "bundle path is outside workspace")
        })?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        validate_manifest_path(&relative)?;
        copy_relative_file(root, output, &relative)?;
        copied_paths.push(relative);
    }
    Ok(())
}

fn copy_relative_file(root: &Path, output: &Path, relative: &str) -> Result<(), WorkspaceError> {
    let source = root.join(relative);
    let source_metadata = fs::symlink_metadata(&source).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            "failed to inspect bundle source file",
            &error,
        )
    })?;
    if !source_metadata.file_type().is_file() || source_metadata.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "bundle_export_failed",
            format!("bundle source path is not a regular file: {relative}"),
        ));
    }
    let target = output.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_export_failed",
                "failed to create bundle subdirectory",
                &error,
            )
        })?;
    }
    fs::copy(source, target).map_err(|error| {
        WorkspaceError::from_io("bundle_export_failed", "failed to copy bundle file", &error)
    })?;
    Ok(())
}

fn reject_output_inside_bundle_source_dirs(
    root: &Path,
    output: &Path,
) -> Result<(), WorkspaceError> {
    let output = if output.is_absolute() {
        normalize_existing_ancestor(output)?
    } else {
        normalize_existing_ancestor(&root.join(output))?
    };
    for relative_dir in BUNDLE_DIRS {
        let source_dir = normalize_existing_ancestor(&root.join(relative_dir))?;
        if path_eq_or_under(&output, &source_dir) {
            return Err(WorkspaceError::new(
                "invalid_bundle_output",
                format!("bundle output must not be inside {relative_dir}"),
            ));
        }
    }
    Ok(())
}

fn target_conflicts_for_skip(root: &Path, relative: &str) -> Result<bool, WorkspaceError> {
    let target = root.join(relative);
    match fs::symlink_metadata(&target) {
        Ok(_) => return Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "bundle_import_failed",
                "failed to inspect import target",
                &error,
            ));
        }
    }

    let relative_path = Path::new(relative);
    let mut current = root.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        current.push(part);
        if current == target {
            break;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "bundle_import_failed",
                    "failed to inspect import target parent",
                    &error,
                ));
            }
        }
    }

    Ok(false)
}

fn validated_manifest_files(
    manifest: &MemoryBundleManifest,
) -> Result<Vec<String>, WorkspaceError> {
    let mut files = Vec::with_capacity(manifest.files.len());
    for relative in &manifest.files {
        validate_manifest_path(relative)?;
        files.push(relative.clone());
    }
    Ok(files)
}

fn validate_manifest_path(relative: &str) -> Result<(), WorkspaceError> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(WorkspaceError::new(
            "invalid_bundle_path",
            format!("bundle path must be relative: {relative}"),
        ));
    }
    if relative.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_bundle_path",
            "bundle path must not be empty",
        ));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(WorkspaceError::new(
                    "invalid_bundle_path",
                    format!("bundle path contains unsupported component: {relative}"),
                ));
            }
        }
    }
    if relative != "log.md" && !BUNDLE_DIRS.iter().any(|dir| path_is_under(relative, dir)) {
        return Err(WorkspaceError::new(
            "invalid_bundle_path",
            format!("bundle path is not part of the memory bundle: {relative}"),
        ));
    }
    Ok(())
}

fn is_any_record_path(path: &str) -> bool {
    is_record_path(path, "memory/memories")
        || is_record_path(path, "memory/inbox")
        || is_record_path(path, "memory/threads")
}

fn is_record_path(path: &str, prefix: &str) -> bool {
    path_is_under(path, prefix) && path.ends_with(".md")
}

fn path_is_under(path: &str, prefix: &str) -> bool {
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('/'))
}

fn path_eq_or_under(path: &Path, parent: &Path) -> bool {
    path == parent || path.starts_with(parent)
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn normalize_existing_ancestor(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let mut missing = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(name) = current.file_name() else {
            break;
        };
        missing.push(name.to_os_string());
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent;
    }

    let mut normalized = current.canonicalize().map_err(|error| {
        WorkspaceError::from_io(
            "invalid_bundle_output",
            "failed to resolve bundle output path",
            &error,
        )
    })?;
    for name in missing.iter().rev() {
        normalized.push(name);
    }
    Ok(normalize_path_lexically(&normalized))
}
