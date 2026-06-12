use crate::memory_models::{
    MemoryListFilter, MemoryRecord, MemorySummary, RecallMemoryItem, RecallRequest, RecallResult,
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

    let working = if request.include_working {
        Some(crate::memory_working::memory_working_get(root)?)
    } else {
        None
    };

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
        let score = score_memory(&record, &request.query, time::OffsetDateTime::now_utc())?;
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
    items.truncate(request.limit.unwrap_or(10));

    let byte_budget = request.byte_budget.unwrap_or(65_536);
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
    if byte_count > byte_budget {
        byte_count = byte_budget;
    }

    Ok(RecallResult {
        working,
        memories: selected,
        threads: Vec::new(),
        truncated,
        byte_count,
    })
}

fn score_memory(record: &MemoryRecord, query: &str, now: time::OffsetDateTime) -> Option<f64> {
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
    let recency_decay = 0.5_f64.powf(age_days / 30.0);
    Some(text_score * (0.5 + importance) * recency_decay)
}

fn snippet_for_body(body: &str, max_chars: usize) -> String {
    let mut snippet = body.chars().take(max_chars).collect::<String>();
    if body.chars().count() > max_chars {
        snippet.push_str("...");
    }
    snippet
}
