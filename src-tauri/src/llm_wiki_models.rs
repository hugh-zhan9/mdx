use std::collections::BTreeMap;

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
    pub version: String,
    pub entries: BTreeMap<String, LlmWikiCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiCacheEntry {
    pub hash: String,
    pub source_page: String,
    pub ingested_at: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiKnowledgeConfig {
    pub paused: bool,
    pub skip_paths: Vec<String>,
}
