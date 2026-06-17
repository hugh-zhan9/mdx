use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::memory_schema::SQLITE_DDL;
use crate::memory_storage::{
    validate_job_timestamps, workspace_scope_for_root, MemoryStorage, MemoryStorageScope,
    ProjectionMemory, StoredAgentEvent, StoredAgentSession, StoredInboxWrite, StoredJob,
    StoredMemoryWrite, StoredProvenanceLink, StoredThreadWrite, StoredWorkspace,
};
use crate::WorkspaceError;

pub struct SqliteMemoryStorage {
    conn: rusqlite::Connection,
    scope: MemoryStorageScope,
}

impl SqliteMemoryStorage {
    pub fn open_workspace(root: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let root = root.as_ref();
        let db_dir = ensure_workspace_db_dir(root)?;
        let db_path = db_dir.join("memory.sqlite");
        ensure_database_path_is_regular_file_or_missing(&db_path)?;
        let conn = rusqlite::Connection::open(db_path).map_err(|error| {
            WorkspaceError::new(
                "memory_db_open_failed",
                format!("failed to open memory sqlite database: {error}"),
            )
        })?;
        Ok(Self {
            conn,
            scope: workspace_scope_for_root(root),
        })
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

    pub fn insert_memory(&mut self, memory: &StoredMemoryWrite) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_memory(self, memory)
    }

