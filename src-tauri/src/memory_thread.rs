use crate::memory_fs::{
    date_prefix, ensure_memory_ready, normalize_markdown_body, parse_markdown_frontmatter,
    read_thread_index, render_markdown_with_frontmatter, sha256_prefixed, slugify_segment,
    thread_index_entry, validate_thread_source, write_thread_index, write_workspace_file,
};
use crate::memory_models::{
    MemoryThreadFrontmatter, MemoryThreadRecord, ThreadListFilter, ThreadListItem,
    ThreadSaveRequest, ThreadSaveResult,
};
use crate::models::WorkspaceError;

pub fn memory_thread_save(
    root: impl AsRef<std::path::Path>,
    request: ThreadSaveRequest,
) -> Result<ThreadSaveResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;
    validate_thread_source(&request.source)?;

    let body = normalize_markdown_body(&request.body);
    if body.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_thread_body",
            "thread body must not be empty",
        ));
    }

    let thread_id = request
        .thread_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            let hash = sha256_prefixed(body.as_bytes());
            let digest = hash.trim_start_matches("sha256:");
            format!("manual:{}", &digest[..12])
        });
    let content_hash = sha256_prefixed(body.as_bytes());

    let mut index = read_thread_index(root)?;
    if let Some(existing) = index.threads.get(&thread_id) {
        if existing.content_hash == content_hash {
            return Ok(ThreadSaveResult {
                action: "skipped".to_string(),
                path: existing.path.clone(),
                thread_id,
                content_hash,
            });
        }
    }

    let path = index
        .threads
        .get(&thread_id)
        .map(|entry| entry.path.clone())
        .unwrap_or_else(|| {
            let slug = slugify_segment(&thread_id);
            let date = date_prefix(request.started_at.as_deref()).unwrap();
            format!("memory/threads/{}/{date}-{slug}.md", request.source)
        });

    let frontmatter = MemoryThreadFrontmatter {
        schema_version: 1,
        kind: "thread".to_string(),
        thread_id: thread_id.clone(),
        source: request.source.clone(),
        title: request.title.trim().to_string(),
        content_hash: content_hash.clone(),
        started_at: request.started_at.clone(),
        ended_at: request.ended_at.clone(),
        message_count: Some(body.matches("## Message ").count()),
        model: request.model.clone(),
        workspace_root: request.workspace_root.clone(),
        tags: request.tags.clone(),
        distilled: false,
        promoted_to_wiki: false,
        archived: false,
    };

    let markdown = render_markdown_with_frontmatter(&frontmatter, &body)?;
    write_workspace_file(root, &path, markdown.as_bytes())?;

    let action = if index.threads.contains_key(&thread_id) {
        "updated"
    } else {
        "created"
    };
    index.threads.insert(
        thread_id.clone(),
        thread_index_entry(path.clone(), content_hash.clone())?,
    );
    write_thread_index(root, &index)?;
    crate::memory_fs::append_memory_log_entry(
        root,
        &format!("thread_save thread_id={thread_id} result={action} path={path}"),
    )?;

    Ok(ThreadSaveResult {
        action: action.to_string(),
        path,
        thread_id,
        content_hash,
    })
}

pub fn memory_thread_get(
    root: impl AsRef<std::path::Path>,
    target: String,
) -> Result<MemoryThreadRecord, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let index = read_thread_index(root)?;
    let path = if let Some(entry) = index.threads.get(&target) {
        entry.path.clone()
    } else {
        target
    };
    let markdown = crate::memory_fs::read_workspace_file(root, &path)?;
    let (frontmatter, body) = parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
    Ok(MemoryThreadRecord {
        path,
        frontmatter,
        body,
    })
}

pub fn memory_thread_list(
    root: impl AsRef<std::path::Path>,
    filter: ThreadListFilter,
) -> Result<Vec<ThreadListItem>, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let index = read_thread_index(root)?;
    let mut items = Vec::new();
    for entry in index.threads.values() {
        let markdown = crate::memory_fs::read_workspace_file(root, &entry.path)?;
        let (frontmatter, _) = parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
        if filter
            .source
            .as_deref()
            .is_some_and(|source| frontmatter.source != source)
        {
            continue;
        }
        if filter.since.as_deref().is_some_and(|since| {
            frontmatter
                .started_at
                .as_deref()
                .or(frontmatter.ended_at.as_deref())
                .map(|timestamp| timestamp < since)
                .unwrap_or(true)
        }) {
            continue;
        }
        items.push(ThreadListItem {
            path: entry.path.clone(),
            thread_id: frontmatter.thread_id,
            source: frontmatter.source,
            title: frontmatter.title,
            started_at: frontmatter.started_at,
            ended_at: frontmatter.ended_at,
            message_count: frontmatter.message_count,
            archived: frontmatter.archived,
        });
    }
    items.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(items)
}
