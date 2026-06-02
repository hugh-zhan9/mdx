use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmWikiCache, LlmWikiKnowledgeConfig, LlmWikiWorkspaceStatus,
    RawScanFile,
};
use crate::models::WorkspaceError;
use crate::path_guard::is_allowed_markdown_file;
use sha2::{Digest, Sha256};

const REQUIRED_DIRS: &[&str] = &["raw", "wiki", ".llm-wiki"];

const REQUIRED_FILES: &[&str] = &[
    "index.md",
    "log.md",
    "purpose.md",
    "AGENTS.md",
    "llm-wiki-progress.md",
    ".llm-wiki/cache.json",
    ".llm-wiki/config.json",
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

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    let root = root.as_ref();
    ensure_directory(root)?;
    let llm_wiki_dir = managed_directory(root, ".llm-wiki")?;
    let path = llm_wiki_dir.join("config.json");
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {
            return Ok(LlmWikiKnowledgeConfig {
                paused: false,
                skip_paths: Vec::new(),
            });
        }
        ExistingPathKind::File => {}
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict(
                "file",
                "not a file",
                ".llm-wiki/config.json",
            ));
        }
    }

    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
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

    write_managed_file(root.as_ref(), "llm-wiki-progress.md", markdown.as_bytes())
}

pub fn build_knowledge_graph_markdown(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_directory(root)?;

    let wiki_dir = managed_directory(root, "wiki")?;
    let mut pages = BTreeMap::new();
    scan_wiki_graph_dir(root, &wiki_dir, &mut pages)?;
    let index = GraphPageIndex::new(&pages);
    let mut edges = Vec::new();
    for (source_path, page) in &pages {
        for target in &page.links {
            if let Some(target_path) = index.resolve(source_path, target) {
                if &target_path != source_path {
                    edges.push((source_path.clone(), target_path.clone()));
                }
            }
        }
    }
    edges.sort();
    edges.dedup();

    let mut markdown = String::from("# Knowledge Graph\n\n```mermaid\ngraph TD\n");
    for page in pages.values() {
        markdown.push_str("  ");
        markdown.push_str(&page.id);
        markdown.push_str("[\"");
        markdown.push_str(&escape_mermaid_label(&page.display_name));
        markdown.push_str("\"]\n");
    }
    for (source, target) in edges {
        markdown.push_str("  ");
        markdown.push_str(&pages[&source].id);
        markdown.push_str(" --> ");
        markdown.push_str(&pages[&target].id);
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
    let relative_path = relative_path(root, &wiki_dir.join("knowledge-graph.md"))?;
    write_managed_file(root, &relative_path, markdown.as_bytes())
}

pub(crate) fn ensure_directory(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "root_not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect llm wiki workspace root", &error)
    })?;

    let file_type = metadata.file_type();
    if file_type.is_symlink() || !file_type.is_dir() {
        return Err(WorkspaceError::new(
            "not_directory",
            "llm wiki workspace root is not a directory",
        ));
    }

    Ok(())
}

pub(crate) fn managed_directory(
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

pub(crate) fn write_managed_file(
    root: &Path,
    managed_relative_path: &str,
    contents: &[u8],
) -> Result<(), WorkspaceError> {
    validate_managed_relative_path(managed_relative_path)?;
    let path = root.join(managed_relative_path);
    ensure_managed_parent_directories(root, managed_relative_path)?;
    match existing_path_kind(&path)? {
        ExistingPathKind::Missing => {}
        ExistingPathKind::File => {}
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict(
                "file",
                "not a file",
                managed_relative_path,
            ));
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "llm wiki path has no parent"))?;
    ensure_directory(parent)?;

    let temp_dir = managed_directory(root, ".llm-wiki")?;
    let tmp_path = temp_dir.join(unique_temp_filename(managed_relative_path));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|error| {
                WorkspaceError::from_io(
                    "write_failed",
                    "failed to create llm wiki temp file",
                    &error,
                )
            })?;
        file.write_all(contents).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to write llm wiki temp file", &error)
        })?;
        file.sync_all().map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io("write_failed", "failed to sync llm wiki temp file", &error)
        })?;
    }

    #[cfg(windows)]
    if matches!(existing_path_kind(&path)?, ExistingPathKind::File) {
        fs::remove_file(&path).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            WorkspaceError::from_io(
                "write_failed",
                "failed to remove existing llm wiki file before replace",
                &error,
            )
        })?;
    }

    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        WorkspaceError::from_io("write_failed", "failed to replace llm wiki file", &error)
    })
}