    pub fn upsert_thread(&mut self, thread: &StoredThreadWrite) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::upsert_thread(self, thread)
    }

    pub fn insert_inbox_candidate(
        &mut self,
        inbox: &StoredInboxWrite,
    ) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_inbox_candidate(self, inbox)
    }

    pub fn insert_provenance_link(
        &mut self,
        link: &StoredProvenanceLink,
    ) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_provenance_link(self, link)
    }

    pub fn list_active_memories_for_projection(
        &mut self,
    ) -> Result<Vec<ProjectionMemory>, WorkspaceError> {
        <Self as MemoryStorage>::list_active_memories_for_projection(self)
    }

    pub fn list_memory_records_for_migration(
        &mut self,
    ) -> Result<Vec<crate::memory_storage::StoredMemoryRecord>, WorkspaceError> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT
                    memory_id,
                    workspace_id,
                    project_key,
                    title,
                    body,
                    status,
                    tags,
                    importance,
                    confidence,
                    created_at,
                    updated_at,
                    archived_at
                FROM memories
                ORDER BY created_at ASC, memory_id ASC",
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_migration_prepare_failed",
                    "failed to prepare sqlite memory migration query",
                    error,
                )
            })?;
        let rows = statement
            .query_map([], |row| {
                let tags_json: String = row.get(6)?;
                let tags = serde_json::from_str::<Vec<String>>(&tags_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        6,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(crate::memory_storage::StoredMemoryRecord {
                    memory_id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    project_key: row.get(2)?,
                    title: row.get(3)?,
                    body: row.get(4)?,
                    status: row.get(5)?,
                    tags,
                    importance: row.get(7)?,
                    confidence: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    archived_at: row.get(11)?,
                })
            })
            .map_err(|error| {
                sqlite_error(
                    "memory_migration_list_failed",
                    "failed to list sqlite memory migration records",
                    error,
                )
            })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            sqlite_error(
                "memory_migration_decode_failed",
                "failed to decode sqlite memory migration record",
                error,
            )
        })
    }

    pub fn list_thread_records_for_migration(
        &mut self,
    ) -> Result<Vec<crate::memory_storage::StoredThreadRecord>, WorkspaceError> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT
                    thread_id,
                    workspace_id,
                    agent_source,
                    session_pk,
                    title,
                    body,
                    content_hash,
                    message_count,
                    distilled,
                    promoted_to_wiki,
                    created_at,
                    updated_at
                FROM threads
                ORDER BY created_at ASC, thread_id ASC",
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_migration_prepare_failed",
                    "failed to prepare sqlite thread migration query",
                    error,
                )
            })?;
        let rows = statement
            .query_map([], |row| {
                let distilled: i64 = row.get(8)?;
                let promoted_to_wiki: i64 = row.get(9)?;
                Ok(crate::memory_storage::StoredThreadRecord {
                    thread_id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    agent_source: row.get(2)?,
                    session_pk: row.get(3)?,
                    title: row.get(4)?,
                    body: row.get(5)?,
                    content_hash: row.get(6)?,
                    message_count: row.get(7)?,
                    distilled: distilled != 0,
                    promoted_to_wiki: promoted_to_wiki != 0,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|error| {
                sqlite_error(
                    "memory_migration_list_failed",
                    "failed to list sqlite thread migration records",
                    error,
                )
            })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            sqlite_error(
                "memory_migration_decode_failed",
                "failed to decode sqlite thread migration record",
                error,
            )
        })
    }

    pub fn count_active_memories(&mut self) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT COUNT(*)
                FROM memories
                WHERE workspace_id = ?1
                    AND project_key = ?2
                    AND status = 'active'
                    AND archived_at IS NULL",
                params![self.scope.workspace_id, self.scope.project_key],
                |row| row.get(0),
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_recall_memory_count_failed",
                    "failed to count sqlite recall memory records",
                    error,
                )
            })
    }

    #[cfg(test)]
    pub fn count_memories_for_test(&mut self) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
            .map_err(|error| {
                sqlite_error(
                    "memory_count_failed",
                    "failed to count sqlite memory records",
                    error,
                )
            })
    }

    #[cfg(test)]
    pub fn insert_memory_for_test(
        &mut self,
        memory_id: &str,
        _workspace_id: &str,
        _project_key: &str,
        title: &str,
        body: &str,
        tags: &[&str],
        confidence: f64,
    ) -> Result<bool, WorkspaceError> {
        <Self as MemoryStorage>::insert_memory(
            self,
            &StoredMemoryWrite {
                memory_id: memory_id.to_string(),
                workspace_id: self.scope.workspace_id.clone(),
                project_key: self.scope.project_key.clone(),
                title: title.to_string(),
                body: body.to_string(),
                tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
                importance: None,
                confidence: Some(confidence),
                created_at: now_rfc3339()?,
            },
        )
    }

    #[cfg(test)]
    pub fn count_provenance_links_for_test(
        &mut self,
        source_thread_id: &str,
    ) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM provenance_links WHERE source_thread_id = ?1",
                params![source_thread_id],
                |row| row.get(0),
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_provenance_count_failed",
                    "failed to count sqlite provenance links",
                    error,
                )
            })
    }

    #[cfg(test)]
    pub fn get_thread_for_test(
        &mut self,
        thread_id: &str,
    ) -> Result<Option<StoredThreadWrite>, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT
                    thread_id,
                    workspace_id,
                    agent_source,
                    session_pk,
                    title,
                    body,
                    content_hash,
                    message_count,
                    distilled,
                    promoted_to_wiki,
                    created_at,
                    updated_at
                FROM threads
                WHERE thread_id = ?1",
                params![thread_id],
                row_to_thread,
            )
            .optional()
            .map_err(|error| {
                sqlite_error(
                    "memory_thread_read_failed",
                    "failed to read sqlite memory thread",
                    error,
                )
            })
    }

    pub fn count_threads(&mut self) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT COUNT(*)
                FROM threads
                WHERE workspace_id = ?1",
                params![self.scope.workspace_id],
                |row| row.get(0),
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_recall_thread_count_failed",
                    "failed to count sqlite recall thread records",
                    error,
                )
            })
    }

    #[cfg(test)]
    pub fn session_timestamps_for_test(
        &mut self,
        agent_source: &str,
        session_id: &str,
    ) -> Result<Option<(String, Option<String>)>, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT started_at, ended_at FROM agent_sessions WHERE agent_source = ?1 AND session_id = ?2",
                params![agent_source, session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| {
                sqlite_error(
                    "memory_session_timestamp_read_failed",
                    "failed to read sqlite memory session timestamps",
                    error,
                )
            })
    }
}

