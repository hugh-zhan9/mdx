//! Wire types for the four read surfaces: search, context, brief, recall.
//!
//! These are the shapes that leave the memory layer. Nothing upstream appears
//! here — the engine's own types carry enum values and helper structs that would
//! otherwise become part of the command contract, and one of them (the tier
//! ladder) is deliberately not product vocabulary. Everything is flattened to
//! strings the command surface can hand to a panel or an agent unchanged.
//!
//! `RecallResult` is the one contract change users can notice. It used to carry
//! `working` and `threads`; both concepts are gone, so both fields are gone.
//! There is no alias and no shim: an agent skill written against the old body
//! gets a hard error rather than a quietly empty answer.

use serde::{Deserialize, Serialize};

/// What `search` was asked to look for.
///
/// `wing` and `room` are left unset by default, which lets the engine route the
/// query itself and search across projects. Callers that mean "only this
/// project" have to say so.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub wing: Option<String>,
    #[serde(default)]
    pub room: Option<String>,
    /// Falls back to the global configuration's `topK`.
    #[serde(default)]
    pub top_k: Option<usize>,
}

/// What `context` and `brief` were asked for.
///
/// The workspace root is not in here on purpose: it is the caller's own state,
/// not something a client should be able to point somewhere else.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextQuery {
    pub query: String,
    /// Falls back to the global configuration's `contextMaxItems`.
    #[serde(default)]
    pub max_items: Option<usize>,
    /// Falls back to the global configuration's `daoTianLimit`.
    #[serde(default)]
    pub dao_tian_limit: Option<usize>,
}

/// What `recall` was asked for: the union of the three surfaces it combines.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallQuery {
    pub query: String,
    #[serde(default)]
    pub wing: Option<String>,
    #[serde(default)]
    pub room: Option<String>,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
    #[serde(default)]
    pub dao_tian_limit: Option<usize>,
}

/// One search hit, with enough on it to open the thing it came from.
///
/// `drawer_id` and `source_file` are both always present — a hit nobody can
/// trace back to a file is a hit nobody can check.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub drawer_id: String,
    pub source_file: String,
    pub snippet: String,
    pub score: f32,
    pub wing: String,
    pub room: Option<String>,
    /// `evidence` or `knowledge`.
    pub kind: String,
    pub tier: Option<String>,
    pub status: Option<String>,
}

/// The assembled context pack: what a task should know before it starts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub query: String,
    pub anchors: Vec<ContextAnchor>,
    pub items: Vec<ContextItem>,
}

/// Where the pack looked. Useful when the answer is empty and the question is
/// "did it look in the right place".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAnchor {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    /// The group this item was assembled into, in assembly order:
    /// `dao_tian`, `dao_ren`, `shu`, `qi`, `evidence`. It is a grouping key for
    /// the caller, not a label to show anyone — the panel has its own words.
    pub section: String,
    pub drawer_id: String,
    pub source_file: String,
    pub text: String,
    pub tier: Option<String>,
    pub status: Option<String>,
    pub anchor_kind: String,
    pub anchor_id: String,
    pub evidence_refs: Vec<EvidenceRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRef {
    pub drawer_id: String,
    /// `supporting`, `verification`, `counterexample`, or `teaching`.
    pub role: String,
    pub source_file: String,
}

/// A deterministic summary of the context pack. No model is called to build it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brief {
    pub query: String,
    pub summary: String,
    pub key_facts: Vec<BriefFact>,
    pub evidence: Vec<BriefFact>,
    pub uncertainties: Vec<Uncertainty>,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefFact {
    pub text: String,
    pub drawer_id: String,
    pub source_file: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Uncertainty {
    pub kind: String,
    pub message: String,
}

/// The single entry point an agent calls: context, summary, and hits together.
///
/// There is no `working` field and no `threads` field. Working context was
/// dropped as a concept, and a conversation is now ordinary material, so it
/// arrives through `hits` like everything else.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallResult {
    pub context: ContextPack,
    pub brief: Brief,
    pub hits: Vec<SearchHit>,
    /// True when either budget was spent in full, so there may be more memory
    /// that this answer left out.
    pub truncated: bool,
}
