use crate::memory_models::{
    DistillCandidate, MemoryDistillRequest, MemoryDistillResult, MemoryRecord,
};
use crate::memory_provider::{MemoryProvider, MemoryProviderMessage, ReusedLlmProvider};
use crate::models::WorkspaceError;

const DISTILL_SYSTEM_PROMPT: &str = r#"You distill AI conversation transcripts into durable memory candidates.
Return only a JSON array. Do not wrap it in Markdown.
Each item must have:
- title: concise string
- body: standalone durable memory text
- tags: string array
- importance: number from 0.0 to 1.0
- confidence: number from 0.0 to 1.0
- source_message_refs: array of message numbers from the transcript
"#;

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
    let thread = crate::memory_thread::memory_thread_get(root, request.target.clone())?;
    let Some(provider) = ReusedLlmProvider::from_default_config()? else {
        return Err(WorkspaceError::new(
            "distill_unavailable",
            "memory distill requires a configured local provider",
        ));
    };

    let output = provider.complete_json(&build_distill_messages(
        &thread.frontmatter.title,
        &thread.body,
    ))?;
    memory_distill_with_json(
        root,
        request,
        &extract_json_array(&provider_value_text(output))?,
    )
}

#[cfg(test)]
pub(crate) fn parse_distill_candidates_for_test(
    json: &str,
) -> Result<Vec<DistillCandidate>, WorkspaceError> {
    parse_distill_candidates(json)
}

#[cfg(test)]
pub(crate) fn build_distill_messages_for_test(
    title: &str,
    body: &str,
) -> Vec<MemoryProviderMessage> {
    build_distill_messages(title, body)
}

#[cfg(test)]
pub(crate) fn extract_json_array_for_test(output: &str) -> Result<String, WorkspaceError> {
    extract_json_array(output)
}

#[cfg(test)]
pub(crate) fn memory_distill_with_json_for_test(
    root: impl AsRef<std::path::Path>,
    request: MemoryDistillRequest,
    json: &str,
) -> Result<MemoryDistillResult, WorkspaceError> {
    memory_distill_with_json(root, request, json)
}

