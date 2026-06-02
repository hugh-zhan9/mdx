use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::llm_wiki_fs::{
    ensure_directory, ensure_managed_file_target, existing_path_kind, managed_directory,
    path_type_conflict, relative_path, write_managed_file, ExistingPathKind,
};
use crate::llm_wiki_models::{LlmWikiCache, LlmWikiCacheEntry};
use crate::models::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmWikiFileBlock {
    pub path: String,
    pub content: String,
}

pub fn parse_file_blocks(output: &str) -> Result<Vec<LlmWikiFileBlock>, WorkspaceError> {
    let mut blocks = Vec::new();
    let mut seen_paths = BTreeSet::new();
    let mut current_block: Option<OpenFileBlock> = None;

    for line in output.split_inclusive('\n') {
        let line_body = line_without_ending(line).trim();
        if let Some(open_block) = current_block.as_mut() {
            if !open_block.in_fence && line_body == "---END FILE---" {
                let open_block = current_block.take().expect("open block exists");
                blocks.push(LlmWikiFileBlock {
                    path: open_block.path,
                    content: open_block.content,
                });
                continue;
            }
            if !open_block.in_fence && parse_file_marker_path(line_body).is_some() {
                return Err(WorkspaceError::new(
                    "llm_wiki_parse_failed",
                    "llm wiki file block started before previous block ended",
                ));
            }

            open_block.content.push_str(line);
            update_fence_state(&mut open_block.in_fence, line_body);
            continue;
        }

        if let Some(path) = parse_file_marker_path(line_body) {
            if !is_safe_llm_wiki_output_path(&path) {
                return Err(invalid_output_path(&path));
            }
            if !seen_paths.insert(output_path_uniqueness_key(&path)) {
                return Err(duplicate_output_path(&path));
            }
            current_block = Some(OpenFileBlock {
                path,
                content: String::new(),
                in_fence: false,
            });
        } else if !line_body.is_empty() {
            return Err(WorkspaceError::new(
                "llm_wiki_parse_failed",
                "llm wiki output contains text outside file blocks",
            ));
        }
    }

    if let Some(open_block) = current_block {
        return Err(WorkspaceError::new(
            "llm_wiki_parse_failed",
            format!(
                "llm wiki file block is missing end marker: {}",
                open_block.path
            ),
        ));
    }

    if !output.ends_with('\n') {
        if let Some(line) = output.rsplit('\n').next() {
            let line_body = line.trim();
            if let Some(path) = parse_file_marker_path(line_body) {
                if !is_safe_llm_wiki_output_path(&path) {
                    return Err(invalid_output_path(&path));
                }
                if !seen_paths.insert(output_path_uniqueness_key(&path)) {
                    return Err(duplicate_output_path(&path));
                }
                return Err(WorkspaceError::new(
                    "llm_wiki_parse_failed",
                    format!("llm wiki file block is missing end marker: {path}"),
                ));
            }
        };
    }

    if blocks.is_empty() {
        return Err(WorkspaceError::new(
            "llm_wiki_parse_failed",
            "llm wiki output did not contain file blocks",
        ));
    }

    Ok(blocks)
}

pub fn is_safe_llm_wiki_output_path(path: &str) -> bool {
    if path.is_empty()
        || path.contains('\\')
        || path.contains('\0')
        || path.ends_with('/')
        || Path::new(path).is_absolute()
        || !path.ends_with(".md")
        || has_unsafe_slash_segment(path)
    {
        return false;
    }

    let mut components = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(segment) => {
                let Some(segment) = segment.to_str() else {
                    return false;
                };
                if segment.is_empty()
                    || segment == "."
                    || segment == ".."
                    || segment.starts_with('.')
                {
                    return false;
                }
                components.push(segment);
            }
            _ => return false,
        }
    }

    if components.len() == 1 {
        return matches!(
            components[0],
            "index.md" | "log.md" | "purpose.md" | "llm-wiki-progress.md"
        );
    }

    if components.len() < 3 || components[0] != "wiki" {
        return false;
    }

    matches!(
        components[1],
        "sources" | "entities" | "concepts" | "syntheses"
    )
}

pub fn write_ingest_outputs(
    root: impl AsRef<Path>,
    raw_relative_path: &str,
    hash: &str,
    model: &str,
    blocks: &[LlmWikiFileBlock],
) -> Result<(), WorkspaceError> {
    let root = canonicalize_root(root.as_ref())?;
    let root = root.as_path();
    ensure_directory(root)?;

    let mut seen_paths = BTreeSet::new();
    for block in blocks {
        if !is_safe_llm_wiki_output_path(&block.path) {
            return Err(invalid_output_path(&block.path));
        }
        if !seen_paths.insert(output_path_uniqueness_key(&block.path)) {
            return Err(duplicate_output_path(&block.path));
        }
    }
    let source_page = source_page(blocks)?;
    let raw_relative_path = validate_raw_relative_path(root, raw_relative_path)?;
    for block in blocks {
        ensure_managed_file_target(root, &block.path)?;
    }

    ensure_cache_file_target(root)?;
    let mut cache = read_cache(root)?;

    for block in blocks {
        write_managed_file(root, &block.path, block.content.as_bytes())?;
    }

    cache.entries.insert(
        raw_relative_path.clone(),
        LlmWikiCacheEntry {
            hash: hash.to_string(),
            source_page,
            ingested_at: timestamp_millis().to_string(),
            model: model.to_string(),
        },
    );
    write_cache(root, &cache)
}

