use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::memory_provider::{MemoryProvider, MemoryProviderMessage};
use crate::memory_storage::{
    MemoryStorage, StoredInboxWrite, StoredMemoryWrite, StoredProvenanceLink,
};
use crate::models::WorkspaceError;

const DISTILL_WORKER_PROMPT_VERSION: &str = "memory-distill-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateClassification {
    pub action: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistillWorkerResult {
    pub created_memories: usize,
    pub created_inbox: usize,
    pub dropped: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct ProviderCandidates {
    candidates: Vec<ProviderCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct ProviderCandidate {
    title: String,
    body: String,
    #[serde(default)]
    confidence: Option<f64>,
    #[serde(default)]
    importance: Option<f64>,
    #[serde(default)]
    tags: Vec<String>,
}

pub fn classify_distill_candidate(body: &str, confidence: f64) -> CandidateClassification {
    let lower = body.to_ascii_lowercase();
    if contains_secret(&lower) {
        return CandidateClassification {
            action: "drop".to_string(),
            reason: "secret_detected".to_string(),
        };
    }
    if ["customer", "billing", "private"]
        .iter()
        .any(|term| lower.contains(term))
    {
        return CandidateClassification {
            action: "inbox".to_string(),
            reason: "sensitive_content".to_string(),
        };
    }
    if confidence >= 0.90 {
        return CandidateClassification {
            action: "auto_accept".to_string(),
            reason: "high_confidence_low_risk".to_string(),
        };
    }
    CandidateClassification {
        action: "inbox".to_string(),
        reason: "low_confidence".to_string(),
    }
}

#[cfg(test)]
pub fn run_distill_job_for_test(
    storage: &mut dyn MemoryStorage,
    provider: &dyn MemoryProvider,
    workspace_id: &str,
    session_pk: &str,
) -> Result<DistillWorkerResult, WorkspaceError> {
    run_distill_job(storage, provider, workspace_id, session_pk)
}

pub fn run_distill_job(
    storage: &mut dyn MemoryStorage,
    provider: &dyn MemoryProvider,
    workspace_id: &str,
    session_pk: &str,
) -> Result<DistillWorkerResult, WorkspaceError> {
    let provider_output = provider.complete_json(&worker_messages(session_pk))?;
    let candidates: ProviderCandidates =
        serde_json::from_value(provider_output).map_err(|error| {
            WorkspaceError::new(
                "distill_parse_failed",
                format!("failed to parse distill provider candidates: {error}"),
            )
        })?;

    let mut result = DistillWorkerResult {
        created_memories: 0,
        created_inbox: 0,
        dropped: 0,
    };

    for candidate in &candidates.candidates {
        let confidence = candidate.confidence.unwrap_or(0.5);
        let classification = classify_distill_candidate(&candidate.body, confidence);
        match classification.action.as_str() {
            "drop" => result.dropped += 1,
            "auto_accept" => {
                let title = candidate.title.trim();
                let body = candidate.body.trim();
                let memory_id = stable_candidate_id("mem", workspace_id, session_pk, title, body);
                let now = crate::memory_fs::now_utc_rfc3339()?;
                let inserted = storage.insert_memory(&StoredMemoryWrite {
                    memory_id: memory_id.clone(),
                    workspace_id: workspace_id.to_string(),
                    project_key: workspace_id.to_string(),
                    title: title.to_string(),
                    body: body.to_string(),
                    tags: candidate.tags.clone(),
                    importance: candidate.importance.or(Some(0.5)),
                    confidence: Some(confidence),
                    created_at: now.clone(),
                })?;
                insert_provenance(
                    storage,
                    workspace_id,
                    "memory",
                    &memory_id,
                    session_pk,
                    &now,
                )?;
                if inserted {
                    result.created_memories += 1;
                }
            }
            _ => {
                let title = candidate.title.trim();
                let body = candidate.body.trim();
                let inbox_id = stable_candidate_id("inbox", workspace_id, session_pk, title, body);
                let now = crate::memory_fs::now_utc_rfc3339()?;
                let inserted = storage.insert_inbox_candidate(&StoredInboxWrite {
                    inbox_id: inbox_id.clone(),
                    workspace_id: workspace_id.to_string(),
                    project_key: workspace_id.to_string(),
                    title: title.to_string(),
                    body: body.to_string(),
                    tags: candidate.tags.clone(),
                    confidence: Some(confidence),
                    risk_level: classification.reason,
                    created_at: now.clone(),
                })?;
                insert_provenance(storage, workspace_id, "inbox", &inbox_id, session_pk, &now)?;
                if inserted {
                    result.created_inbox += 1;
                }
            }
        }
    }

    Ok(result)
}

fn worker_messages(session_pk: &str) -> Vec<MemoryProviderMessage> {
    vec![
        MemoryProviderMessage {
            role: "system".to_string(),
            content: "Distill durable memory candidates. Return JSON with a candidates array."
                .to_string(),
        },
        MemoryProviderMessage {
            role: "user".to_string(),
            content: format!("Distill memory candidates for session {session_pk}."),
        },
    ]
}

fn insert_provenance(
    storage: &mut dyn MemoryStorage,
    workspace_id: &str,
    target_type: &str,
    target_id: &str,
    session_pk: &str,
    created_at: &str,
) -> Result<(), WorkspaceError> {
    storage.insert_provenance_link(&StoredProvenanceLink {
        link_id: stable_id("prov", &[workspace_id, target_type, target_id, session_pk]),
        workspace_id: workspace_id.to_string(),
        target_type: target_type.to_string(),
        target_id: target_id.to_string(),
        source_event_id: None,
        source_thread_id: Some(session_pk.to_string()),
        provider: None,
        model: None,
        prompt_version: DISTILL_WORKER_PROMPT_VERSION.to_string(),
        created_at: created_at.to_string(),
    })?;
    Ok(())
}

fn contains_secret(lower: &str) -> bool {
    lower.contains("api token")
        || lower.contains("api key")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("sk-")
}

fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    format!("{prefix}:{:x}", hasher.finalize())
}

fn stable_candidate_id(
    prefix: &str,
    workspace_id: &str,
    session_pk: &str,
    title: &str,
    body: &str,
) -> String {
    stable_id(prefix, &[workspace_id, session_pk, title, body])
}
