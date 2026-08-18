//! Turning material into conclusions, and deciding which conclusions count.
//!
//! A conclusion starts as a candidate distilled from material the user picked.
//! It only reaches the agent's working context after someone adopts it, and
//! adopting writes a record of that review into the library as the verification
//! the upstream gate demands.
//!
//! Be clear-eyed about what the gate is here. Upstream designed it to filter on
//! accumulated evidence; because adoption manufactures its own verification,
//! what it actually enforces is "a person looked at this, and no counterexample
//! is attached". That is bookkeeping with an audit trail, not a filter — the
//! trade recorded in the detailed design. Everything below is written so the
//! record is true: the confirmation names who adopted what and when, and it is
//! a real drawer anyone can read back.

use std::path::Path;

use mempal_runtime::core::db::Database;
use mempal_runtime::core::types::{KnowledgeStatus, MemoryKind, SourceType};
use mempal_runtime::embed::Embedder;
use mempal_runtime::knowledge_distill::{commit_distill, prepare_distill, DistillPlan, DistillRequest};
use mempal_runtime::knowledge_gate::{evaluate_gate_by_id, GateReport};
use mempal_runtime::knowledge_lifecycle::{
    demote_knowledge, promote_knowledge, DemoteRequest, PromoteRequest,
};

use crate::memory::engine::embed_one;
use crate::memory::evidence::{synthetic_source, write_text, TextEvidence, REVIEW_ROOM};
use crate::memory::models::knowledge::{AdoptedConclusion, DistilledConclusion, RetiredConclusion};
use crate::models::WorkspaceError;

/// The two tiers a conclusion can be created at.
///
/// Upstream allows exactly these two at distill time — `shu` and `dao_tian` are
/// refused outright — so the product offers what actually exists rather than a
/// vocabulary that fails at the boundary. `Pattern` is deliberately harder to
/// reach: its gate wants two independent pieces of supporting material, which
/// is the point of calling something a pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConclusionTier {
    /// One concrete thing that is true of this project.
    Concrete,
    /// A regularity claimed across several pieces of material.
    Pattern,
}

impl ConclusionTier {
    fn slug(self) -> &'static str {
        match self {
            Self::Concrete => "qi",
            Self::Pattern => "dao_ren",
        }
    }
}

pub struct DistillArgs<'a> {
    pub workspace_root: &'a Path,
    pub wing: &'a str,
    pub room: &'a str,
    /// The one-line claim. This is what a later session sees first.
    pub statement: String,
    pub body: String,
    pub tier: ConclusionTier,
    /// Material this conclusion came from; becomes its supporting evidence.
    pub supporting_refs: Vec<String>,
}

/// Creates a candidate conclusion from material already in the library.
///
/// The references are not decoration: upstream refuses ids that do not resolve
/// to stored material, which is what keeps a conclusion attached to something
/// real.
pub fn distill<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    args: DistillArgs<'_>,
) -> Result<DistilledConclusion, WorkspaceError> {
    if args.supporting_refs.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_evidence_ref",
            "a conclusion has to come from at least one piece of material",
        ));
    }

    let request = DistillRequest {
        statement: args.statement,
        content: args.body,
        tier: args.tier.slug().to_string(),
        supporting_refs: args.supporting_refs,
        wing: args.wing.to_string(),
        room: args.room.to_string(),
        domain: "project".to_string(),
        field: "general".to_string(),
        cwd: Some(args.workspace_root.to_path_buf()),
        scope_constraints: None,
        counterexample_refs: Vec::new(),
        teaching_refs: Vec::new(),
        trigger_hints: None,
        importance: 2,
        dry_run: false,
    };

    let plan = prepare_distill(database, request).map_err(|error| distill_error(&error))?;

    match plan {
        DistillPlan::Done(outcome) => Ok(DistilledConclusion {
            drawer_id: outcome.drawer_id,
            created: outcome.created,
        }),
        DistillPlan::Create(prepared) => {
            let vector = embed_one(embedder, &prepared.content)?;
            let outcome = commit_distill(database, *prepared, &vector).map_err(|error| {
                WorkspaceError::new(
                    "memory_unavailable",
                    format!("failed to store the conclusion: {error}"),
                )
            })?;

            Ok(DistilledConclusion {
                drawer_id: outcome.drawer_id,
                created: outcome.created,
            })
        }
    }
}

