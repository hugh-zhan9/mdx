use std::collections::BTreeMap;

use crate::memory_fs::{
    append_memory_log_entry as append_memory_log_entry_impl, create_dir_if_missing,
    create_file_if_missing, create_json_file_if_missing, ensure_directory, read_workspace_file,
    required_path_state, write_workspace_file, RequiredPathKind, RequiredPathState,
};
pub use crate::memory_models::{
    InitializeMemoryResult, MemoryCaptureConfig, MemoryConfig, MemoryDistillConfig,
    MemoryRecallConfig, MemoryWorkspaceStatus, ThreadIndex, ThreadIndexEntry,
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
    initialize_memory_workspace(root)
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

    let status = detect_memory_workspace(root)?;

    Ok(InitializeMemoryResult {
        created_paths,
        preserved_paths,
        status,
    })
}

pub(crate) fn default_memory_config() -> MemoryConfig {
    MemoryConfig {
        version: 1,
        recall: MemoryRecallConfig {
            default_limit: 10,
            context_byte_budget: 65_536,
        },
        distill: MemoryDistillConfig {
            enabled: false,
            min_messages: 4,
            skip_patterns: vec!["^Running terminal command".to_string()],
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
