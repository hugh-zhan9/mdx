use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmWikiCache, LlmWikiKnowledgeConfig, LlmWikiWorkspaceStatus,
    RawScanFile,
};
use crate::models::WorkspaceError;
use crate::path_guard::is_allowed_markdown_file;
use sha2::{Digest, Sha256};

const REQUIRED_DIRS: &[&str] = &["raw", "wiki"];

const REQUIRED_FILES: &[&str] = &[
    "index.md",
    "log.md",
    "purpose.md",
    "AGENTS.md",
    "llm-wiki-progress.md",
];

const INITIAL_DIRS: &[&str] = &[
    "raw",
    "raw/notes",
    "raw/articles",
    "raw/assets",
    "wiki",
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
    let has_llm_wiki = missing_paths.is_empty();

    Ok(LlmWikiWorkspaceStatus {
        mode: if has_llm_wiki {
            "llmWiki".to_string()
        } else {
            "ordinary".to_string()
        },
        has_llm_wiki,
        can_initialize: !has_llm_wiki && !has_type_conflict,
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
            version: 1,
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

pub fn read_knowledge_config(
    root: impl AsRef<Path>,
) -> Result<LlmWikiKnowledgeConfig, WorkspaceError> {
    let path = root.as_ref().join(".llm-wiki/config.json");
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LlmWikiKnowledgeConfig {
                paused: false,
                skip_paths: Vec::new(),
            });
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "read_failed",
                "failed to read llm wiki config",
                &error,
            ));
        }
    };

    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "config_parse_failed",
            format!("failed to parse llm wiki config: {error}"),
        )
    })
}

pub fn scan_raw_files(
    root: impl AsRef<Path>,
    config: &LlmWikiKnowledgeConfig,
) -> Result<Vec<RawScanFile>, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let raw_dir = managed_directory(root, "raw")?;
    let mut files = Vec::new();
    scan_raw_dir(root, &raw_dir, config, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

pub fn update_progress_markdown(
    root: impl AsRef<Path>,
    status: &str,
    pending: &[String],
    completed: &[String],
    failed: &[(String, String)],
    skipped: &[String],
) -> Result<(), WorkspaceError> {
    let mut markdown = String::from("# LLM Wiki Progress\n\n");
    markdown.push_str("## Status\n\n");
    markdown.push_str(status);
    markdown.push_str("\n\n");
    append_path_section(&mut markdown, "Pending", pending);
    append_path_section(&mut markdown, "Processing", &[]);
    append_path_section(&mut markdown, "Completed", completed);
    append_failed_section(&mut markdown, failed);
    append_path_section(&mut markdown, "Skipped", skipped);

    fs::write(root.as_ref().join("llm-wiki-progress.md"), markdown).map_err(|error| {
        WorkspaceError::from_io(
            "write_failed",
            "failed to write llm wiki progress markdown",
            &error,
        )
    })
}

pub fn build_knowledge_graph_markdown(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let wiki_dir = managed_directory(root, "wiki")?;
    let mut edges = Vec::new();
    scan_wiki_graph_dir(root, &wiki_dir, &mut edges)?;
    edges.sort();
    edges.dedup();

    let mut markdown = String::from("# Knowledge Graph\n\n```mermaid\ngraph TD\n");
    for (source, target) in edges {
        markdown.push_str("  ");
        markdown.push_str(&source);
        markdown.push_str(" --> ");
        markdown.push_str(&target);
        markdown.push('\n');
    }
    markdown.push_str("```\n");
    Ok(markdown)
}

pub fn write_knowledge_graph_markdown(
    root: impl AsRef<Path>,
    markdown: &str,
) -> Result<(), WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;
    let wiki_dir = managed_directory(root, "wiki")?;
    fs::write(wiki_dir.join("knowledge-graph.md"), markdown).map_err(|error| {
        WorkspaceError::from_io(
            "write_failed",
            "failed to write llm wiki knowledge graph",
            &error,
        )
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

fn managed_directory(
    root: &Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, WorkspaceError> {
    match required_path_state(root, relative_path, RequiredPathKind::Directory)? {
        RequiredPathState::Valid => Ok(root.join(relative_path)),
        RequiredPathState::Missing => Err(WorkspaceError::new(
            "not_found",
            format!("llm wiki managed directory is missing: {relative_path}"),
        )),
        RequiredPathState::TypeConflict => Err(path_type_conflict(
            "directory",
            "not a directory",
            relative_path,
        )),
    }
}

fn scan_raw_dir(
    root: &Path,
    dir: &Path,
    config: &LlmWikiKnowledgeConfig,
    files: &mut Vec<RawScanFile>,
) -> Result<(), WorkspaceError> {
    for entry in fs::read_dir(dir).map_err(|error| {
        WorkspaceError::from_io(
            "scan_failed",
            "failed to scan llm wiki raw directory",
            &error,
        )
    })? {
        let entry = entry.map_err(|error| {
            WorkspaceError::from_io("scan_failed", "failed to read llm wiki raw entry", &error)
        })?;
        let path = entry.path();
        let relative_path = relative_path(root, &path)?;
        if should_skip_path(&relative_path, &config.skip_paths) {
            continue;
        }

        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::from_io("path_failed", "failed to inspect llm wiki raw path", &error)
        })?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_raw_dir(root, &path, config, files)?;
        } else if file_type.is_file() && is_allowed_markdown_file(&path) {
            let contents = fs::read(&path).map_err(|error| {
                WorkspaceError::from_io("read_failed", "failed to read llm wiki raw file", &error)
            })?;
            files.push(RawScanFile {
                hash: raw_file_hash(&relative_path, &contents),
                absolute_path: path.to_string_lossy().into_owned(),
                relative_path,
            });
        }
    }

    Ok(())
}

fn scan_wiki_graph_dir(
    root: &Path,
    dir: &Path,
    edges: &mut Vec<(String, String)>,
) -> Result<(), WorkspaceError> {
    for entry in fs::read_dir(dir).map_err(|error| {
        WorkspaceError::from_io(
            "scan_failed",
            "failed to scan llm wiki graph directory",
            &error,
        )
    })? {
        let entry = entry.map_err(|error| {
            WorkspaceError::from_io("scan_failed", "failed to read llm wiki graph entry", &error)
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            WorkspaceError::from_io(
                "path_failed",
                "failed to inspect llm wiki graph path",
                &error,
            )
        })?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_wiki_graph_dir(root, &path, edges)?;
        } else if file_type.is_file() && is_allowed_markdown_file(&path) {
            let source = graph_node_name(root, &path)?;
            let contents = fs::read_to_string(&path).map_err(|error| {
                WorkspaceError::from_io("read_failed", "failed to read llm wiki graph file", &error)
            })?;
            for target in extract_wikilinks(&contents) {
                if target != source {
                    edges.push((source.clone(), target));
                }
            }
        }
    }

    Ok(())
}

