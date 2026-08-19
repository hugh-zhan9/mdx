//! What the rest of the application is allowed to ask memory for.
//!
//! Every function here takes a workspace path and nothing else that matters:
//! resolving the project, the configuration, the model and the library handle
//! is this layer's job, not the caller's. Commands, the CLI and the MCP server
//! all come through here, so the three surfaces cannot drift apart in what they
//! actually do — only in how they are spelled.

use std::path::{Path, PathBuf};

use mempal_runtime::core::types::{KnowledgeStatus, MemoryKind, SourceType};
use mempal_runtime::embed::Embedder;
use mempal_runtime::knowledge_gate::GateReport;
use mempal_runtime::projects::ProjectSummary;
use serde::{Deserialize, Serialize};

use crate::memory::config::{read_global_config, read_workspace_config};
use crate::memory::embedder::{build_embedder, download_model, readiness, ModelReadiness};
use crate::memory::engine::{
    diagnostics as engine_diagnostics, library_status, reindex, wing_bindings, wing_for,
    with_library, LibraryStatus, MemoryDiagnostics, ReindexReport,
};
use crate::memory::evidence::{
    ingest_directory, ingest_file, purge as purge_evidence, room_for, soft_delete, synthetic_source,
    write_text, TextEvidence,
};
use crate::memory::knowledge::{
    add_counterexample, adopt, demote, distill, gate, AdoptArgs, ConclusionTier, DistillArgs,
    RetireReason,
};
use crate::memory::models::evidence::{IngestOutcome, WrittenEvidence};
use crate::memory::models::knowledge::{AdoptedConclusion, DistilledConclusion, RetiredConclusion};
use crate::memory::models::retrieval::{
    Brief, ContextPack, ContextQuery, RecallQuery, RecallResult, SearchHit, SearchRequest,
};
use crate::memory::retrieval;
use crate::models::WorkspaceError;

