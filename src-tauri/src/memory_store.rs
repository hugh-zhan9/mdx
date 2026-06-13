use std::fs;

use crate::memory_fs::{
    append_memory_log_entry, date_prefix, ensure_memory_ready, normalize_markdown_body,
    now_utc_rfc3339, parse_markdown_frontmatter, render_markdown_with_frontmatter, slugify_segment,
    write_new_markdown_file, write_workspace_file,
};
use crate::memory_models::{
    MemoryAddRequest, MemoryFrontmatter, MemoryListFilter, MemoryRecord, MemorySummary,
};
use crate::models::WorkspaceError;

pub fn memory_add(
    root: impl AsRef<std::path::Path>,
    request: MemoryAddRequest,
) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let title = request.title.trim().to_string();
    let body = normalize_markdown_body(&request.body);
    if title.is_empty() || body.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_memory",
            "memory title and body must not be empty",
        ));
    }

    let now = now_utc_rfc3339()?;
    let slug = slugify_segment(&title);
    let date = date_prefix(Some(&now))?;
    let path = write_new_markdown_file(root, "memory/memories", &date, &slug, |path| {
        let frontmatter = MemoryFrontmatter {
            schema_version: 1,
            kind: "memory".to_string(),
            memory_id: memory_id_from_path(path),
            title: title.clone(),
            status: "active".to_string(),
            created_at: now.clone(),
            source_thread: request.source_thread.clone(),
            source_message_refs: request.source_message_refs.clone(),
            importance: Some(request.importance.unwrap_or(0.5)),
            confidence: request.confidence.or(Some(0.5)),
            tags: request.tags.clone(),
            evolves_from: None,
        };
        render_markdown_with_frontmatter(&frontmatter, &body).map(String::into_bytes)
    })?;
    let memory_id = memory_id_from_path(&path);
    let frontmatter = MemoryFrontmatter {
        schema_version: 1,
        kind: "memory".to_string(),
        memory_id: memory_id.clone(),
        title: title.clone(),
        status: "active".to_string(),
        created_at: now,
        source_thread: request.source_thread.clone(),
        source_message_refs: request.source_message_refs,
        importance: Some(request.importance.unwrap_or(0.5)),
        confidence: request.confidence.or(Some(0.5)),
        tags: request.tags.clone(),
        evolves_from: None,
    };
    let record = MemoryRecord {
        path,
        frontmatter,
        body,
    };
    sync_memory_projection(root, &record)?;
    append_memory_log_entry(
        root,
        &format!("memory_add memory_id={memory_id} path={}", record.path),
    )?;
    Ok(record)
}

fn memory_id_from_path(path: &str) -> String {
    let memory_stem = path
        .trim_start_matches("memory/memories/")
        .trim_end_matches(".md")
        .replace('-', "_");
    format!("mem_{memory_stem}")
}

pub fn memory_get(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    for relative in memory_markdown_paths(root)? {
        let markdown = crate::memory_fs::read_workspace_file(root, &relative)?;
        let (frontmatter, body) = parse_markdown_frontmatter::<MemoryFrontmatter>(&markdown)?;
        if target == relative || target == frontmatter.memory_id {
            return Ok(MemoryRecord {
                path: relative,
                frontmatter,
                body,
            });
        }
    }
    Err(WorkspaceError::new(
        "not_found",
        "memory record was not found",
    ))
}

pub fn memory_list(
    root: impl AsRef<std::path::Path>,
    filter: MemoryListFilter,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let mut items = Vec::new();
    for relative in memory_markdown_paths(root)? {
        let markdown = crate::memory_fs::read_workspace_file(root, &relative)?;
        let (frontmatter, _) = parse_markdown_frontmatter::<MemoryFrontmatter>(&markdown)?;
        if !filter.include_archived && frontmatter.status == "archived" {
            continue;
        }
        if filter
            .tag
            .as_deref()
            .is_some_and(|tag| !frontmatter.tags.iter().any(|item| item == tag))
        {
            continue;
        }
        if filter
            .since
            .as_deref()
            .is_some_and(|since| frontmatter.created_at.as_str() < since)
        {
            continue;
        }
        items.push(MemorySummary {
            path: relative,
            memory_id: frontmatter.memory_id,
            title: frontmatter.title,
            status: frontmatter.status,
            created_at: frontmatter.created_at,
            tags: frontmatter.tags,
        });
    }
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(items)
}

pub fn memory_archive(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<MemoryRecord, WorkspaceError> {
    let root = root.as_ref();
    let mut record = memory_get(root, target)?;
    record.frontmatter.status = "archived".to_string();
    let markdown = render_markdown_with_frontmatter(&record.frontmatter, &record.body)?;
    write_workspace_file(root, &record.path, markdown.as_bytes())?;
    sync_memory_projection(root, &record)?;
    append_memory_log_entry(
        root,
        &format!(
            "memory_archive memory_id={} path={}",
            record.frontmatter.memory_id, record.path
        ),
    )?;
    Ok(record)
}

fn sync_memory_projection(
    root: &std::path::Path,
    record: &MemoryRecord,
) -> Result<(), WorkspaceError> {
    match crate::search_index::sync_memory(root, record) {
        Ok(()) => Ok(()),
        Err(error) if crate::search_index::is_index_degradation_error(&error) => {
            append_memory_log_entry(
                root,
                &format!(
                    "memory_index_sync_failed memory_id={} error_code={} message={}",
                    record.frontmatter.memory_id,
                    error.error_code(),
                    error
                ),
            )?;
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn memory_markdown_paths(root: &std::path::Path) -> Result<Vec<String>, WorkspaceError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root.join("memory/memories")).map_err(|error| {
        WorkspaceError::from_io("scan_failed", "failed to scan memory directory", &error)
    })? {
        let path = entry
            .map_err(|error| {
                WorkspaceError::from_io("scan_failed", "failed to read memory entry", &error)
            })?
            .path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            WorkspaceError::new("outside_workspace", "memory path is outside workspace")
        })?;
        paths.push(relative.to_string_lossy().replace('\\', "/"));
    }
    paths.sort();
    Ok(paths)
}
