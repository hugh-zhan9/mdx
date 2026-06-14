use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::memory_schema::SQLITE_DDL;
use crate::memory_storage::{MemoryStorage, StoredAgentEvent, StoredAgentSession, StoredWorkspace};
use crate::WorkspaceError;

pub struct SqliteMemoryStorage {
    conn: rusqlite::Connection,
}

impl SqliteMemoryStorage {
    pub fn open_workspace(root: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let db_dir = ensure_workspace_db_dir(root.as_ref())?;
        let db_path = db_dir.join("memory.sqlite");
        ensure_database_path_is_regular_file_or_missing(&db_path)?;
        let conn = rusqlite::Connection::open(db_path).map_err(|error| {
            WorkspaceError::new(
                "memory_db_open_failed",
                format!("failed to open memory sqlite database: {error}"),
            )
        })?;
        Ok(Self { conn })
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
                    started_at = excluded.started_at,
                    ended_at = excluded.ended_at,
                    message_count = excluded.message_count,
                    event_count = excluded.event_count,
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
        let rows_changed = self
            .conn
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
        Ok(rows_changed > 0)
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

fn sqlite_error(
    error_code: &'static str,
    message: impl Into<String>,
    error: rusqlite::Error,
) -> WorkspaceError {
    WorkspaceError::new(error_code, format!("{}: {error}", message.into()))
}
