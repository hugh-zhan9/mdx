use std::collections::BTreeMap;

use crate::memory_fs::{
    append_memory_log_entry as append_memory_log_entry_impl, create_dir_if_missing,
    create_file_if_missing, create_json_file_if_missing, ensure_directory, read_workspace_file,
    required_path_state, try_acquire_memory_lock, write_workspace_file, RequiredPathKind,
    RequiredPathState,
};
pub use crate::memory_models::{
    DistillCandidate, InboxAddRequest, InboxFrontmatter, InboxRecord, InboxReviewRequest,
    InboxReviewResult, InitializeMemoryResult, MemoryAddRequest, MemoryCaptureConfig,
    MemoryCaptureImportRequest, MemoryCaptureImportResult, MemoryCaptureScanRequest,
    MemoryCaptureScanResult, MemoryConfig, MemoryDistillConfig, MemoryDistillRequest,
    MemoryDistillResult, MemoryEmbeddingConfig, MemoryExportRequest, MemoryExportResult,
    MemoryFrontmatter, MemoryImportRequest, MemoryImportResult, MemoryIndexSearchItem,
    MemoryIndexSearchRequest, MemoryIndexSearchResult, MemoryIndexStatus, MemoryListFilter,
    MemoryPromoteRequest, MemoryPromoteResult, MemoryRecallConfig, MemoryRecord,
    MemoryRepairRequest, MemoryRepairResult, MemorySummary, MemoryThreadFrontmatter,
    MemoryThreadRecord, MemoryWorkspaceStatus, RecallMemoryItem, RecallRequest, RecallResult,
    ThreadIndex, ThreadIndexEntry, ThreadListFilter, ThreadListItem, ThreadSaveRequest,
    ThreadSaveResult,
};
use crate::models::WorkspaceError;
use crate::path_guard::canonicalize_workspace_root;

const REQUIRED_DIRS: &[&str] = &[
    "memory",
    "memory/threads",
    "memory/memories",
    "memory/inbox",
    ".mdx",
];

const REQUIRED_FILES: &[&str] = &[
    "memory/working.md",
    "memory/MEMORY.md",
    ".mdx/memory-config.json",
    ".mdx/thread-index.json",
    "log.md",
];

const INITIAL_DIRS: &[&str] = &[
    "memory",
    "memory/threads",
    "memory/threads/codex",
    "memory/memories",
    "memory/inbox",
    ".mdx",
];

const WORKING_MEMORY_MARKDOWN: &str =
    "# Working Memory\n\n## Updated\n\n## Focus\n\n## Open Questions\n\n## Recent Decisions\n";

const MEMORY_RULES_MARKDOWN: &str = r#"# Memory Rules

## Snapshots

- Memory snapshots are full snapshots of useful context, not incremental patches.
- Each snapshot should stand alone with enough context to be recalled later.
- Preserve uncertainty, source boundaries, and decisions that changed direction.

## Source Threads

- When a source thread is available, include the source thread path or identifier.
- Do not invent provenance when a source thread is unavailable.

## Recall Defaults

- Prefer the configured default recall limit.
- Keep recalled context within the configured byte budget.
- Use `memory/working.md` for current focus before broader recall.

## Wiki Promotion

- Promote memory into wiki pages only when the user explicitly asks.
- Memory initialization must not create `raw/` or `wiki/`.
"#;

pub fn memory_detect_workspace(root_path: String) -> Result<MemoryWorkspaceStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    detect_memory_workspace(root)
}

pub fn memory_initialize_workspace(
    root_path: String,
) -> Result<InitializeMemoryResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    initialize_memory_workspace(root)
}

pub fn memory_repair_workspace(
    root_path: String,
    request: MemoryRepairRequest,
) -> Result<MemoryRepairResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    repair_memory_workspace(root, request)
}

pub fn memory_export_bundle(
    root_path: String,
    request: MemoryExportRequest,
) -> Result<MemoryExportResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_bundle::memory_export_bundle(root, request)
}

pub fn memory_import_bundle(
    root_path: String,
    request: MemoryImportRequest,
) -> Result<MemoryImportResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_bundle::memory_import_bundle(root, request)
}

