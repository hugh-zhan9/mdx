use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::memory_fs::{render_markdown_with_frontmatter, write_workspace_file_if_missing};
use crate::memory_models::MemoryFrontmatter;
use crate::memory_storage::{MemoryStorage, ProjectionMemory};
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionReport {
    pub written: usize,
    pub skipped: usize,
    pub conflicts: usize,
}

pub fn rebuild_projection(
    root: impl AsRef<Path>,
    storage: &mut dyn MemoryStorage,
) -> Result<ProjectionReport, WorkspaceError> {
    let root = root.as_ref();
    let config = crate::memory_fs::read_memory_config(root)?;
    let projection = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::Projection,
        None,
    );
    if !projection.enabled {
        return Ok(ProjectionReport {
            written: 0,
            skipped: 0,
            conflicts: 0,
        });
    }

    let mut report = ProjectionReport {
        written: 0,
        skipped: 0,
        conflicts: 0,
    };
    let mut projected_slugs = HashSet::new();

    for memory in storage.list_active_memories_for_projection()? {
        let relative_path = allocate_memory_projection_path(&memory, &mut projected_slugs);
        let markdown = render_projection_markdown(&memory)?;
        let existing = match std::fs::read_to_string(root.join(&relative_path)) {
            Ok(contents) => Some(contents),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "memory_projection_read_failed",
                    "failed to read existing memory projection",
                    &error,
                ));
            }
        };
        if existing.as_deref() == Some(markdown.as_str()) {
            report.skipped += 1;
            continue;
        }
        if existing.is_some() {
            report.conflicts += 1;
            continue;
        }
        if write_workspace_file_if_missing(root, &relative_path, markdown.as_bytes())? {
            report.written += 1;
            continue;
        }
        let existing = std::fs::read_to_string(root.join(&relative_path)).map_err(|error| {
            WorkspaceError::from_io(
                "memory_projection_read_failed",
                "failed to read concurrently created memory projection",
                &error,
            )
        })?;
        if existing == markdown {
            report.skipped += 1;
        } else {
            report.conflicts += 1;
        }
    }

    Ok(report)
}

fn render_projection_markdown(memory: &ProjectionMemory) -> Result<String, WorkspaceError> {
    let frontmatter = MemoryFrontmatter {
        schema_version: 1,
        kind: "memory".to_string(),
        memory_id: memory.memory_id.clone(),
        title: memory.title.clone(),
        status: "active".to_string(),
        created_at: memory.created_at.clone(),
        source_thread: None,
        source_message_refs: Vec::new(),
        importance: memory.importance,
        confidence: memory.confidence,
        tags: memory.tags.clone(),
        evolves_from: None,
    };
    render_markdown_with_frontmatter(&frontmatter, &memory.body)
}

fn allocate_memory_projection_path(
    memory: &ProjectionMemory,
    projected_paths: &mut HashSet<String>,
) -> String {
    let title_slug = slugify(&memory.title);
    let base_path = format!("memory/memories/{title_slug}.md");
    if projected_paths.insert(base_path.clone()) {
        return base_path;
    }

    let id_slug = slugify(&memory.memory_id);
    let id_path = format!("memory/memories/{title_slug}-{id_slug}.md");
    if projected_paths.insert(id_path.clone()) {
        return id_path;
    }

    let hash_path = format!(
        "memory/memories/{title_slug}-{}.md",
        short_hash(&memory.memory_id)
    );
    projected_paths.insert(hash_path.clone());
    hash_path
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

fn short_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("{digest:x}").chars().take(12).collect()
}
