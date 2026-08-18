//! Taking the library out as Markdown, and putting it back.
//!
//! One SQLite file now holds every project's memory. That is what makes recall
//! across projects work, and it is also a single thing to lose. This module is
//! the answer to losing it: an export writes the library out as ordinary
//! Markdown files a person can read, keep anywhere, and diff, and an import
//! reads that same shape back into an empty library.
//!
//! The bundle is rendered *from the library*, not copied from any directory.
//! There is no longer a Markdown tree behind memory to archive — the earlier
//! version of this file copied `memory/memories`, `memory/inbox` and
//! `memory/threads`, and none of those exist as concepts any more.
//!
//! What makes the round trip trustworthy is that identity is carried, not
//! recomputed. Each file records the entry's own identifier and every field
//! beside it, so restoring produces the same entries rather than lookalikes
//! with new ids — which matters most for conclusions, whose supporting and
//! verification links are those ids.
//!
//! What is deliberately not in a bundle: the embedding vectors, which belong to
//! whichever model is installed and are rebuilt on import, and the upstream
//! knowledge-card and event tables, which this product does not write.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use mempal_runtime::core::db::Database;
use mempal_runtime::core::types::{Drawer, MemoryKind};
use mempal_runtime::embed::Embedder;
use serde::{Deserialize, Serialize};

use crate::memory::engine::embed_one;
use crate::models::WorkspaceError;

/// The bundle layout, which shares nothing with the directory copy that used to
/// carry this name. An older bundle is refused rather than half-understood.
pub const BUNDLE_VERSION: u32 = 2;

const MANIFEST_FILE: &str = "manifest.json";
const EVIDENCE_DIR: &str = "evidence";
const KNOWLEDGE_DIR: &str = "knowledge";
const FRONT_MATTER_OPEN: &str = "---\n";
const FRONT_MATTER_CLOSE: &str = "\n---\n";
/// Long enough for any identifier this product generates, short enough that no
/// filesystem objects.
const MAX_FILE_STEM: usize = 120;

/// What a bundle says about itself.
///
/// The file list is the authority on what the bundle contains: an import reads
/// these and only these, so a stale file left over from an earlier export into
/// the same directory is ignored rather than silently restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    pub version: u32,
    pub exported_at: String,
    /// The project this bundle covers, or absent for the whole library.
    #[serde(default)]
    pub wing: Option<String>,
    pub evidence: usize,
    pub knowledge: usize,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExport {
    pub output_path: String,
    pub evidence: usize,
    pub knowledge: usize,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleImport {
    pub source_path: String,
    pub evidence: usize,
    pub knowledge: usize,
    /// Entries the library already held. Restoring on top of a live library is
    /// allowed and leaves what is already there alone.
    pub skipped: usize,
}

/// Writes the library out as a Markdown bundle.
///
/// Passing a project name exports only that project; passing none exports
/// everything, which is the backup a user wants when the worry is the library
/// file itself.
pub fn export(
    database: &Database,
    output_dir: &Path,
    wing: Option<&str>,
) -> Result<BundleExport, WorkspaceError> {
    let drawers = collect(database, wing)?;

    create_dir(output_dir)?;
    create_dir(&output_dir.join(EVIDENCE_DIR))?;
    create_dir(&output_dir.join(KNOWLEDGE_DIR))?;

    let mut used = HashSet::new();
    let mut files = Vec::with_capacity(drawers.len());
    let mut evidence = 0;
    let mut knowledge = 0;

    for drawer in &drawers {
        let directory = match drawer.memory_kind {
            MemoryKind::Evidence => {
                evidence += 1;
                EVIDENCE_DIR
            }
            MemoryKind::Knowledge => {
                knowledge += 1;
                KNOWLEDGE_DIR
            }
        };
        let relative = format!("{directory}/{}", file_name_for(&drawer.id, &mut used));
        let rendered = render(drawer)?;

        std::fs::write(output_dir.join(&relative), rendered).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_export_failed",
                format!("failed to write {relative}"),
                &error,
            )
        })?;
        files.push(relative);
    }

    let manifest = BundleManifest {
        version: BUNDLE_VERSION,
        exported_at: now_rfc3339(),
        wing: wing.map(|wing| wing.to_string()),
        evidence,
        knowledge,
        files: files.clone(),
    };
    write_manifest(&output_dir.join(MANIFEST_FILE), &manifest)?;

    Ok(BundleExport {
        output_path: output_dir.to_string_lossy().into_owned(),
        evidence,
        knowledge,
        files,
    })
}

