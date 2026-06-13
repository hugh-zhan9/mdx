use std::fs;

use crate::memory_fs::{
    append_memory_log_entry, date_prefix, ensure_memory_ready, normalize_markdown_body,
    now_utc_rfc3339, parse_markdown_frontmatter, render_markdown_with_frontmatter, slugify_segment,
    write_new_markdown_file, write_workspace_file,
};
use crate::memory_models::{
    InboxAddRequest, InboxFrontmatter, InboxRecord, InboxReviewRequest, InboxReviewResult,
    MemoryAddRequest,
};
use crate::models::WorkspaceError;

pub fn memory_inbox_add(
    root: impl AsRef<std::path::Path>,
    request: InboxAddRequest,
) -> Result<InboxRecord, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let title = request.title.trim().to_string();
    let body = normalize_markdown_body(&request.body);
    if title.is_empty() || body.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_inbox_candidate",
            "inbox title and body must not be empty",
        ));
    }

    let now = now_utc_rfc3339()?;
    let slug = slugify_segment(&title);
    let date = date_prefix(Some(&now))?;
    let path = write_new_markdown_file(root, "memory/inbox", &date, &slug, |path| {
        let frontmatter = InboxFrontmatter {
            schema_version: 1,
            kind: "memory_inbox".to_string(),
            inbox_id: inbox_id_from_path(path),
            title: title.clone(),
            status: "pending".to_string(),
            created_at: now.clone(),
            source_thread: request.source_thread.clone(),
            source_message_refs: request.source_message_refs.clone(),
            importance: Some(request.importance.unwrap_or(0.5)),
            confidence: request.confidence.or(Some(0.5)),
            tags: request.tags.clone(),
            distill_run_id: request.distill_run_id.clone(),
            accepted_memory_id: None,
        };
        render_markdown_with_frontmatter(&frontmatter, &body).map(String::into_bytes)
    })?;
    let inbox_id = inbox_id_from_path(&path);
    let frontmatter = InboxFrontmatter {
        schema_version: 1,
        kind: "memory_inbox".to_string(),
        inbox_id: inbox_id.clone(),
        title,
        status: "pending".to_string(),
        created_at: now,
        source_thread: request.source_thread,
        source_message_refs: request.source_message_refs,
        importance: Some(request.importance.unwrap_or(0.5)),
        confidence: request.confidence.or(Some(0.5)),
        tags: request.tags,
        distill_run_id: request.distill_run_id,
        accepted_memory_id: None,
    };
    append_memory_log_entry(
        root,
        &format!("memory_inbox_add inbox_id={inbox_id} path={path}"),
    )?;

    Ok(InboxRecord {
        path,
        frontmatter,
        body,
    })
}

pub fn memory_inbox_get(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<InboxRecord, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    for relative in inbox_markdown_paths(root)? {
        let markdown = crate::memory_fs::read_workspace_file(root, &relative)?;
        let (frontmatter, body) = parse_markdown_frontmatter::<InboxFrontmatter>(&markdown)?;
        if target == relative || target == frontmatter.inbox_id {
            return Ok(InboxRecord {
                path: relative,
                frontmatter,
                body,
            });
        }
    }

    Err(WorkspaceError::new(
        "not_found",
        "memory inbox record was not found",
    ))
}

