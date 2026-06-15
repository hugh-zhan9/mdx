use std::collections::BTreeSet;

use crate::memory_models::{MemorySummary, RecallMemoryItem, RecallRequest, RecallResult};
use crate::memory_storage::MemoryStorage;
use crate::WorkspaceError;

pub fn recall_from_storage(
    storage: &mut dyn MemoryStorage,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let limit = request.limit.unwrap_or(10);
    let byte_budget = request.byte_budget.unwrap_or(65_536);
    let memories = storage.search_memories(
        &request.query,
        limit,
        request.tag.as_deref(),
        request.since.as_deref(),
    )?;
    let threads = recall_thread_summaries(storage, &request, limit)?;
    let (memories, threads, truncated, byte_count) =
        apply_byte_budget(memories, threads, byte_budget);

    Ok(RecallResult {
        working: None,
        memories,
        threads,
        wiki_refs: Vec::new(),
        truncated,
        byte_count,
        index_degraded: false,
        warnings: Vec::new(),
    })
}

fn recall_thread_summaries(
    storage: &mut dyn MemoryStorage,
    request: &RecallRequest,
    limit: usize,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    if limit == 0 || (!request.include_threads && request.thread_ids.is_empty()) {
        return Ok(Vec::new());
    }

    let mut seen = BTreeSet::new();
    let mut threads = Vec::new();
    for thread_id in &request.thread_ids {
        for summary in
            storage.search_thread_summaries(thread_id, limit.saturating_sub(threads.len()), None)?
        {
            if summary.memory_id != *thread_id {
                continue;
            }
            if seen.insert(summary.memory_id.clone()) {
                threads.push(summary);
            }
            if threads.len() >= limit {
                return Ok(threads);
            }
        }
    }

    if request.include_threads && !request.query.trim().is_empty() && threads.len() < limit {
        for summary in storage.search_thread_summaries(
            &request.query,
            limit - threads.len(),
            request.since.as_deref(),
        )? {
            if seen.insert(summary.memory_id.clone()) {
                threads.push(summary);
            }
            if threads.len() >= limit {
                break;
            }
        }
    }

    Ok(threads)
}

fn apply_byte_budget(
    memories: Vec<RecallMemoryItem>,
    threads: Vec<MemorySummary>,
    byte_budget: usize,
) -> (Vec<RecallMemoryItem>, Vec<MemorySummary>, bool, usize) {
    let mut byte_count = 0;
    let mut truncated = false;
    let mut selected_memories = Vec::new();
    for memory in memories {
        let item_bytes = memory.snippet.len();
        if byte_count + item_bytes > byte_budget {
            truncated = true;
            break;
        }
        byte_count += item_bytes;
        selected_memories.push(memory);
    }

    let mut selected_threads = Vec::new();
    for thread in threads {
        let item_bytes = summary_budget_bytes(&thread);
        if byte_count + item_bytes > byte_budget {
            truncated = true;
            break;
        }
        byte_count += item_bytes;
        selected_threads.push(thread);
    }

    (selected_memories, selected_threads, truncated, byte_count)
}

fn summary_budget_bytes(item: &MemorySummary) -> usize {
    item.path.len()
        + item.memory_id.len()
        + item.title.len()
        + item.status.len()
        + item.created_at.len()
        + item.tags.iter().map(|tag| tag.len()).sum::<usize>()
}
