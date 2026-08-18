//! Reading memory back: search, context, brief, and the recall that combines
//! them.
//!
//! Four surfaces, one shape. Every one of them needs the query as a vector, so
//! the query is embedded once, on the calling thread, *before* the library lock
//! is taken — embedding is the slow part and holding the lock through it would
//! serialize every window behind one CPU-bound model call. What runs under the
//! lock is the vector-taking half of the upstream API, which is why `recall` can
//! answer all three questions from a single consistent read.
//!
//! Recall is also where the one visible contract change lives: the body it
//! returns has no `working` and no `threads`. See `models::retrieval`.

use std::path::Path;

use mempal_runtime::brief::{brief_from_context, CognitiveBrief};
use mempal_runtime::context::{
    assemble_context_with_vector, ContextPack as UpstreamContextPack,
    ContextRequest as UpstreamContextRequest,
};
use mempal_runtime::core::anchor::DEFAULT_FIELD;
use mempal_runtime::core::db::Database;
use mempal_runtime::core::types::{
    AnchorKind, KnowledgeEvidenceRole, KnowledgeStatus, KnowledgeTier, MemoryDomain, MemoryKind,
    SearchResult,
};
use mempal_runtime::embed::Embedder;
use mempal_runtime::search::{resolve_route, search_with_vector_options, SearchOptions};

use crate::memory::config::{read_global_config, RetrievalConfig};
use crate::memory::engine::with_library;
use crate::memory::models::retrieval::{
    Brief, BriefFact, ContextAnchor, ContextItem, ContextPack, ContextQuery, EvidenceRef,
    RecallQuery, RecallResult, SearchHit, SearchRequest, Uncertainty,
};
use crate::models::WorkspaceError;

/// How much of a drawer's content a hit carries. Enough to recognise the thing
/// without shipping a whole file to a panel that will show three lines of it.
const SNIPPET_CHARS: usize = 400;

/// Hybrid search — BM25 and vectors, fused upstream — over the whole library.
///
/// Every hit carries both its `drawer_id` and a `source_file`, so anything this
/// returns can be traced back to what it was written from.
pub fn search<E: Embedder + ?Sized>(
    embedder: &E,
    request: &SearchRequest,
) -> Result<Vec<SearchHit>, WorkspaceError> {
    let defaults = read_global_config()?.retrieval;
    let top_k = request.top_k.unwrap_or(defaults.top_k);
    let query_vector = embed_query(embedder, &request.query)?;

    with_library(|database| search_in(database, request, &query_vector, top_k))
}

/// The context pack for a task: governed knowledge first, then material.
pub fn context<E: Embedder + ?Sized>(
    embedder: &E,
    root: &Path,
    request: &ContextQuery,
) -> Result<ContextPack, WorkspaceError> {
    let defaults = read_global_config()?.retrieval;
    let query_vector = embed_query(embedder, &request.query)?;

    with_library(|database| {
        let pack = context_pack_in(database, root, request, &defaults, &query_vector)?;
        Ok(context_dto(pack))
    })
}

/// A summary of that same pack, built by counting and quoting rather than by
/// asking a model. Same input, same output, every time.
pub fn brief<E: Embedder + ?Sized>(
    embedder: &E,
    root: &Path,
    request: &ContextQuery,
) -> Result<Brief, WorkspaceError> {
    let defaults = read_global_config()?.retrieval;
    let query_vector = embed_query(embedder, &request.query)?;

    with_library(|database| {
        let pack = context_pack_in(database, root, request, &defaults, &query_vector)?;
        Ok(brief_dto(brief_from_context(pack)))
    })
}

/// The single call an agent makes: context, brief, and hits from one read.
pub fn recall<E: Embedder + ?Sized>(
    embedder: &E,
    root: &Path,
    request: &RecallQuery,
) -> Result<RecallResult, WorkspaceError> {
    let defaults = read_global_config()?.retrieval;
    let query_vector = embed_query(embedder, &request.query)?;

    with_library(|database| recall_in(database, root, request, &defaults, &query_vector))
}

