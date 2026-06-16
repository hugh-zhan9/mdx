use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Deserialize;

use crate::memory::{
    MemoryMarkdownImportReport, MemoryStorageMigrateRequest, MemoryStorageMigrationReport,
};
use crate::memory_storage::{
    workspace_scope_for_root, MemoryStorage, StoredMemoryWrite, StoredThreadWrite,
};
use crate::WorkspaceError;

pub fn import_markdown_memory_to_db(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<MemoryMarkdownImportReport, WorkspaceError> {
    let root = root.as_ref();
    let scope = workspace_scope_for_root(root);
    let mut report = MemoryMarkdownImportReport {
        memories_imported: 0,
        inbox_imported: 0,
        threads_imported: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    for path in markdown_paths(root, &root.join("memory/memories"))? {
        let relative = relative_path(root, &path)?;
        match import_memory_file(&path, &scope.workspace_id, &scope.project_key, storage) {
            Ok(true) => report.memories_imported += 1,
            Ok(false) => report.skipped += 1,
            Err(error) => report.errors.push(format!("{relative}: {error}")),
        }
    }

    for path in markdown_paths(root, &root.join("memory/threads"))? {
        let relative = relative_path(root, &path)?;
        match import_thread_file(&path, &scope.workspace_id, storage) {
            Ok(true) => report.threads_imported += 1,
            Ok(false) => report.skipped += 1,
            Err(error) => report.errors.push(format!("{relative}: {error}")),
        }
    }

    Ok(report)
}

pub fn dry_run_storage_migration(
    root: impl AsRef<Path>,
    from: &str,
    to: &str,
    target: Option<&str>,
) -> Result<MemoryStorageMigrationReport, WorkspaceError> {
    let mut records_seen = BTreeMap::new();
    let mut validation_errors = Vec::new();

    validate_storage_migration_target(to, target, &mut validation_errors);

    if from == "sqlite" {
        let mut storage = crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(root)?;
        storage.initialize()?;
        records_seen.insert(
            "memories".to_string(),
            usize::try_from(storage.count_active_memories()?).unwrap_or(0),
        );
        records_seen.insert(
            "threads".to_string(),
            usize::try_from(storage.count_threads()?).unwrap_or(0),
        );
    } else {
        validation_errors.push(format!("unsupported_source:{from}"));
    }

    Ok(MemoryStorageMigrationReport {
        migration_id: format!("migration:{}:{to}", crate::memory_fs::now_utc_rfc3339()?),
        from: from.to_string(),
        to: to.to_string(),
        dry_run: true,
        records_seen,
        records_copied: BTreeMap::new(),
        records_skipped: BTreeMap::new(),
        validation_errors,
        backup_path: None,
        config_switched: false,
    })
}

pub fn dry_run_storage_migration_request(
    root: impl AsRef<Path>,
    request: MemoryStorageMigrateRequest,
) -> Result<MemoryStorageMigrationReport, WorkspaceError> {
    let mut report =
        dry_run_storage_migration(root, &request.from, &request.to, request.target.as_deref())?;
    if !request.dry_run {
        report
            .validation_errors
            .push("dry_run_required".to_string());
    }
    if request.resume {
        report
            .validation_errors
            .push("resume_not_supported_for_dry_run".to_string());
    }
    Ok(report)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LegacyMemoryFrontmatter {
    memory_id: Option<String>,
    title: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    importance: Option<f64>,
    confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LegacyThreadFrontmatter {
    thread_id: Option<String>,
    source: Option<String>,
    title: Option<String>,
    content_hash: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    message_count: Option<usize>,
    distilled: Option<bool>,
    promoted_to_wiki: Option<bool>,
}

fn import_memory_file(
    path: &Path,
    workspace_id: &str,
    project_key: &str,
    storage: &mut dyn MemoryStorage,
) -> Result<bool, WorkspaceError> {
    let markdown = read_markdown_file(path)?;
    let (frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<LegacyMemoryFrontmatter>(&markdown)?;
    if frontmatter
        .status
        .as_deref()
        .is_some_and(|status| status != "active")
    {
        return Ok(false);
    }
    let memory_id = required_frontmatter(frontmatter.memory_id, "memory_id")?;
    let title = required_frontmatter(frontmatter.title, "title")?;
    let created_at = frontmatter
        .created_at
        .unwrap_or(file_modified_rfc3339(path)?);

    storage.insert_memory(&StoredMemoryWrite {
        memory_id,
        workspace_id: workspace_id.to_string(),
        project_key: project_key.to_string(),
        title,
        body: frontmatter_body(body),
        tags: frontmatter.tags,
        importance: frontmatter.importance,
        confidence: frontmatter.confidence,
        created_at,
    })
}

fn import_thread_file(
    path: &Path,
    workspace_id: &str,
    storage: &mut dyn MemoryStorage,
) -> Result<bool, WorkspaceError> {
    let markdown = read_markdown_file(path)?;
    let (frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<LegacyThreadFrontmatter>(&markdown)?;
    let thread_id = required_frontmatter(frontmatter.thread_id, "thread_id")?;
    let agent_source = frontmatter
        .source
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            thread_id
                .split_once(':')
                .map(|(source, _)| source.to_string())
        })
        .or_else(|| fallback_thread_source_from_path(path))
        .unwrap_or_else(|| "unknown".to_string());
    let title = frontmatter
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| thread_id.clone());
    let content_hash = required_frontmatter(frontmatter.content_hash, "content_hash")?;
    let created_at = frontmatter
        .started_at
        .clone()
        .unwrap_or(file_modified_rfc3339(path)?);
    let updated_at = frontmatter
        .ended_at
        .clone()
        .or(frontmatter.started_at)
        .unwrap_or_else(|| created_at.clone());

    storage.upsert_thread(&StoredThreadWrite {
        thread_id,
        workspace_id: workspace_id.to_string(),
        agent_source,
        session_pk: None,
        title,
        body: frontmatter_body(body),
        content_hash,
        message_count: frontmatter
            .message_count
            .map(|count| i64::try_from(count).unwrap_or(i64::MAX)),
        distilled: frontmatter.distilled,
        promoted_to_wiki: frontmatter.promoted_to_wiki,
        created_at,
        updated_at,
    })
}

fn validate_storage_migration_target(
    to: &str,
    target: Option<&str>,
    validation_errors: &mut Vec<String>,
) {
    match to {
        "postgresql" => match target.map(str::trim) {
            Some("") => validation_errors.push("target_empty".to_string()),
            Some(value)
                if value.starts_with("postgresql://") || value.starts_with("postgres://") => {}
            Some(_) => validation_errors.push("target_invalid".to_string()),
            None => validation_errors.push("target_required".to_string()),
        },
        "sqlite" => {}
        _ => validation_errors.push(format!("unsupported_target:{to}")),
    }
}

fn markdown_paths(root: &Path, dir: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    let mut paths = Vec::new();
    collect_markdown_paths(root, dir, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_markdown_paths(
    root: &Path,
    dir: &Path,
    paths: &mut Vec<PathBuf>,
) -> Result<(), WorkspaceError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "scan_failed",
                "failed to scan markdown memory directory",
                &error,
            ));
        }
    };
    for entry in entries {
        let path = entry
            .map_err(|error| {
                WorkspaceError::from_io(
                    "scan_failed",
                    "failed to read markdown memory directory entry",
                    &error,
                )
            })?
            .path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::from_io(
                "scan_failed",
                "failed to inspect markdown memory path",
                &error,
            )
        })?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_markdown_paths(root, &path, paths)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            path.strip_prefix(root).map_err(|_| {
                WorkspaceError::new(
                    "outside_workspace",
                    "markdown memory path is outside workspace",
                )
            })?;
            paths.push(path);
        }
    }
    Ok(())
}