struct OpenFileBlock {
    path: String,
    content: String,
    in_fence: bool,
}

fn canonicalize_root(root: &Path) -> Result<PathBuf, WorkspaceError> {
    root.canonicalize().map_err(|error| {
        WorkspaceError::from_io(
            "scan_failed",
            "failed to resolve llm wiki workspace root",
            &error,
        )
    })
}

fn validate_raw_relative_path(
    root: &Path,
    raw_relative_path: &str,
) -> Result<String, WorkspaceError> {
    if raw_relative_path.is_empty()
        || raw_relative_path.contains('\\')
        || raw_relative_path.contains('\0')
        || Path::new(raw_relative_path).is_absolute()
    {
        return Err(invalid_raw_path());
    }

    let mut components = Vec::new();
    for component in Path::new(raw_relative_path).components() {
        match component {
            Component::Normal(segment) => {
                let Some(segment) = segment.to_str() else {
                    return Err(invalid_raw_path());
                };
                if segment.is_empty() || segment == "." || segment == ".." {
                    return Err(invalid_raw_path());
                }
                components.push(segment);
            }
            _ => return Err(invalid_raw_path()),
        }
    }

    if components.first() != Some(&"raw") || components.len() < 2 {
        return Err(invalid_raw_path());
    }

    let path = root.join(raw_relative_path);
    let kind = existing_path_kind(&path)?;
    if !matches!(kind, ExistingPathKind::File) {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_raw_path",
            "llm wiki raw path must point to an existing regular file under raw/",
        ));
    }
    let canonical = fs::canonicalize(&path).map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to resolve llm wiki raw file", &error)
    })?;
    if !canonical.starts_with(root) {
        return Err(WorkspaceError::new(
            "outside_workspace",
            "llm wiki raw file is outside workspace",
        ));
    }

    relative_path(root, &path)
}

fn source_page(blocks: &[LlmWikiFileBlock]) -> Result<String, WorkspaceError> {
    blocks
        .iter()
        .find(|block| block.path.starts_with("wiki/sources/"))
        .or_else(|| blocks.first())
        .map(|block| block.path.clone())
        .ok_or_else(|| {
            WorkspaceError::new(
                "llm_wiki_parse_failed",
                "llm wiki ingest requires at least one file block",
            )
        })
}

fn ensure_cache_file_target(root: &Path) -> Result<(), WorkspaceError> {
    managed_directory(root, ".llm-wiki")?;
    ensure_managed_file_target(root, ".llm-wiki/cache.json")
}

fn read_cache(root: &Path) -> Result<LlmWikiCache, WorkspaceError> {
    ensure_cache_file_target(root)?;
    let path = root.join(".llm-wiki/cache.json");
    match existing_path_kind(&path)? {
        ExistingPathKind::File => {}
        ExistingPathKind::Missing => {
            return Ok(LlmWikiCache {
                version: 1,
                entries: BTreeMap::new(),
            });
        }
        ExistingPathKind::Directory | ExistingPathKind::Symlink | ExistingPathKind::Other => {
            return Err(path_type_conflict(
                "file",
                "not a file",
                ".llm-wiki/cache.json",
            ));
        }
    }

    let contents = fs::read_to_string(&path).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read llm wiki cache", &error)
    })?;
    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "cache_parse_failed",
            format!("failed to parse llm wiki cache: {error}"),
        )
    })
}

fn write_cache(root: &Path, cache: &LlmWikiCache) -> Result<(), WorkspaceError> {
    let contents = serde_json::to_vec_pretty(cache).map_err(|error| {
        WorkspaceError::new(
            "serialize_failed",
            format!("failed to serialize llm wiki cache: {error}"),
        )
    })?;
    let mut contents_with_newline = contents;
    contents_with_newline.push(b'\n');
    write_managed_file(root, ".llm-wiki/cache.json", &contents_with_newline)
}

fn parse_file_marker_path(line: &str) -> Option<String> {
    let rest = line.strip_prefix("---FILE:")?;
    let path = rest.strip_suffix("---")?.trim();
    Some(path.to_string())
}

fn line_without_ending(line: &str) -> &str {
    line.strip_suffix("\r\n")
        .or_else(|| line.strip_suffix('\n'))
        .unwrap_or(line)
}

fn update_fence_state(in_fence: &mut bool, line_body: &str) {
    let trimmed = line_body.trim_start();
    if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
        *in_fence = !*in_fence;
    }
}

fn invalid_output_path(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "invalid_llm_wiki_output_path",
        format!("unsafe llm wiki output path: {path}"),
    )
}

fn duplicate_output_path(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "duplicate_llm_wiki_output_path",
        format!("duplicate llm wiki output path: {path}"),
    )
}

fn output_path_uniqueness_key(path: &str) -> String {
    path.to_lowercase()
}

fn has_unsafe_slash_segment(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn invalid_raw_path() -> WorkspaceError {
    WorkspaceError::new(
        "invalid_llm_wiki_raw_path",
        "llm wiki raw path must be a relative path under raw/",
    )
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
