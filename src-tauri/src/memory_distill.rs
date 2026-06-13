use crate::memory_models::{DistillCandidate, MemoryDistillRequest, MemoryDistillResult};
use crate::models::WorkspaceError;

#[allow(dead_code)]
pub(crate) fn parse_distill_candidates(
    json: &str,
) -> Result<Vec<DistillCandidate>, WorkspaceError> {
    let candidates: Vec<DistillCandidate> = serde_json::from_str(json).map_err(|error| {
        WorkspaceError::new(
            "distill_parse_failed",
            format!("failed to parse distill JSON: {error}"),
        )
    })?;

    for candidate in &candidates {
        if candidate.title.trim().is_empty() || candidate.body.trim().is_empty() {
            return Err(WorkspaceError::new(
                "distill_parse_failed",
                "distill candidate title and body must not be empty",
            ));
        }
        if !(0.0..=1.0).contains(&candidate.importance)
            || !(0.0..=1.0).contains(&candidate.confidence)
        {
            return Err(WorkspaceError::new(
                "distill_parse_failed",
                "distill candidate scores must be between 0 and 1",
            ));
        }
    }

    Ok(candidates)
}

pub(crate) fn memory_distill(
    root: impl AsRef<std::path::Path>,
    request: MemoryDistillRequest,
) -> Result<MemoryDistillResult, WorkspaceError> {
    let root = root.as_ref();
    let _thread = crate::memory_thread::memory_thread_get(root, request.target)?;
    Err(WorkspaceError::new(
        "distill_unavailable",
        "memory distill requires a configured local provider or injected candidate JSON",
    ))
}

#[cfg(test)]
pub(crate) fn parse_distill_candidates_for_test(
    json: &str,
) -> Result<Vec<DistillCandidate>, WorkspaceError> {
    parse_distill_candidates(json)
}

#[cfg(test)]
pub(crate) fn memory_distill_with_json_for_test(
    root: impl AsRef<std::path::Path>,
    request: MemoryDistillRequest,
    json: &str,
) -> Result<MemoryDistillResult, WorkspaceError> {
    memory_distill_with_json(root, request, json)
}

#[cfg(test)]
fn memory_distill_with_json(
    root: impl AsRef<std::path::Path>,
    request: MemoryDistillRequest,
    json: &str,
) -> Result<MemoryDistillResult, WorkspaceError> {
    let root = root.as_ref();
    let thread = crate::memory_thread::memory_thread_get(root, request.target.clone())?;
    let candidates = parse_distill_candidates(json)?;
    let source_thread = thread.frontmatter.thread_id;
    let mut inbox = Vec::new();
    let mut memories = Vec::new();
    let distill_run_id = Some(format!("distill:{}", source_thread.replace(':', "_")));

    for candidate in &candidates {
        let source_message_refs = candidate
            .source_message_refs
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>();
        if request.accept {
            memories.push(crate::memory_store::memory_add(
                root,
                crate::memory_models::MemoryAddRequest {
                    title: candidate.title.clone(),
                    body: candidate.body.clone(),
                    tags: candidate.tags.clone(),
                    source_thread: Some(source_thread.clone()),
                    importance: Some(candidate.importance),
                    confidence: Some(candidate.confidence),
                },
            )?);
        } else {
            inbox.push(crate::memory_inbox::memory_inbox_add(
                root,
                crate::memory_models::InboxAddRequest {
                    title: candidate.title.clone(),
                    body: candidate.body.clone(),
                    source_thread: Some(source_thread.clone()),
                    source_message_refs,
                    importance: Some(candidate.importance),
                    confidence: Some(candidate.confidence),
                    tags: candidate.tags.clone(),
                    distill_run_id: distill_run_id.clone(),
                },
            )?);
        }
    }

    Ok(MemoryDistillResult {
        target: request.target,
        source_thread,
        accepted: request.accept,
        candidate_count: candidates.len(),
        inbox_count: inbox.len(),
        memory_count: memories.len(),
        candidates,
        inbox,
        memories,
    })
}
