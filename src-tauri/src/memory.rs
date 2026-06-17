use std::collections::BTreeMap;

use crate::memory_fs::{
    append_memory_log_entry as append_memory_log_entry_impl, create_dir_if_missing,
    create_file_if_missing, create_json_file_if_missing, ensure_directory, read_workspace_file,
    required_path_state, try_acquire_memory_lock, write_workspace_file, RequiredPathKind,
    RequiredPathState,
};
pub use crate::memory_models::{
    DistillCandidate, InboxAddRequest, InboxFrontmatter, InboxRecord, InboxReviewRequest,
    InboxReviewResult, InitializeMemoryResult, MemoryAddRequest, MemoryBackendDaemonStatus,
    MemoryBackendProjectionStatus, MemoryBackendQueueStatus, MemoryBackendStatus,
    MemoryBackendStorageStatus, MemoryBackendTodayStatus, MemoryCaptureCandidate,
    MemoryCaptureConfig, MemoryCaptureImportRequest, MemoryCaptureImportResult,
    MemoryCaptureScanRequest, MemoryCaptureScanResult, MemoryConfig, MemoryConfigSetRequest,
    MemoryConfigUpdateRequest,
    MemoryDiagnostics, MemoryDistillConfig, MemoryDistillRequest, MemoryDistillResult,
    MemoryDoctorReport, MemoryEmbeddingConfig, MemoryExportRequest, MemoryExportResult,
    MemoryFrontmatter, MemoryHookEventRequest, MemoryHookEventResponse, MemoryImportRequest,
    MemoryImportResult, MemoryIndexSearchItem, MemoryIndexSearchRequest, MemoryIndexSearchResult,
    MemoryIndexStatus, MemoryIntegrationStatus, MemoryListFilter, MemoryMarkdownImportReport,
    MemoryProjectionDiagnostics, MemoryPromoteRequest, MemoryPromoteResult, MemoryRecallConfig,
    MemoryRecord, MemoryRepairRequest, MemoryRepairResult, MemorySpoolDiagnostics,
    MemoryStorageMigrateRequest, MemoryStorageMigrationReport, MemorySummary,
    MemoryThreadFrontmatter, MemoryThreadRecord, MemoryWorkspaceStatus, RecallMemoryItem,
    RecallRequest, RecallResult, ThreadIndex, ThreadIndexEntry, ThreadListFilter, ThreadListItem,
    ThreadSaveRequest, ThreadSaveResult,
};
pub use crate::memory_projection::ProjectionReport;
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

pub fn load_memory_config_for_root(
    root: impl AsRef<std::path::Path>,
) -> Result<MemoryConfig, WorkspaceError> {
    crate::memory_fs::read_memory_config(root.as_ref())
}

pub fn memory_config_set(
    root_path: String,
    request: MemoryConfigSetRequest,
) -> Result<MemoryConfig, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    memory_config_set_for_root(&root, request)
}

pub fn memory_config_update(
    root_path: String,
    request: MemoryConfigUpdateRequest,
) -> Result<MemoryConfig, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
    memory_config_update_for_root(&root, request)
}

fn memory_config_set_for_root(
    root: &std::path::Path,
    request: MemoryConfigSetRequest,
) -> Result<MemoryConfig, WorkspaceError> {
    if request.scope != "workspace" {
        return Err(WorkspaceError::new(
            "memory_config_scope_unknown",
            format!("unsupported memory config scope: {}", request.scope),
        ));
    }

    let mut config = load_memory_config_for_root(root)?;
    match request.key.as_str() {
        "memory.enabled" => config.memory.enabled = request.enabled,
        "agent_backend.capture_enabled" => {
            config.agent_backend.capture_enabled = request.enabled;
        }
        "agent_backend.recall_injection_enabled" => {
            config.agent_backend.recall_injection_enabled = request.enabled;
        }
        "agent_backend.distill_enabled" => {
            config.agent_backend.distill_enabled = request.enabled;
        }
        "agent_backend.auto_accept" => config.agent_backend.auto_accept = request.enabled,
        "projection.enabled" => config.projection.enabled = request.enabled,
        "agents.codex.enabled" => config.agents.codex.enabled = request.enabled,
        "agents.claude.enabled" => config.agents.claude.enabled = request.enabled,
        "agents.cursor.enabled" => config.agents.cursor.enabled = request.enabled,
        key => {
            return Err(WorkspaceError::new(
                "memory_config_key_unknown",
                format!("unsupported memory config key: {key}"),
            ));
        }
    }

    write_memory_config(root, &config)?;
    Ok(config)
}