/// Reads a Markdown bundle back into the library.
///
/// Strict on purpose. This is the path someone takes after losing the library,
/// and a restore that quietly drops the entries it could not parse would hand
/// back a plausible-looking subset of what was lost. Anything unreadable stops
/// the import and says which file it was.
pub fn import<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    bundle_dir: &Path,
) -> Result<BundleImport, WorkspaceError> {
    let manifest = read_manifest(&bundle_dir.join(MANIFEST_FILE))?;
    if manifest.version != BUNDLE_VERSION {
        return Err(WorkspaceError::new(
            "bundle_import_failed",
            format!(
                "this bundle is version {}, and this version of the app reads version {BUNDLE_VERSION}",
                manifest.version
            ),
        ));
    }

    let mut drawers = Vec::with_capacity(manifest.files.len());
    for relative in &manifest.files {
        let path = bundle_path(bundle_dir, relative)?;
        let markdown = std::fs::read_to_string(&path).map_err(|error| {
            WorkspaceError::from_io(
                "bundle_import_failed",
                format!("failed to read {relative}"),
                &error,
            )
        })?;
        let drawer = render_back(&markdown).map_err(|error| {
            WorkspaceError::new(
                "bundle_import_failed",
                format!("{relative} is not a readable memory entry: {error}"),
            )
        })?;
        drawers.push(drawer);
    }

    // Material before conclusions. A conclusion's gate checks that every
    // identifier it references resolves, so the material has to be in place
    // first for the restored library to behave like the one it came from.
    drawers.sort_by_key(kind_order);

    let mut evidence = 0;
    let mut knowledge = 0;
    let mut skipped = 0;

    for drawer in drawers {
        let exists = database.drawer_exists(&drawer.id).map_err(|error| {
            WorkspaceError::new(
                "bundle_import_failed",
                format!("failed to check for {}: {error}", drawer.id),
            )
        })?;
        if exists {
            skipped += 1;
            continue;
        }

        let vector = embed_one(embedder, &drawer.content)?;
        let inserted = database.insert_drawer(&drawer).map_err(|error| {
            WorkspaceError::new(
                "bundle_import_failed",
                format!("failed to restore {}: {error}", drawer.id),
            )
        })?;
        if !inserted {
            skipped += 1;
            continue;
        }

        database.insert_vector(&drawer.id, &vector).map_err(|error| {
            WorkspaceError::new(
                "bundle_import_failed",
                format!("failed to index {}: {error}", drawer.id),
            )
        })?;

        match drawer.memory_kind {
            MemoryKind::Evidence => evidence += 1,
            MemoryKind::Knowledge => knowledge += 1,
        }
    }

    Ok(BundleImport {
        source_path: bundle_dir.to_string_lossy().into_owned(),
        evidence,
        knowledge,
        skipped,
    })
}

fn collect(database: &Database, wing: Option<&str>) -> Result<Vec<Drawer>, WorkspaceError> {
    let ids = database.all_active_drawers().map_err(|error| {
        WorkspaceError::new(
            "bundle_export_failed",
            format!("failed to list what memory holds: {error}"),
        )
    })?;

    let mut drawers = Vec::new();
    for (id, _) in ids {
        let Some(drawer) = database.get_drawer(&id).map_err(|error| {
            WorkspaceError::new(
                "bundle_export_failed",
                format!("failed to read {id}: {error}"),
            )
        })?
        else {
            continue;
        };
        if wing.is_some_and(|wing| drawer.wing != wing) {
            continue;
        }
        drawers.push(drawer);
    }

    drawers.sort_by(|left, right| {
        kind_order(left)
            .cmp(&kind_order(right))
            .then_with(|| left.id.cmp(&right.id))
    });

    Ok(drawers)
}

fn kind_order(drawer: &Drawer) -> u8 {
    match drawer.memory_kind {
        MemoryKind::Evidence => 0,
        MemoryKind::Knowledge => 1,
    }
}