fn recall_in(
    database: &Database,
    root: &Path,
    request: &RecallQuery,
    defaults: &RetrievalConfig,
    query_vector: &[f32],
) -> Result<RecallResult, WorkspaceError> {
    let context_query = ContextQuery {
        query: request.query.clone(),
        max_items: request.max_items,
        dao_tian_limit: request.dao_tian_limit,
    };
    let search_request = SearchRequest {
        query: request.query.clone(),
        wing: request.wing.clone(),
        room: request.room.clone(),
        top_k: request.top_k,
    };
    let max_items = context_query.max_items.unwrap_or(defaults.context_max_items);
    let top_k = search_request.top_k.unwrap_or(defaults.top_k);

    // The brief is built from the pack we already assembled rather than from
    // upstream's `assemble_brief`, which would assemble a second one — with
    // `include_cards` forced on, and from a second embedding of the same query.
    let pack = context_pack_in(database, root, &context_query, defaults, query_vector)?;
    let brief = brief_dto(brief_from_context(pack.clone()));
    let context = context_dto(pack);
    let hits = search_in(database, &search_request, query_vector, top_k)?;

    let truncated = context.items.len() >= max_items || hits.len() >= top_k;

    Ok(RecallResult {
        context,
        brief,
        hits,
        truncated,
    })
}

fn search_in(
    database: &Database,
    request: &SearchRequest,
    query_vector: &[f32],
    top_k: usize,
) -> Result<Vec<SearchHit>, WorkspaceError> {
    let route = resolve_route(
        database,
        &request.query,
        request.wing.as_deref(),
        request.room.as_deref(),
    )
    .map_err(|error| library_error("failed to route the memory search", &error))?;

    let results = search_with_vector_options(
        database,
        &request.query,
        query_vector,
        route,
        SearchOptions::default(),
        top_k,
    )
    .map_err(|error| library_error("failed to search memory", &error))?;

    Ok(results.into_iter().map(hit_dto).collect())
}

fn context_pack_in(
    database: &Database,
    root: &Path,
    request: &ContextQuery,
    defaults: &RetrievalConfig,
    query_vector: &[f32],
) -> Result<UpstreamContextPack, WorkspaceError> {
    assemble_context_with_vector(
        database,
        upstream_context_request(root, request, defaults),
        query_vector,
    )
    .map_err(|error| library_error("failed to assemble memory context", &error))
}

/// Turns our request plus the configured budgets into the upstream request.
///
/// Four of these fields are fixed rather than exposed. `domain` is always
/// `Project` because agent- and skill-level memory has no counterpart in this
/// application; `field` is always `general` because the field taxonomy is a
/// read-only suggestion upstream and inventing categories nobody asked for would
/// only fragment retrieval; `include_evidence` is always on because material is
/// most of what there is to say; and distill suggestions are off because this
/// release has no surface that would act on them.
fn upstream_context_request(
    root: &Path,
    request: &ContextQuery,
    defaults: &RetrievalConfig,
) -> UpstreamContextRequest {
    UpstreamContextRequest {
        query: request.query.clone(),
        domain: MemoryDomain::Project,
        field: DEFAULT_FIELD.to_string(),
        cwd: root.to_path_buf(),
        include_evidence: true,
        include_cards: defaults.include_cards,
        max_items: request.max_items.unwrap_or(defaults.context_max_items),
        dao_tian_limit: request
            .dao_tian_limit
            .unwrap_or(defaults.dao_tian_limit),
        include_distill_suggestions: false,
    }
}

fn context_dto(pack: UpstreamContextPack) -> ContextPack {
    let items = pack
        .sections
        .into_iter()
        .flat_map(|section| {
            let name = section.name;
            section.items.into_iter().map(move |item| ContextItem {
                section: name.clone(),
                drawer_id: item.drawer_id,
                source_file: item.source_file,
                text: item.text,
                tier: item.tier.as_ref().map(tier_slug).map(str::to_string),
                status: item.status.as_ref().map(status_slug).map(str::to_string),
                anchor_kind: anchor_kind_slug(&item.anchor_kind).to_string(),
                anchor_id: item.anchor_id,
                evidence_refs: item
                    .evidence_citations
                    .into_iter()
                    .map(|citation| EvidenceRef {
                        drawer_id: citation.evidence_drawer_id,
                        role: role_slug(&citation.role).to_string(),
                        source_file: citation.source_file,
                    })
                    .collect(),
            })
        })
        .collect();

    ContextPack {
        query: pack.query,
        anchors: pack
            .anchors
            .into_iter()
            .map(|anchor| ContextAnchor {
                kind: anchor_kind_slug(&anchor.anchor_kind).to_string(),
                id: anchor.anchor_id,
            })
            .collect(),
        items,
    }
}