impl MemoryStorage for SqliteMemoryStorage {
    fn initialize(&mut self) -> Result<(), WorkspaceError> {
        for statement in SQLITE_DDL {
            self.conn.execute(statement, []).map_err(|error| {
                sqlite_error(
                    "memory_schema_initialize_failed",
                    "failed to initialize memory sqlite schema",
                    error,
                )
            })?;
        }
        Ok(())
    }

    fn schema_version(&mut self) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE component = 'memory'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map(|version| version.unwrap_or(0))
            .map_err(|error| {
                sqlite_error(
                    "memory_schema_version_failed",
                    "failed to read memory sqlite schema version",
                    error,
                )
            })
    }

    fn table_exists(&mut self, table: &str) -> Result<bool, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                params![table],
                |row| row.get::<_, i64>(0),
            )
            .map(|exists| exists != 0)
            .map_err(|error| {
                sqlite_error(
                    "memory_table_check_failed",
                    format!("failed to check sqlite table {table}"),
                    error,
                )
            })
    }

    fn upsert_workspace(&mut self, workspace: &StoredWorkspace) -> Result<(), WorkspaceError> {
        let now = now_rfc3339()?;
        self.conn
            .execute(
                "INSERT INTO workspaces (workspace_id, workspace_root, project_key, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    workspace_root = excluded.workspace_root,
                    project_key = excluded.project_key,
                    updated_at = excluded.updated_at",
                params![
                    workspace.workspace_id,
                    workspace.workspace_root,
                    workspace.project_key,
                    now
                ],
            )
            .map(|_| ())
            .map_err(|error| {
                sqlite_error(
                    "memory_workspace_upsert_failed",
                    "failed to upsert sqlite memory workspace",
                    error,
                )
            })
    }

    fn upsert_session(&mut self, session: &StoredAgentSession) -> Result<(), WorkspaceError> {
        self.conn
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
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(agent_source, session_id) DO UPDATE SET
                    session_pk = excluded.session_pk,
                    workspace_id = excluded.workspace_id,
                    project_key = excluded.project_key,
                    cwd = excluded.cwd,
                    model = excluded.model,
                    started_at = agent_sessions.started_at,
                    ended_at = excluded.ended_at,
                    message_count = COALESCE(excluded.message_count, agent_sessions.message_count),
                    event_count = agent_sessions.event_count,
                    status = excluded.status",
                params![
                    session.session_pk,
                    session.workspace_id,
                    session.agent_source,
                    session.session_id,
                    session.project_key,
                    session.cwd,
                    session.model,
                    session.started_at,
                    session.ended_at,
                    session.message_count,
                    session.event_count,
                    session.status
                ],
            )
            .map(|_| ())
            .map_err(|error| {
                sqlite_error(
                    "memory_session_upsert_failed",
                    "failed to upsert sqlite memory agent session",
                    error,
                )
            })
    }

    fn get_session_by_agent_id(
        &mut self,
        agent_source: &str,
        session_id: &str,
    ) -> Result<Option<StoredAgentSession>, WorkspaceError> {
        self.conn
            .query_row(
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
                WHERE agent_source = ?1 AND session_id = ?2",
                params![agent_source, session_id],
                row_to_session,
            )
            .optional()
            .map_err(|error| {
                sqlite_error(
                    "memory_session_read_failed",
                    "failed to read sqlite memory agent session",
                    error,
                )
            })
    }

    fn insert_event_idempotent(
        &mut self,
        event: &StoredAgentEvent,
    ) -> Result<bool, WorkspaceError> {
        let raw_payload = serde_json::to_string(&event.raw_payload).map_err(|error| {
            WorkspaceError::new(
                "memory_event_payload_serialize_failed",
                format!("failed to serialize memory event payload: {error}"),
            )
        })?;
        let transaction = self.conn.transaction().map_err(|error| {
            sqlite_error(
                "memory_event_insert_failed",
                "failed to begin sqlite memory event insert transaction",
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
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(idempotency_key) DO NOTHING",
                params![
                    event.event_id,
                    event.session_pk,
                    event.workspace_id,
                    event.agent_source,
                    event.event_name,
                    event.turn_id,
                    event.event_seq,
                    event.idempotency_key,
                    raw_payload,
                    event.payload_hash,
                    event.created_at
                ],
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_event_insert_failed",
                    "failed to insert sqlite memory event",
                    error,
                )
            })?;
        if rows_changed > 0 {
            transaction
                .execute(
                    "UPDATE agent_sessions
                    SET event_count = event_count + 1
                    WHERE session_pk = ?1",
                    params![event.session_pk],
                )
                .map_err(|error| {
                    sqlite_error(
                        "memory_event_session_count_update_failed",
                        "failed to update sqlite memory session event count",
                        error,
                    )
                })?;
        }
        transaction.commit().map_err(|error| {
            sqlite_error(
                "memory_event_insert_failed",
                "failed to commit sqlite memory event insert transaction",
                error,
            )
        })?;
        Ok(rows_changed > 0)
    }

    fn enqueue_job_idempotent(&mut self, job: &StoredJob) -> Result<bool, WorkspaceError> {
        validate_job_timestamps(job)?;
        let payload = serde_json::to_string(&job.payload).map_err(|error| {
            WorkspaceError::new(
                "memory_job_payload_serialize_failed",
                format!("failed to serialize memory job payload: {error}"),
            )
        })?;
        let rows_changed = self
            .conn
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
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(idempotency_key) DO NOTHING",
                params![
                    job.job_id,
                    job.workspace_id,
                    job.kind,
                    job.status,
                    job.idempotency_key,
                    payload,
                    job.attempts,
                    job.next_run_at,
                    job.created_at,
                    job.updated_at,
                    job.last_error
                ],
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_job_enqueue_failed",
                    "failed to enqueue sqlite memory job",
                    error,
                )
            })?;
        Ok(rows_changed > 0)
    }

    fn list_ready_jobs(&mut self, limit: usize) -> Result<Vec<StoredJob>, WorkspaceError> {
        let now = crate::memory_storage::parse_normalized_utc_rfc3339("now", &now_rfc3339()?)?;
        let mut statement = self
            .conn
            .prepare(
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
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_job_list_prepare_failed",
                    "failed to prepare sqlite ready memory jobs query",
                    error,
                )
            })?;
        let jobs = statement
            .query_map([], row_to_job)
            .map_err(|error| {
                sqlite_error(
                    "memory_job_list_failed",
                    "failed to list sqlite ready memory jobs",
                    error,
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                sqlite_error(
                    "memory_job_decode_failed",
                    "failed to decode sqlite ready memory job",
                    error,
                )
            })?;
        crate::memory_storage::filter_sort_ready_jobs(jobs, limit, now)
    }

    fn count_events(&mut self) -> Result<i64, WorkspaceError> {
        self.conn
            .query_row("SELECT COUNT(*) FROM agent_events", [], |row| row.get(0))
            .map_err(|error| {
                sqlite_error(
                    "memory_event_count_failed",
                    "failed to count sqlite memory events",
                    error,
                )
            })
    }

    fn insert_memory(&mut self, memory: &StoredMemoryWrite) -> Result<bool, WorkspaceError> {
        let tags = serde_json::to_string(&memory.tags).map_err(|error| {
            WorkspaceError::new(
                "memory_tags_serialize_failed",
                format!("failed to serialize memory tags: {error}"),
            )
        })?;
        self.conn
            .execute(
                "INSERT INTO memories (
                    memory_id,
                    workspace_id,
                    project_key,
                    title,
                    body,
                    status,
                    tags,
                    importance,
                    confidence,
                    created_at,
                    updated_at,
                    archived_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?9, NULL)
                ON CONFLICT(memory_id) DO NOTHING",
                params![
                    memory.memory_id,
                    memory.workspace_id,
                    memory.project_key,
                    memory.title,
                    memory.body,
                    tags,
                    memory.importance,
                    memory.confidence,
                    memory.created_at
                ],
            )
            .map(|rows_changed| rows_changed > 0)
            .map_err(|error| {
                sqlite_error(
                    "memory_insert_failed",
                    "failed to insert sqlite memory record",
                    error,
                )
            })
    }

    fn upsert_thread(&mut self, thread: &StoredThreadWrite) -> Result<bool, WorkspaceError> {
        self.conn
            .execute(
                "INSERT INTO threads (
                    thread_id,
                    workspace_id,
                    agent_source,
                    session_pk,
                    title,
                    body,
                    content_hash,
                    message_count,
                    distilled,
                    promoted_to_wiki,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, 0), COALESCE(?10, 0), ?11, ?12)
                ON CONFLICT(thread_id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    agent_source = excluded.agent_source,
                    session_pk = COALESCE(?4, threads.session_pk),
                    title = excluded.title,
                    body = excluded.body,
                    content_hash = excluded.content_hash,
                    message_count = COALESCE(?8, threads.message_count),
                    distilled = CASE WHEN ?9 IS NULL THEN threads.distilled ELSE excluded.distilled END,
                    promoted_to_wiki = CASE WHEN ?10 IS NULL THEN threads.promoted_to_wiki ELSE excluded.promoted_to_wiki END,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                WHERE threads.workspace_id IS NOT excluded.workspace_id
                    OR threads.agent_source IS NOT excluded.agent_source
                    OR threads.session_pk IS NOT COALESCE(?4, threads.session_pk)
                    OR threads.title IS NOT excluded.title
                    OR threads.body IS NOT excluded.body
                    OR threads.content_hash IS NOT excluded.content_hash
                    OR threads.message_count IS NOT COALESCE(?8, threads.message_count)
                    OR threads.distilled IS NOT CASE WHEN ?9 IS NULL THEN threads.distilled ELSE excluded.distilled END
                    OR threads.promoted_to_wiki IS NOT CASE WHEN ?10 IS NULL THEN threads.promoted_to_wiki ELSE excluded.promoted_to_wiki END
                    OR threads.created_at IS NOT excluded.created_at
                    OR threads.updated_at IS NOT excluded.updated_at",
                params![
                    thread.thread_id,
                    thread.workspace_id,
                    thread.agent_source,
                    thread.session_pk,
                    thread.title,
                    thread.body,
                    thread.content_hash,
                    thread.message_count,
                    option_bool_to_i64(thread.distilled),
                    option_bool_to_i64(thread.promoted_to_wiki),
                    thread.created_at,
                    thread.updated_at
                ],
            )
            .map(|rows_changed| rows_changed > 0)
            .map_err(|error| {
                sqlite_error(
                    "memory_thread_upsert_failed",
                    "failed to upsert sqlite memory thread",
                    error,
                )
            })
    }

    fn insert_inbox_candidate(&mut self, inbox: &StoredInboxWrite) -> Result<bool, WorkspaceError> {
        let tags = serde_json::to_string(&inbox.tags).map_err(|error| {
            WorkspaceError::new(
                "memory_inbox_tags_serialize_failed",
                format!("failed to serialize inbox tags: {error}"),
            )
        })?;
        self.conn
            .execute(
                "INSERT INTO inbox_candidates (
                    inbox_id,
                    workspace_id,
                    project_key,
                    title,
                    body,
                    status,
                    tags,
                    confidence,
                    risk_level,
                    accepted_memory_id,
                    created_at,
                    reviewed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, NULL, ?9, NULL)
                ON CONFLICT(inbox_id) DO NOTHING",
                params![
                    inbox.inbox_id,
                    inbox.workspace_id,
                    inbox.project_key,
                    inbox.title,
                    inbox.body,
                    tags,
                    inbox.confidence,
                    inbox.risk_level,
                    inbox.created_at
                ],
            )
            .map(|rows_changed| rows_changed > 0)
            .map_err(|error| {
                sqlite_error(
                    "memory_inbox_insert_failed",
                    "failed to insert sqlite inbox candidate",
                    error,
                )
            })
    }

    fn insert_provenance_link(
        &mut self,
        link: &StoredProvenanceLink,
    ) -> Result<bool, WorkspaceError> {
        self.conn
            .execute(
                "INSERT INTO provenance_links (
                    link_id,
                    workspace_id,
                    target_type,
                    target_id,
                    source_event_id,
                    source_thread_id,
                    provider,
                    model,
                    prompt_version,
                    created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(link_id) DO NOTHING",
                params![
                    link.link_id,
                    link.workspace_id,
                    link.target_type,
                    link.target_id,
                    link.source_event_id,
                    link.source_thread_id,
                    link.provider,
                    link.model,
                    link.prompt_version,
                    link.created_at
                ],
            )
            .map(|rows_changed| rows_changed > 0)
            .map_err(|error| {
                sqlite_error(
                    "memory_provenance_insert_failed",
                    "failed to insert sqlite provenance link",
                    error,
                )
            })
    }

    fn list_active_memories_for_projection(
        &mut self,
    ) -> Result<Vec<ProjectionMemory>, WorkspaceError> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT
                    memory_id,
                    title,
                    body,
                    tags,
                    importance,
                    confidence,
                    created_at,
                    updated_at
                FROM memories
                WHERE workspace_id = ?1
                    AND project_key = ?2
                    AND status = 'active'
                    AND archived_at IS NULL
                ORDER BY title ASC, memory_id ASC",
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_projection_list_prepare_failed",
                    "failed to prepare sqlite memory projection query",
                    error,
                )
            })?;
        let memories = statement
            .query_map(
                params![self.scope.workspace_id, self.scope.project_key],
                |row| {
                    let tags_json: String = row.get(3)?;
                    let tags =
                        serde_json::from_str::<Vec<String>>(&tags_json).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                3,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?;
                    Ok(ProjectionMemory {
                        memory_id: row.get(0)?,
                        title: row.get(1)?,
                        body: row.get(2)?,
                        tags,
                        importance: row.get(4)?,
                        confidence: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_projection_list_failed",
                    "failed to list sqlite memory projection records",
                    error,
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                sqlite_error(
                    "memory_projection_decode_failed",
                    "failed to decode sqlite memory projection record",
                    error,
                )
            })?;
        Ok(memories)
    }

    fn search_memories(
        &mut self,
        query: &str,
        limit: usize,
        tag: Option<&str>,
        since: Option<&str>,
    ) -> Result<Vec<crate::memory::RecallMemoryItem>, WorkspaceError> {
        if limit == 0 || query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let pattern = like_pattern(query);
        let mut statement = self
            .conn
            .prepare(
                "SELECT
                    memory_id,
                    title,
                    body,
                    tags,
                    COALESCE(importance, 0.5) AS importance
                FROM memories
                WHERE workspace_id = ?1
                    AND project_key = ?2
                    AND status = 'active'
                    AND archived_at IS NULL
                    AND (
                        title COLLATE NOCASE LIKE ?3 ESCAPE '\\'
                        OR body COLLATE NOCASE LIKE ?3 ESCAPE '\\'
                        OR tags COLLATE NOCASE LIKE ?3 ESCAPE '\\'
                    )
                    AND (?4 IS NULL OR created_at >= ?4 OR updated_at >= ?4)
                    AND (?5 IS NULL OR tags LIKE ?5 ESCAPE '\\')
                ORDER BY importance DESC, updated_at DESC
                LIMIT ?6",
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_search_prepare_failed",
                    "failed to prepare sqlite memory search query",
                    error,
                )
            })?;
        let rows = statement
            .query_map(
                params![
                    self.scope.workspace_id,
                    self.scope.project_key,
                    pattern,
                    since,
                    tag_pattern(tag)?,
                    sql_limit(limit)
                ],
                |row| -> rusqlite::Result<(String, String, String, Vec<String>, f64)> {
                    let tags_json: String = row.get(3)?;
                    let tags =
                        serde_json::from_str::<Vec<String>>(&tags_json).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                3,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?;
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, tags, row.get(4)?))
                },
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_search_failed",
                    "failed to search sqlite memories",
                    error,
                )
            })?;
        let mut items = Vec::new();
        for row in rows {
            let (memory_id, title, body, tags, importance) = row.map_err(|error| {
                sqlite_error(
                    "memory_search_decode_failed",
                    "failed to decode sqlite memory search result",
                    error,
                )
            })?;
            if tag.is_some_and(|tag| !tags.iter().any(|item| item == tag)) {
                continue;
            }
            items.push(crate::memory::RecallMemoryItem {
                path: format!("memory/memories/{memory_id}.md"),
                memory_id,
                title,
                snippet: snippet_for_body(&body, 240),
                score: importance,
                importance,
            });
            if items.len() >= limit {
                break;
            }
        }
        Ok(items)
    }

    fn search_thread_summaries(
        &mut self,
        query: &str,
        limit: usize,
        since: Option<&str>,
    ) -> Result<Vec<crate::memory::MemorySummary>, WorkspaceError> {
        if limit == 0 || query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let pattern = like_pattern(query);
        let exact_thread_id = query.trim();
        let mut statement = self
            .conn
            .prepare(
                "SELECT
                    thread_id,
                    title,
                    agent_source,
                    created_at
                FROM threads
                WHERE workspace_id = ?1
                    AND (
                        title COLLATE NOCASE LIKE ?2 ESCAPE '\\'
                        OR thread_id COLLATE NOCASE LIKE ?2 ESCAPE '\\'
                        OR agent_source COLLATE NOCASE LIKE ?2 ESCAPE '\\'
                    )
                    AND (?4 IS NULL OR created_at >= ?4 OR updated_at >= ?4)
                ORDER BY CASE WHEN thread_id = ?3 THEN 0 ELSE 1 END, updated_at DESC
                LIMIT ?5",
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_thread_search_prepare_failed",
                    "failed to prepare sqlite thread summary search query",
                    error,
                )
            })?;
        let summaries = statement
            .query_map(
                params![
                    self.scope.workspace_id,
                    pattern,
                    exact_thread_id,
                    since,
                    sql_limit(limit)
                ],
                |row| {
                    let thread_id: String = row.get(0)?;
                    let agent_source: String = row.get(2)?;
                    Ok(crate::memory::MemorySummary {
                        path: format!("memory/threads/{agent_source}/{thread_id}.md"),
                        memory_id: thread_id,
                        title: row.get(1)?,
                        status: "active".to_string(),
                        created_at: row.get(3)?,
                        tags: Vec::new(),
                    })
                },
            )
            .map_err(|error| {
                sqlite_error(
                    "memory_thread_search_failed",
                    "failed to search sqlite thread summaries",
                    error,
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                sqlite_error(
                    "memory_thread_search_decode_failed",
                    "failed to decode sqlite thread summary search result",
                    error,
                )
            })?;
        Ok(summaries)
    }
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAgentSession> {
    Ok(StoredAgentSession {
        session_pk: row.get(0)?,
        workspace_id: row.get(1)?,
        agent_source: row.get(2)?,
        session_id: row.get(3)?,
        project_key: row.get(4)?,
        cwd: row.get(5)?,
        model: row.get(6)?,
        started_at: row.get(7)?,
        ended_at: row.get(8)?,
        message_count: row.get(9)?,
        event_count: row.get(10)?,
        status: row.get(11)?,
    })
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredJob> {
    let payload_json: String = row.get(5)?;
    let payload = serde_json::from_str(&payload_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(StoredJob {
        job_id: row.get(0)?,
        workspace_id: row.get(1)?,
        kind: row.get(2)?,
        status: row.get(3)?,
        idempotency_key: row.get(4)?,
        payload,
        attempts: row.get(6)?,
        next_run_at: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_error: row.get(10)?,
    })
}

#[cfg(test)]
fn row_to_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredThreadWrite> {
    let distilled: i64 = row.get(8)?;
    let promoted_to_wiki: i64 = row.get(9)?;
    Ok(StoredThreadWrite {
        thread_id: row.get(0)?,
        workspace_id: row.get(1)?,
        agent_source: row.get(2)?,
        session_pk: row.get(3)?,
        title: row.get(4)?,
        body: row.get(5)?,
        content_hash: row.get(6)?,
        message_count: row.get(7)?,
        distilled: Some(distilled != 0),
        promoted_to_wiki: Some(promoted_to_wiki != 0),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn option_bool_to_i64(value: Option<bool>) -> Option<i64> {
    value.map(|value| if value { 1 } else { 0 })
}

fn ensure_workspace_db_dir(root: &Path) -> Result<PathBuf, WorkspaceError> {
    crate::memory_fs::ensure_directory(root)?;
    let db_dir = root.join(".mdx");
    match std::fs::symlink_metadata(&db_dir) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_dir() {
                return Err(WorkspaceError::new(
                    "memory_db_dir_invalid",
                    "memory sqlite database directory .mdx is not a directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(&db_dir).map_err(|error| {
                WorkspaceError::from_io(
                    "memory_db_dir_create_failed",
                    "failed to create memory sqlite database directory",
                    &error,
                )
            })?;
        }
        Err(error) => {
            return Err(WorkspaceError::from_io(
                "memory_db_dir_inspect_failed",
                "failed to inspect memory sqlite database directory",
                &error,
            ));
        }
    }
    Ok(db_dir)
}

fn ensure_database_path_is_regular_file_or_missing(db_path: &Path) -> Result<(), WorkspaceError> {
    match std::fs::symlink_metadata(db_path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !file_type.is_file() {
                return Err(WorkspaceError::new(
                    "memory_db_path_invalid",
                    "memory sqlite database path is not a regular file",
                ));
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(WorkspaceError::from_io(
            "memory_db_path_inspect_failed",
            "failed to inspect memory sqlite database path",
            &error,
        )),
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

fn like_pattern(query: &str) -> String {
    let mut pattern = String::from("%");
    for character in query.trim().chars() {
        if matches!(character, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('%');
    pattern
}

fn tag_pattern(tag: Option<&str>) -> Result<Option<String>, WorkspaceError> {
    tag.map(|tag| {
        serde_json::to_string(tag).map(|value| {
            let mut pattern = String::from("%");
            for character in value.chars() {
                if matches!(character, '%' | '_' | '\\') {
                    pattern.push('\\');
                }
                pattern.push(character);
            }
            pattern.push('%');
            pattern
        })
    })
    .transpose()
    .map_err(|error| {
        WorkspaceError::new(
            "memory_tag_filter_serialize_failed",
            format!("failed to serialize memory tag filter: {error}"),
        )
    })
}

fn sql_limit(limit: usize) -> i64 {
    let capped = limit.saturating_mul(8).max(limit).min(i64::MAX as usize);
    capped as i64
}

fn snippet_for_body(body: &str, max_chars: usize) -> String {
    let mut snippet = body.chars().take(max_chars).collect::<String>();
    if body.chars().count() > max_chars {
        snippet.push_str("...");
    }
    snippet
}

fn sqlite_error(
    error_code: &'static str,
    message: impl Into<String>,
    error: rusqlite::Error,
) -> WorkspaceError {
    WorkspaceError::new(error_code, format!("{}: {error}", message.into()))
}