fn should_skip_path(relative_path: &str, skip_paths: &[String]) -> bool {
    skip_paths
        .iter()
        .map(|path| normalize_relative_path(path))
        .any(|skip_path| {
            relative_path == skip_path || relative_path.starts_with(&format!("{skip_path}/"))
        })
}

fn normalize_relative_path(path: &str) -> String {
    path.trim().trim_matches('/').replace('\\', "/")
}

fn relative_path(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    path.strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside llm wiki root"))
}

fn raw_file_hash(relative_path: &str, contents: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(relative_path.as_bytes());
    hasher.update([0]);
    hasher.update(contents);
    format!("sha256:{:x}", hasher.finalize())
}

fn append_path_section(markdown: &mut String, title: &str, paths: &[String]) {
    markdown.push_str("## ");
    markdown.push_str(title);
    markdown.push_str("\n\n");
    if paths.is_empty() {
        markdown.push_str("- None\n\n");
        return;
    }
    for path in paths {
        markdown.push_str("- ");
        markdown.push_str(path);
        markdown.push('\n');
    }
    markdown.push('\n');
}

fn append_failed_section(markdown: &mut String, failed: &[(String, String)]) {
    markdown.push_str("## Failed\n\n");
    if failed.is_empty() {
        markdown.push_str("- None\n\n");
        return;
    }
    for (path, reason) in failed {
        markdown.push_str("- ");
        markdown.push_str(path);
        markdown.push_str(": ");
        markdown.push_str(reason);
        markdown.push('\n');
    }
    markdown.push('\n');
}

fn graph_node_name(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    let relative = path.strip_prefix(root.join("wiki")).map_err(|_| {
        WorkspaceError::new("outside_workspace", "wiki path is outside llm wiki root")
    })?;
    let without_extension = relative.with_extension("");
    Ok(without_extension
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string())
}

fn extract_wikilinks(contents: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = contents;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let raw_target = &rest[..end];
        let target = raw_target
            .split('|')
            .next()
            .unwrap_or("")
            .trim()
            .trim_start_matches('#')
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        let target = target
            .rsplit('/')
            .next()
            .unwrap_or(target)
            .trim_end_matches(".markdown")
            .trim_end_matches(".md");
        if !target.is_empty() {
            links.push(target.to_string());
        }
        rest = &rest[end + 2..];
    }
    links
}

fn create_dir_if_missing(
    root: &Path,
    relative_path: &str,
    created_paths: &mut Vec<String>,
    preserved_paths: &mut Vec<String>,
) -> Result<(), WorkspaceError> {
    let path = root.join(relative_path);
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::Directory => {
            preserved_paths.push(relative_path.to_string());
            return Ok(());
        }
        ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict(
                "directory",
                "not a directory",
                relative_path,
            ));
        }
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
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::File => {
            preserved_paths.push(relative_path.to_string());
            return Ok(());
        }
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict("file", "not a file", relative_path));
        }
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

enum RequiredPathKind {
    Directory,
    File,
}

enum RequiredPathState {
    Valid,
    Missing,
    TypeConflict,
}

enum ExistingPathKind {
    Missing,
    Directory,
    File,
    Symlink,
    Other,
}

fn required_path_state(
    root: &Path,
    relative_path: &str,
    kind: RequiredPathKind,
) -> Result<RequiredPathState, WorkspaceError> {
    let path_kind = existing_path_kind(&root.join(relative_path))?;
    Ok(match (path_kind, kind) {
        (ExistingPathKind::Missing, _) => RequiredPathState::Missing,
        (ExistingPathKind::Directory, RequiredPathKind::Directory)
        | (ExistingPathKind::File, RequiredPathKind::File) => RequiredPathState::Valid,
        _ => RequiredPathState::TypeConflict,
    })
}

fn existing_path_kind(path: &Path) -> Result<ExistingPathKind, WorkspaceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ExistingPathKind::Missing);
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "path_failed",
                "failed to inspect llm wiki managed path",
                &error,
            ));
        }
    };

    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        Ok(ExistingPathKind::Symlink)
    } else if file_type.is_dir() {
        Ok(ExistingPathKind::Directory)
    } else if file_type.is_file() {
        Ok(ExistingPathKind::File)
    } else {
        Ok(ExistingPathKind::Other)
    }
}

fn path_type_conflict(expected: &str, actual: &str, relative_path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "path_type_conflict",
        format!("llm wiki {expected} path exists but is {actual}: {relative_path}"),
    )
}
