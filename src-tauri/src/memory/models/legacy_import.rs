//! What the one-time import of an old memory directory reports back.
//!
//! Two shapes, one for each half of the "preflight then run" pattern this
//! product already uses elsewhere. Both are deliberately explicit about what is
//! *not* imported: the inbox and the working note are abandoned concepts, and a
//! user who sees their counts drop without explanation will reasonably conclude
//! that memory was lost.
//!
//! Both types deserialize as well as serialize, because the report is written to
//! disk and read back — by the panel, and by anyone comparing two runs.

use serde::{Deserialize, Serialize};

/// The sentence the report has to carry.
///
/// Importing produces material, never conclusions. Nothing in an old
/// `memory/memories/*.md` file was ever reviewed against the gate this product
/// now applies, so promoting it wholesale would launder unverified notes into
/// conclusions.
pub const MATERIAL_NOT_CONCLUSIONS: &str =
    "Everything imported is material, not conclusions. Nothing was promoted: pick what is worth \
     distilling and adopt it deliberately.";

/// Why the two abandoned parts of the old directory stay out.
pub const NOT_IMPORTED_REASON: &str =
    "The inbox held entries nobody had confirmed, and the working note held content that was \
     rewritten constantly. Neither concept exists any more, so neither is imported. The old \
     directory is left untouched on disk.";

/// What an import would do, without doing any of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportPreflight {
    pub root_path: String,
    /// `memory/memories/**.md`, which become material.
    pub memories: usize,
    /// `memory/threads/**.md`, which become material.
    pub threads: usize,
    /// `memory/inbox/**.md`. Counted so the number is visible, never imported.
    pub inbox: usize,
    /// Whether `memory/working.md` is there. Never imported either.
    pub working: bool,
    /// Total size of the files that would be read, which is the only honest
    /// predictor of how long embedding them will take.
    pub estimated_bytes: u64,
    /// False means the run would fail immediately: material cannot be stored
    /// without the embedding model.
    pub model_ready: bool,
    pub note: String,
}

/// What an import actually did.
///
/// The counts separate three outcomes that a single "imported" number would
/// blur: files whose text entered the library on this run, files that were
/// already there in full (a re-run), and files that failed. The three plus
/// nothing else add up to `files_scanned`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportReport {
    pub root_path: String,
    pub wing: String,
    pub started_at: String,
    pub finished_at: String,
    /// Every `.md` file the preflight promised, so the two numbers can be
    /// compared directly.
    pub files_scanned: usize,
    /// Files that put at least one new entry in the library.
    pub files_imported: usize,
    /// Files already in the library in full. A second run reports every file
    /// here and nothing under `files_imported`.
    pub files_unchanged: usize,
    pub files_failed: usize,
    pub entries_created: usize,
    pub entries_already_present: usize,
    pub not_imported: LegacyNotImported,
    /// One entry per file that could not be read or stored. The rest of the
    /// import still happened.
    pub failures: Vec<LegacyImportFailure>,
    /// The newest material this run produced, so the user has somewhere to
    /// start choosing what to distill.
    pub recent: Vec<LegacyImportedEntry>,
    pub report_path: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyNotImported {
    pub inbox: usize,
    pub working: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportFailure {
    /// Relative to the workspace root, the way the user sees it in the tree.
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportedEntry {
    pub drawer_id: String,
    pub source_file: String,
    pub room: String,
    pub added_at: String,
}
