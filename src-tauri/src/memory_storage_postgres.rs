use postgres::{Client, NoTls};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::memory_schema::POSTGRES_DDL;
use crate::memory_storage::{MemoryStorage, StoredAgentEvent, StoredAgentSession, StoredWorkspace};
use crate::WorkspaceError;

pub struct PostgresMemoryStorage {
    client: Client,
}

impl PostgresMemoryStorage {
    pub fn connect(url: &str) -> Result<Self, WorkspaceError> {
        let client = Client::connect(url, NoTls).map_err(|error| {
            postgres_error(
                "memory_postgres_connect_failed",
                "failed to connect to memory postgres database",
                error,
            )
        })?;
        Ok(Self { client })
    }

    pub fn initialize(&mut self) -> Result<(), WorkspaceError> {
        <Self as MemoryStorage>::initialize(self)
    }

    pub fn schema_version(&mut self) -> Result<i64, WorkspaceError> {
        <Self as MemoryStorage>::schema_version(self)
    }

    pub fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::table_exists(self, table)
    }

    pub fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError> {
        <Self as MemoryStorage>::upsert_workspace(self, workspace)
    }

    pub fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError> {
        <Self as MemoryStorage>::upsert_session(self, session)
    }

    pub fn insert_event_idempotent(
        &mut self,
        event: &StoredAgentEvent,
    ) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_event_idempotent(self, event)
    }

    pub fn count_events(&mut self) -> Result<i64, WorkspaceError> {
        <Self as MemoryStorage>::count_events(self)
    }
}

impl MemoryStorage for PostgresMemoryStorage {
    fn initialize(&mut self) -> Result<(), WorkspaceError> {
        for statement in POSTGRES_DDL {
            self.client.batch_execute(statement).map_err(|error| {
                postgres_error(
                    "memory_postgres_schema_initialize_failed",
                    "failed to initialize memory postgres schema",
                    error,
                )
            })?;
        }
        Ok(())
    }

    fn schema_version(&mut self) -> Result<i64, WorkspaceError> {
        self.client
            .query_opt(
                "SELECT version FROM schema_migrations WHERE component = 'memory'",
                &[],
            )
            .map(|row| row.map(|row| row.get(0)).unwrap_or(0))
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_schema_version_failed",
                    "failed to read memory postgres schema version",
                    error,
                )
            })
    }

    fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError> {
        self.client
            .query_one(
                "SELECT EXISTS(
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = $1
                )",
                &[&table],
            )
            .map(|row| row.get(0))
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_table_check_failed",
                    format!("failed to check postgres table {table}"),
                    error,
                )
            })
    }

    fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError> {
        let now = now_rfc3339()?;
        self.client
            .execute(
                "INSERT INTO workspaces (workspace_id, workspace_root, project_key, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $4)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    workspace_root = EXCLUDED.workspace_root,
                    project_key = EXCLUDED.project_key,
                    updated_at = EXCLUDED.updated_at",
                &[
                    &workspace.workspace_id,
                    &workspace.workspace_root,
                    &workspace.project_key,
                    &now,
                ],
            )
            .map(|_| ())
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_workspace_upsert_failed",
                    "failed to upsert postgres memory workspace",
                    error,
                )
            })
    }

    fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError> {
        self.client
            .execute(
                "INSERT INTO agent_sessions (
                    session_pk,
                    workspace_id,
                    agent_source,
                    session_id,
                    project_key,
                    cwd,
                    model,
                    started_at,
                    ended_at,
                    message_count,
                    event_count,
                    status
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT(agent_source, session_id) DO UPDATE SET
                    session_pk = EXCLUDED.session_pk,
                    workspace_id = EXCLUDED.workspace_id,
                    project_key = EXCLUDED.project_key,
                    cwd = EXCLUDED.cwd,
                    model = EXCLUDED.model,
                    started_at = EXCLUDED.started_at,
                    ended_at = EXCLUDED.ended_at,
                    message_count = EXCLUDED.message_count,
                    event_count = EXCLUDED.event_count,
                    status = EXCLUDED.status",
                &[
                    &session.session_pk,
                    &session.workspace_id,
                    &session.agent_source,
                    &session.session_id,
                    &session.project_key,
                    &session.cwd,
                    &session.model,
                    &session.started_at,
                    &session.ended_at,
                    &session.message_count,
                    &session.event_count,
                    &session.status,
                ],
            )
            .map(|_| ())
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_session_upsert_failed",
                    "failed to upsert postgres memory agent session",
                    error,
                )
            })
    }

    fn insert_event_idempotent(
        &mut self,
        event: &StoredAgentEvent,
    ) -> Result<bool, WorkspaceError> {
        let rows_changed = self
            .client
            .execute(
                "INSERT INTO agent_events (
                    event_id,
                    session_pk,
                    workspace_id,
                    agent_source,
                    event_name,
                    turn_id,
                    event_seq,
                    idempotency_key,
                    raw_payload,
                    payload_hash,
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
                ON CONFLICT(idempotency_key) DO NOTHING",
                &[
                    &event.event_id,
                    &event.session_pk,
                    &event.workspace_id,
                    &event.agent_source,
                    &event.event_name,
                    &event.turn_id,
                    &event.event_seq,
                    &event.idempotency_key,
                    &event.raw_payload,
                    &event.payload_hash,
                    &event.created_at,
                ],
            )
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_event_insert_failed",
                    "failed to insert postgres memory event",
                    error,
                )
            })?;
        Ok(rows_changed > 0)
    }

    fn count_events(&mut self) -> Result<i64, WorkspaceError> {
        self.client
            .query_one("SELECT COUNT(*) FROM agent_events", &[])
            .map(|row| row.get(0))
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_event_count_failed",
                    "failed to count postgres memory events",
                    error,
                )
            })
    }
}

fn now_rfc3339() -> Result<String, WorkspaceError> {
    OffsetDateTime::now_utc().format(&Rfc3339).map_err(|error| {
        WorkspaceError::new(
            "memory_timestamp_failed",
            format!("failed to format memory storage timestamp: {error}"),
        )
    })
}

fn postgres_error(
    error_code: &'static str,
    message: impl Into<String>,
    error: postgres::Error,
) -> WorkspaceError {
    WorkspaceError::new(error_code, format!("{}: {error}", message.into()))
}