pub fn memory_inbox_list(
    root: impl AsRef<std::path::Path>,
    include_reviewed: bool,
) -> Result<Vec<InboxRecord>, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let mut records = Vec::new();
    for relative in inbox_markdown_paths(root)? {
        let markdown = crate::memory_fs::read_workspace_file(root, &relative)?;
        let (frontmatter, body) = parse_markdown_frontmatter::<InboxFrontmatter>(&markdown)?;
        if !include_reviewed && frontmatter.status != "pending" {
            continue;
        }
        records.push(InboxRecord {
            path: relative,
            frontmatter,
            body,
        });
    }
    records.sort_by(|left, right| {
        right
            .frontmatter
            .created_at
            .cmp(&left.frontmatter.created_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(records)
}

pub fn memory_inbox_accept(
    root: impl AsRef<std::path::Path>,
    request: InboxReviewRequest,
) -> Result<InboxReviewResult, WorkspaceError> {
    let root = root.as_ref();
    let mut candidate = memory_inbox_get(root, request.inbox_id)?;
    if candidate.frontmatter.status == "accepted" {
        if let Some(memory_id) = candidate.frontmatter.accepted_memory_id.clone() {
            let memory = crate::memory_store::memory_get(root, memory_id.clone()).ok();
            return Ok(InboxReviewResult {
                inbox_id: candidate.frontmatter.inbox_id,
                path: candidate.path,
                status: "accepted".to_string(),
                accepted_memory_id: Some(memory_id),
                memory,
            });
        }
    }
    ensure_pending(&candidate)?;

    let title = request
        .title
        .as_deref()
        .unwrap_or(&candidate.frontmatter.title)
        .trim()
        .to_string();
    let body = request
        .body
        .map(|body| normalize_markdown_body(&body))
        .unwrap_or_else(|| normalize_markdown_body(&candidate.body));
    let tags = request
        .tags
        .unwrap_or_else(|| candidate.frontmatter.tags.clone());

    let memory = crate::memory_store::memory_add(
        root,
        MemoryAddRequest {
            title: title.clone(),
            body: body.clone(),
            tags: tags.clone(),
            source_thread: candidate.frontmatter.source_thread.clone(),
            source_message_refs: candidate.frontmatter.source_message_refs.clone(),
            importance: candidate.frontmatter.importance,
            confidence: candidate.frontmatter.confidence,
        },
    )?;

    candidate.frontmatter.title = title;
    candidate.body = body;
    candidate.frontmatter.tags = tags;
    candidate.frontmatter.status = "accepted".to_string();
    candidate.frontmatter.accepted_memory_id = Some(memory.frontmatter.memory_id.clone());
    write_inbox_record(root, &candidate)?;
    append_memory_log_entry(
        root,
        &format!(
            "memory_inbox_accept inbox_id={} memory_id={}",
            candidate.frontmatter.inbox_id, memory.frontmatter.memory_id
        ),
    )?;

    Ok(InboxReviewResult {
        inbox_id: candidate.frontmatter.inbox_id,
        path: candidate.path,
        status: "accepted".to_string(),
        accepted_memory_id: Some(memory.frontmatter.memory_id.clone()),
        memory: Some(memory),
    })
}

pub fn memory_inbox_reject(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<InboxReviewResult, WorkspaceError> {
    let root = root.as_ref();
    let mut candidate = memory_inbox_get(root, target)?;
    ensure_pending(&candidate)?;

    candidate.frontmatter.status = "rejected".to_string();
    candidate.frontmatter.accepted_memory_id = None;
    write_inbox_record(root, &candidate)?;
    append_memory_log_entry(
        root,
        &format!(
            "memory_inbox_reject inbox_id={}",
            candidate.frontmatter.inbox_id
        ),
    )?;

    Ok(InboxReviewResult {
        inbox_id: candidate.frontmatter.inbox_id,
        path: candidate.path,
        status: "rejected".to_string(),
        accepted_memory_id: None,
        memory: None,
    })
}

fn ensure_pending(candidate: &InboxRecord) -> Result<(), WorkspaceError> {
    if candidate.frontmatter.status == "pending" {
        return Ok(());
    }

    Err(WorkspaceError::new(
        "invalid_inbox_status",
        "only pending inbox candidates can be reviewed",
    ))
}

fn write_inbox_record(root: &std::path::Path, record: &InboxRecord) -> Result<(), WorkspaceError> {
    let markdown = render_markdown_with_frontmatter(&record.frontmatter, &record.body)?;
    write_workspace_file(root, &record.path, markdown.as_bytes())
}

fn inbox_id_from_path(path: &str) -> String {
    let inbox_stem = path
        .trim_start_matches("memory/inbox/")
        .trim_end_matches(".md")
        .replace('-', "_");
    format!("inbox_{inbox_stem}")
}

fn inbox_markdown_paths(root: &std::path::Path) -> Result<Vec<String>, WorkspaceError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root.join("memory/inbox")).map_err(|error| {
        WorkspaceError::from_io(
            "scan_failed",
            "failed to scan memory inbox directory",
            &error,
        )
    })? {
        let path = entry
            .map_err(|error| {
                WorkspaceError::from_io("scan_failed", "failed to read memory inbox entry", &error)
            })?
            .path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            WorkspaceError::new(
                "outside_workspace",
                "memory inbox path is outside workspace",
            )
        })?;
        paths.push(relative.to_string_lossy().replace('\\', "/"));
    }
    paths.sort();
    Ok(paths)
}
