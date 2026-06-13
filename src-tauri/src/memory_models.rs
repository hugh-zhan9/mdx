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
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
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
pub struct RecallRequest {
    pub query: String,
    pub limit: Option<usize>,
    pub byte_budget: Option<usize>,
    pub include_working: bool,
    pub include_threads: bool,
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
    pub truncated: bool,
    pub byte_count: usize,
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
