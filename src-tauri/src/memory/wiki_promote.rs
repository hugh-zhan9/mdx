//! The one place memory hands something to the wiki.
//!
//! Promotion renders a stored item back out as Markdown under `raw/promoted/`,
//! where the wiki's own ingest can pick it up. It is the only crossing between
//! the two layers, and it stays one-way: the wiki never writes back into the
//! library.
//!
//! Not to be confused with adopting a conclusion. Both used to be called
//! "promote"; this one moves text into another product, the other one decides
//! that a conclusion is worth reading.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::memory::api;
use crate::models::WorkspaceError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteRequest {
    /// The stored item to render out.
    pub drawer_id: String,
    /// Whether to run the wiki's ingest afterwards.
    #[serde(default)]
    pub ingest: bool,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteResult {
    pub drawer_id: String,
    /// Workspace-relative path of the file that was written.
    pub promoted_path: String,
    pub ingested: bool,
}

pub fn promote(root: &Path, request: PromoteRequest) -> Result<PromoteResult, WorkspaceError> {
    promote_with_ingest(root, request, |root_path, promoted_path| {
        crate::llm_wiki::llm_wiki_ingest_raw_file_sync(root_path, promoted_path)
    })
}

fn promote_with_ingest(
    root: &Path,
    request: PromoteRequest,
    ingest: impl FnOnce(String, String) -> Result<(), WorkspaceError>,
) -> Result<PromoteResult, WorkspaceError> {
    let item = api::show(&request.drawer_id)?;

    if request.ingest {
        let status = crate::llm_wiki_fs::detect_llm_wiki_workspace(root)?;
        if !status.has_llm_wiki {
            return Err(WorkspaceError::new(
                "llm_wiki_not_ready",
                "this workspace is not an LLM Wiki workspace",
            ));
        }
    }

    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_title(&item));
    let relative = allocate_promoted_path(root, &title)?;
    let markdown = render(&item, &title);

    let absolute = root.join(&relative);
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "promote_write_failed",
                "failed to create the promoted material directory",
                &error,
            )
        })?;
    }
    std::fs::write(&absolute, markdown).map_err(|error| {
        WorkspaceError::from_io(
            "promote_write_failed",
            "failed to write the promoted material",
            &error,
        )
    })?;

    let mut ingested = false;
    if request.ingest {
        ingest(
            root.to_string_lossy().into_owned(),
            relative.to_string_lossy().into_owned(),
        )?;
        ingested = true;
    }

    Ok(PromoteResult {
        drawer_id: item.drawer_id,
        promoted_path: relative.to_string_lossy().into_owned(),
        ingested,
    })
}

/// Renders the item with enough provenance that the wiki page can be traced
/// back to what it came from.
fn render(item: &api::StoredItem, title: &str) -> String {
    let mut text = String::from("---\n");
    text.push_str(&format!("title: {title}\n"));
    text.push_str("source: loam-memory\n");
    text.push_str(&format!("memory_id: {}\n", item.drawer_id));
    text.push_str(&format!("memory_kind: {}\n", item.kind));
    if let Some(status) = item.status.as_deref() {
        text.push_str(&format!("memory_status: {status}\n"));
    }
    if let Some(source_file) = item.source_file.as_deref() {
        text.push_str(&format!("memory_source: {source_file}\n"));
    }
    text.push_str("---\n\n");

    if let Some(statement) = item.statement.as_deref() {
        text.push_str(&format!("{statement}\n\n"));
    }
    text.push_str(item.excerpt.trim());
    text.push('\n');

    text
}

fn default_title(item: &api::StoredItem) -> String {
    let candidate = item
        .statement
        .as_deref()
        .unwrap_or(&item.excerpt)
        .lines()
        .next()
        .unwrap_or("promoted memory")
        .trim();

    if candidate.is_empty() {
        "promoted memory".to_string()
    } else {
        candidate.chars().take(80).collect()
    }
}