fn memory_distill_with_json(
    root: impl AsRef<std::path::Path>,
    request: MemoryDistillRequest,
    json: &str,
) -> Result<MemoryDistillResult, WorkspaceError> {
    let root = root.as_ref();
    let thread = crate::memory_thread::memory_thread_get(root, request.target.clone())?;
    let candidates = parse_distill_candidates(json)?;
    let source_thread = thread.frontmatter.thread_id;
    let config = crate::memory_fs::read_memory_config(root)?;
    let base_run_id = distill_run_id(&source_thread, &thread.frontmatter.content_hash);
    if !request.force {
        if let Some(existing) = existing_distill_result(
            root,
            &request,
            &source_thread,
            &base_run_id,
            &candidates,
            &config,
        )? {
            return Ok(existing);
        }
    }

    let mut inbox = Vec::new();
    let mut memories = Vec::new();
    let distill_run_id = Some(if request.force {
        format!("{}:{}", base_run_id, crate::memory_fs::now_utc_rfc3339()?)
    } else {
        base_run_id
    });

    for candidate in &candidates {
        let source_message_refs = candidate
            .source_message_refs
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>();
        if should_accept_candidate(&request, &config, candidate) {
            memories.push(crate::memory_store::memory_add(
                root,
                crate::memory_models::MemoryAddRequest {
                    title: candidate.title.clone(),
                    body: candidate.body.clone(),
                    tags: candidate.tags.clone(),
                    source_thread: Some(source_thread.clone()),
                    source_message_refs,
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
        accepted: !memories.is_empty() && inbox.is_empty(),
        candidate_count: candidates.len(),
        inbox_count: inbox.len(),
        memory_count: memories.len(),
        candidates,
        inbox,
        memories,
    })
}

fn existing_distill_result(
    root: &std::path::Path,
    request: &MemoryDistillRequest,
    source_thread: &str,
    run_id: &str,
    candidates: &[DistillCandidate],
    config: &crate::memory_models::MemoryConfig,
) -> Result<Option<MemoryDistillResult>, WorkspaceError> {
    let should_accept_all = candidates
        .iter()
        .all(|candidate| should_accept_candidate(request, config, candidate));
    if should_accept_all {
        let memories = existing_distilled_memories(root, source_thread, candidates)?;
        if memories.len() == candidates.len() {
            return Ok(Some(MemoryDistillResult {
                target: request.target.clone(),
                source_thread: source_thread.to_string(),
                accepted: true,
                candidate_count: candidates.len(),
                inbox_count: 0,
                memory_count: memories.len(),
                candidates: candidates.to_vec(),
                inbox: Vec::new(),
                memories,
            }));
        }
        return Ok(None);
    }

    let memories = existing_distilled_memories(root, source_thread, candidates)?;
    let inbox = crate::memory_inbox::memory_inbox_list(root, true)?
        .into_iter()
        .filter(|record| record.frontmatter.distill_run_id.as_deref() == Some(run_id))
        .collect::<Vec<_>>();
    if memories.len() + inbox.len() == candidates.len() {
        return Ok(Some(MemoryDistillResult {
            target: request.target.clone(),
            source_thread: source_thread.to_string(),
            accepted: memories.len() == candidates.len(),
            candidate_count: candidates.len(),
            inbox_count: inbox.len(),
            memory_count: memories.len(),
            candidates: candidates.to_vec(),
            inbox,
            memories,
        }));
    }
    Ok(None)
}

fn existing_distilled_memories(
    root: &std::path::Path,
    source_thread: &str,
    candidates: &[DistillCandidate],
) -> Result<Vec<MemoryRecord>, WorkspaceError> {
    let mut memories = Vec::new();
    for summary in crate::memory_store::memory_list(
        root,
        crate::memory_models::MemoryListFilter {
            tag: None,
            since: None,
            include_archived: false,
        },
    )? {
        let record = crate::memory_store::memory_get(root, summary.memory_id)?;
        if record.frontmatter.source_thread.as_deref() == Some(source_thread)
            && candidates
                .iter()
                .any(|candidate| source_refs_match(&record, candidate))
        {
            memories.push(record);
        }
    }
    Ok(memories)
}

fn source_refs_match(record: &MemoryRecord, candidate: &DistillCandidate) -> bool {
    let refs = candidate
        .source_message_refs
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>();
    record.frontmatter.source_message_refs == refs
}

fn should_accept_candidate(
    request: &MemoryDistillRequest,
    config: &crate::memory_models::MemoryConfig,
    candidate: &DistillCandidate,
) -> bool {
    request.accept
        || (config.distill.auto_accept
            && candidate.confidence * 100.0 >= f64::from(config.distill.confidence_threshold))
}

fn distill_run_id(source_thread: &str, content_hash: &str) -> String {
    format!(
        "distill:{}:{}",
        source_thread.replace(':', "_"),
        content_hash
            .trim_start_matches("sha256:")
            .chars()
            .take(12)
            .collect::<String>()
    )
}

fn build_distill_messages(title: &str, body: &str) -> Vec<MemoryProviderMessage> {
    vec![
        MemoryProviderMessage {
            role: "system".to_string(),
            content: DISTILL_SYSTEM_PROMPT.to_string(),
        },
        MemoryProviderMessage {
            role: "user".to_string(),
            content: format!(
                "Thread title: {}\n\nTranscript:\n{}",
                title.trim(),
                body.trim()
            ),
        },
    ]
}

fn extract_json_array(output: &str) -> Result<String, WorkspaceError> {
    let trimmed = output.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return Ok(trimmed.to_string());
    }

    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim);
    if let Some(json) = without_fence {
        if json.starts_with('[') && json.ends_with(']') {
            return Ok(json.to_string());
        }
    }

    let Some(start) = trimmed.find('[') else {
        return Err(WorkspaceError::new(
            "distill_parse_failed",
            "distill output did not include a JSON array",
        ));
    };
    let Some(end) = trimmed.rfind(']') else {
        return Err(WorkspaceError::new(
            "distill_parse_failed",
            "distill output did not include a complete JSON array",
        ));
    };
    if start > end {
        return Err(WorkspaceError::new(
            "distill_parse_failed",
            "distill output did not include a valid JSON array",
        ));
    }
    Ok(trimmed[start..=end].to_string())
}

fn provider_value_text(output: serde_json::Value) -> String {
    match output {
        serde_json::Value::String(text) => text,
        value => value.to_string(),
    }
}
