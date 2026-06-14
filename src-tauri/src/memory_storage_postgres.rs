use postgres::{Client, NoTls};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::memory_schema::POSTGRES_DDL;
use crate::memory_storage::{
    validate_job_timestamps, MemoryStorage, StoredAgentEvent, StoredAgentSession, StoredJob,
    StoredWorkspace,
};
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

    pub fn get_session_by_agent_id(
        &mut self,
        agent_source: &str,
        session_id: &str,
    ) -> Result<Option<StoredAgentSession>, WorkspaceError> {
        <Self as MemoryStorage>::get_session_by_agent_id(self, agent_source, session_id)
    }

    pub fn insert_event_idempotent(
        &mut self,
        event: &StoredAgentEvent,
    ) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_event_idempotent(self, event)
    }

    pub fn enqueue_job_idempotent(&mut self, job: &StoredJob) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::enqueue_job_idempotent(self, job)
    }

    pub fn list_ready_jobs(&mut self, limit: usize) -> Result<Vec<StoredJob>, WorkspaceError> {
        <Self as MemoryStorage>::list_ready_jobs(self, limit)
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
                    started_at = agent_sessions.started_at,
                    ended_at = EXCLUDED.ended_at,
                    message_count = COALESCE(EXCLUDED.message_count, agent_sessions.message_count),
                    event_count = agent_sessions.event_count,
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

    fn get_session_by_agent_id(
        &mut self,
        agent_source: &str,
        session_id: &str,
    ) -> Result<Option<StoredAgentSession>, WorkspaceError> {
        self.client
            .query_opt(
                "SELECT
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
                FROM agent_sessions
                WHERE agent_source = $1 AND session_id = $2",
                &[&agent_source, &session_id],
            )
            .map(|row| row.map(|row| postgres_row_to_session(&row)))
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_session_read_failed",
                    "failed to read postgres memory agent session",
                    error,
                )
            })
    }

    fn insert_event_idempotent(
        &mut self,
        event: &StoredAgentEvent,
    ) -> Result<bool, WorkspaceError> {
        let mut transaction = self.client.transaction().map_err(|error| {
            postgres_error(
                "memory_postgres_event_insert_failed",
                "failed to begin postgres memory event insert transaction",
                error,
            )
        })?;
        let rows_changed = transaction
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
        if rows_changed > 0 {
            transaction
                .execute(
                    "UPDATE agent_sessions
                    SET event_count = event_count + 1
                    WHERE session_pk = $1",
                    &[&event.session_pk],
                )
                .map_err(|error| {
                    postgres_error(
                        "memory_postgres_event_session_count_update_failed",
                        "failed to update postgres memory session event count",
                        error,
                    )
                })?;
        }
        transaction.commit().map_err(|error| {
            postgres_error(
                "memory_postgres_event_insert_failed",
                "failed to commit postgres memory event insert transaction",
                error,
            )
        })?;
        Ok(rows_changed > 0)
    }

    fn enqueue_job_idempotent(&mut self, job: &StoredJob) -> Result<bool, WorkspaceError> {
        validate_job_timestamps(job)?;
        let rows_changed = self
            .client
            .execute(
                "INSERT INTO jobs (
                    job_id,
                    workspace_id,
                    kind,
                    status,
                    idempotency_key,
                    payload,
                    attempts,
                    next_run_at,
                    created_at,
                    updated_at,
                    last_error
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
                ON CONFLICT(idempotency_key) DO NOTHING",
                &[
                    &job.job_id,
                    &job.workspace_id,
                    &job.kind,
                    &job.status,
                    &job.idempotency_key,
                    &job.payload,
                    &job.attempts,
                    &job.next_run_at,
                    &job.created_at,
                    &job.updated_at,
                    &job.last_error,
                ],
            )
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_job_enqueue_failed",
                    "failed to enqueue postgres memory job",
                    error,
                )
            })?;
        Ok(rows_changed > 0)
    }

    fn list_ready_jobs(&mut self, limit: usize) -> Result<Vec<StoredJob>, WorkspaceError> {
        let now = crate::memory_storage::parse_normalized_utc_rfc3339("now", &now_rfc3339()?)?;
        let rows = self
            .client
            .query(
                "SELECT
                    job_id,
                    workspace_id,
                    kind,
                    status,
                    idempotency_key,
                    payload,
                    attempts,
                    next_run_at,
                    created_at,
                    updated_at,
                    last_error
                FROM jobs
                WHERE status = 'queued'",
                &[],
            )
            .map_err(|error| {
                postgres_error(
                    "memory_postgres_job_list_failed",
                    "failed to list postgres ready memory jobs",
                    error,
                )
            })?;
        let jobs = rows
            .into_iter()
            .map(|row| postgres_row_to_job(&row))
            .collect();
        crate::memory_storage::filter_sort_ready_jobs(jobs, limit, now)
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

fn postgres_row_to_session(row: &postgres::Row) -> StoredAgentSession {
    StoredAgentSession {
        session_pk: row.get(0),
        workspace_id: row.get(1),
        agent_source: row.get(2),
        session_id: row.get(3),
        project_key: row.get(4),
        cwd: row.get(5),
        model: row.get(6),
        started_at: row.get(7),
        ended_at: row.get(8),
        message_count: row.get(9),
        event_count: row.get(10),
        status: row.get(11),
    }
}

fn postgres_row_to_job(row: &postgres::Row) -> StoredJob {
    StoredJob {
        job_id: row.get(0),
        workspace_id: row.get(1),
        kind: row.get(2),
        status: row.get(3),
        idempotency_key: row.get(4),
        payload: row.get(5),
        attempts: row.get(6),
        next_run_at: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
        last_error: row.get(10),
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
