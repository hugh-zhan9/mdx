use crate::memory_models::{MemoryPromoteRequest, MemoryPromoteResult, MemoryThreadFrontmatter};
use crate::models::WorkspaceError;

pub fn memory_promote(
    root: impl AsRef<std::path::Path>,
    request: MemoryPromoteRequest,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::ensure_memory_ready(root)?;
    let thread = crate::memory_thread::memory_thread_get(root, request.target.clone())?;

    if request.ingest {
        let status = crate::llm_wiki_fs::detect_llm_wiki_workspace(root)?;
        if !status.has_llm_wiki {
            return Err(WorkspaceError::new(
                "llm_wiki_not_ready",
                "current workspace is not an LLM Wiki workspace",
            ));
        }
    }

    let date = crate::memory_fs::date_prefix(thread.frontmatter.started_at.as_deref())?;
    let title = request
        .title
        .as_deref()
        .unwrap_or(&thread.frontmatter.title)
        .trim();
    let slug = crate::memory_fs::slugify_segment(title);

    let promoted_markdown = format!(
        "---\nkind: promoted_thread\nsource_thread: {}\nthread_id: {}\npromoted_at: {}\ntitle: {}\n---\n\n{}",
        thread.path,
        thread.frontmatter.thread_id,
        crate::memory_fs::now_utc_rfc3339()?,
        title,
        thread.body
    );
    let promoted_path =
        crate::memory_fs::write_new_markdown_file(root, "raw/promoted", &date, &slug, |_| {
            Ok(promoted_markdown.clone().into_bytes())
        })?;

    if request.ingest {
        crate::llm_wiki::llm_wiki_ingest_raw_file_sync(
            root.to_string_lossy().into_owned(),
            promoted_path.clone(),
        )?;
    }

    mark_thread_promoted(root, &thread.path)?;

    crate::memory_fs::append_memory_log_entry(
        root,
        &format!(
            "memory_promote thread_id={} promoted_path={} ingest={}",
            thread.frontmatter.thread_id, promoted_path, request.ingest
        ),
    )?;

    Ok(MemoryPromoteResult {
        thread_path: thread.path,
        promoted_path,
        ingested: request.ingest,
    })
}

fn mark_thread_promoted(root: &std::path::Path, thread_path: &str) -> Result<(), WorkspaceError> {
    let markdown = crate::memory_fs::read_workspace_file(root, thread_path)?;
    let (mut frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
    frontmatter.promoted_to_wiki = true;
    let markdown = crate::memory_fs::render_markdown_with_frontmatter(&frontmatter, &body)?;
    crate::memory_fs::write_workspace_file(root, thread_path, markdown.as_bytes())
}