/// Reports whether a conclusion could be adopted, and what is missing if not.
pub fn gate(database: &Database, drawer_id: &str) -> Result<GateReport, WorkspaceError> {
    evaluate_gate_by_id(database, drawer_id, None, None, false).map_err(|error| {
        WorkspaceError::new(
            "gate_failed",
            format!("failed to evaluate {drawer_id}: {error}"),
        )
    })
}

pub struct AdoptArgs<'a> {
    pub workspace_root: &'a Path,
    pub wing: &'a str,
    pub drawer_id: &'a str,
    /// Who is adopting. Recorded in the confirmation so the audit names a person.
    pub reviewer: &'a str,
    pub note: Option<String>,
}

/// Adopts a conclusion: records the review, then promotes behind the gate.
///
/// The confirmation is written first and on purpose. If promotion then fails
/// the library holds a record of a review that did not take — which is honest —
/// rather than a promotion with no reviewer behind it.
pub fn adopt<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    args: AdoptArgs<'_>,
) -> Result<AdoptedConclusion, WorkspaceError> {
    let drawer = database
        .get_drawer(args.drawer_id)
        .map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to look up {}: {error}", args.drawer_id),
            )
        })?
        .ok_or_else(|| {
            WorkspaceError::new(
                "invalid_evidence_ref",
                format!("there is no conclusion with id {}", args.drawer_id),
            )
        })?;

    if drawer.memory_kind != MemoryKind::Knowledge {
        return Err(WorkspaceError::new(
            "invalid_evidence_ref",
            format!("{} is material, not a conclusion", args.drawer_id),
        ));
    }

    let statement = drawer.statement.clone().unwrap_or_default();
    let confirmation = write_text(
        database,
        embedder,
        TextEvidence {
            workspace_root: args.workspace_root,
            wing: args.wing,
            room: REVIEW_ROOM,
            content: confirmation_record(&ConfirmationRecord {
                drawer_id: args.drawer_id,
                statement: &statement,
                reviewer: args.reviewer,
                reviewed_evidence: &drawer.supporting_refs,
                note: args.note.as_deref(),
            }),
            source_type: SourceType::Manual,
            source_file: Some(synthetic_source("review", args.drawer_id)),
            importance: 1,
        },
    )?;

    let outcome = promote_knowledge(
        database,
        PromoteRequest {
            drawer_id: args.drawer_id.to_string(),
            status: KnowledgeStatus::Promoted.slug_for_request(),
            verification_refs: vec![confirmation.drawer_id.clone()],
            reason: args
                .note
                .clone()
                .unwrap_or_else(|| "adopted from the memory panel".to_string()),
            reviewer: Some(args.reviewer.to_string()),
            allow_counterexamples: false,
            enforce_gate: true,
        },
    )
    .map_err(|error| {
        WorkspaceError::new(
            "gate_failed",
            // Upstream's reasons are the only useful thing here, so they are
            // passed through untouched rather than summarised into a shrug.
            format!("{error}"),
        )
    })?;

    Ok(AdoptedConclusion {
        drawer_id: outcome.drawer_id,
        status: outcome.new_status,
        confirmation_drawer_id: confirmation.drawer_id,
    })
}

/// Why a conclusion is being taken out of circulation.
///
/// Upstream fixes this vocabulary, and it is worth surfacing rather than
/// flattening: "this was contradicted" and "this was superseded" are different
/// stories, and the audit log is where someone later goes looking for which one
/// happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetireReason {
    Contradicted,
    Obsolete,
    Superseded,
    OutOfScope,
    Unsafe,
}

