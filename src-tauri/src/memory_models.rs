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