pub(crate) fn detect_memory_workspace(
    root: impl AsRef<std::path::Path>,
) -> Result<MemoryWorkspaceStatus, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let mut missing_paths = Vec::new();
    let mut has_type_conflict = false;
    for path in REQUIRED_DIRS {
        match required_path_state(root, path, RequiredPathKind::Directory)? {
            RequiredPathState::Valid => {}
            RequiredPathState::Missing => missing_paths.push((*path).to_string()),
            RequiredPathState::TypeConflict => {
                missing_paths.push((*path).to_string());
                has_type_conflict = true;
            }
        }
    }
    for path in REQUIRED_FILES {
        match required_path_state(root, path, RequiredPathKind::File)? {
            RequiredPathState::Valid => {}
            RequiredPathState::Missing => missing_paths.push((*path).to_string()),
            RequiredPathState::TypeConflict => {
                missing_paths.push((*path).to_string());
                has_type_conflict = true;
            }
        }
    }
    let has_memory = missing_paths.is_empty();

    Ok(MemoryWorkspaceStatus {
        mode: if has_memory {
            "memory".to_string()
        } else {
            "ordinary".to_string()
        },
        has_memory,
        can_initialize: !has_memory && !has_type_conflict,
        missing_paths,
    })
}

pub(crate) fn initialize_memory_workspace(
    root: impl AsRef<std::path::Path>,
) -> Result<InitializeMemoryResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let mut created_paths = Vec::new();
    let mut preserved_paths = Vec::new();

    for path in INITIAL_DIRS {
        create_dir_if_missing(root, path, &mut created_paths, &mut preserved_paths)?;
    }

    create_file_if_missing(
        root,
        "memory/working.md",
        WORKING_MEMORY_MARKDOWN,
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "memory/MEMORY.md",
        MEMORY_RULES_MARKDOWN,
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".mdx/memory-config.json",
        &default_memory_config(),
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".mdx/thread-index.json",
        &default_thread_index(),
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "log.md",
        "# Log\n",
        &mut created_paths,
        &mut preserved_paths,
    )?;
    let init_result = if created_paths.is_empty() {
        "noop"
    } else {
        "initialized"
    };
    append_memory_log_entry_impl(root, &format!("memory_init result={init_result}"))?;

    let status = detect_memory_workspace(root)?;

    Ok(InitializeMemoryResult {
        created_paths,
        preserved_paths,
        status,
    })
}

pub(crate) fn repair_memory_workspace(
    root: impl AsRef<std::path::Path>,
    request: MemoryRepairRequest,
) -> Result<MemoryRepairResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let mut repaired_paths = Vec::new();
    let mut preserved_paths = Vec::new();
    let mut warnings = Vec::new();

    create_json_file_if_missing(
        root,
        ".mdx/thread-index.json",
        &default_thread_index(),
        &mut repaired_paths,
        &mut preserved_paths,
    )?;

    if request.rebuild_index {
        warnings.push("search index rebuild is handled by the search index task".to_string());
    }

    append_memory_log_entry_impl(root, "memory_repair")?;

    Ok(MemoryRepairResult {
        repaired_paths,
        warnings,
    })
}

pub(crate) fn default_memory_config() -> MemoryConfig {
    MemoryConfig {
        version: 1,
        recall: MemoryRecallConfig {
            default_limit: 10,
            context_byte_budget: 65_536,
            half_life_days: 30,
            embeddings: MemoryEmbeddingConfig { enabled: false },
        },
        distill: MemoryDistillConfig {
            enabled: false,
            min_messages: 4,
            skip_patterns: vec!["^Running terminal command".to_string()],
            auto_accept: false,
            confidence_threshold: 85,
        },
        capture: MemoryCaptureConfig {
            enabled: false,
            sources: Vec::new(),
        },
    }
}

pub(crate) fn default_thread_index() -> ThreadIndex {
    ThreadIndex {
        version: 1,
        threads: BTreeMap::new(),
    }
}

#[allow(dead_code)]
pub(crate) fn read_memory_workspace_file(
    root: impl AsRef<std::path::Path>,
    relative_path: &str,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;
    read_workspace_file(root, relative_path)
}

#[allow(dead_code)]
pub(crate) fn write_memory_workspace_file(
    root: impl AsRef<std::path::Path>,
    relative_path: &str,
    contents: &str,
) -> Result<(), WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;
    write_workspace_file(root, relative_path, contents.as_bytes())
}