pub(crate) fn ensure_managed_file_target(
    root: &Path,
    managed_relative_path: &str,
) -> Result<(), WorkspaceError> {
    validate_managed_relative_path(managed_relative_path)?;
    ensure_managed_parent_directories(root, managed_relative_path)?;
    match existing_path_kind(&root.join(managed_relative_path))? {
        ExistingPathKind::Missing | ExistingPathKind::File => Ok(()),
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => Err(
            path_type_conflict("file", "not a file", managed_relative_path),
        ),
    }
}

fn validate_managed_relative_path(managed_relative_path: &str) -> Result<(), WorkspaceError> {
    if managed_relative_path.is_empty()
        || managed_relative_path.contains('\\')
        || managed_relative_path.contains('\0')
        || Path::new(managed_relative_path).is_absolute()
    {
        return Err(invalid_managed_path(managed_relative_path));
    }

    let mut has_component = false;
    for component in Path::new(managed_relative_path).components() {
        match component {
            std::path::Component::Normal(segment) => {
                let Some(segment) = segment.to_str() else {
                    return Err(invalid_managed_path(managed_relative_path));
                };
                if segment.is_empty() {
                    return Err(invalid_managed_path(managed_relative_path));
                }
                has_component = true;
            }
            _ => return Err(invalid_managed_path(managed_relative_path)),
        }
    }

    if !has_component {
        return Err(invalid_managed_path(managed_relative_path));
    }

    Ok(())
}

fn invalid_managed_path(managed_relative_path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "invalid_llm_wiki_managed_path",
        format!("unsafe llm wiki managed path: {managed_relative_path}"),
    )
}

