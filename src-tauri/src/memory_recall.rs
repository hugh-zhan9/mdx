use crate::memory_models::{
    MemoryIndexSearchRequest, MemoryListFilter, MemoryRecord, MemorySummary, RecallMemoryItem,
    RecallRequest, RecallResult, ThreadListFilter,
};
use crate::models::WorkspaceError;

pub fn memory_search(
    root: impl AsRef<std::path::Path>,
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let result = memory_recall(
        root,
        RecallRequest {
            query,
            limit,
            byte_budget: Some(65_536),
            include_working: false,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag,
            since,
        },
    )?;

    Ok(result
        .memories
        .into_iter()
        .map(|item| MemorySummary {
            path: item.path,
            memory_id: item.memory_id,
            title: item.title,
            status: "active".to_string(),
            created_at: String::new(),
            tags: Vec::new(),
        })
        .collect())
}

pub fn memory_recall(
    root: impl AsRef<std::path::Path>,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let root = root.as_ref();
    crate::memory_fs::ensure_memory_ready(root)?;
    let config = crate::memory_fs::read_memory_config(root)?;
    let limit = request.limit.unwrap_or(config.recall.default_limit);
    let byte_budget = request
        .byte_budget
        .unwrap_or(config.recall.context_byte_budget);

    let working = if request.include_working {
        Some(crate::memory_working::memory_working_get(root)?)
    } else {
        None
    };

    let mut warnings = Vec::new();
    let mut index_degraded = false;
    let items = if crate::search_index::is_degraded(root)? {
        index_degraded = true;
        warnings.push("search index degraded; used markdown fallback".to_string());
        recall_memories_from_markdown(root, &request, limit, config.recall.half_life_days)?
    } else {
        match recall_memories_from_index(root, &request, limit) {
            Ok(items) => items,
            Err(error) if crate::search_index::is_index_degradation_error(&error) => {
                index_degraded = true;
                warnings.push("search index unavailable; used markdown fallback".to_string());
                recall_memories_from_markdown(root, &request, limit, config.recall.half_life_days)?
            }
            Err(error) => return Err(error),
        }
    };

    let threads = if request.include_threads || !request.thread_ids.is_empty() {
        recall_threads(root, &request, limit)?
    } else {
        Vec::new()
    };
    let wiki_refs = recall_wiki_refs(root, &request, limit)?;
    let (selected, selected_threads, selected_wiki_refs, truncated, byte_count) =
        apply_byte_budget(working.as_ref(), items, threads, wiki_refs, byte_budget);

    Ok(RecallResult {
        working,
        memories: selected,
        threads: selected_threads,
        wiki_refs: selected_wiki_refs,
        truncated,
        byte_count,
        index_degraded,
        warnings,
    })
}

fn recall_memories_from_index(
    root: &std::path::Path,
    request: &RecallRequest,
    limit: usize,
) -> Result<Vec<RecallMemoryItem>, WorkspaceError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let search = crate::search_index::search(
        root,
        MemoryIndexSearchRequest {
            query: request.query.clone(),
            limit: limit.saturating_mul(4).max(limit),
            kinds: vec!["memory".to_string()],
        },
    )?;

    let mut items = Vec::new();
    for hit in search.items {
        let Ok(record) = crate::memory_store::memory_get(root, hit.doc_id) else {
            continue;
        };
        if !record_matches_recall_filters(&record, request) {
            continue;
        }
        items.push(RecallMemoryItem {
            memory_id: record.frontmatter.memory_id,
            title: record.frontmatter.title,
            path: record.path,
            snippet: snippet_for_body(&record.body, 240),
            score: hit.score,
            importance: record.frontmatter.importance.unwrap_or(0.5),
        });
        if items.len() >= limit {
            break;
        }
    }
    Ok(items)
}

fn recall_memories_from_markdown(
    root: &std::path::Path,
    request: &RecallRequest,
    limit: usize,
    half_life_days: u32,
) -> Result<Vec<RecallMemoryItem>, WorkspaceError> {
    let half_life_days = half_life_days.max(1) as f64;
    let mut items = crate::memory_store::memory_list(
        root,
        MemoryListFilter {
            tag: request.tag.clone(),
            since: request.since.clone(),
            include_archived: false,
        },
    )?
    .into_iter()
    .filter_map(|summary| {
        let record = crate::memory_store::memory_get(root, summary.memory_id).ok()?;
        let score = score_memory(
            &record,
            &request.query,
            time::OffsetDateTime::now_utc(),
            half_life_days,
        )?;
        let snippet = snippet_for_body(&record.body, 240);
        Some(RecallMemoryItem {
            memory_id: record.frontmatter.memory_id,
            title: record.frontmatter.title,
            path: record.path,
            snippet,
            score,
            importance: record.frontmatter.importance.unwrap_or(0.5),
        })
    })
    .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    items.truncate(limit);
    Ok(items)
}

fn apply_byte_budget(
    working: Option<&String>,
    items: Vec<RecallMemoryItem>,
    threads: Vec<MemorySummary>,
    wiki_refs: Vec<MemorySummary>,
    byte_budget: usize,
) -> (
    Vec<RecallMemoryItem>,
    Vec<MemorySummary>,
    Vec<MemorySummary>,
    bool,
    usize,
) {
    let mut byte_count = working.as_ref().map(|value| value.len()).unwrap_or(0);
    let mut truncated = byte_count > byte_budget;
    let mut selected = Vec::new();
    for item in items {
        let item_bytes = item.snippet.len();
        if byte_count + item_bytes > byte_budget {
            truncated = true;
            break;
        }
        byte_count += item_bytes;
        selected.push(item);
    }
    let (selected_threads, threads_truncated, byte_count) =
        apply_summary_budget(threads, byte_budget, byte_count);
    truncated |= threads_truncated;
    let (selected_wiki_refs, wiki_refs_truncated, mut byte_count) =
        apply_summary_budget(wiki_refs, byte_budget, byte_count);
    truncated |= wiki_refs_truncated;
    if byte_count > byte_budget {
        byte_count = byte_budget;
    }
    (
        selected,
        selected_threads,
        selected_wiki_refs,
        truncated,
        byte_count,
    )
}

