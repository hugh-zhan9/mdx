use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemoryDistillConfig {
    pub enabled: bool,
    pub min_messages: usize,
    pub skip_patterns: Vec<String>,
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