fn ensure_managed_parent_directories(
    root: &Path,
    managed_relative_path: &str,
) -> Result<(), WorkspaceError> {
    let path = root.join(managed_relative_path);
    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "llm wiki path has no parent"))?;
    let relative_parent = parent
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::new("outside_workspace", "path is outside llm wiki root"))?;

    let mut current = root.to_path_buf();
    for component in relative_parent.components() {
        current.push(component);
        let relative_component = relative_path(root, &current)?;
        match existing_path_kind(&current)? {
            ExistingPathKind::Directory => {}
            ExistingPathKind::Missing => {
                return Err(WorkspaceError::new(
                    "not_found",
                    format!("llm wiki managed directory is missing: {relative_component}"),
                ));
            }
            ExistingPathKind::File | ExistingPathKind::Symlink | ExistingPathKind::Other => {
                return Err(path_type_conflict(
                    "directory",
                    "not a directory",
                    &relative_component,
                ));
            }
        }
    }

    Ok(())
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
    pages: &mut BTreeMap<String, GraphPage>,
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
            scan_wiki_graph_dir(root, &path, pages)?;
        } else if file_type.is_file() && is_allowed_markdown_file(&path) {
            let relative_path = relative_path(root, &path)?;
            if relative_path == "wiki/knowledge-graph.md" {
                continue;
            }
            let display_name = graph_display_name(&path);
            let id = graph_node_id(&relative_path);
            let contents = fs::read_to_string(&path).map_err(|error| {
                WorkspaceError::from_io("read_failed", "failed to read llm wiki graph file", &error)
            })?;
            pages.insert(
                relative_path,
                GraphPage {
                    id,
                    display_name,
                    links: extract_wikilinks(&contents),
                },
            );
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

pub(crate) fn relative_path(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
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

#[derive(Debug)]
struct GraphPage {
    id: String,
    display_name: String,
    links: Vec<GraphLink>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct GraphLink {
    target: String,
    wiki_root_qualified: bool,
}

struct GraphPageIndex {
    path_keys: BTreeMap<String, String>,
    unambiguous_names: BTreeMap<String, String>,
}

impl GraphPageIndex {
    fn new(pages: &BTreeMap<String, GraphPage>) -> Self {
        let mut path_keys = BTreeMap::new();
        let mut name_counts = BTreeMap::<String, usize>::new();
        let mut name_targets = BTreeMap::new();

        for (relative_path, page) in pages {
            path_keys.insert(graph_link_path_key(relative_path), relative_path.clone());
            *name_counts.entry(page.display_name.clone()).or_default() += 1;
            name_targets.insert(page.display_name.clone(), relative_path.clone());
        }

        let unambiguous_names = name_targets
            .into_iter()
            .filter(|(name, _)| name_counts.get(name) == Some(&1))
            .collect();

        Self {
            path_keys,
            unambiguous_names,
        }
    }

    fn resolve(&self, source_path: &str, link: &GraphLink) -> Option<String> {
        let target = GraphLinkTarget::parse(&link.target);
        if target.path.is_empty() {
            return None;
        }

        if target.path.contains('/') {
            if link.wiki_root_qualified
                || target.root_qualified
                || is_wiki_root_qualified_link(&target.path)
            {
                return self.path_keys.get(&target.path).cloned();
            }
            if let Some(relative_target) = self.resolve_source_relative(source_path, &target.path) {
                return Some(relative_target);
            }
            return self.path_keys.get(&target.path).cloned();
        }

        self.unambiguous_names.get(&target.path).cloned()
    }

    fn resolve_source_relative(&self, source_path: &str, target: &str) -> Option<String> {
        let source_key = graph_link_path_key(source_path);
        let source_dir = source_key
            .rsplit_once('/')
            .map(|(dir, _)| dir)
            .unwrap_or("");
        let candidate = if source_dir.is_empty() {
            target.to_string()
        } else {
            format!("{source_dir}/{target}")
        };
        let candidate = normalize_graph_path(&candidate)?;

        self.path_keys.get(&candidate).cloned()
    }
}

struct GraphLinkTarget {
    path: String,
    root_qualified: bool,
}

impl GraphLinkTarget {
    fn parse(target: &str) -> Self {
        let target = trim_markdown_extension(target.trim());
        let (path, root_qualified) = if let Some(rest) = target.strip_prefix("/wiki/") {
            (normalize_graph_path(rest).unwrap_or_default(), true)
        } else if let Some(rest) = target.strip_prefix('/') {
            (normalize_graph_path(rest).unwrap_or_default(), true)
        } else if let Some(rest) = target.strip_prefix("wiki/") {
            (normalize_graph_path(rest).unwrap_or_default(), true)
        } else {
            (target.to_string(), false)
        };

        Self {
            path,
            root_qualified,
        }
    }
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

fn graph_display_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string()
}

fn graph_node_id(relative_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(relative_path.as_bytes());
    let digest = hasher.finalize();
    let mut id = String::from("wiki_");
    for byte in digest.iter().take(12) {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

fn graph_link_path_key(relative_path: &str) -> String {
    trim_markdown_extension(relative_path)
        .trim_start_matches("wiki/")
        .to_string()
}

fn is_wiki_root_qualified_link(target: &str) -> bool {
    matches!(
        target.split('/').next(),
        Some("sources" | "entities" | "concepts" | "syntheses")
    )
}

fn normalize_graph_path(path: &str) -> Option<String> {
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            segment => segments.push(segment),
        }
    }
    Some(segments.join("/"))
}

fn trim_markdown_extension(path: &str) -> &str {
    path.strip_suffix(".markdown")
        .or_else(|| path.strip_suffix(".md"))
        .unwrap_or(path)
}

fn escape_mermaid_label(label: &str) -> String {
    label.replace('\\', "\\\\").replace('"', "\\\"")
}

fn unique_temp_filename(relative_path: &str) -> String {
    let pid = std::process::id();
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!(
        ".write-{pid}-{counter}-{nanos}-{}.tmp",
        safe_temp_suffix(relative_path)
    )
}

fn safe_temp_suffix(relative_path: &str) -> String {
    let mut suffix = String::new();
    for character in relative_path.chars() {
        if character.is_ascii_alphanumeric() {
            suffix.push(character);
        } else {
            suffix.push('-');
        }
    }
    suffix
}

fn extract_wikilinks(contents: &str) -> Vec<GraphLink> {
    let mut links = BTreeSet::new();
    let mut rest = contents;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let raw_target = &rest[..end];
        let raw_target = raw_target.split('|').next().unwrap_or("").trim();
        if raw_target.starts_with('#') {
            rest = &rest[end + 2..];
            continue;
        }
        let target = raw_target.split('#').next().unwrap_or("").trim();
        let target = trim_markdown_extension(target);
        if !target.is_empty() {
            links.insert(GraphLink {
                target: target.to_string(),
                wiki_root_qualified: raw_target.starts_with("wiki/"),
            });
        }
        rest = &rest[end + 2..];
    }
    links.into_iter().collect()
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

pub(crate) enum ExistingPathKind {
    Missing,
    Directory,
    File,
    Symlink,
    Other,
}

pub(crate) fn existing_path_kind(path: &Path) -> Result<ExistingPathKind, WorkspaceError> {
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

pub(crate) fn path_type_conflict(
    expected: &str,
    actual: &str,
    relative_path: &str,
) -> WorkspaceError {
    WorkspaceError::new(
        "path_type_conflict",
        format!("llm wiki {expected} path exists but is {actual}: {relative_path}"),
    )
}
