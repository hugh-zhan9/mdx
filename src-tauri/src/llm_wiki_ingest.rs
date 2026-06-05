use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::llm_wiki_fs::{
    append_log_entry, ensure_directory, ensure_managed_file_target, existing_path_kind,
    managed_directory, path_type_conflict, raw_file_metadata, relative_path, write_managed_file,
    ExistingPathKind,
};
use crate::llm_wiki_models::{LlmWikiCache, LlmWikiCacheEntry};
use crate::models::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmWikiFileBlock {
    pub path: String,
    pub content: String,
}

pub fn build_ingest_analysis_prompt(raw: &str, purpose: &str, agents: &str, index: &str) -> String {
    format!(
        r#"Analyze this raw source for ingest into an LLM Wiki workspace.

Return strict JSON only. Do not include markdown fences.
Do not answer user queries from raw sources. Raw sources are used only during ingest.
Identify:
- source_summary: concise summary of the raw source.
- entities: important people, projects, files, systems, organizations, and other named things.
- concepts: reusable ideas, terms, workflows, constraints, and decisions.
- suggested_source_slug: one ASCII lowercase slug using only a-z, 0-9, hyphen, or underscore.
- suggested_entity_slugs: ASCII slugs for useful wiki/entities pages.
- suggested_concept_slugs: ASCII slugs for useful wiki/concepts pages.

Workspace purpose:
{purpose}

Workspace instructions:
{agents}

Existing index:
{index}

Raw source:
{raw}
"#
    )
}

pub fn build_ingest_generation_prompt(analysis_json: &str, existing_context: &str) -> String {
    format!(
        r#"Generate LLM Wiki markdown files from the analysis JSON and existing context.

Output only strict file blocks compatible with this format:
---FILE: wiki/sources/ascii-slug.md---
# Title
Markdown content
---END FILE---

Rules:
- Produce at least one wiki/sources/*.md source page.
- You may also produce wiki/entities/*.md, wiki/concepts/*.md, wiki/syntheses/*.md, index.md, log.md, or llm-wiki-progress.md when useful.
- Use index.md for the workspace index. Do not produce wiki/index.md.
- Do not produce purpose.md.
- File paths must be ASCII only and use only letters, digits, '/', '.', '_', and '-'.
- File paths must end in .md and must not contain spaces, backslashes, dot segments, hidden path segments, absolute paths, or non-ASCII characters.
- Keep filenames descriptive ASCII slugs.
- Use stable path wikilinks with readable aliases when helpful.
- Update related entity and concept pages when the source adds useful facts, contradictions, or provenance.
- Preserve existing wiki context instead of replacing it blindly.
- Use stable wikilinks with aliases, such as [[concepts/example-concept|Readable Label]].
- Include source provenance for factual claims.
- If the source conflicts with existing wiki context, record the disagreement instead of erasing either side.
- Do not write any text outside file blocks.

Analysis JSON:
{analysis_json}

Existing wiki context:
{existing_context}
"#
    )
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
        || !has_only_safe_ascii_output_path_chars(path)
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
            "index.md" | "log.md" | "llm-wiki-progress.md"
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
    let raw_metadata = raw_file_metadata(root, &raw_relative_path)?;
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
            source_page: source_page.clone(),
            ingested_at: timestamp_millis().to_string(),
            model: model.to_string(),
            raw_size: Some(raw_metadata.size),
            raw_modified_ms: raw_metadata.modified_ms,
        },
    );
    write_cache(root, &cache)?;
    append_log_entry(
        root,
        &format!("ingest {raw_relative_path} -> {source_page} ({model})"),
    )
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

pub(crate) fn validate_raw_relative_path(
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
    let raw_dir = managed_directory(root, "raw")?;
    let canonical_raw_dir = fs::canonicalize(&raw_dir).map_err(|error| {
        WorkspaceError::from_io(
            "path_failed",
            "failed to resolve llm wiki raw directory",
            &error,
        )
    })?;
    if !canonical.starts_with(&canonical_raw_dir) {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_raw_path",
            "llm wiki raw path must resolve inside raw/",
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

pub(crate) fn read_cache(root: &Path) -> Result<LlmWikiCache, WorkspaceError> {
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
    Some(normalize_llm_wiki_output_path(path))
}

fn normalize_llm_wiki_output_path(path: &str) -> String {
    match path {
        "wiki/index.md" => "index.md".to_string(),
        _ => path.to_string(),
    }
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

fn has_only_safe_ascii_output_path_chars(path: &str) -> bool {
    path.bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
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
