//! What the write path reports back.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenEvidence {
    pub drawer_id: String,
    /// False when this material was already in the library. Writing the same
    /// thing twice is not an error; it just does not happen twice.
    pub created: bool,
    /// How long this write waited for another writer, so contention is visible
    /// rather than merely slow.
    pub lock_wait_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestOutcome {
    pub files: usize,
    pub chunks: usize,
    pub skipped: usize,
    pub room: String,
}