/// Picks a path that does not exist yet.
///
/// Promoted files are never overwritten: the wiki may already have ingested the
/// previous one, and silently replacing its source would make the wiki page and
/// its material disagree.
fn allocate_promoted_path(root: &Path, title: &str) -> Result<PathBuf, WorkspaceError> {
    let date = today();
    let slug = slugify(title);

    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{date}-{slug}.md")
        } else {
            format!("{date}-{slug}-{suffix}.md")
        };
        let relative = PathBuf::from("raw").join("promoted").join(&name);
        if !root.join(&relative).exists() {
            return Ok(relative);
        }
    }

    Err(WorkspaceError::new(
        "promote_write_failed",
        "too many promoted files share this title today",
    ))
}

fn today() -> String {
    time::OffsetDateTime::now_utc()
        .date()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap_or_else(|_| "0000-00-00".to_string())
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
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
        "promoted-memory".to_string()
    } else {
        slug.chars().take(60).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::engine::{library_path, wing_for};
    use crate::memory::evidence::{synthetic_source, write_text, TextEvidence};
    use mempal_runtime::core::db::Database;
    use mempal_runtime::core::types::SourceType;
    use mempal_runtime::embed::Embedder;

    struct FixedEmbedder;

    #[async_trait::async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, texts: &[&str]) -> mempal_runtime::embed::Result<Vec<Vec<f32>>> {
            Ok(texts.iter().map(|_| vec![0.1, 0.2, 0.3, 0.4]).collect())
        }

        fn dimensions(&self) -> usize {
            4
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    fn store_material(root: &Path, content: &str) -> String {
        let wing = wing_for(root).expect("wing");
        let path = library_path().expect("library path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let database = Database::open(&path).expect("open library");

        write_text(
            &database,
            &FixedEmbedder,
            TextEvidence {
                workspace_root: root,
                wing: &wing,
                room: "note",
                content: content.to_string(),
                source_type: SourceType::Manual,
                source_file: Some(synthetic_source("note", content)),
                importance: 1,
            },
        )
        .expect("material")
        .drawer_id
    }

    #[test]
    fn promoting_writes_wiki_material_with_its_provenance() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let drawer_id = store_material(workspace.path(), "We chose the embedded subset.");

            let result = promote_with_ingest(
                workspace.path(),
                PromoteRequest {
                    drawer_id: drawer_id.clone(),
                    ingest: false,
                    title: Some("Font subset decision".to_string()),
                },
                |_, _| panic!("ingest must not run when it was not asked for"),
            )
            .expect("promote");

            assert!(result.promoted_path.starts_with("raw/promoted/"));
            assert!(!result.ingested);
            let written =
                std::fs::read_to_string(workspace.path().join(&result.promoted_path)).expect("read");
            assert!(written.contains("title: Font subset decision"));
            assert!(written.contains(&format!("memory_id: {drawer_id}")));
            assert!(written.contains("We chose the embedded subset."));
        });
    }

    #[test]
    fn promoting_twice_does_not_overwrite_what_the_wiki_may_have_ingested() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let drawer_id = store_material(workspace.path(), "Same decision, promoted twice.");
            let request = || PromoteRequest {
                drawer_id: drawer_id.clone(),
                ingest: false,
                title: Some("Repeated".to_string()),
            };

            let first = promote_with_ingest(workspace.path(), request(), |_, _| Ok(()))
                .expect("first promote");
            let second = promote_with_ingest(workspace.path(), request(), |_, _| Ok(()))
                .expect("second promote");

            assert_ne!(first.promoted_path, second.promoted_path);
            assert!(workspace.path().join(&first.promoted_path).is_file());
            assert!(workspace.path().join(&second.promoted_path).is_file());
        });
    }

    #[test]
    fn promoting_into_a_workspace_without_a_wiki_is_refused_before_writing() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let drawer_id = store_material(workspace.path(), "Nowhere to put this.");

            let error = promote_with_ingest(
                workspace.path(),
                PromoteRequest {
                    drawer_id,
                    ingest: true,
                    title: None,
                },
                |_, _| Ok(()),
            )
            .expect_err("must refuse");

            assert_eq!(error.error_code(), "llm_wiki_not_ready");
            assert!(
                !workspace.path().join("raw/promoted").exists(),
                "nothing should be written when the destination is not ready"
            );
        });
    }
}