impl RetireReason {
    fn slug(self) -> &'static str {
        match self {
            Self::Contradicted => "contradicted",
            Self::Obsolete => "obsolete",
            Self::Superseded => "superseded",
            Self::OutOfScope => "out_of_scope",
            Self::Unsafe => "unsafe",
        }
    }
}

/// Takes a conclusion back out of circulation.
pub fn demote(
    database: &Database,
    drawer_id: &str,
    retire: bool,
    evidence_refs: Vec<String>,
    reason_type: RetireReason,
    reason: String,
) -> Result<RetiredConclusion, WorkspaceError> {
    if evidence_refs.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_evidence_ref",
            "retiring a conclusion needs the material that shows it no longer holds",
        ));
    }

    let outcome = demote_knowledge(
        database,
        DemoteRequest {
            drawer_id: drawer_id.to_string(),
            status: if retire { "retired" } else { "demoted" }.to_string(),
            evidence_refs,
            reason,
            reason_type: reason_type.slug().to_string(),
        },
    )
    .map_err(|error| {
        WorkspaceError::new(
            "invalid_evidence_ref",
            format!("failed to retire {drawer_id}: {error}"),
        )
    })?;

    Ok(RetiredConclusion {
        drawer_id: outcome.drawer_id,
        status: outcome.new_status,
    })
}

/// Records a counterexample and attaches it to a conclusion.
///
/// This is the only way the second half of the gate — "a counterexample blocks
/// promotion" — can ever fire, because nothing else in this product produces
/// counterexamples.
pub fn add_counterexample<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    workspace_root: &Path,
    wing: &str,
    drawer_id: &str,
    body: String,
) -> Result<GateReport, WorkspaceError> {
    let drawer = database
        .get_drawer(drawer_id)
        .map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to look up {drawer_id}: {error}"),
            )
        })?
        .ok_or_else(|| {
            WorkspaceError::new(
                "invalid_evidence_ref",
                format!("there is no conclusion with id {drawer_id}"),
            )
        })?;

    let counterexample = write_text(
        database,
        embedder,
        TextEvidence {
            workspace_root,
            wing,
            room: REVIEW_ROOM,
            content: body,
            source_type: SourceType::Manual,
            source_file: Some(synthetic_source("counterexample", drawer_id)),
            importance: 1,
        },
    )?;

    let mut counterexample_refs = drawer.counterexample_refs.clone();
    if !counterexample_refs.contains(&counterexample.drawer_id) {
        counterexample_refs.push(counterexample.drawer_id.clone());
    }
    let status = drawer.status.clone().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_evidence_ref",
            format!("{drawer_id} has no lifecycle status to update"),
        )
    })?;

    database
        .update_knowledge_lifecycle(
            drawer_id,
            &status,
            &drawer.verification_refs,
            &counterexample_refs,
        )
        .map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to attach the counterexample: {error}"),
            )
        })?;

    gate(database, drawer_id)
}

struct ConfirmationRecord<'a> {
    drawer_id: &'a str,
    statement: &'a str,
    reviewer: &'a str,
    reviewed_evidence: &'a [String],
    note: Option<&'a str>,
}

