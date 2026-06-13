use std::path::Path;

use rusqlite::{params, Connection, OpenFlags, Transaction};

use crate::memory_models::{
    MemoryIndexSearchItem, MemoryIndexSearchRequest, MemoryIndexSearchResult, MemoryIndexStatus,
    MemoryListFilter, MemoryRecord,
};
use crate::models::WorkspaceError;

const SCHEMA_VERSION: i64 = 1;

pub(crate) fn rebuild(root: &Path) -> Result<MemoryIndexStatus, WorkspaceError> {
    crate::memory_fs::ensure_memory_ready(root)?;

    let mut conn = open_read_write(&root.join(".mdx/search.sqlite"))?;
    init_schema(&conn)?;

    let tx = conn.transaction().map_err(sql_error)?;
    tx.execute("DELETE FROM fts_memories", [])
        .map_err(sql_error)?;
    tx.execute("DELETE FROM documents", []).map_err(sql_error)?;

    let memories = crate::memory_store::memory_list(
        root,
        MemoryListFilter {
            tag: None,
            since: None,
            include_archived: false,
        },
    )?;
    for summary in memories {
        let record = crate::memory_store::memory_get(root, summary.memory_id)?;
        upsert_memory(&tx, &record)?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES('schema_version', ?)",
        [SCHEMA_VERSION.to_string()],
    )
    .map_err(sql_error)?;
    tx.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES('index_status', 'clean')",
        [],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;

    let document_count = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sql_error)? as usize;

    Ok(MemoryIndexStatus {
        index_status: "clean".to_string(),
        document_count,
        dirty: false,
    })
}

pub(crate) fn status(root: &Path) -> Result<MemoryIndexStatus, WorkspaceError> {
    crate::memory_fs::ensure_memory_ready(root)?;

    let path = root.join(".mdx/search.sqlite");
    if !path.is_file() {
        return Ok(unavailable_status());
    }

    let conn = match open_read_only(&path) {
        Ok(conn) => conn,
        Err(error) if error.error_code() == "index_unavailable" => {
            return Ok(unavailable_status());
        }
        Err(error) => return Err(error),
    };

    if !has_required_schema(&conn)? {
        return Ok(unavailable_status());
    }

    let document_count = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sql_error)? as usize;
    let index_status = conn
        .query_row(
            "SELECT value FROM metadata WHERE key = 'index_status'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(MemoryIndexStatus {
        dirty: index_status != "clean",
        index_status,
        document_count,
    })
}

pub(crate) fn search(
    root: &Path,
    request: MemoryIndexSearchRequest,
) -> Result<MemoryIndexSearchResult, WorkspaceError> {
    crate::memory_fs::ensure_memory_ready(root)?;

    if request.limit == 0 {
        return Ok(MemoryIndexSearchResult { items: Vec::new() });
    }
    if !request.kinds.is_empty() && !request.kinds.iter().any(|kind| kind == "memory") {
        return Ok(MemoryIndexSearchResult { items: Vec::new() });
    }

    let match_query = fts_match_query(&request.query)?;
    let index_path = root.join(".mdx/search.sqlite");
    if !index_path.is_file() {
        return Err(index_unavailable(
            "memory search index is unavailable: .mdx/search.sqlite is missing",
        ));
    }
    let conn = open_read_only(&index_path)?;
    if !has_required_schema(&conn)? {
        return Err(index_unavailable(
            "memory search index is unavailable: required index tables are missing",
        ));
    }

    let mut stmt = conn
        .prepare(
            "SELECT d.doc_id,
                    d.kind,
                    d.path,
                    d.title,
                    snippet(fts_memories, 1, '[', ']', '...', 16),
                    bm25(fts_memories)
             FROM fts_memories
             JOIN documents d ON d.rowid = fts_memories.rowid
             WHERE fts_memories MATCH ?
               AND (? = 0 OR d.kind = 'memory')
             ORDER BY bm25(fts_memories), d.title
             LIMIT ?",
        )
        .map_err(sql_error)?;

    let rows = stmt
        .query_map(
            params![
                match_query,
                if request.kinds.is_empty() { 0 } else { 1 },
                request.limit as i64
            ],
            |row| {
                let rank = row.get::<_, f64>(5)?;
                Ok(MemoryIndexSearchItem {
                    doc_id: row.get(0)?,
                    kind: row.get(1)?,
                    path: row.get(2)?,
                    title: row.get(3)?,
                    snippet: row.get(4)?,
                    score: -rank,
                })
            },
        )
        .map_err(sql_error)?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(sql_error)?);
    }
    Ok(MemoryIndexSearchResult { items })
}

