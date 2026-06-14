use serde_json::Value;

use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub workspace_root: String,
    pub project_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAgentSession {
    pub session_pk: String,
    pub workspace_id: String,
    pub agent_source: String,
    pub session_id: String,
    pub project_key: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub message_count: Option<i64>,
    pub event_count: i64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredAgentEvent {
    pub event_id: String,
    pub session_pk: String,
    pub workspace_id: String,
    pub agent_source: String,
    pub event_name: String,
    pub turn_id: Option<String>,
    pub event_seq: Option<i64>,
    pub idempotency_key: String,
    pub raw_payload: Value,
    pub payload_hash: String,
    pub created_at: String,
}

pub trait MemoryStorage {
    fn initialize(&mut self) -> Result<(), WorkspaceError>;
    fn schema_version(&mut self) -> Result<i64, WorkspaceError>;
    fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError>;
    fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError>;
    fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError>;
    fn insert_event_idempotent(&mut self, event: &StoredAgentEvent)
        -> Result<bool, WorkspaceError>;
    fn count_events(&mut self) -> Result<i64, WorkspaceError>;
}