#[allow(dead_code)]
pub(crate) fn append_memory_log_entry(
    root: impl AsRef<std::path::Path>,
    entry: &str,
) -> Result<(), WorkspaceError> {
    append_memory_log_entry_impl(root, entry)
}

pub fn memory_thread_save(
    root_path: String,
    request: ThreadSaveRequest,
) -> Result<ThreadSaveResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_thread::memory_thread_save(root, request)
}

pub fn memory_thread_get(
    root_path: String,
    target: String,
) -> Result<MemoryThreadRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_thread::memory_thread_get(root, target)
}

pub fn memory_thread_list(
    root_path: String,
    filter: ThreadListFilter,
) -> Result<Vec<ThreadListItem>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_thread::memory_thread_list(root, filter)
}

pub fn memory_add(
    root_path: String,
    request: MemoryAddRequest,
) -> Result<MemoryRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_store::memory_add(root, request)
}

pub fn memory_get(root_path: String, target: String) -> Result<MemoryRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_store::memory_get(root, target)
}

pub fn memory_list(
    root_path: String,
    filter: MemoryListFilter,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_store::memory_list(root, filter)
}

pub fn memory_archive(root_path: String, target: String) -> Result<MemoryRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_store::memory_archive(root, target)
}

pub fn memory_inbox_add(
    root_path: String,
    request: InboxAddRequest,
) -> Result<InboxRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_inbox::memory_inbox_add(root, request)
}

pub fn memory_inbox_get(root_path: String, target: String) -> Result<InboxRecord, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_inbox::memory_inbox_get(root, target)
}

pub fn memory_inbox_list(
    root_path: String,
    include_reviewed: bool,
) -> Result<Vec<InboxRecord>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_inbox::memory_inbox_list(root, include_reviewed)
}

pub fn memory_inbox_accept(
    root_path: String,
    request: InboxReviewRequest,
) -> Result<InboxReviewResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_inbox::memory_inbox_accept(root, request)
}

pub fn memory_inbox_reject(
    root_path: String,
    target: String,
) -> Result<InboxReviewResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_inbox::memory_inbox_reject(root, target)
}

pub fn memory_working_get(root_path: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_working::memory_working_get(root)
}

pub fn memory_working_set(root_path: String, markdown: String) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_working::memory_working_set(root, markdown)
}

pub fn memory_working_append(
    root_path: String,
    section: String,
    text: String,
) -> Result<String, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_working::memory_working_append(root, section, text)
}

pub fn memory_search(
    root_path: String,
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
) -> Result<Vec<MemorySummary>, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_recall::memory_search(root, query, limit, tag, since)
}

pub fn memory_index_rebuild(root_path: String) -> Result<MemoryIndexStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::search_index::rebuild(&root)
}

pub fn memory_index_status(root_path: String) -> Result<MemoryIndexStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::search_index::status(&root)
}

pub fn memory_index_search(
    root_path: String,
    request: MemoryIndexSearchRequest,
) -> Result<MemoryIndexSearchResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::search_index::search(&root, request)
}

pub fn memory_recall(
    root_path: String,
    request: RecallRequest,
) -> Result<RecallResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_recall::memory_recall(root, request)
}

pub fn memory_promote(
    root_path: String,
    request: MemoryPromoteRequest,
) -> Result<MemoryPromoteResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_promote::memory_promote(root, request)
}

pub fn memory_distill(
    root_path: String,
    request: MemoryDistillRequest,
) -> Result<MemoryDistillResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_distill::memory_distill(root, request)
}

pub fn memory_capture_import(
    root_path: String,
    request: MemoryCaptureImportRequest,
) -> Result<MemoryCaptureImportResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_capture::memory_capture_import(root, request)
}

pub fn memory_capture_scan(
    root_path: String,
    request: MemoryCaptureScanRequest,
) -> Result<MemoryCaptureScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    crate::memory_capture::memory_capture_scan(root, request)
}

#[cfg(test)]
pub(crate) fn memory_distill_with_json_for_test(
    root_path: String,
    request: MemoryDistillRequest,
    json: &str,
) -> Result<MemoryDistillResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    crate::memory_distill::memory_distill_with_json_for_test(root, request, json)
}