/// Flattens the upstream brief, dropping the parts that describe a feature this
/// release does not ship.
///
/// Knowledge cards are Phase-2 upstream and off here, so upstream's "no active
/// knowledge card was found" uncertainty and its matching next action are not
/// findings — they are a disabled feature reporting itself as a gap, in
/// vocabulary that means nothing to anyone reading the panel.
fn brief_dto(brief: CognitiveBrief) -> Brief {
    Brief {
        query: brief.query,
        summary: brief.summary.narrative,
        key_facts: brief
            .key_facts
            .into_iter()
            .map(|fact| BriefFact {
                text: fact.text,
                drawer_id: fact.citation.drawer_id,
                source_file: fact.citation.source_file,
            })
            .collect(),
        evidence: brief
            .evidence
            .into_iter()
            .map(|item| BriefFact {
                text: item.text,
                drawer_id: item.citation.drawer_id,
                source_file: item.citation.source_file,
            })
            .collect(),
        uncertainties: brief
            .uncertainty
            .into_iter()
            .filter(|item| item.kind != "no_cards")
            .map(|item| Uncertainty {
                kind: item.kind,
                message: item.message,
            })
            .collect(),
        next_actions: brief
            .next_actions
            .into_iter()
            .filter(|action| !mentions_knowledge_cards(action))
            .collect(),
    }
}

fn mentions_knowledge_cards(text: &str) -> bool {
    text.to_lowercase().contains("knowledge card")
}

fn hit_dto(result: SearchResult) -> SearchHit {
    SearchHit {
        drawer_id: result.drawer_id,
        source_file: result.source_file,
        snippet: snippet(&result.content),
        score: result.similarity,
        wing: result.wing,
        room: result.room,
        kind: kind_slug(&result.memory_kind).to_string(),
        tier: result.tier.as_ref().map(tier_slug).map(str::to_string),
        status: result.status.as_ref().map(status_slug).map(str::to_string),
    }
}

fn snippet(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.chars().count() <= SNIPPET_CHARS {
        return trimmed.to_string();
    }

    let head: String = trimmed.chars().take(SNIPPET_CHARS).collect();
    format!("{head}…")
}

fn embed_query<E: Embedder + ?Sized>(
    embedder: &E,
    query: &str,
) -> Result<Vec<f32>, WorkspaceError> {
    let vectors = crate::memory::engine::block_on(embedder.embed(&[query])).map_err(|error| {
        WorkspaceError::new(
            "embedding_failed",
            format!("failed to embed the memory query: {}", describe(&error)),
        )
    })?;

    vectors.into_iter().next().ok_or_else(|| {
        WorkspaceError::new(
            "embedding_failed",
            "the embedder returned no vector for the query",
        )
    })
}

fn library_error(what: &str, error: &dyn std::error::Error) -> WorkspaceError {
    WorkspaceError::new("memory_unavailable", format!("{what}: {}", describe(error)))
}

/// Renders an error together with its causes.
///
/// The upstream errors keep the interesting part — the SQL or embedding failure
/// — in `source()`, so a bare `to_string()` reads "failed to execute search
/// query" and tells nobody anything.
fn describe(error: &dyn std::error::Error) -> String {
    let mut rendered = error.to_string();
    let mut cause = error.source();
    while let Some(current) = cause {
        rendered.push_str(": ");
        rendered.push_str(&current.to_string());
        cause = current.source();
    }
    rendered
}

fn kind_slug(value: &MemoryKind) -> &'static str {
    match value {
        MemoryKind::Evidence => "evidence",
        MemoryKind::Knowledge => "knowledge",
    }
}