fn read_markdown_file(path: &Path) -> Result<String, WorkspaceError> {
    std::fs::read_to_string(path).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read markdown memory file", &error)
    })
}

fn file_modified_rfc3339(path: &Path) -> Result<String, WorkspaceError> {
    let modified = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| {
            WorkspaceError::from_io(
                "metadata_failed",
                "failed to read markdown memory file timestamp",
                &error,
            )
        })?;
    let duration = modified.duration_since(UNIX_EPOCH).map_err(|error| {
        WorkspaceError::new(
            "metadata_failed",
            format!("markdown memory file timestamp is before unix epoch: {error}"),
        )
    })?;
    time::OffsetDateTime::from_unix_timestamp(duration.as_secs() as i64)
        .map_err(|error| {
            WorkspaceError::new(
                "time_format_failed",
                format!("failed to convert markdown memory file timestamp: {error}"),
            )
        })?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| {
            WorkspaceError::new(
                "time_format_failed",
                format!("failed to format markdown memory file timestamp: {error}"),
            )
        })
}

fn required_frontmatter(value: Option<String>, field: &str) -> Result<String, WorkspaceError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            WorkspaceError::new(
                "invalid_frontmatter",
                format!("markdown memory frontmatter missing {field}"),
            )
        })
}

fn relative_path(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside workspace"))
}

fn fallback_thread_source_from_path(path: &Path) -> Option<String> {
    let parent = path.parent()?.file_name()?.to_str()?;
    (!parent.trim().is_empty() && parent != "threads").then(|| parent.to_string())
}

fn frontmatter_body(body: String) -> String {
    body.strip_prefix('\n').unwrap_or(&body).to_string()
}