/// Everything the overview needs to say whether memory works here.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    pub enabled: bool,
    pub wing: Option<String>,
    pub library: LibraryStatus,
    pub model_ready: bool,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub drawer_id: String,
    pub kind: String,
    pub room: String,
    pub source_file: Option<String>,
    pub added_at: String,
    pub importance: i32,
    /// Present on conclusions: the claim itself.
    pub statement: Option<String>,
    /// Present on conclusions: candidate, promoted, demoted, retired.
    pub status: Option<String>,
    pub excerpt: String,
    /// Conclusions only: the material this stands on.
    ///
    /// Carried so a conclusion can be shown with what it was drawn from. The ids
    /// are enough: the panel fetches a piece of material when someone opens it,
    /// rather than every list read paying for text nobody looked at.
    pub supporting_refs: Vec<String>,
    /// Conclusions only: what was checked before it was adopted.
    pub verification_refs: Vec<String>,
    /// Conclusions only: what stands against it, and blocks promotion.
    pub counterexample_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListFilter {
    /// `material`, `conclusion`, or unset for both.
    #[serde(default)]
    pub kind: Option<String>,
    /// Every project in the library rather than this workspace's own.
    ///
    /// One library serves every workspace, and the split by project is this
    /// layer's, not the store's — so answering "everything I have ever stored" is
    /// a matter of not applying it. Off by default: a workspace asking about its
    /// own memory is the common case, and cross-project reading is a decision.
    #[serde(default)]
    pub all_projects: bool,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMaterialRequest {
    pub body: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistillRequestDto {
    pub statement: String,
    pub body: String,
    /// `concrete` (default) or `pattern`.
    #[serde(default)]
    pub tier: Option<String>,
    pub supporting_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptRequestDto {
    pub drawer_id: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetireRequestDto {
    pub drawer_id: String,
    /// `contradicted` | `obsolete` | `superseded` | `out_of_scope` | `unsafe`
    pub reason_type: String,
    pub reason: String,
    pub evidence_refs: Vec<String>,
    /// True retires it outright; false only demotes it.
    #[serde(default)]
    pub retire: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterexampleRequestDto {
    pub drawer_id: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub model: String,
    pub ready: bool,
    pub dir: String,
    pub missing: Vec<String>,
}

pub fn status(root: &Path) -> Result<MemoryStatus, WorkspaceError> {
    let workspace = read_workspace_config(root)?;
    let global = read_global_config()?;
    let model = readiness(&global)?;

    Ok(MemoryStatus {
        enabled: workspace.enabled,
        wing: crate::memory::engine::bound_wing(root)?,
        library: library_status(),
        model_ready: model.is_ready(),
        model: global.embedding.model,
    })
}

pub fn diagnostics() -> Result<MemoryDiagnostics, WorkspaceError> {
    Ok(engine_diagnostics(&read_global_config()?))
}

pub fn projects() -> Result<Vec<ProjectSummary>, WorkspaceError> {
    with_library(|database| {
        mempal_runtime::projects::list_projects(database).map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to list projects: {error}"),
            )
        })
    })
}

pub fn model_status() -> Result<ModelStatus, WorkspaceError> {
    let global = read_global_config()?;
    Ok(match readiness(&global)? {
        ModelReadiness::Ready { model, dir } => ModelStatus {
            model,
            ready: true,
            dir: dir.to_string_lossy().into_owned(),
            missing: Vec::new(),
        },
        ModelReadiness::Missing { model, missing } => ModelStatus {
            model,
            ready: false,
            dir: String::new(),
            missing,
        },
    })
}

/// Downloads the embedding model. Only ever called because a user asked.
pub fn fetch_model() -> Result<ModelStatus, WorkspaceError> {
    let global = read_global_config()?;
    download_model(&global)?;
    model_status()
}

pub fn rebuild_index() -> Result<ReindexReport, WorkspaceError> {
    reindex(&read_global_config()?)
}

pub fn bind_project(root: &Path) -> Result<String, WorkspaceError> {
    wing_for(root)
}

pub fn rebind_project(wing: &str, root: &Path) -> Result<(), WorkspaceError> {
    crate::memory::engine::rebind_wing(wing, root)
}

pub fn project_bindings() -> Result<Vec<(String, String)>, WorkspaceError> {
    Ok(wing_bindings()?.into_iter().collect())
}

pub fn search(request: SearchRequest) -> Result<Vec<SearchHit>, WorkspaceError> {
    with_embedder(|embedder| retrieval::search(embedder, &request))
}

pub fn context(root: &Path, query: ContextQuery) -> Result<ContextPack, WorkspaceError> {
    with_embedder(|embedder| retrieval::context(embedder, root, &query))
}

pub fn brief(root: &Path, query: ContextQuery) -> Result<Brief, WorkspaceError> {
    with_embedder(|embedder| retrieval::brief(embedder, root, &query))
}

pub fn recall(root: &Path, query: RecallQuery) -> Result<RecallResult, WorkspaceError> {
    with_embedder(|embedder| retrieval::recall(embedder, root, &query))
}

/// Stores a note the user typed, as material.
pub fn add_material(
    root: &Path,
    request: AddMaterialRequest,
) -> Result<WrittenEvidence, WorkspaceError> {
    let wing = wing_for(root)?;
    let source = request
        .source
        .unwrap_or_else(|| synthetic_source("note", &short_digest(&request.body)));

    with_embedder(|embedder| {
        with_library(|database| {
            write_text(
                database,
                embedder,
                TextEvidence {
                    workspace_root: root,
                    wing: &wing,
                    room: "note",
                    content: request.body.clone(),
                    source_type: SourceType::Manual,
                    source_file: Some(source.clone()),
                    importance: 1,
                },
            )
        })
    })
}

pub fn import_path(root: &Path, path: &Path) -> Result<IngestOutcome, WorkspaceError> {
    let wing = wing_for(root)?;

    with_embedder(|embedder| {
        with_library(|database| {
            if path.is_dir() {
                ingest_directory(database, embedder, root, &wing, path)
            } else {
                ingest_file(database, embedder, root, &wing, path, None)
            }
        })
    })
}

pub fn list(root: &Path, filter: ListFilter) -> Result<Vec<StoredItem>, WorkspaceError> {
    // Resolved even when every project is asked for, so a first read still binds
    // the workspace to a project rather than leaving it unbound.
    let wing = wing_for(root)?;
    let limit = filter.limit.unwrap_or(200);

    with_library(|database| {
        let mut items = Vec::new();
        for (drawer_id, _) in database.all_active_drawers().map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to list memory: {error}"),
            )
        })? {
            let Some(drawer) = database.get_drawer(&drawer_id).map_err(|error| {
                WorkspaceError::new(
                    "memory_unavailable",
                    format!("failed to read {drawer_id}: {error}"),
                )
            })?
            else {
                continue;
            };
            if !filter.all_projects && drawer.wing != wing {
                continue;
            }
            let kind = match drawer.memory_kind {
                MemoryKind::Evidence => "material",
                MemoryKind::Knowledge => "conclusion",
            };
            if filter.kind.as_deref().is_some_and(|wanted| wanted != kind) {
                continue;
            }
            let status = drawer.status.as_ref().map(status_slug);
            if filter.status.is_some() && filter.status != status {
                continue;
            }

            items.push(StoredItem {
                drawer_id: drawer.id.clone(),
                kind: kind.to_string(),
                room: drawer.room.clone().unwrap_or_default(),
                source_file: drawer.source_file.clone(),
                added_at: drawer.added_at.clone(),
                importance: drawer.importance,
                statement: drawer.statement.clone(),
                status,
                excerpt: excerpt(&drawer.content),
                supporting_refs: drawer.supporting_refs.clone(),
                verification_refs: drawer.verification_refs.clone(),
                counterexample_refs: drawer.counterexample_refs.clone(),
            });

            if items.len() >= limit {
                break;
            }
        }

        items.sort_by(|left, right| right.added_at.cmp(&left.added_at));
        Ok(items)
    })
}