fn tier_slug(value: &KnowledgeTier) -> &'static str {
    match value {
        KnowledgeTier::Qi => "qi",
        KnowledgeTier::Shu => "shu",
        KnowledgeTier::DaoRen => "dao_ren",
        KnowledgeTier::DaoTian => "dao_tian",
    }
}

fn status_slug(value: &KnowledgeStatus) -> &'static str {
    match value {
        KnowledgeStatus::Candidate => "candidate",
        KnowledgeStatus::Promoted => "promoted",
        KnowledgeStatus::Canonical => "canonical",
        KnowledgeStatus::Demoted => "demoted",
        KnowledgeStatus::Retired => "retired",
    }
}

fn anchor_kind_slug(value: &AnchorKind) -> &'static str {
    match value {
        AnchorKind::Global => "global",
        AnchorKind::Repo => "repo",
        AnchorKind::Worktree => "worktree",
    }
}

fn role_slug(value: &KnowledgeEvidenceRole) -> &'static str {
    match value {
        KnowledgeEvidenceRole::Supporting => "supporting",
        KnowledgeEvidenceRole::Verification => "verification",
        KnowledgeEvidenceRole::Counterexample => "counterexample",
        KnowledgeEvidenceRole::Teaching => "teaching",
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use mempal_runtime::core::anchor::derive_anchor_from_cwd;
    use mempal_runtime::core::types::{
        AnchorKind, BootstrapEvidenceArgs, Drawer, KnowledgeStatus, KnowledgeTier, MemoryKind,
        SourceType,
    };
    use mempal_runtime::embed::{Embedder, Result as EmbedResult};

    use super::*;
    use crate::memory::config::GlobalMemoryConfig;

    const WING: &str = "notes-abc123";

    /// A deterministic stand-in for the real model.
    ///
    /// It has to be content-dependent — a constant vector makes every drawer
    /// equidistant and the ranking meaningless — and it must not touch the
    /// network, because a test that downloads a few hundred megabytes is not a
    /// test anyone will run.
    struct FixedEmbedder;

    const TEST_DIMENSIONS: usize = 16;

    fn test_vector(text: &str) -> Vec<f32> {
        let mut vector = vec![0.0_f32; TEST_DIMENSIONS];
        for byte in text.to_lowercase().bytes() {
            vector[usize::from(byte) % TEST_DIMENSIONS] += 1.0;
        }

        let length = vector
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        if length > 0.0 {
            for value in &mut vector {
                *value /= length;
            }
        }
        vector
    }

    impl Embedder for FixedEmbedder {
        fn embed<'life0, 'life1, 'life2, 'async_trait>(
            &'life0 self,
            texts: &'life1 [&'life2 str],
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = EmbedResult<Vec<Vec<f32>>>> + Send + 'async_trait>,
        >
        where
            'life0: 'async_trait,
            'life1: 'async_trait,
            'life2: 'async_trait,
            Self: 'async_trait,
        {
            let vectors = texts.iter().map(|text| test_vector(text)).collect();
            Box::pin(async move { Ok(vectors) })
        }

        fn dimensions(&self) -> usize {
            TEST_DIMENSIONS
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    /// A library nobody else is holding, so these tests can run alongside the
    /// rest of the suite instead of queueing behind a process-wide handle.
    struct Scratch {
        _dir: tempfile::TempDir,
        root: PathBuf,
        database: Database,
    }

    impl Scratch {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("scratch dir");
            let root = dir.path().join("workspace");
            std::fs::create_dir_all(&root).expect("workspace dir");
            let database = Database::open(&dir.path().join("palace.db")).expect("open library");

            Self {
                _dir: dir,
                root,
                database,
            }
        }

        fn worktree_anchor(&self) -> String {
            derive_anchor_from_cwd(Some(&self.root))
                .expect("derive an anchor for the workspace")
                .anchor_id
        }

        fn add_evidence(&self, id: &str, content: &str, source_file: &str) {
            let drawer = Drawer::new_bootstrap_evidence(BootstrapEvidenceArgs {
                id: id.to_string(),
                content: content.to_string(),
                wing: WING.to_string(),
                room: Some("notes".to_string()),
                source_file: Some(source_file.to_string()),
                source_type: SourceType::Project,
                added_at: "2026-08-17T09:00:00Z".to_string(),
                chunk_index: None,
                importance: 0,
            });
            self.insert(&drawer);
        }

        fn add_knowledge(&self, id: &str, statement: &str, tier: KnowledgeTier) {
            let mut drawer = Drawer::new_bootstrap_evidence(BootstrapEvidenceArgs {
                id: id.to_string(),
                content: statement.to_string(),
                wing: WING.to_string(),
                room: Some("review".to_string()),
                source_file: Some(format!("memory://{id}")),
                source_type: SourceType::Manual,
                added_at: "2026-08-17T09:00:00Z".to_string(),
                chunk_index: None,
                importance: 2,
            });
            drawer.memory_kind = MemoryKind::Knowledge;
            drawer.statement = Some(statement.to_string());
            drawer.tier = Some(tier);
            drawer.status = Some(KnowledgeStatus::Promoted);
            drawer.anchor_kind = AnchorKind::Worktree;
            drawer.anchor_id = self.worktree_anchor();
            drawer.parent_anchor_id = None;
            self.insert(&drawer);
        }

        fn insert(&self, drawer: &Drawer) {
            assert!(
                self.database.insert_drawer(drawer).expect("insert drawer"),
                "the test data collided on {}",
                drawer.id
            );
            self.database
                .insert_vector(&drawer.id, &test_vector(&drawer.content))
                .expect("insert vector");
        }
    }

    fn defaults() -> RetrievalConfig {
        GlobalMemoryConfig::default().retrieval
    }

    fn context_query(query: &str) -> ContextQuery {
        ContextQuery {
            query: query.to_string(),
            max_items: None,
            dao_tian_limit: None,
        }
    }

    #[test]
    fn the_fake_embedder_is_deterministic_and_fixed_width() {
        let once = embed_query(&FixedEmbedder, "pdf export").expect("embed");
        let again = embed_query(&FixedEmbedder, "pdf export").expect("embed");

        assert_eq!(once.len(), TEST_DIMENSIONS);
        assert_eq!(once, again);
        assert_ne!(
            once,
            embed_query(&FixedEmbedder, "font fallback").expect("embed"),
            "a content-independent vector would make ranking meaningless"
        );
    }

    #[test]
    fn every_hit_can_be_traced_back_to_a_source_file() {
        let scratch = Scratch::new();
        scratch.add_evidence(
            "ev_pdf",
            "pdf export embeds a font subset",
            "raw/pdf-export.md",
        );
        scratch.add_evidence(
            "ev_font",
            "font fallback covers missing glyphs",
            "raw/fonts.md",
        );

        let request = SearchRequest {
            query: "pdf export".to_string(),
            ..SearchRequest::default()
        };
        let hits = search_in(
            &scratch.database,
            &request,
            &test_vector("pdf export"),
            defaults().top_k,
        )
        .expect("search");

        assert!(!hits.is_empty(), "seeded material should be findable");
        for hit in &hits {
            assert!(!hit.drawer_id.is_empty(), "{hit:?}");
            assert!(!hit.source_file.is_empty(), "{hit:?}");
            assert_eq!(hit.wing, WING);
        }
        let traced = hits
            .iter()
            .find(|hit| hit.drawer_id == "ev_pdf")
            .expect("the pdf note is a hit");
        assert_eq!(traced.source_file, "raw/pdf-export.md");
        assert_eq!(traced.kind, "evidence");
        assert!(traced.snippet.contains("font subset"));
    }

    #[test]
    fn search_and_context_agree_on_what_they_cite() {
        let scratch = Scratch::new();
        scratch.add_evidence(
            "ev_pdf",
            "pdf export embeds a font subset",
            "raw/pdf-export.md",
        );
        scratch.add_evidence(
            "ev_pdf_two",
            "pdf export keeps page size from the document",
            "raw/pdf-pages.md",
        );

        let query = "pdf export";
        let vector = test_vector(query);
        let hits = search_in(
            &scratch.database,
            &SearchRequest {
                query: query.to_string(),
                ..SearchRequest::default()
            },
            &vector,
            defaults().top_k,
        )
        .expect("search");
        let pack = context_dto(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query(query),
                &defaults(),
                &vector,
            )
            .expect("context"),
        );

        assert!(!pack.items.is_empty(), "material should reach the pack");
        for item in &pack.items {
            let hit = hits
                .iter()
                .find(|hit| hit.drawer_id == item.drawer_id)
                .unwrap_or_else(|| {
                    panic!(
                        "{} is in the context pack but not in the hits for the same query",
                        item.drawer_id
                    )
                });
            assert_eq!(
                hit.source_file, item.source_file,
                "the two surfaces disagree about where {} came from",
                item.drawer_id
            );
        }
    }

    #[test]
    fn the_context_pack_keeps_the_top_tier_within_its_budget() {
        let scratch = Scratch::new();
        scratch.add_knowledge("kn_one", "pdf export always embeds a subset", KnowledgeTier::DaoTian);
        scratch.add_knowledge("kn_two", "pdf export never rasterizes text", KnowledgeTier::DaoTian);
        scratch.add_knowledge("kn_three", "pdf export writes one file", KnowledgeTier::DaoTian);

        let query = "pdf export";
        let vector = test_vector(query);
        let pack = context_dto(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query(query),
                &defaults(),
                &vector,
            )
            .expect("context"),
        );

        let top_tier = pack
            .items
            .iter()
            .filter(|item| item.section == "dao_tian")
            .count();
        assert_eq!(
            top_tier, 1,
            "the default budget is one; got {top_tier} of three candidates: {:?}",
            pack.items
        );

        // And the budget is the one we passed, not a constant that happens to
        // agree with the default.
        let widened = context_dto(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &ContextQuery {
                    query: query.to_string(),
                    max_items: None,
                    dao_tian_limit: Some(2),
                },
                &defaults(),
                &vector,
            )
            .expect("context"),
        );
        assert_eq!(
            widened
                .items
                .iter()
                .filter(|item| item.section == "dao_tian")
                .count(),
            2
        );
    }

    #[test]
    fn the_context_request_takes_its_budgets_from_configuration() {
        let configured = defaults();
        let request = upstream_context_request(
            Path::new("/workspace"),
            &context_query("pdf export"),
            &configured,
        );

        assert_eq!(request.max_items, 12);
        assert_eq!(request.dao_tian_limit, 1);
        assert!(
            !request.include_cards,
            "knowledge cards are off unless configuration turns them on"
        );
        assert_eq!(request.domain, MemoryDomain::Project);
        assert_eq!(request.field, "general");
        assert!(request.include_evidence);
        assert!(!request.include_distill_suggestions);
        assert_eq!(request.cwd, PathBuf::from("/workspace"));
    }

    #[test]
    fn explicit_request_values_win_over_configuration() {
        let request = upstream_context_request(
            Path::new("/workspace"),
            &ContextQuery {
                query: "pdf export".to_string(),
                max_items: Some(3),
                dao_tian_limit: Some(0),
            },
            &defaults(),
        );

        assert_eq!(request.max_items, 3);
        assert_eq!(request.dao_tian_limit, 0);
    }

    #[test]
    fn cards_follow_configuration_rather_than_being_hard_wired_off() {
        let mut configured = defaults();
        configured.include_cards = true;

        let request = upstream_context_request(
            Path::new("/workspace"),
            &context_query("pdf export"),
            &configured,
        );

        assert!(request.include_cards);
    }

    #[test]
    fn recall_answers_with_context_brief_and_hits_and_nothing_else() {
        let scratch = Scratch::new();
        scratch.add_evidence(
            "ev_pdf",
            "pdf export embeds a font subset",
            "raw/pdf-export.md",
        );
        scratch.add_knowledge(
            "kn_pdf",
            "pdf export always embeds a subset",
            KnowledgeTier::Shu,
        );

        let request = RecallQuery {
            query: "pdf export".to_string(),
            ..RecallQuery::default()
        };
        let result = recall_in(
            &scratch.database,
            &scratch.root,
            &request,
            &defaults(),
            &test_vector("pdf export"),
        )
        .expect("recall");

        assert!(!result.hits.is_empty());
        assert!(!result.context.items.is_empty());
        assert!(!result.brief.summary.is_empty());

        let body = serde_json::to_value(&result).expect("serialize recall");
        let object = body.as_object().expect("recall is an object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["brief", "context", "hits", "truncated"]);

        let rendered = serde_json::to_string(&result).expect("serialize recall");
        assert!(
            !rendered.contains("\"working\""),
            "working context was dropped as a concept: {rendered}"
        );
        assert!(
            !rendered.contains("\"threads\""),
            "conversations are material now and travel in hits: {rendered}"
        );
    }

    #[test]
    fn recall_reports_truncation_only_when_a_budget_was_spent() {
        let scratch = Scratch::new();
        for index in 0..4 {
            scratch.add_evidence(
                &format!("ev_{index}"),
                &format!("pdf export note number {index}"),
                &format!("raw/pdf-{index}.md"),
            );
        }
        let vector = test_vector("pdf export");

        let roomy = recall_in(
            &scratch.database,
            &scratch.root,
            &RecallQuery {
                query: "pdf export".to_string(),
                ..RecallQuery::default()
            },
            &defaults(),
            &vector,
        )
        .expect("recall");
        assert!(!roomy.truncated, "four items fit inside the default budgets");

        let tight = recall_in(
            &scratch.database,
            &scratch.root,
            &RecallQuery {
                query: "pdf export".to_string(),
                max_items: Some(2),
                top_k: Some(2),
                ..RecallQuery::default()
            },
            &defaults(),
            &vector,
        )
        .expect("recall");
        assert!(tight.truncated);
        assert_eq!(tight.context.items.len(), 2);
        assert_eq!(tight.hits.len(), 2);
    }

    #[test]
    fn an_empty_library_answers_all_four_surfaces_without_failing() {
        let scratch = Scratch::new();
        let query = "pdf export";
        let vector = test_vector(query);

        let hits = search_in(
            &scratch.database,
            &SearchRequest {
                query: query.to_string(),
                ..SearchRequest::default()
            },
            &vector,
            defaults().top_k,
        )
        .expect("search an empty library");
        assert!(hits.is_empty());

        let pack = context_dto(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query(query),
                &defaults(),
                &vector,
            )
            .expect("assemble from an empty library"),
        );
        assert!(pack.items.is_empty());
        assert!(
            !pack.anchors.is_empty(),
            "an empty answer should still say where it looked"
        );

        let brief = brief_dto(brief_from_context(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query(query),
                &defaults(),
                &vector,
            )
            .expect("assemble from an empty library"),
        ));
        assert!(brief.key_facts.is_empty());
        assert!(brief.evidence.is_empty());
        assert!(
            !brief.summary.is_empty(),
            "an empty brief still has to say that it is empty"
        );

        let recall = recall_in(
            &scratch.database,
            &scratch.root,
            &RecallQuery {
                query: query.to_string(),
                ..RecallQuery::default()
            },
            &defaults(),
            &vector,
        )
        .expect("recall from an empty library");
        assert!(recall.hits.is_empty());
        assert!(recall.context.items.is_empty());
        assert!(!recall.truncated);
    }

    #[test]
    fn the_brief_cites_the_material_it_summarizes() {
        let scratch = Scratch::new();
        scratch.add_evidence(
            "ev_pdf",
            "pdf export embeds a font subset",
            "raw/pdf-export.md",
        );
        scratch.add_knowledge(
            "kn_pdf",
            "pdf export always embeds a subset",
            KnowledgeTier::Shu,
        );
        let vector = test_vector("pdf export");

        let brief = brief_dto(brief_from_context(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query("pdf export"),
                &defaults(),
                &vector,
            )
            .expect("context"),
        ));

        let fact = brief
            .key_facts
            .iter()
            .find(|fact| fact.drawer_id == "kn_pdf")
            .expect("the promoted conclusion is a key fact");
        assert_eq!(fact.text, "pdf export always embeds a subset");
        assert_eq!(fact.source_file, "memory://kn_pdf");

        let cited = brief
            .evidence
            .iter()
            .find(|item| item.drawer_id == "ev_pdf")
            .expect("the material is cited as evidence");
        assert_eq!(cited.source_file, "raw/pdf-export.md");
    }

    #[test]
    fn the_brief_does_not_report_a_disabled_feature_as_a_gap() {
        let scratch = Scratch::new();
        let vector = test_vector("pdf export");

        let brief = brief_dto(brief_from_context(
            context_pack_in(
                &scratch.database,
                &scratch.root,
                &context_query("pdf export"),
                &defaults(),
                &vector,
            )
            .expect("context"),
        ));

        assert!(
            !brief
                .uncertainties
                .iter()
                .any(|item| item.kind == "no_cards"),
            "{:?}",
            brief.uncertainties
        );
        let rendered = serde_json::to_string(&brief).expect("serialize brief");
        assert!(
            !rendered.to_lowercase().contains("knowledge card"),
            "cards are not part of this release: {rendered}"
        );
        // The findings that do apply are still reported.
        assert!(
            brief
                .uncertainties
                .iter()
                .any(|item| item.kind == "no_evidence"),
            "{:?}",
            brief.uncertainties
        );
    }

    #[test]
    fn a_long_snippet_is_cut_on_a_character_boundary() {
        let content = "记忆".repeat(400);

        let cut = snippet(&content);

        assert_eq!(cut.chars().count(), SNIPPET_CHARS + 1);
        assert!(cut.ends_with('…'));
        assert_eq!(snippet("  short  "), "short");
    }

    /// The four public entry points, exercised through the real library handle.
    ///
    /// The tests above call the `*_in` helpers with their own database, which
    /// covers the behaviour but not the wiring. These go through
    /// `with_library`, so a wrapper that read the wrong config or lost the
    /// workspace root on the way in would be caught here.
    mod public_surface {
        use super::*;
        use crate::memory::config::testing::with_scoped_home;

        #[test]
        fn an_empty_library_answers_all_four_surfaces() {
            with_scoped_home(|_home| {
                let workspace = tempfile::tempdir().expect("workspace");
                let root = workspace.path();

                let hits = search(
                    &FixedEmbedder,
                    &SearchRequest {
                        query: "anything at all".to_string(),
                        top_k: None,
                        wing: None,
                        room: None,
                    },
                )
                .expect("search answers");
                assert!(hits.is_empty());

                let query = ContextQuery {
                    query: "anything at all".to_string(),
                    max_items: None,
                    dao_tian_limit: None,
                };
                let pack = context(&FixedEmbedder, root, &query).expect("context answers");
                assert!(pack.items.is_empty());

                let brief_result = brief(&FixedEmbedder, root, &query).expect("brief answers");
                assert!(brief_result.key_facts.is_empty());

                let recalled = recall(
                    &FixedEmbedder,
                    root,
                    &RecallQuery {
                        query: "anything at all".to_string(),
                        wing: None,
                        room: None,
                        top_k: None,
                        max_items: None,
                        dao_tian_limit: None,
                    },
                )
                .expect("recall answers");
                assert!(recalled.hits.is_empty());
                assert!(recalled.context.items.is_empty());
            });
        }

        #[test]
        fn recall_carries_no_trace_of_the_abandoned_concepts() {
            with_scoped_home(|_home| {
                let workspace = tempfile::tempdir().expect("workspace");

                let recalled = recall(
                    &FixedEmbedder,
                    workspace.path(),
                    &RecallQuery {
                        query: "what was decided".to_string(),
                        wing: None,
                        room: None,
                        top_k: None,
                        max_items: None,
                        dao_tian_limit: None,
                    },
                )
                .expect("recall answers");

                let rendered = serde_json::to_string(&recalled).expect("serialize");
                assert!(!rendered.contains("working"), "{rendered}");
                assert!(!rendered.contains("threads"), "{rendered}");
            });
        }
    }
}
