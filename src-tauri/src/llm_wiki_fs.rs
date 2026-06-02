use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmWikiCache, LlmWikiKnowledgeConfig, LlmWikiWorkspaceStatus,
};
use crate::models::WorkspaceError;

const REQUIRED_PATHS: &[&str] = &[
    "raw",
    "wiki",
    "index.md",
    "log.md",
    "purpose.md",
    "AGENTS.md",
    "llm-wiki-progress.md",
];

const INITIAL_DIRS: &[&str] = &[
    "raw/notes",
    "raw/articles",
    "raw/assets",
    "wiki/sources",
    "wiki/entities",
    "wiki/concepts",
    "wiki/syntheses",
    ".llm-wiki",
];

pub fn detect_llm_wiki_workspace(
    root: impl AsRef<Path>,
) -> Result<LlmWikiWorkspaceStatus, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let missing_paths = REQUIRED_PATHS
        .iter()
        .filter(|path| !root.join(path).exists())
        .map(|path| (*path).to_string())
        .collect::<Vec<_>>();
    let has_llm_wiki = missing_paths.is_empty();

    Ok(LlmWikiWorkspaceStatus {
        mode: if has_llm_wiki {
            "llmWiki".to_string()
        } else {
            "ordinary".to_string()
        },
        has_llm_wiki,
        can_initialize: !has_llm_wiki,
        missing_paths,
    })
}

pub fn initialize_llm_wiki_workspace(
    root: impl AsRef<Path>,
) -> Result<InitializeLlmWikiResult, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let mut created_paths = Vec::new();
    let mut preserved_paths = Vec::new();

    for path in INITIAL_DIRS {
        create_dir_if_missing(root, path, &mut created_paths, &mut preserved_paths)?;
    }

    create_file_if_missing(
        root,
        "index.md",
        "# Index\n",
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
    create_file_if_missing(
        root,
        "purpose.md",
        "# Purpose\n",
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "AGENTS.md",
        "# LLM Wiki Rules\n",
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_file_if_missing(
        root,
        "llm-wiki-progress.md",
        "# LLM Wiki Progress\n",
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".llm-wiki/cache.json",
        &LlmWikiCache {
            version: "1".to_string(),
            entries: BTreeMap::new(),
        },
        &mut created_paths,
        &mut preserved_paths,
    )?;
    create_json_file_if_missing(
        root,
        ".llm-wiki/config.json",
        &LlmWikiKnowledgeConfig {
            paused: false,
            skip_paths: Vec::new(),
        },
        &mut created_paths,
        &mut preserved_paths,
    )?;
    let status = detect_llm_wiki_workspace(root)?;

    Ok(InitializeLlmWikiResult {
        created_paths,
        preserved_paths,
        status,
    })
}

fn ensure_directory(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "root_not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect llm wiki workspace root", &error)
    })?;

    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_directory",
            "llm wiki workspace root is not a directory",
        ));
    }

    Ok(())
}

fn create_dir_if_missing(
    root: &Path,
    relative_path: &str,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    let path = root.join(relative_path);
    if path.exists() {
        preserved_paths.push(relative_path.to_string());
        return Ok(());
    }

    fs::create_dir_all(&path).map_err(|error| {
        WorkspaceError::from_io(
            "create_failed",
            "failed to create llm wiki directory",
            &error,
        )
    })?;
    created_paths.push(relative_path.to_string());
    Ok(())
}

fn create_file_if_missing(
    root: &Path,
    relative_path: &str,
    contents: &str,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    let path = root.join(relative_path);
    if path.exists() {
        preserved_paths.push(relative_path.to_string());
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "create_failed",
                "failed to create llm wiki file parent directory",
                &error,
            )
        })?;
    }

    fs::write(&path, contents).map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to write llm wiki file", &error)
    })?;
    created_paths.push(relative_path.to_string());
    Ok(())
}

fn create_json_file_if_missing<T: serde::Serialize>(
    root: &Path,
    relative_path: &str,
    value: &T,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    let contents = serde_json::to_string_pretty(value)
        .map(|json| format!("{json}\n"))
        .map_err(|error| {
            WorkspaceError::new(
                "serialize_failed",
                format!("failed to serialize llm wiki json file: {error}"),
            )
        })?;

    create_file_if_missing(
        root,
        relative_path,
        &contents,
        created_paths,
        preserved_paths,
    )
}
