use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::memory_storage::{MemoryStorage, StoredAgentEvent, StoredAgentSession, StoredWorkspace};
use crate::WorkspaceError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct AgentHookEvent {
    pub agent_source: String,
    pub event_name: String,
    pub workspace_root: String,
    pub cwd: Option<String>,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub event_seq: Option<i64>,
    pub idempotency_key: String,
    pub raw_payload: serde_json::Value,
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AgentCaptureResult {
    pub inserted: bool,
    pub session_pk: String,
}

pub fn capture_agent_event(
    storage: &mut dyn MemoryStorage,
    event: &AgentHookEvent,
) -> Result<AgentCaptureResult, WorkspaceError> {
    let workspace_root = stable_workspace_root(&event.workspace_root);
    let workspace_id = workspace_id_for_root(&workspace_root);
    let project_key = workspace_id.clone();
    storage.upsert_workspace(&StoredWorkspace {
        workspace_id: workspace_id.clone(),
        workspace_root,
        project_key: project_key.clone(),
    })?;

    let session_pk = session_pk_for_agent_session(&event.agent_source, &event.session_id);
    let now = crate::memory_fs::now_utc_rfc3339()?;
    let existing_session =
        storage.get_session_by_agent_id(&event.agent_source, &event.session_id)?;
    let base_session = StoredAgentSession {
        session_pk: session_pk.clone(),
        workspace_id: workspace_id.clone(),
        agent_source: event.agent_source.clone(),
        session_id: event.session_id.clone(),
        project_key,
        cwd: event.cwd.clone().or_else(|| {
            existing_session
                .as_ref()
                .and_then(|session| session.cwd.clone())
        }),
        model: existing_session
            .as_ref()
            .and_then(|session| session.model.clone()),
        started_at: existing_session
            .as_ref()
            .map(|session| session.started_at.clone())
            .unwrap_or_else(|| now.clone()),
        ended_at: existing_session
            .as_ref()
            .and_then(|session| session.ended_at.clone()),
        message_count: existing_session
            .as_ref()
            .and_then(|session| session.message_count),
        event_count: existing_session
            .as_ref()
            .map(|session| session.event_count)
            .unwrap_or(0),
        status: existing_session
            .as_ref()
            .map(|session| session.status.clone())
            .unwrap_or_else(|| "active".to_string()),
    };
    storage.upsert_session(&base_session)?;

    let raw = serde_json::to_vec(&event.raw_payload).map_err(|error| {
        WorkspaceError::new(
            "memory_event_payload_serialize_failed",
            format!("failed to serialize memory event payload: {error}"),
        )
    })?;
    let payload_hash = sha256_hex(&raw);
    let inserted = storage.insert_event_idempotent(&StoredAgentEvent {
        event_id: event_id_for_idempotency_key(&event.idempotency_key),
        session_pk: session_pk.clone(),
        workspace_id,
        agent_source: event.agent_source.clone(),
        event_name: event.event_name.clone(),
        turn_id: event.turn_id.clone(),
        event_seq: event.event_seq,
        idempotency_key: event.idempotency_key.clone(),
        raw_payload: event.raw_payload.clone(),
        payload_hash,
        created_at: now,
    })?;

    Ok(AgentCaptureResult {
        inserted,
        session_pk,
    })
}

fn stable_workspace_root(root: &str) -> String {
    std::fs::canonicalize(Path::new(root))
        .unwrap_or_else(|_| Path::new(root).to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn workspace_id_for_root(root: &str) -> String {
    format!("workspace:{}", sha256_hex(root.as_bytes()))
}

fn session_pk_for_agent_session(agent_source: &str, session_id: &str) -> String {
    format!("{agent_source}:{session_id}")
}

fn event_id_for_idempotency_key(idempotency_key: &str) -> String {
    format!("event:{}", sha256_hex(idempotency_key.as_bytes()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}