/// One entry as a Markdown file: every field but the text in the front matter,
/// the text itself as the body.
///
/// The front matter is built from the entry's own serialized form rather than
/// from a hand-written list of fields, so a field this application never reads
/// still survives the round trip instead of being quietly dropped.
fn render(drawer: &Drawer) -> Result<String, WorkspaceError> {
    let mut value = serde_json::to_value(drawer).map_err(|error| {
        WorkspaceError::new(
            "bundle_export_failed",
            format!("failed to describe {}: {error}", drawer.id),
        )
    })?;
    value
        .as_object_mut()
        .ok_or_else(|| {
            WorkspaceError::new(
                "bundle_export_failed",
                format!("{} did not describe itself as a record", drawer.id),
            )
        })?
        .remove("content");

    let mut front_matter = serde_yaml_ng::to_string(&value).map_err(|error| {
        WorkspaceError::new(
            "bundle_export_failed",
            format!("failed to encode {}: {error}", drawer.id),
        )
    })?;
    if !front_matter.ends_with('\n') {
        front_matter.push('\n');
    }

    Ok(format!(
        "{FRONT_MATTER_OPEN}{front_matter}---\n{}",
        drawer.content
    ))
}

/// The exact inverse of [`render`].
///
/// The body is taken verbatim from the first front-matter terminator to the end
/// of the file, so text that itself contains `---` lines or trailing blank
/// lines comes back byte for byte.
fn render_back(markdown: &str) -> Result<Drawer, WorkspaceError> {
    let rest = markdown.strip_prefix(FRONT_MATTER_OPEN).ok_or_else(|| {
        WorkspaceError::new("bundle_import_failed", "the entry has no front matter")
    })?;
    let (front_matter, content) = rest.split_once(FRONT_MATTER_CLOSE).ok_or_else(|| {
        WorkspaceError::new("bundle_import_failed", "the front matter is never closed")
    })?;

    let mut value: serde_json::Value =
        serde_yaml_ng::from_str(front_matter).map_err(|error| {
            WorkspaceError::new(
                "bundle_import_failed",
                format!("the front matter does not parse: {error}"),
            )
        })?;
    value
        .as_object_mut()
        .ok_or_else(|| {
            WorkspaceError::new(
                "bundle_import_failed",
                "the front matter is not a set of fields",
            )
        })?
        .insert(
            "content".to_string(),
            serde_json::Value::String(content.to_string()),
        );

    serde_json::from_value(value).map_err(|error| {
        WorkspaceError::new(
            "bundle_import_failed",
            format!("the entry is missing something it needs: {error}"),
        )
    })
}

/// Resolves one manifest entry inside the bundle.
///
/// A manifest is data, and a bundle can come from anywhere, so an entry that
/// climbs out of its own directory is refused rather than followed.
fn bundle_path(bundle_dir: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let candidate = Path::new(relative);
    let contained = candidate
        .components()
        .all(|component| matches!(component, Component::Normal(_)));

    if !contained || relative.is_empty() {
        return Err(WorkspaceError::new(
            "bundle_import_failed",
            format!("{relative} is not a path inside the bundle"),
        ));
    }

    Ok(bundle_dir.join(candidate))
}

fn file_name_for(id: &str, used: &mut HashSet<String>) -> String {
    let stem: String = id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '.'
            {
                character
            } else {
                '_'
            }
        })
        .take(MAX_FILE_STEM)
        .collect();
    let stem = if stem.is_empty() {
        "entry".to_string()
    } else {
        stem
    };

    let mut candidate = format!("{stem}.md");
    let mut attempt = 2;
    while !used.insert(candidate.clone()) {
        candidate = format!("{stem}-{attempt}.md");
        attempt += 1;
    }

    candidate
}

fn create_dir(path: &Path) -> Result<(), WorkspaceError> {
    std::fs::create_dir_all(path).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            format!("failed to create {}", path.display()),
            &error,
        )
    })
}

fn write_manifest(path: &Path, manifest: &BundleManifest) -> Result<(), WorkspaceError> {
    let mut contents = serde_json::to_string_pretty(manifest).map_err(|error| {
        WorkspaceError::new(
            "bundle_export_failed",
            format!("failed to encode the bundle manifest: {error}"),
        )
    })?;
    contents.push('\n');

    std::fs::write(path, contents).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_export_failed",
            "failed to write the bundle manifest",
            &error,
        )
    })
}

