use std::path::Path;

use serde_json::Value;
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub workspace_root: String,
    pub project_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryStorageScope {
    pub workspace_id: String,
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

#[derive(Debug, Clone, PartialEq)]
pub struct StoredJob {
    pub job_id: String,
    pub workspace_id: String,
    pub kind: String,
    pub status: String,
    pub idempotency_key: String,
    pub payload: Value,
    pub attempts: i64,
    pub next_run_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_error: Option<String>,
}

pub trait MemoryStorage {
    fn initialize(&mut self) -> Result<(), WorkspaceError>;
    fn schema_version(&mut self) -> Result<i64, WorkspaceError>;
    fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError>;
    fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError>;
    fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError>;
    fn get_session_by_agent_id(
        &mut self,
        agent_source: &str,
        session_id: &str,
    ) -> Result<Option<StoredAgentSession>, WorkspaceError>;
    fn insert_event_idempotent(&mut self, event: &StoredAgentEvent)
        -> Result<bool, WorkspaceError>;
    fn enqueue_job_idempotent(&mut self, job: &StoredJob) -> Result<bool, WorkspaceError>;
    fn list_ready_jobs(&mut self, limit: usize) -> Result<Vec<StoredJob>, WorkspaceError>;
    fn count_events(&mut self) -> Result<i64, WorkspaceError>;
    fn search_memories(
        &mut self,
        query: &str,
        limit: usize,
        tag: Option<&str>,
        since: Option<&str>,
    ) -> Result<Vec<crate::memory::RecallMemoryItem>, WorkspaceError>;
    fn search_thread_summaries(
        &mut self,
        query: &str,
        limit: usize,
        since: Option<&str>,
    ) -> Result<Vec<crate::memory::MemorySummary>, WorkspaceError>;
}

pub fn workspace_scope_for_root(root: impl AsRef<Path>) -> MemoryStorageScope {
    let workspace_root = std::fs::canonicalize(root.as_ref())
        .unwrap_or_else(|_| root.as_ref().to_path_buf())
        .to_string_lossy()
        .into_owned();
    let workspace_id = format!("workspace:{}", sha256_hex(workspace_root.as_bytes()));
    MemoryStorageScope {
        workspace_id: workspace_id.clone(),
        project_key: workspace_id,
    }
}

pub(crate) fn validate_job_timestamps(job: &StoredJob) -> Result<(), WorkspaceError> {
    parse_normalized_utc_rfc3339("next_run_at", &job.next_run_at)?;
    parse_normalized_utc_rfc3339("created_at", &job.created_at)?;
    parse_normalized_utc_rfc3339("updated_at", &job.updated_at)?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

pub(crate) fn filter_sort_ready_jobs(
    jobs: Vec<StoredJob>,
    limit: usize,
    now: OffsetDateTime,
) -> Result<Vec<StoredJob>, WorkspaceError> {
    let mut ready = Vec::new();
    for job in jobs {
        validate_job_timestamps(&job)?;
        let next_run_at = parse_normalized_utc_rfc3339("next_run_at", &job.next_run_at)?;
        if next_run_at <= now {
            let created_at = parse_normalized_utc_rfc3339("created_at", &job.created_at)?;
            ready.push((next_run_at, created_at, job.job_id.clone(), job));
        }
    }
    ready.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    Ok(ready
        .into_iter()
        .take(limit)
        .map(|(_, _, _, job)| job)
        .collect())
}

pub(crate) fn parse_normalized_utc_rfc3339(
    field_name: &str,
    value: &str,
) -> Result<OffsetDateTime, WorkspaceError> {
    let parsed = OffsetDateTime::parse(value, &Rfc3339).map_err(|error| {
        WorkspaceError::new(
            "memory_job_timestamp_invalid",
            format!("memory job {field_name} must be UTC RFC3339: {error}"),
        )
    })?;
    if parsed.offset() != UtcOffset::UTC {
        return Err(WorkspaceError::new(
            "memory_job_timestamp_invalid",
            format!("memory job {field_name} must use UTC offset"),
        ));
    }
    let normalized = parsed.format(&Rfc3339).map_err(|error| {
        WorkspaceError::new(
            "memory_job_timestamp_invalid",
            format!("failed to normalize memory job {field_name}: {error}"),
        )
    })?;
    if normalized != value {
        return Err(WorkspaceError::new(
            "memory_job_timestamp_invalid",
            format!("memory job {field_name} must be normalized UTC RFC3339"),
        ));
    }
    Ok(parsed)
}
