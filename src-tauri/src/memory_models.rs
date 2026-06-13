use std::collections::BTreeMap;

use serde::{de, Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryWorkspaceStatus {
    pub mode: String,
    pub has_memory: bool,
    pub can_initialize: bool,
    pub missing_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct InitializeMemoryResult {
    pub created_paths: Vec<String>,
    pub preserved_paths: Vec<String>,
    pub status: MemoryWorkspaceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRepairRequest {
    pub rebuild_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRepairResult {
    pub repaired_paths: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryExportRequest {
    pub output_path: String,
    pub include_log: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryExportResult {
    pub manifest_path: String,
    pub output_path: String,
    pub version: u32,
    pub records_exported: usize,
    pub files_exported: usize,
    pub memory_count: usize,
    pub inbox_count: usize,
    pub thread_count: usize,
    pub log_included: bool,
    pub copied_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryImportRequest {
    pub input_path: String,
    pub strategy: String,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryImportResult {
    pub manifest_path: String,
    pub input_path: String,
    pub strategy: String,
    pub dry_run: bool,
    pub records_seen: usize,
    pub records_imported: usize,
    pub records_skipped: usize,
    pub files_seen: usize,
    pub files_imported: usize,
    pub files_skipped: usize,
    pub copied_paths: Vec<String>,
    pub skipped_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryConfig {
    pub version: u32,
    pub recall: MemoryRecallConfig,
    pub distill: MemoryDistillConfig,
    pub capture: MemoryCaptureConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRecallConfig {
    pub default_limit: usize,
    pub context_byte_budget: usize,
    #[serde(default = "default_half_life_days")]
    pub half_life_days: u32,
    #[serde(default)]
    pub embeddings: MemoryEmbeddingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct MemoryEmbeddingConfig {
    pub enabled: bool,
}

fn default_half_life_days() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillConfig {
    pub enabled: bool,
    pub min_messages: usize,
    pub skip_patterns: Vec<String>,
    #[serde(default)]
    pub auto_accept: bool,
    #[serde(
        default = "default_confidence_threshold",
        deserialize_with = "confidence_threshold_format::deserialize"
    )]
    pub confidence_threshold: u8,
}

fn default_confidence_threshold() -> u8 {
    85
}

mod confidence_threshold_format {
    use super::*;

    pub(super) fn deserialize<'de, D>(deserializer: D) -> Result<u8, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ConfidenceThresholdVisitor;

        impl de::Visitor<'_> for ConfidenceThresholdVisitor {
            type Value = u8;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an integer 0-100 or decimal 0.0-1.0 confidence threshold")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                u8::try_from(value)
                    .ok()
                    .filter(|value| *value <= 100)
                    .ok_or_else(|| E::custom("confidence threshold must be between 0 and 100"))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value < 0 {
                    return Err(E::custom("confidence threshold must be between 0 and 100"));
                }
                self.visit_u64(value as u64)
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if !(0.0..=1.0).contains(&value) {
                    return Err(E::custom(
                        "decimal confidence threshold must be between 0.0 and 1.0",
                    ));
                }
                Ok((value * 100.0).round() as u8)
            }
        }

        deserializer.deserialize_any(ConfidenceThresholdVisitor)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureConfig {
    pub enabled: bool,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureImportRequest {
    pub source: String,
    pub path: String,
    pub title: Option<String>,
    pub thread_id: Option<String>,
    pub distill: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureImportResult {
    pub source: String,
    pub thread_id: String,
    pub path: String,
    pub title: String,
    pub message_count: usize,
    pub distilled: bool,
    pub distill_status: String,
    pub distill_error_code: Option<String>,
    pub distill_error_message: Option<String>,
    pub distill_result: Option<MemoryDistillResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureScanRequest {
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryCaptureScanResult {
    pub source: String,
    pub status: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadIndex {
    pub version: u32,
    pub threads: BTreeMap<String, ThreadIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadIndexEntry {
    pub path: String,
    pub content_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryThreadFrontmatter {
    pub schema_version: u32,
    pub kind: String,
    pub thread_id: String,
    pub source: String,
    pub title: String,
    pub content_hash: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: Option<usize>,
    pub model: Option<String>,
    pub workspace_root: Option<String>,
    pub tags: Vec<String>,
    pub distilled: bool,
    pub promoted_to_wiki: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryThreadRecord {
    pub path: String,
    pub frontmatter: MemoryThreadFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadSaveRequest {
    pub source: String,
    pub thread_id: Option<String>,
    pub title: String,
    pub body: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub model: Option<String>,
    pub workspace_root: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadSaveResult {
    pub action: String,
    pub path: String,
    pub thread_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct ThreadListFilter {
    pub source: Option<String>,
    pub since: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ThreadListItem {
    pub path: String,
    pub thread_id: String,
    pub source: String,
    pub title: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: Option<usize>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryFrontmatter {
    pub schema_version: u32,
    pub kind: String,
    pub memory_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub source_thread: Option<String>,
    #[serde(default)]
    pub source_message_refs: Vec<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
    pub tags: Vec<String>,
    pub evolves_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryRecord {
    pub path: String,
    pub frontmatter: MemoryFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemorySummary {
    pub path: String,
    pub memory_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryAddRequest {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub source_thread: Option<String>,
    #[serde(default)]
    pub source_message_refs: Vec<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct DistillCandidate {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub confidence: f64,
    pub source_message_refs: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillRequest {
    pub target: String,
    pub accept: bool,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillResult {
    pub target: String,
    pub source_thread: String,
    pub accepted: bool,
    pub candidate_count: usize,
    pub inbox_count: usize,
    pub memory_count: usize,
    pub candidates: Vec<DistillCandidate>,
    pub inbox: Vec<InboxRecord>,
    pub memories: Vec<MemoryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InboxFrontmatter {
    pub schema_version: u32,
    pub kind: String,
    pub inbox_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub source_thread: Option<String>,
    pub source_message_refs: Vec<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
    pub tags: Vec<String>,
    pub distill_run_id: Option<String>,
    pub accepted_memory_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InboxRecord {
    pub path: String,
    pub frontmatter: InboxFrontmatter,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InboxAddRequest {
    pub title: String,
    pub body: String,
    pub source_thread: Option<String>,
    pub source_message_refs: Vec<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
    pub tags: Vec<String>,
    pub distill_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InboxReviewRequest {
    pub inbox_id: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InboxReviewResult {
    pub inbox_id: String,
    pub path: String,
    pub status: String,
    pub accepted_memory_id: Option<String>,
    pub memory: Option<MemoryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct MemoryListFilter {
    pub tag: Option<String>,
    pub since: Option<String>,
    pub include_archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexStatus {
    pub index_status: String,
    pub document_count: usize,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchRequest {
    pub query: String,
    pub limit: usize,
    pub kinds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchResult {
    pub items: Vec<MemoryIndexSearchItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryIndexSearchItem {
    pub doc_id: String,
    pub kind: String,
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct RecallRequest {
    pub query: String,
    pub limit: Option<usize>,
    pub byte_budget: Option<usize>,
    #[serde(default)]
    pub include_working: bool,
    #[serde(default)]
    pub include_threads: bool,
    #[serde(default)]
    pub thread_ids: Vec<String>,
    #[serde(default)]
    pub include_wiki_refs: bool,
    #[serde(default)]
    pub include_wiki_snippets: bool,
    pub tag: Option<String>,
    pub since: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct RecallMemoryItem {
    pub memory_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub score: f64,
    pub importance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct RecallResult {
    pub working: Option<String>,
    pub memories: Vec<RecallMemoryItem>,
    pub threads: Vec<MemorySummary>,
    pub wiki_refs: Vec<MemorySummary>,
    pub truncated: bool,
    pub byte_count: usize,
    pub index_degraded: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryPromoteRequest {
    pub target: String,
    pub ingest: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryPromoteResult {
    pub thread_path: String,
    pub promoted_path: String,
    pub ingested: bool,
}