fn read_manifest(path: &Path) -> Result<BundleManifest, WorkspaceError> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        WorkspaceError::from_io(
            "bundle_import_failed",
            format!("failed to read {}", path.display()),
            &error,
        )
    })?;

    serde_json::from_str(&contents).map_err(|error| {
        WorkspaceError::new(
            "bundle_import_failed",
            format!("{} is not a memory bundle manifest: {error}", path.display()),
        )
    })
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::engine::{library_path, wing_for};
    use crate::memory::evidence::{
        ingest_file, synthetic_source, write_text, TextEvidence, SESSION_ROOM,
    };
    use crate::memory::knowledge::{adopt, distill, gate, AdoptArgs, ConclusionTier, DistillArgs};
    use mempal_runtime::core::types::SourceType;

    struct FixedEmbedder;

    #[async_trait::async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, texts: &[&str]) -> mempal_runtime::embed::Result<Vec<Vec<f32>>> {
            Ok(texts
                .iter()
                .map(|text| vec![text.len() as f32, 0.1, 0.2, 0.3])
                .collect())
        }

        fn dimensions(&self) -> usize {
            4
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    fn open_library() -> Database {
        let path = library_path().expect("library path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        Database::open(&path).expect("open library")
    }

    /// A second, empty library beside the first — what a user restores into
    /// after losing the original.
    fn open_empty_library(home: &Path, name: &str) -> Database {
        let path = home.join("memory").join(name);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        Database::open(&path).expect("open library")
    }

    struct Populated {
        database: Database,
        workspace: tempfile::TempDir,
        wing: String,
        conclusion: String,
    }

    /// A library with one of everything the product can produce: material this
    /// application assembled, material read out of a file, an adopted
    /// conclusion and the review record behind it.
    fn populated_library() -> Populated {
        let workspace = tempfile::tempdir().expect("workspace");
        let wing = wing_for(workspace.path()).expect("wing");
        let database = open_library();

        let material = write_text(
            &database,
            &FixedEmbedder,
            TextEvidence {
                workspace_root: workspace.path(),
                wing: &wing,
                room: SESSION_ROOM,
                content: "we measured the exported PDF and the subset was there".to_string(),
                source_type: SourceType::Conversation,
                source_file: Some(synthetic_source("session", "abc123")),
                importance: 1,
            },
        )
        .expect("material")
        .drawer_id;

        let notes = workspace.path().join("notes");
        std::fs::create_dir_all(&notes).expect("mkdir");
        let file = notes.join("decision.md");
        std::fs::write(
            &file,
            "# Decision\n\nExports embed a subset of a system CJK face.\n\n---\n\nStill true.\n",
        )
        .expect("write");
        ingest_file(&database, &FixedEmbedder, workspace.path(), &wing, &file, None).expect("ingest");

        let conclusion = distill(
            &database,
            &FixedEmbedder,
            DistillArgs {
                workspace_root: workspace.path(),
                wing: &wing,
                room: "review",
                statement: "PDF export embeds a font subset".to_string(),
                body: "Exports carry a subset of a system CJK face.".to_string(),
                tier: ConclusionTier::Concrete,
                supporting_refs: vec![material],
            },
        )
        .expect("distill")
        .drawer_id;

        adopt(
            &database,
            &FixedEmbedder,
            AdoptArgs {
                workspace_root: workspace.path(),
                wing: &wing,
                drawer_id: &conclusion,
                reviewer: "local-user",
                note: Some("checked against the rendered page".to_string()),
            },
        )
        .expect("adopt");

        Populated {
            database,
            workspace,
            wing,
            conclusion,
        }
    }

    fn every_drawer(database: &Database) -> Vec<Drawer> {
        database
            .all_active_drawers()
            .expect("drawers")
            .into_iter()
            .map(|(id, _)| database.get_drawer(&id).expect("lookup").expect("stored"))
            .collect()
    }

    #[test]
    fn a_rendered_entry_reads_as_markdown_with_front_matter() {
        with_scoped_home(|_home| {
            let fixture = populated_library();
            let conclusion = fixture
                .database
                .get_drawer(&fixture.conclusion)
                .expect("lookup")
                .expect("stored");

            let rendered = render(&conclusion).expect("render");

            assert!(rendered.starts_with("---\n"));
            let (front_matter, body) = rendered
                .strip_prefix("---\n")
                .expect("opens")
                .split_once("\n---\n")
                .expect("closes");
            assert_eq!(body, conclusion.content, "the text is the body, unwrapped");
            assert!(!front_matter.contains("content:"), "the text is not duplicated");
            for field in [
                "id:",
                "wing:",
                "memory_kind:",
                "statement:",
                "tier:",
                "status:",
                "supporting_refs:",
                "verification_refs:",
            ] {
                assert!(front_matter.contains(field), "missing {field}:\n{front_matter}");
            }
            assert_eq!(render_back(&rendered).expect("parse"), conclusion);
        });
    }

    #[test]
    fn a_bundle_restored_into_an_empty_library_is_the_same_library() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let original = every_drawer(&fixture.database);
            assert!(
                original.len() >= 4,
                "the fixture should hold material and conclusions: {}",
                original.len()
            );
            let output = home.path().join("bundle");

            let exported = export(&fixture.database, &output, None).expect("export");

            assert_eq!(exported.evidence + exported.knowledge, original.len());
            assert_eq!(exported.files.len(), original.len());
            assert!(output.join(MANIFEST_FILE).is_file());

            let restored_db = open_empty_library(home.path(), "restored.db");
            assert_eq!(restored_db.drawer_count().expect("count"), 0);

            let imported = import(&restored_db, &FixedEmbedder, &output).expect("import");

            assert_eq!(imported.evidence, exported.evidence);
            assert_eq!(imported.knowledge, exported.knowledge);
            assert_eq!(imported.skipped, 0);

            // Field for field, not just count for count.
            let restored = every_drawer(&restored_db);
            assert_eq!(restored, original, "the round trip lost or changed a field");
        });
    }

    #[test]
    fn a_restored_conclusion_still_passes_the_same_gate() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let before = gate(&fixture.database, &fixture.conclusion).expect("gate");
            let output = home.path().join("bundle");
            export(&fixture.database, &output, None).expect("export");

            let restored_db = open_empty_library(home.path(), "restored.db");
            import(&restored_db, &FixedEmbedder, &output).expect("import");

            let after = gate(&restored_db, &fixture.conclusion).expect("gate");

            // The gate resolves every referenced identifier against the
            // library, so this only holds if the links came back intact.
            assert_eq!(after.allowed, before.allowed);
            assert_eq!(
                after.evidence_counts.supporting,
                before.evidence_counts.supporting
            );
            assert_eq!(
                after.evidence_counts.verification,
                before.evidence_counts.verification
            );
            assert_eq!(after.status, before.status);
            assert_eq!(after.tier, before.tier);
        });
    }

    #[test]
    fn restoring_the_same_bundle_twice_adds_nothing() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let output = home.path().join("bundle");
            let exported = export(&fixture.database, &output, None).expect("export");

            let restored_db = open_empty_library(home.path(), "restored.db");
            import(&restored_db, &FixedEmbedder, &output).expect("first import");
            let count = restored_db.drawer_count().expect("count");

            let again = import(&restored_db, &FixedEmbedder, &output).expect("second import");

            assert_eq!(again.evidence, 0);
            assert_eq!(again.knowledge, 0);
            assert_eq!(again.skipped, exported.files.len());
            assert_eq!(restored_db.drawer_count().expect("count"), count);
        });
    }

    #[test]
    fn exporting_one_project_leaves_the_others_out() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let other_workspace = tempfile::tempdir().expect("other workspace");
            let other_wing = wing_for(other_workspace.path()).expect("wing");
            write_text(
                &fixture.database,
                &FixedEmbedder,
                TextEvidence {
                    workspace_root: other_workspace.path(),
                    wing: &other_wing,
                    room: SESSION_ROOM,
                    content: "a different project's material".to_string(),
                    source_type: SourceType::Conversation,
                    source_file: Some(synthetic_source("session", "other")),
                    importance: 1,
                },
            )
            .expect("other material");
            let output = home.path().join("bundle");

            let exported =
                export(&fixture.database, &output, Some(&fixture.wing)).expect("export");

            let restored_db = open_empty_library(home.path(), "restored.db");
            import(&restored_db, &FixedEmbedder, &output).expect("import");

            assert_eq!(
                exported.files.len(),
                restored_db.drawer_count().expect("count") as usize
            );
            for drawer in every_drawer(&restored_db) {
                assert_eq!(drawer.wing, fixture.wing);
            }
        });
    }

    #[test]
    fn awkward_text_survives_the_round_trip_byte_for_byte() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            // A note that looks like it has front matter of its own, ends in
            // blank lines, and carries the kind of punctuation a YAML encoder
            // has opinions about.
            let awkward = "---\ntitle: not our front matter\n---\n\n# Notes\n\n\
                 - a line with: a colon\n- \"quoted\"\n- 'single'\n- tab\there\n\n\n";
            let written = write_text(
                &fixture.database,
                &FixedEmbedder,
                TextEvidence {
                    workspace_root: fixture.workspace.path(),
                    wing: &fixture.wing,
                    room: SESSION_ROOM,
                    content: awkward.to_string(),
                    source_type: SourceType::Manual,
                    source_file: Some(synthetic_source("session", "awkward: one\ntwo")),
                    importance: 1,
                },
            )
            .expect("write")
            .drawer_id;
            let output = home.path().join("bundle");
            export(&fixture.database, &output, None).expect("export");

            let restored_db = open_empty_library(home.path(), "restored.db");
            import(&restored_db, &FixedEmbedder, &output).expect("import");

            let restored = restored_db
                .get_drawer(&written)
                .expect("lookup")
                .expect("stored");
            assert_eq!(restored.content, awkward);
            assert_eq!(
                restored.source_file.as_deref(),
                Some("memory://session/awkward: one\ntwo")
            );
        });
    }

    #[test]
    fn a_bundle_from_another_version_is_refused() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let output = home.path().join("bundle");
            export(&fixture.database, &output, None).expect("export");

            let manifest_path = output.join(MANIFEST_FILE);
            let mut manifest = read_manifest(&manifest_path).expect("manifest");
            manifest.version = 1;
            write_manifest(&manifest_path, &manifest).expect("rewrite");

            let restored_db = open_empty_library(home.path(), "restored.db");
            let error =
                import(&restored_db, &FixedEmbedder, &output).expect_err("must be refused");

            assert_eq!(error.error_code(), "bundle_import_failed");
            assert_eq!(restored_db.drawer_count().expect("count"), 0);
        });
    }

    #[test]
    fn a_manifest_that_points_outside_the_bundle_is_refused() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let output = home.path().join("bundle");
            export(&fixture.database, &output, None).expect("export");

            let manifest_path = output.join(MANIFEST_FILE);
            let mut manifest = read_manifest(&manifest_path).expect("manifest");
            manifest
                .files
                .push("../../../etc/hosts".to_string());
            write_manifest(&manifest_path, &manifest).expect("rewrite");

            let restored_db = open_empty_library(home.path(), "restored.db");
            let error =
                import(&restored_db, &FixedEmbedder, &output).expect_err("must be refused");

            assert_eq!(error.error_code(), "bundle_import_failed");
            assert!(error.to_string().contains("inside the bundle"));
            assert_eq!(
                restored_db.drawer_count().expect("count"),
                0,
                "nothing may be restored from a bundle that lies about itself"
            );
        });
    }

    #[test]
    fn a_missing_entry_stops_the_restore() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let output = home.path().join("bundle");
            let exported = export(&fixture.database, &output, None).expect("export");
            std::fs::remove_file(output.join(&exported.files[0])).expect("remove");

            let restored_db = open_empty_library(home.path(), "restored.db");
            let error =
                import(&restored_db, &FixedEmbedder, &output).expect_err("must be refused");

            assert_eq!(error.error_code(), "bundle_import_failed");
            assert_eq!(
                restored_db.drawer_count().expect("count"),
                0,
                "a partial restore must not look like a whole one"
            );
        });
    }

    #[test]
    fn stale_files_left_in_the_output_directory_are_ignored() {
        with_scoped_home(|home| {
            let fixture = populated_library();
            let output = home.path().join("bundle");
            export(&fixture.database, &output, None).expect("export");
            std::fs::write(
                output.join(EVIDENCE_DIR).join("left-over.md"),
                "---\nnot: an entry\n---\nnothing\n",
            )
            .expect("write");

            let restored_db = open_empty_library(home.path(), "restored.db");
            let imported = import(&restored_db, &FixedEmbedder, &output).expect("import");

            assert_eq!(
                imported.evidence + imported.knowledge,
                fixture.database.drawer_count().expect("count") as usize
            );
        });
    }

    #[test]
    fn an_empty_library_exports_an_empty_bundle() {
        with_scoped_home(|home| {
            let database = open_library();
            let output = home.path().join("bundle");

            let exported = export(&database, &output, None).expect("export");

            assert_eq!(exported.evidence, 0);
            assert_eq!(exported.knowledge, 0);
            assert!(exported.files.is_empty());

            let restored_db = open_empty_library(home.path(), "restored.db");
            let imported = import(&restored_db, &FixedEmbedder, &output).expect("import");
            assert_eq!(imported.skipped, 0);
            assert_eq!(restored_db.drawer_count().expect("count"), 0);
        });
    }
}