fn memory_config_update_for_root(
    root: &std::path::Path,
    request: MemoryConfigUpdateRequest,
) -> Result<MemoryConfig, WorkspaceError> {
    if request.scope != "workspace" {
        return Err(WorkspaceError::new(
            "memory_config_scope_unknown",
            format!("unsupported memory config scope: {}", request.scope),
        ));
    }

    let mut config = load_memory_config_for_root(root)?;

    if let Some(provider) = request.provider {
        if let Some(mode) = provider.mode {
            config.provider.mode = normalize_memory_provider_mode(&mode)?;
        }
        if let Some(provider_name) = provider.provider {
            config.provider.provider =
                provider_name.and_then(|value| normalize_optional_text(&value));
        }
        if let Some(model) = provider.model {
            config.provider.model = model.and_then(|value| normalize_optional_text(&value));
        }
    }

    if let Some(storage) = request.storage {
        if let Some(backend) = storage.backend {
            config.storage.backend = normalize_storage_backend_config(&backend)?;
        }
        if let Some(postgres_url_ref) = storage.postgres_url_ref {
            config.storage.postgres_url_ref =
                postgres_url_ref.and_then(|value| normalize_optional_text(&value));
        }
    }

    write_memory_config(root, &config)?;
    Ok(config)
}

fn normalize_memory_provider_mode(mode: &str) -> Result<String, WorkspaceError> {
    match mode.trim() {
        "reuse_llm" | "provider" => Ok(mode.trim().to_string()),
        other => Err(WorkspaceError::new(
            "memory_config_provider_mode_unknown",
            format!("unsupported memory provider mode: {other}"),
        )),
    }
}

fn normalize_storage_backend_config(backend: &str) -> Result<String, WorkspaceError> {
    match backend.trim() {
        "sqlite" => Ok("sqlite".to_string()),
        "postgres" | "postgresql" => Ok("postgresql".to_string()),
        other => Err(WorkspaceError::new(
            "memory_config_storage_backend_unknown",
            format!("unsupported memory storage backend: {other}"),
        )),
    }
}

fn normalize_optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn write_memory_config(
    root: &std::path::Path,
    config: &MemoryConfig,
) -> Result<(), WorkspaceError> {
    let contents = serde_json::to_vec_pretty(config).map_err(|error| {
        WorkspaceError::new(
            "json_encode_failed",
            format!("failed to encode memory config: {error}"),
        )
    })?;
    write_workspace_file(root, ".mdx/memory-config.json", &contents)
}

