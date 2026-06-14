use crate::memory_fs::{
    date_prefix, ensure_memory_ready, normalize_markdown_body, parse_markdown_frontmatter,
    read_thread_index, render_markdown_with_frontmatter, sha256_prefixed, slugify_segment,
    thread_index_entry, validate_thread_source, write_thread_index, write_workspace_file,
};
use crate::memory_models::{
    MemoryThreadFrontmatter, MemoryThreadRecord, ThreadIndexEntry, ThreadListFilter,
    ThreadListItem, ThreadSaveRequest, ThreadSaveResult,
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
        message_count: Some(count_thread_messages(&body)),
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
        thread_index_entry(path.clone(), content_hash.clone(), &frontmatter)?,
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

fn count_thread_messages(body: &str) -> usize {
    let mut message_count = 0;
    let mut open_fence: Option<(char, usize)> = None;
    for line in body.lines() {
        if let Some((fence_char, fence_len)) = open_fence {
            if markdown_fence(line, fence_char).is_some_and(|len| len >= fence_len) {
                open_fence = None;
            }
            continue;
        }
        if line.starts_with("## Message ") {
            message_count += 1;
            continue;
        }
        if let Some(fence) = markdown_fence(line, '`').map(|len| ('`', len)) {
            open_fence = Some(fence);
        } else if let Some(fence) = markdown_fence(line, '~').map(|len| ('~', len)) {
            open_fence = Some(fence);
        }
    }
    message_count
}

fn markdown_fence(line: &str, fence_char: char) -> Option<usize> {
    let trimmed = line.trim_start();
    let count = trimmed
        .chars()
        .take_while(|character| *character == fence_char)
        .count();
    (count >= 3).then_some(count)
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
    for (thread_id, entry) in &index.threads {
        let item = thread_list_item_from_index(thread_id, entry);
        if filter
            .source
            .as_deref()
            .is_some_and(|source| item.source != source)
        {
            continue;
        }
        if filter.since.as_deref().is_some_and(|since| {
            item.started_at
                .as_deref()
                .or(item.ended_at.as_deref())
                .map(|timestamp| timestamp < since)
                .unwrap_or(true)
        }) {
            continue;
        }
        items.push(item);
    }
    items.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(items)
}

fn thread_list_item_from_index(thread_id: &str, entry: &ThreadIndexEntry) -> ThreadListItem {
    let resolved_thread_id = entry
        .thread_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(thread_id)
        .to_string();
    let source = entry
        .source
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback_thread_source(&resolved_thread_id, &entry.path));
    let title = entry
        .title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback_thread_title(&resolved_thread_id, &entry.path));

    ThreadListItem {
        path: entry.path.clone(),
        thread_id: resolved_thread_id,
        source,
        title,
        started_at: entry
            .started_at
            .clone()
            .or_else(|| fallback_thread_date(&entry.path)),
        ended_at: entry.ended_at.clone(),
        message_count: entry.message_count,
        archived: entry.archived.unwrap_or(false),
    }
}

fn fallback_thread_source(thread_id: &str, path: &str) -> String {
    thread_id
        .split_once(':')
        .map(|(source, _)| source.to_string())
        .or_else(|| {
            path.strip_prefix("memory/threads/")
                .and_then(|relative| relative.split('/').next())
                .filter(|source| !source.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default()
}

fn fallback_thread_title(thread_id: &str, path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(|name| {
            name.trim_start_matches(|character: char| {
                character.is_ascii_digit() || character == '-'
            })
        })
        .filter(|title| !title.is_empty())
        .map(|title| title.replace('-', " "))
        .unwrap_or_else(|| thread_id.to_string())
}

fn fallback_thread_date(path: &str) -> Option<String> {
    let file_name = std::path::Path::new(path).file_name()?.to_str()?;
    let date = file_name.get(0..10)?;
    (date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit()))
    .then(|| date.to_string())
}

pub(crate) fn rebuild_thread_index(
    root: impl AsRef<std::path::Path>,
) -> Result<usize, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;

    let mut index = crate::memory::default_thread_index();
    for relative in thread_markdown_paths(root)? {
        let markdown = crate::memory_fs::read_workspace_file(root, &relative)?;
        let (frontmatter, _) = parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
        validate_thread_source(&frontmatter.source)?;
        index.threads.insert(
            frontmatter.thread_id.clone(),
            thread_index_entry(relative, frontmatter.content_hash.clone(), &frontmatter)?,
        );
    }
    let count = index.threads.len();
    write_thread_index(root, &index)?;
    Ok(count)
}

fn thread_markdown_paths(root: &std::path::Path) -> Result<Vec<String>, WorkspaceError> {
    let mut paths = Vec::new();
    collect_thread_markdown_paths(root, &root.join("memory/threads"), &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_thread_markdown_paths(
    root: &std::path::Path,
    dir: &std::path::Path,
    paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    for entry in std::fs::read_dir(dir).map_err(|error| {
        WorkspaceError::from_io(
            "scan_failed",
            "failed to scan memory thread directory",
            &error,
        )
    })? {
        let path = entry
            .map_err(|error| {
                WorkspaceError::from_io("scan_failed", "failed to read memory thread entry", &error)
            })?
            .path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::from_io(
                "scan_failed",
                "failed to inspect memory thread path",
                &error,
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceError::new(
                "path_type_conflict",
                "memory thread path must not be a symlink",
            ));
        }
        if metadata.is_dir() {
            collect_thread_markdown_paths(root, &path, paths)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            WorkspaceError::new("outside_workspace", "thread path is outside workspace")
        })?;
        paths.push(relative.to_string_lossy().replace('\\', "/"));
    }
    Ok(())
}
