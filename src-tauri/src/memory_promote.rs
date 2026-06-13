use serde::Serialize;

use crate::memory_models::{
    MemoryFrontmatter, MemoryPromoteRequest, MemoryPromoteResult, MemoryThreadFrontmatter,
};
use crate::models::WorkspaceError;

pub fn memory_promote(
    root: impl AsRef<std::path::Path>,
    request: MemoryPromoteRequest,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    memory_promote_with_ingest(root, request, |root_path, promoted_path| {
        crate::llm_wiki::llm_wiki_ingest_raw_file_sync(root_path, promoted_path)
    })
}

fn memory_promote_with_ingest(
    root: impl AsRef<std::path::Path>,
    request: MemoryPromoteRequest,
    ingest: impl FnOnce(String, String) -> Result<(), WorkspaceError>,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::ensure_memory_ready(root)?;
    let target = resolve_promote_target(root, request.target.clone())?;

    if request.ingest {
        let status = crate::llm_wiki_fs::detect_llm_wiki_workspace(root)?;
        if !status.has_llm_wiki {
            return Err(WorkspaceError::new(
                "llm_wiki_not_ready",
                "current workspace is not an LLM Wiki workspace",
            ));
        }
    }

    let date = crate::memory_fs::date_prefix(target.date_hint())?;
    let title = request.title.as_deref().unwrap_or(target.title()).trim();
    let slug = crate::memory_fs::slugify_segment(title);

    let promoted_markdown = target.render_promoted_markdown(title)?;
    let promoted_path =
        crate::memory_fs::write_new_markdown_file(root, "raw/promoted", &date, &slug, |_| {
            Ok(promoted_markdown.clone().into_bytes())
        })?;

    if request.ingest {
        ingest(root.to_string_lossy().into_owned(), promoted_path.clone())?;
    }

    if let PromoteTarget::Thread { path, .. } = &target {
        mark_thread_promoted(root, path)?;
    }

    crate::memory_fs::append_memory_log_entry(
        root,
        &target.log_entry(&promoted_path, request.ingest),
    )?;

    Ok(MemoryPromoteResult {
        thread_path: target.source_path().to_string(),
        promoted_path,
        ingested: request.ingest,
    })
}

#[cfg(test)]
pub(crate) fn memory_promote_with_ingest_for_test(
    root: impl AsRef<std::path::Path>,
    request: MemoryPromoteRequest,
    ingest: impl FnOnce(String, String) -> Result<(), WorkspaceError>,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    memory_promote_with_ingest(root, request, ingest)
}

fn mark_thread_promoted(root: &std::path::Path, thread_path: &str) -> Result<(), WorkspaceError> {
    let markdown = crate::memory_fs::read_workspace_file(root, thread_path)?;
    let (mut frontmatter, body) =
        crate::memory_fs::parse_markdown_frontmatter::<MemoryThreadFrontmatter>(&markdown)?;
    frontmatter.promoted_to_wiki = true;
    let markdown = crate::memory_fs::render_markdown_with_frontmatter(&frontmatter, &body)?;
    crate::memory_fs::write_workspace_file(root, thread_path, markdown.as_bytes())
}

enum PromoteTarget {
    Thread {
        path: String,
        frontmatter: MemoryThreadFrontmatter,
        body: String,
    },
    Memory {
        path: String,
        frontmatter: MemoryFrontmatter,
        body: String,
    },
}

impl PromoteTarget {
    fn title(&self) -> &str {
        match self {
            PromoteTarget::Thread { frontmatter, .. } => &frontmatter.title,
            PromoteTarget::Memory { frontmatter, .. } => &frontmatter.title,
        }
    }

    fn date_hint(&self) -> Option<&str> {
        match self {
            PromoteTarget::Thread { frontmatter, .. } => frontmatter.started_at.as_deref(),
            PromoteTarget::Memory { frontmatter, .. } => Some(frontmatter.created_at.as_str()),
        }
    }

    fn source_path(&self) -> &str {
        match self {
            PromoteTarget::Thread { path, .. } | PromoteTarget::Memory { path, .. } => path,
        }
    }

    fn render_promoted_markdown(&self, title: &str) -> Result<String, WorkspaceError> {
        let promoted_at = crate::memory_fs::now_utc_rfc3339()?;
        match self {
            PromoteTarget::Thread {
                path,
                frontmatter,
                body,
            } => crate::memory_fs::render_markdown_with_frontmatter(
                &PromotedThreadFrontmatter {
                    kind: "promoted_thread",
                    source_thread: path,
                    thread_id: &frontmatter.thread_id,
                    promoted_at,
                    title,
                },
                body,
            ),
            PromoteTarget::Memory {
                path,
                frontmatter,
                body,
            } => crate::memory_fs::render_markdown_with_frontmatter(
                &PromotedMemoryFrontmatter {
                    kind: "promoted_memory",
                    source_memory: path,
                    memory_id: &frontmatter.memory_id,
                    promoted_at,
                    title,
                },
                body,
            ),
        }
    }

    fn log_entry(&self, promoted_path: &str, ingest: bool) -> String {
        match self {
            PromoteTarget::Thread { frontmatter, .. } => format!(
                "memory_promote thread_id={} promoted_path={} ingest={}",
                frontmatter.thread_id, promoted_path, ingest
            ),
            PromoteTarget::Memory { frontmatter, .. } => format!(
                "memory_promote memory_id={} promoted_path={} ingest={}",
                frontmatter.memory_id, promoted_path, ingest
            ),
        }
    }
}

#[derive(Serialize)]
struct PromotedThreadFrontmatter<'a> {
    kind: &'a str,
    source_thread: &'a str,
    thread_id: &'a str,
    promoted_at: String,
    title: &'a str,
}

#[derive(Serialize)]
struct PromotedMemoryFrontmatter<'a> {
    kind: &'a str,
    source_memory: &'a str,
    memory_id: &'a str,
    promoted_at: String,
    title: &'a str,
}

fn resolve_promote_target(
    root: &std::path::Path,
    target: String,
) -> Result<PromoteTarget, WorkspaceError> {
    match crate::memory_thread::memory_thread_get(root, target.clone()) {
        Ok(thread) => Ok(PromoteTarget::Thread {
            path: thread.path,
            frontmatter: thread.frontmatter,
            body: thread.body,
        }),
        Err(error) if error.error_code() == "not_found" => {
            let memory = crate::memory_store::memory_get(root, target)?;
            Ok(PromoteTarget::Memory {
                path: memory.path,
                frontmatter: memory.frontmatter,
                body: memory.body,
            })
        }
        Err(error) => Err(error),
    }
}