pub fn memory_backend_status(root_path: String) -> Result<MemoryBackendStatus, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let workspace = detect_memory_workspace(&root)?;
    let config = if workspace.has_memory {
        crate::memory_fs::read_memory_config(&root)?
    } else {
        default_memory_config()
    };

    let index_status = if workspace.has_memory {
        Some(crate::search_index::status(&root)?)
    } else {
        None
    };
    let pending_candidates = if workspace.has_memory {
        crate::memory_inbox::memory_inbox_list(&root, false)
            .map(|records| records.len())
            .unwrap_or(0)
    } else {
        0
    };
    let storage_status = if workspace.has_memory {
        "ready"
    } else {
        "stopped"
    };
    let projection_dirty = index_status
        .as_ref()
        .map(|status| status.dirty)
        .unwrap_or(false);
    let projection_status = if !config.projection.enabled {
        "disabled"
    } else if projection_dirty {
        "dirty"
    } else if workspace.has_memory {
        "ready"
    } else {
        "stopped"
    };
    let daemon_status = if !workspace.has_memory {
        "stopped"
    } else if !config.memory.enabled || !config.agent_backend.enabled {
        "disabled"
    } else if projection_dirty {
        "degraded"
    } else {
        "running"
    };

    Ok(MemoryBackendStatus {
        ok: workspace.has_memory
            && config.memory.enabled
            && config.agent_backend.enabled
            && !projection_dirty,
        daemon: MemoryBackendDaemonStatus {
            status: daemon_status.to_string(),
            last_error: None,
        },
        storage: MemoryBackendStorageStatus {
            backend: normalize_storage_backend_label(&config.storage.backend),
            status: storage_status.to_string(),
        },
        queue: MemoryBackendQueueStatus {
            depth: 0,
            oldest_job_age_seconds: None,
        },
        projection: MemoryBackendProjectionStatus {
            status: projection_status.to_string(),
            dirty_count: if projection_dirty { 1 } else { 0 },
        },
        today: MemoryBackendTodayStatus {
            captured_events: 0,
            pending_candidates,
        },
    })
}

pub fn memory_diagnostics(root_path: String) -> Result<MemoryDiagnostics, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let workspace = detect_memory_workspace(&root)?;
    let config = if workspace.has_memory {
        crate::memory_fs::read_memory_config(&root)?
    } else {
        default_memory_config()
    };

    let index_status = if workspace.has_memory {
        Some(crate::search_index::status(&root)?)
    } else {
        None
    };
    let projection_dirty = index_status
        .as_ref()
        .map(|status| status.dirty)
        .unwrap_or(false);
    let projection_status = if !config.projection.enabled {
        "disabled"
    } else if projection_dirty {
        "dirty"
    } else if workspace.has_memory {
        "ready"
    } else {
        "stopped"
    };

    Ok(MemoryDiagnostics {
        queue: crate::memory_queue::empty_queue_diagnostics(),
        spool: MemorySpoolDiagnostics {
            pending: crate::memory_spool::count_spool_files(&root)?,
            quarantined: crate::memory_spool::count_quarantine_files(&root)?,
        },
        projection: MemoryProjectionDiagnostics {
            status: projection_status.to_string(),
            dirty_count: if projection_dirty { 1 } else { 0 },
        },
        recent_errors: Vec::new(),
    })
}

fn normalize_storage_backend_label(backend: &str) -> String {
    match backend {
        "postgres" | "postgresql" => "postgresql".to_string(),
        "sqlite" => "sqlite".to_string(),
        other => other.to_string(),
    }
}

pub fn memory_export_bundle(
    root_path: String,
    request: MemoryExportRequest,
) -> Result<MemoryExportResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let _lock = try_acquire_memory_lock(&root)?;
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
    let warnings = Vec::new();

    for path in REQUIRED_DIRS {
        create_dir_if_missing(root, path, &mut repaired_paths, &mut preserved_paths)?;
    }
    create_file_if_missing(
        root,
        "memory/working.md",
        WORKING_MEMORY_MARKDOWN,
        &mut repaired_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "memory/MEMORY.md",
        MEMORY_RULES_MARKDOWN,
        &mut repaired_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".mdx/memory-config.json",
        &default_memory_config(),
        &mut repaired_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".mdx/thread-index.json",
        &default_thread_index(),
        &mut repaired_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "log.md",
        "# Log\n",
        &mut repaired_paths,
        &mut preserved_paths,
    )?;

    crate::memory_thread::rebuild_thread_index(root)?;

    if request.rebuild_index {
        crate::search_index::rebuild(root)?;
    }

    append_memory_log_entry_impl(root, "memory_repair")?;

    Ok(MemoryRepairResult {
        repaired_paths,
        warnings,
    })
}

pub(crate) fn default_memory_config() -> MemoryConfig {
    MemoryConfig {
        version: 2,
        memory: Default::default(),
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
        storage: Default::default(),
        projection: Default::default(),
        agent_backend: Default::default(),
        agents: Default::default(),
        provider: Default::default(),
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