pub fn show(drawer_id: &str) -> Result<StoredItem, WorkspaceError> {
    with_library(|database| {
        let drawer = database
            .get_drawer(drawer_id)
            .map_err(|error| {
                WorkspaceError::new(
                    "memory_unavailable",
                    format!("failed to read {drawer_id}: {error}"),
                )
            })?
            .ok_or_else(|| {
                WorkspaceError::new(
                    "invalid_evidence_ref",
                    format!("there is nothing stored under {drawer_id}"),
                )
            })?;

        Ok(StoredItem {
            drawer_id: drawer.id.clone(),
            kind: match drawer.memory_kind {
                MemoryKind::Evidence => "material",
                MemoryKind::Knowledge => "conclusion",
            }
            .to_string(),
            room: drawer.room.clone().unwrap_or_default(),
            source_file: drawer.source_file.clone(),
            added_at: drawer.added_at.clone(),
            importance: drawer.importance,
            statement: drawer.statement.clone(),
            status: drawer.status.as_ref().map(status_slug),
            // The whole text, not an excerpt: this is the "open it" call.
            excerpt: drawer.content.clone(),
            supporting_refs: drawer.supporting_refs.clone(),
            verification_refs: drawer.verification_refs.clone(),
            counterexample_refs: drawer.counterexample_refs.clone(),
        })
    })
}

pub fn delete(drawer_id: &str) -> Result<bool, WorkspaceError> {
    with_library(|database| soft_delete(database, drawer_id))
}

pub fn purge(before: Option<String>) -> Result<u64, WorkspaceError> {
    with_library(|database| {
        let purged = purge_evidence(database, before.as_deref())?;

        // Then give the file its pages back. Without this the rows are gone and
        // the library is exactly as large as before — and the space is the reason
        // anyone purges. `VACUUM` runs through the library's own connection
        // because it rewrites the whole file and refuses to start while another
        // connection holds a lock; that handle is the only one in this process.
        database.conn().execute_batch("VACUUM;").map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("erased, but failed to reclaim the space: {error}"),
            )
        })?;

        Ok(purged)
    })
}

pub fn distill_conclusion(
    root: &Path,
    request: DistillRequestDto,
) -> Result<DistilledConclusion, WorkspaceError> {
    let wing = wing_for(root)?;
    let tier = match request.tier.as_deref() {
        None | Some("concrete") => ConclusionTier::Concrete,
        Some("pattern") => ConclusionTier::Pattern,
        Some(other) => {
            return Err(WorkspaceError::new(
                "invalid_conclusion",
                format!("a conclusion is either concrete or a pattern, not {other}"),
            ));
        }
    };

    with_embedder(|embedder| {
        with_library(|database| {
            distill(
                database,
                embedder,
                DistillArgs {
                    workspace_root: root,
                    wing: &wing,
                    room: "review",
                    statement: request.statement.clone(),
                    body: request.body.clone(),
                    tier,
                    supporting_refs: request.supporting_refs.clone(),
                },
            )
        })
    })
}

pub fn conclusion_gate(drawer_id: &str) -> Result<GateReport, WorkspaceError> {
    with_library(|database| gate(database, drawer_id))
}

pub fn adopt_conclusion(
    root: &Path,
    request: AdoptRequestDto,
) -> Result<AdoptedConclusion, WorkspaceError> {
    let wing = wing_for(root)?;
    let reviewer = current_reviewer();

    with_embedder(|embedder| {
        with_library(|database| {
            adopt(
                database,
                embedder,
                AdoptArgs {
                    workspace_root: root,
                    wing: &wing,
                    drawer_id: &request.drawer_id,
                    reviewer: &reviewer,
                    note: request.note.clone(),
                },
            )
        })
    })
}