pub(crate) fn is_index_degradation_error(error: &WorkspaceError) -> bool {
    matches!(error.error_code(), "index_unavailable" | "index_failed")
}

pub(crate) fn upsert_memory(
    tx: &Transaction<'_>,
    record: &MemoryRecord,
) -> Result<(), WorkspaceError> {
    tx.execute(
        "DELETE FROM fts_memories
         WHERE rowid IN (SELECT rowid FROM documents WHERE doc_id = ?)",
        [&record.frontmatter.memory_id],
    )
    .map_err(sql_error)?;
    tx.execute(
        "DELETE FROM documents WHERE doc_id = ?",
        [&record.frontmatter.memory_id],
    )
    .map_err(sql_error)?;

    let tags_json = serde_json::to_string(&record.frontmatter.tags).map_err(|error| {
        WorkspaceError::new(
            "index_failed",
            format!("memory search index failed to encode tags: {error}"),
        )
    })?;
    tx.execute(
        "INSERT INTO documents (
           doc_id, kind, path, title, status, source, created_at, updated_at,
           content_hash, importance, confidence, tags_json
         )
         VALUES (?, 'memory', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
        params![
            record.frontmatter.memory_id,
            record.path,
            record.frontmatter.title,
            record.frontmatter.status,
            record.frontmatter.source_thread,
            record.frontmatter.created_at,
            record.frontmatter.created_at,
            record.frontmatter.importance.unwrap_or(0.5),
            record.frontmatter.confidence.unwrap_or(0.5),
            tags_json,
        ],
    )
    .map_err(sql_error)?;
    let rowid = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO fts_memories(rowid, title, body, tags) VALUES (?, ?, ?, ?)",
        params![
            rowid,
            record.frontmatter.title,
            record.body,
            record.frontmatter.tags.join(" "),
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn open_read_write(path: &Path) -> Result<Connection, WorkspaceError> {
    Connection::open(path).map_err(sql_error)
}

fn open_read_only(path: &Path) -> Result<Connection, WorkspaceError> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
        if matches!(error, rusqlite::Error::SqliteFailure(_, _)) {
            index_unavailable(format!("memory search index is unavailable: {error}"))
        } else {
            sql_error(error)
        }
    })
}

fn init_schema(conn: &Connection) -> Result<(), WorkspaceError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS metadata(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT OR REPLACE INTO metadata(key, value) VALUES('schema_version', '1');
        CREATE TABLE IF NOT EXISTS documents(
          doc_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT,
          created_at TEXT,
          updated_at TEXT,
          content_hash TEXT,
          importance REAL,
          confidence REAL,
          tags_json TEXT
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(title, body, tags);
        ",
    )
    .map_err(sql_error)
}

fn has_required_schema(conn: &Connection) -> Result<bool, WorkspaceError> {
    Ok(table_exists(conn, "metadata")?
        && table_exists(conn, "documents")?
        && table_exists(conn, "fts_memories")?)
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, WorkspaceError> {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master
           WHERE type = 'table' AND name = ?
         )",
        [name],
        |row| row.get::<_, bool>(0),
    )
    .map_err(sql_error)
}

fn fts_match_query(query: &str) -> Result<String, WorkspaceError> {
    // Search intentionally uses token-AND semantics, not a phrase/query parser:
    // punctuation and quotes are token boundaries, each token is quoted for FTS,
    // and all tokens must match somewhere in the indexed memory document.
    let terms = query
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_query",
            "memory search index query must not be empty",
        ));
    }

    Ok(terms.join(" AND "))
}

fn unavailable_status() -> MemoryIndexStatus {
    MemoryIndexStatus {
        index_status: "unavailable".to_string(),
        document_count: 0,
        dirty: true,
    }
}

fn index_unavailable(message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::new("index_unavailable", message.into())
}

fn sql_error(error: rusqlite::Error) -> WorkspaceError {
    WorkspaceError::new(
        "index_failed",
        format!("memory search index failed: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::fts_match_query;

    #[test]
    fn fts_match_query_uses_token_and_semantics_for_punctuation_and_quotes() {
        assert_eq!(fts_match_query("C++").unwrap(), "\"C\"");
        assert_eq!(
            fts_match_query(r#""quoted" auth,token"#).unwrap(),
            "\"quoted\" AND \"auth\" AND \"token\""
        );
        assert_eq!(
            fts_match_query("鉴权 token").unwrap(),
            "\"鉴权\" AND \"token\""
        );
    }
}