fn apply_summary_budget(
    items: Vec<MemorySummary>,
    byte_budget: usize,
    mut byte_count: usize,
) -> (Vec<MemorySummary>, bool, usize) {
    let mut selected = Vec::new();
    for item in items {
        let item_bytes = summary_budget_bytes(&item);
        if byte_count + item_bytes > byte_budget {
            return (selected, true, byte_count);
        }
        byte_count += item_bytes;
        selected.push(item);
    }
    (selected, false, byte_count)
}

fn summary_budget_bytes(item: &MemorySummary) -> usize {
    item.path.len()
        + item.memory_id.len()
        + item.title.len()
        + item.status.len()
        + item.created_at.len()
        + item.tags.iter().map(|tag| tag.len()).sum::<usize>()
}

fn recall_threads(
    root: &std::path::Path,
    request: &RecallRequest,
    limit: usize,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let query = request.query.trim().to_ascii_lowercase();
    if query.is_empty() && request.thread_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut seen = std::collections::BTreeSet::new();
    let mut items = Vec::new();
    for thread_id in &request.thread_ids {
        let record = crate::memory_thread::memory_thread_get(root, thread_id.clone())?;
        let summary = thread_record_summary(record);
        seen.insert(summary.memory_id.clone());
        items.push(summary);
    }

    if request.include_threads && !query.is_empty() {
        for thread in crate::memory_thread::memory_thread_list(
            root,
            ThreadListFilter {
                source: None,
                since: request.since.clone(),
            },
        )?
        .into_iter()
        .filter(|thread| {
            thread.title.to_ascii_lowercase().contains(&query)
                || thread.thread_id.to_ascii_lowercase().contains(&query)
                || thread.path.to_ascii_lowercase().contains(&query)
        }) {
            if !seen.insert(thread.thread_id.clone()) {
                continue;
            }
            items.push(MemorySummary {
                path: thread.path,
                memory_id: thread.thread_id,
                title: thread.title,
                status: if thread.archived {
                    "archived".to_string()
                } else {
                    "active".to_string()
                },
                created_at: thread.started_at.or(thread.ended_at).unwrap_or_default(),
                tags: Vec::new(),
            });
        }
    }
    items.truncate(limit);
    Ok(items)
}

fn recall_wiki_refs(
    root: &std::path::Path,
    request: &RecallRequest,
    limit: usize,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    if !request.include_wiki_refs || limit == 0 || request.query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut refs = crate::llm_wiki_query::search_wiki_pages(root, &request.query)?
        .into_iter()
        .take(limit)
        .map(|reference| MemorySummary {
            path: reference.path.clone(),
            memory_id: reference.path,
            title: reference.title,
            status: "active".to_string(),
            created_at: String::new(),
            tags: Vec::new(),
        })
        .collect::<Vec<_>>();
    refs.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(refs)
}

fn thread_record_summary(record: crate::memory_models::MemoryThreadRecord) -> MemorySummary {
    MemorySummary {
        path: record.path,
        memory_id: record.frontmatter.thread_id,
        title: record.frontmatter.title,
        status: if record.frontmatter.archived {
            "archived".to_string()
        } else {
            "active".to_string()
        },
        created_at: record
            .frontmatter
            .started_at
            .or(record.frontmatter.ended_at)
            .unwrap_or_default(),
        tags: record.frontmatter.tags,
    }
}

fn record_matches_recall_filters(record: &MemoryRecord, request: &RecallRequest) -> bool {
    if record.frontmatter.status == "archived" {
        return false;
    }
    if request
        .tag
        .as_deref()
        .is_some_and(|tag| !record.frontmatter.tags.iter().any(|item| item == tag))
    {
        return false;
    }
    if request
        .since
        .as_deref()
        .is_some_and(|since| record.frontmatter.created_at.as_str() < since)
    {
        return false;
    }
    true
}

fn score_memory(
    record: &MemoryRecord,
    query: &str,
    now: time::OffsetDateTime,
    half_life_days: f64,
) -> Option<f64> {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return None;
    }

    let mut text_score = 0.0;
    if record
        .frontmatter
        .title
        .to_ascii_lowercase()
        .contains(&query)
    {
        text_score += 3.0;
    }
    if record
        .frontmatter
        .tags
        .iter()
        .any(|tag| tag.to_ascii_lowercase().contains(&query))
    {
        text_score += 2.0;
    }
    if record.body.to_ascii_lowercase().contains(&query) {
        text_score += 1.0;
    }
    if text_score == 0.0 {
        return None;
    }

    let importance = record.frontmatter.importance.unwrap_or(0.5).clamp(0.0, 1.0);
    let created_at = time::OffsetDateTime::parse(
        &record.frontmatter.created_at,
        &time::format_description::well_known::Rfc3339,
    )
    .ok()?;
    let age_days = ((now - created_at).whole_seconds().max(0) as f64) / 86_400.0;
    let recency_decay = 0.5_f64.powf(age_days / half_life_days);
    Some(text_score * (0.5 + importance) * recency_decay)
}

fn snippet_for_body(body: &str, max_chars: usize) -> String {
    let mut snippet = body.chars().take(max_chars).collect::<String>();
    if body.chars().count() > max_chars {
        snippet.push_str("...");
    }
    snippet
}
