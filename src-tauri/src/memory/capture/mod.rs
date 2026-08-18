//! Where captured agent sessions land.
//!
//! Capture is off until someone turns it on, and even then it only accepts
//! sources that were explicitly listed. That is not caution for its own sake:
//! material cannot be un-remembered — once a transcript is in the library the
//! only remedy is to delete it afterwards — so the default has to be that
//! nothing is taken.

use mempal_runtime::core::db::Database;
use mempal_runtime::core::types::SourceType;
use mempal_runtime::embed::Embedder;

use crate::memory::config::WorkspaceMemoryConfig;
use crate::memory::evidence::{synthetic_source, write_text, TextEvidence, SESSION_ROOM};
use crate::memory::models::evidence::WrittenEvidence;
use crate::models::WorkspaceError;

/// One agent session offered to the library.
pub struct SessionCapture<'a> {
    pub workspace_root: &'a std::path::Path,
    pub wing: &'a str,
    /// `claude`, `codex`, `cursor` — matched against the configured sources.
    pub agent: &'a str,
    /// Stable per-session identifier, so re-capturing a growing session
    /// replaces nothing and duplicates nothing.
    pub session_id: &'a str,
    pub transcript: String,
}

/// Stores a session if this workspace asked for it.
///
/// Returns `Ok(None)` when capture is off or this agent was never listed —
/// declining is a normal outcome, not a failure, and it must leave no trace at
/// all: no drawer, no spool file, no queued work.
pub fn record_session<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    config: &WorkspaceMemoryConfig,
    capture: SessionCapture<'_>,
) -> Result<Option<WrittenEvidence>, WorkspaceError> {
    if !accepts(config, capture.agent) {
        return Ok(None);
    }

    if capture.transcript.trim().is_empty() {
        return Ok(None);
    }

    let written = write_text(
        database,
        embedder,
        TextEvidence {
            workspace_root: capture.workspace_root,
            wing: capture.wing,
            room: SESSION_ROOM,
            content: capture.transcript,
            source_type: SourceType::Conversation,
            source_file: Some(synthetic_source(
                "session",
                &format!("{}/{}", capture.agent, capture.session_id),
            )),
            // A session someone actually had outranks a file that happens to be
            // in the workspace, and ranks below a conclusion.
            importance: 1,
        },
    )?;

    Ok(Some(written))
}

/// Whether this workspace takes material from this agent.
pub fn accepts(config: &WorkspaceMemoryConfig, agent: &str) -> bool {
    config.enabled
        && config.capture.enabled
        && config
            .capture
            .sources
            .iter()
            .any(|source| source.eq_ignore_ascii_case(agent))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::config::WorkspaceMemoryConfig;
    use crate::memory::engine::{library_path, wing_for};

    struct FixedEmbedder;

    #[async_trait::async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, texts: &[&str]) -> mempal_runtime::embed::Result<Vec<Vec<f32>>> {
            Ok(texts.iter().map(|_| vec![0.1, 0.2, 0.3, 0.4]).collect())
        }

        fn dimensions(&self) -> usize {
            4
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    fn open_library_for_test() -> Database {
        let path = library_path().expect("library path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        Database::open(&path).expect("open library")
    }

    fn enabled_config() -> WorkspaceMemoryConfig {
        let mut config = WorkspaceMemoryConfig {
            enabled: true,
            ..WorkspaceMemoryConfig::default()
        };
        config.capture.enabled = true;
        config.capture.sources = vec!["claude".to_string()];
        config
    }

    #[test]
    fn capture_is_off_by_default_and_writes_nothing() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library_for_test();
            let config = WorkspaceMemoryConfig::default();

            let written = record_session(
                &database,
                &FixedEmbedder,
                &config,
                SessionCapture {
                    workspace_root: workspace.path(),
                    wing: &wing,
                    agent: "claude",
                    session_id: "s-1",
                    transcript: "a whole conversation".to_string(),
                },
            )
            .expect("declining is not a failure");

            assert!(written.is_none());
            assert_eq!(database.drawer_count().expect("count"), 0);
        });
    }

    #[test]
    fn an_agent_that_was_never_listed_is_not_captured() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library_for_test();

            let written = record_session(
                &database,
                &FixedEmbedder,
                &enabled_config(),
                SessionCapture {
                    workspace_root: workspace.path(),
                    wing: &wing,
                    agent: "codex",
                    session_id: "s-1",
                    transcript: "a whole conversation".to_string(),
                },
            )
            .expect("declining is not a failure");

            assert!(written.is_none(), "only listed sources are captured");
            assert_eq!(database.drawer_count().expect("count"), 0);
        });
    }

    #[test]
    fn a_listed_session_becomes_material_once() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library_for_test();
            let config = enabled_config();
            let session = |transcript: &str| SessionCapture {
                workspace_root: workspace.path(),
                wing: &wing,
                agent: "claude",
                session_id: "s-1",
                transcript: transcript.to_string(),
            };

            let first = record_session(&database, &FixedEmbedder, &config, session("we chose X"))
                .expect("capture")
                .expect("captured");
            let again = record_session(&database, &FixedEmbedder, &config, session("we chose X"))
                .expect("capture")
                .expect("captured");

            assert!(first.created);
            assert!(!again.created, "the same session is not stored twice");
            assert_eq!(database.drawer_count().expect("count"), 1);

            let drawer = database
                .get_drawer(&first.drawer_id)
                .expect("lookup")
                .expect("stored");
            assert_eq!(drawer.room.as_deref(), Some(SESSION_ROOM));
            assert_eq!(drawer.source_type, SourceType::Conversation);
            assert!(
                drawer
                    .source_file
                    .as_deref()
                    .is_some_and(|source| source.contains("claude/s-1")),
                "{:?}",
                drawer.source_file
            );
        });
    }
}