/// The text of a human confirmation.
///
/// Written as plain lines rather than an opaque blob because it ends up in
/// search results like everything else, and "who accepted this and when" should
/// be readable there.
fn confirmation_record(record: &ConfirmationRecord<'_>) -> String {
    let mut text = String::from("adoption confirmation\n");
    text.push_str(&format!("confirmed_at: {}\n", now_rfc3339()));
    text.push_str(&format!("confirmed_by: {}\n", record.reviewer));
    text.push_str(&format!("conclusion: {}\n", record.drawer_id));
    text.push_str(&format!("statement: {}\n", record.statement));
    text.push_str(&format!(
        "reviewed_evidence: {}\n",
        record.reviewed_evidence.join(", ")
    ));
    if let Some(note) = record.note {
        text.push_str(&format!("note: {note}\n"));
    }

    text
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

fn distill_error(error: &impl std::fmt::Display) -> WorkspaceError {
    let message = error.to_string();
    let code = if message.contains("refs") || message.contains("drawer") {
        "invalid_evidence_ref"
    } else {
        "invalid_conclusion"
    };

    WorkspaceError::new(code, message)
}

/// Upstream takes the target status as a string; this keeps the spelling in one
/// place instead of scattering literals.
trait StatusSlug {
    fn slug_for_request(&self) -> String;
}

impl StatusSlug for KnowledgeStatus {
    fn slug_for_request(&self) -> String {
        match self {
            KnowledgeStatus::Candidate => "candidate",
            KnowledgeStatus::Promoted => "promoted",
            KnowledgeStatus::Canonical => "canonical",
            KnowledgeStatus::Demoted => "demoted",
            KnowledgeStatus::Retired => "retired",
        }
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::engine::{library_path, wing_for};
    use crate::memory::evidence::{write_text as write_material, SESSION_ROOM};

    struct FixedEmbedder;

    #[async_trait::async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, texts: &[&str]) -> mempal_runtime::embed::Result<Vec<Vec<f32>>> {
            Ok(texts
                .iter()
                .map(|text| vec![text.len() as f32, 0.2, 0.3, 0.4])
                .collect())
        }

        fn dimensions(&self) -> usize {
            4
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    struct Fixture {
        database: Database,
        workspace: tempfile::TempDir,
        wing: String,
    }

    impl Fixture {
        fn new() -> Self {
            let workspace = tempfile::tempdir().expect("workspace");
            let wing = wing_for(workspace.path()).expect("wing");
            let path = library_path().expect("library path");
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            let database = Database::open(&path).expect("open library");

            Self {
                database,
                workspace,
                wing,
            }
        }

        fn material(&self, content: &str) -> String {
            write_material(
                &self.database,
                &FixedEmbedder,
                TextEvidence {
                    workspace_root: self.workspace.path(),
                    wing: &self.wing,
                    room: SESSION_ROOM,
                    content: content.to_string(),
                    source_type: SourceType::Conversation,
                    source_file: Some(synthetic_source("session", content)),
                    importance: 1,
                },
            )
            .expect("material")
            .drawer_id
        }

        fn distill_one(&self, supporting: Vec<String>) -> String {
            distill(
                &self.database,
                &FixedEmbedder,
                DistillArgs {
                    workspace_root: self.workspace.path(),
                    wing: &self.wing,
                    room: "review",
                    statement: "PDF export embeds a font subset".to_string(),
                    body: "Exports carry a subset of a system CJK face.".to_string(),
                    tier: ConclusionTier::Concrete,
                    supporting_refs: supporting,
                },
            )
            .expect("distill")
            .drawer_id
        }
    }

    #[test]
    fn a_conclusion_needs_material_behind_it() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();

            let error = distill(
                &fixture.database,
                &FixedEmbedder,
                DistillArgs {
                    workspace_root: fixture.workspace.path(),
                    wing: &fixture.wing,
                    room: "review",
                    statement: "unsupported claim".to_string(),
                    body: "nothing backs this".to_string(),
                    tier: ConclusionTier::Concrete,
                    supporting_refs: Vec::new(),
                },
            )
            .expect_err("must refuse");

            assert_eq!(error.error_code(), "invalid_evidence_ref");
        });
    }

    #[test]
    fn a_reference_to_material_that_does_not_exist_is_refused() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();

            let error = distill(
                &fixture.database,
                &FixedEmbedder,
                DistillArgs {
                    workspace_root: fixture.workspace.path(),
                    wing: &fixture.wing,
                    room: "review",
                    statement: "claims to be backed".to_string(),
                    body: "by material that was never stored".to_string(),
                    tier: ConclusionTier::Concrete,
                    supporting_refs: vec!["ev_does_not_exist".to_string()],
                },
            )
            .expect_err("must refuse");

            assert_eq!(error.error_code(), "invalid_evidence_ref");
        });
    }

    #[test]
    fn a_fresh_candidate_cannot_pass_the_gate_on_its_own() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();
            let material = fixture.material("we measured the exported PDF");
            let conclusion = fixture.distill_one(vec![material]);

            let report = gate(&fixture.database, &conclusion).expect("gate");

            assert!(!report.allowed, "no verification has been recorded yet");
            assert_eq!(report.evidence_counts.supporting, 1);
            assert_eq!(report.evidence_counts.verification, 0);
            assert!(!report.reasons.is_empty(), "the gate must say what is missing");
        });
    }

    #[test]
    fn adopting_records_the_review_and_promotes_it() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();
            let material = fixture.material("we measured the exported PDF");
            let conclusion = fixture.distill_one(vec![material.clone()]);

            let adopted = adopt(
                &fixture.database,
                &FixedEmbedder,
                AdoptArgs {
                    workspace_root: fixture.workspace.path(),
                    wing: &fixture.wing,
                    drawer_id: &conclusion,
                    reviewer: "local-user",
                    note: Some("checked against the rendered page".to_string()),
                },
            )
            .expect("adopt");

            assert_eq!(adopted.status, "promoted");

            // The verification is a real, readable record — not a token.
            let confirmation = fixture
                .database
                .get_drawer(&adopted.confirmation_drawer_id)
                .expect("lookup")
                .expect("stored");
            assert!(confirmation.content.contains("confirmed_by: local-user"));
            assert!(confirmation.content.contains(&conclusion));
            assert!(confirmation.content.contains(&material));
            assert!(confirmation.content.contains("checked against the rendered page"));

            let report = gate(&fixture.database, &conclusion).expect("gate");
            assert_eq!(report.evidence_counts.verification, 1);
        });
    }

    #[test]
    fn a_counterexample_blocks_a_conclusion_and_demotion_needs_evidence() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();
            let material = fixture.material("we measured the exported PDF");
            let conclusion = fixture.distill_one(vec![material]);

            let report = add_counterexample(
                &fixture.database,
                &FixedEmbedder,
                fixture.workspace.path(),
                &fixture.wing,
                &conclusion,
                "a Songti-only machine exported blanks".to_string(),
            )
            .expect("counterexample");

            assert!(!report.allowed, "a counterexample must block promotion");
            assert_eq!(report.evidence_counts.counterexample, 1);

            let refused = adopt(
                &fixture.database,
                &FixedEmbedder,
                AdoptArgs {
                    workspace_root: fixture.workspace.path(),
                    wing: &fixture.wing,
                    drawer_id: &conclusion,
                    reviewer: "local-user",
                    note: None,
                },
            )
            .expect_err("adoption must be refused");
            assert_eq!(refused.error_code(), "gate_failed");
            assert!(
                refused.to_string().contains("counterexample"),
                "the reason should survive: {refused}"
            );

            let without_evidence =
                demote(
                    &fixture.database,
                    &conclusion,
                    true,
                    Vec::new(),
                    RetireReason::Contradicted,
                    "gut feeling".to_string(),
                )
                    .expect_err("must refuse");
            assert_eq!(without_evidence.error_code(), "invalid_evidence_ref");
        });
    }

    #[test]
    fn retiring_a_conclusion_records_why() {
        with_scoped_home(|_home| {
            let fixture = Fixture::new();
            let material = fixture.material("we measured the exported PDF");
            let conclusion = fixture.distill_one(vec![material.clone()]);

            let retired = demote(
                &fixture.database,
                &conclusion,
                true,
                vec![material],
                RetireReason::Superseded,
                "superseded by the platform renderer".to_string(),
            )
            .expect("retire");

            assert_eq!(retired.status, "retired");
        });
    }
}
