use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiWorkspaceStatus {
    pub mode: String,
    pub has_llm_wiki: bool,
    pub can_initialize: bool,
    pub missing_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLlmWikiResult {
    pub created_paths: Vec<String>,
    pub preserved_paths: Vec<String>,
    pub status: LlmWikiWorkspaceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LlmWikiProgress {
    pub status: String,
    pub total_raw_files: usize,
    pub pending: Vec<String>,
    pub processing: Vec<String>,
    pub completed: Vec<String>,
    pub failed: Vec<LlmWikiFailedFile>,
    pub skipped: Vec<String>,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LlmWikiFailedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiCache {
    pub version: u32,
    pub entries: BTreeMap<String, LlmWikiCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiCacheEntry {
    pub hash: String,
    pub source_page: String,
    pub ingested_at: String,
    pub model: String,
    #[serde(default)]
    pub raw_size: Option<u64>,
    #[serde(default)]
    pub raw_modified_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiKnowledgeConfig {
    pub paused: bool,
    pub skip_paths: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfigUpdate {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub preserve_api_key: bool,
}

impl fmt::Debug for LlmProviderConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LlmProviderConfig")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicLlmProviderConfig {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanFile {
    pub relative_path: String,
    pub absolute_path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanFileMetadata {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub modified_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanResult {
    pub total: usize,
    pub pending: Vec<String>,
    pub completed: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LlmWikiQueryResponse {
    pub answer: String,
    pub references: Vec<WikiSearchResult>,
    pub insufficient_context: bool,
}