pub fn retire_conclusion(request: RetireRequestDto) -> Result<RetiredConclusion, WorkspaceError> {
    let reason_type = match request.reason_type.as_str() {
        "contradicted" => RetireReason::Contradicted,
        "obsolete" => RetireReason::Obsolete,
        "superseded" => RetireReason::Superseded,
        "out_of_scope" => RetireReason::OutOfScope,
        "unsafe" => RetireReason::Unsafe,
        other => {
            return Err(WorkspaceError::new(
                "invalid_conclusion",
                format!("{other} is not one of the reasons a conclusion can be retired"),
            ));
        }
    };

    with_library(|database| {
        demote(
            database,
            &request.drawer_id,
            request.retire,
            request.evidence_refs.clone(),
            reason_type,
            request.reason.clone(),
        )
    })
}

pub fn record_counterexample(
    root: &Path,
    request: CounterexampleRequestDto,
) -> Result<GateReport, WorkspaceError> {
    let wing = wing_for(root)?;

    with_embedder(|embedder| {
        with_library(|database| {
            add_counterexample(
                database,
                embedder,
                root,
                &wing,
                &request.drawer_id,
                request.body.clone(),
            )
        })
    })
}

/// Reports what a one-time import of the old memory directory would take in.
pub fn legacy_preflight(
    root: &Path,
) -> Result<crate::memory::models::legacy_import::LegacyImportPreflight, WorkspaceError> {
    crate::memory::import_legacy::preflight(root)
}

/// Imports the old memory directory as material. The old files are not touched.
pub fn legacy_import(
    root: &Path,
) -> Result<crate::memory::models::legacy_import::LegacyImportReport, WorkspaceError> {
    let wing = wing_for(root)?;

    with_embedder(|embedder| {
        with_library(|database| {
            crate::memory::import_legacy::import(database, embedder, root, &wing)
        })
    })
}

/// Writes this project's memory out as a readable Markdown bundle.
///
/// With one global library and no automatic backup, this is the user's only
/// copy of their memory, which is why it renders to text rather than copying
/// the database file.
pub fn export_bundle(
    root: &Path,
    output_dir: &Path,
) -> Result<crate::memory::bundle::BundleExport, WorkspaceError> {
    let wing = wing_for(root)?;

    with_library(|database| crate::memory::bundle::export(database, output_dir, Some(&wing)))
}

pub fn import_bundle(
    bundle_dir: &Path,
) -> Result<crate::memory::bundle::BundleImport, WorkspaceError> {
    with_embedder(|embedder| {
        with_library(|database| crate::memory::bundle::import(database, embedder, bundle_dir))
    })
}

/// Which room a path would be filed under, for the panel to show before import.
pub fn room_preview(root: &Path, path: &Path) -> String {
    room_for(root, path)
}

/// Builds the embedder once and hands it to one operation.
///
/// Kept in one place so every write and every query fails the same way when the
/// model is missing: with `embedding_model_missing`, before anything is stored.
fn with_embedder<T>(
    operation: impl FnOnce(&dyn Embedder) -> Result<T, WorkspaceError>,
) -> Result<T, WorkspaceError> {
    let global = read_global_config()?;
    let embedder = build_embedder(&global)?;

    operation(&embedder)
}

fn status_slug(status: &KnowledgeStatus) -> String {
    match status {
        KnowledgeStatus::Candidate => "candidate",
        KnowledgeStatus::Promoted => "promoted",
        KnowledgeStatus::Canonical => "canonical",
        KnowledgeStatus::Demoted => "demoted",
        KnowledgeStatus::Retired => "retired",
    }
    .to_string()
}

fn excerpt(content: &str) -> String {
    const LIMIT: usize = 280;
    let trimmed = content.trim();
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }

    let cut: String = trimmed.chars().take(LIMIT).collect();
    format!("{cut}…")
}

fn short_digest(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    format!("{digest:x}").chars().take(12).collect()
}

/// Who is credited with a review.
///
/// The local account name is the only identity this application has; it is
/// recorded so an adoption can be traced to someone, not to claim more
/// certainty about who they are than that.
fn current_reviewer() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "local-user".to_string())
}

/// The library file, for the panel's "show me where this lives".
pub fn library_location() -> Result<PathBuf, WorkspaceError> {
    crate::memory::engine::library_path()
}

/// Reopens the library. Used after a restore replaces the file underneath us.
pub fn reopen() {
    crate::memory::engine::close_library();
}
