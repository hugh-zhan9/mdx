//! What the engine does when the library, the binding, or the model is not what
//! it should be. These are the paths a user actually hits.

use std::path::Path;

use super::config::{
    read_workspace_config, write_workspace_config, GlobalMemoryConfig, WorkspaceMemoryConfig,
    WORKSPACE_CONFIG_VERSION,
};
use super::embedder::{model_dir, readiness, ModelReadiness};
use super::engine::{
    bound_wing, close_library, library_status, rebind_wing, wing_bindings, wing_for,
};

use super::config::testing::with_scoped_home;

#[test]
fn opening_a_fresh_library_reports_the_supported_schema() {
    with_scoped_home(|_home| {
        let status = library_status();

        assert!(status.writable, "fresh library should be writable: {status:?}");
        assert_eq!(status.schema_version, Some(status.supported_schema_version));
        assert_eq!(status.drawer_count, Some(0));
        assert!(status.error.is_none());
    });
}

#[test]
fn the_same_workspace_always_resolves_to_the_same_project() {
    with_scoped_home(|_home| {
        let root = tempfile::tempdir().expect("workspace");

        let first = wing_for(root.path()).expect("first bind");
        let second = wing_for(root.path()).expect("second bind");

        assert_eq!(first, second);
        assert_eq!(bound_wing(root.path()).expect("lookup"), Some(first));
    });
}

#[test]
fn two_workspaces_with_the_same_name_are_two_projects() {
    with_scoped_home(|_home| {
        let parent_a = tempfile::tempdir().expect("parent a");
        let parent_b = tempfile::tempdir().expect("parent b");
        let a = parent_a.path().join("notes");
        let b = parent_b.path().join("notes");
        std::fs::create_dir_all(&a).expect("mkdir a");
        std::fs::create_dir_all(&b).expect("mkdir b");

        let wing_a = wing_for(&a).expect("bind a");
        let wing_b = wing_for(&b).expect("bind b");

        assert_ne!(wing_a, wing_b, "same directory name must not merge projects");
        assert!(wing_a.starts_with("notes-"));
        assert!(wing_b.starts_with("notes-"));
    });
}

#[test]
fn a_moved_workspace_is_a_new_project_until_it_is_rebound() {
    with_scoped_home(|_home| {
        let parent = tempfile::tempdir().expect("parent");
        let before = parent.path().join("before");
        let after = parent.path().join("after");
        std::fs::create_dir_all(&before).expect("mkdir before");
        std::fs::create_dir_all(&after).expect("mkdir after");

        let original = wing_for(&before).expect("bind before");
        // Nothing is inferred from a path that was never bound.
        assert_eq!(bound_wing(&after).expect("lookup"), None);

        rebind_wing(&original, &after).expect("rebind");

        assert_eq!(bound_wing(&after).expect("lookup"), Some(original.clone()));
        assert_eq!(bound_wing(&before).expect("lookup"), None);
        assert_eq!(wing_bindings().expect("bindings").len(), 1);
    });
}

#[test]
fn rebinding_a_project_that_does_not_exist_is_refused() {
    with_scoped_home(|_home| {
        let root = tempfile::tempdir().expect("workspace");

        let error = rebind_wing("nothing-abcdef", root.path()).expect_err("must refuse");

        assert_eq!(error.error_code(), "wing_unbound");
    });
}

#[test]
fn a_missing_model_is_reported_rather_than_worked_around() {
    with_scoped_home(|_home| {
        let config = GlobalMemoryConfig::default();

        let readiness = readiness(&config).expect("readiness");

        match readiness {
            ModelReadiness::Missing { missing, .. } => {
                assert_eq!(missing.len(), 3, "nothing is downloaded in a fresh home");
            }
            ModelReadiness::Ready { dir, .. } => {
                panic!("unexpected model in a scratch home at {}", dir.display())
            }
        }

        let error = match super::embedder::build_embedder(&config) {
            Ok(_) => panic!("a scratch home has no model to load"),
            Err(error) => error,
        };
        assert_eq!(error.error_code(), "embedding_model_missing");
    });
}

#[test]
fn the_model_directory_lives_under_the_mdx_home() {
    with_scoped_home(|_home| {
        let config = GlobalMemoryConfig::default();

        let dir = model_dir(&config).expect("model dir");

        assert!(dir.ends_with(Path::new("models/potion-multilingual-128M")), "{dir:?}");
    });
}

#[test]
fn a_pre_migration_workspace_config_is_rebuilt_and_kept_aside() {
    let root = tempfile::tempdir().expect("workspace");
    let path = root.path().join(".loam").join("memory-config.json");
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(
        &path,
        r#"{"version":2,"storage":{"backend":"postgres"},"projection":{"enabled":true}}"#,
    )
    .expect("write v2");

    let config = read_workspace_config(root.path()).expect("read");

    assert_eq!(config.version, WORKSPACE_CONFIG_VERSION);
    assert!(!config.enabled, "memory stays off until asked for");
    assert!(!config.capture.enabled);
    assert!(config.capture.sources.is_empty());
    assert!(
        path.with_extension("json.v2.bak").is_file(),
        "the previous configuration is kept, not deleted"
    );
}

#[test]
fn workspace_config_round_trips() {
    let root = tempfile::tempdir().expect("workspace");
    let mut config = WorkspaceMemoryConfig {
        enabled: true,
        ..WorkspaceMemoryConfig::default()
    };
    config.capture.sources = vec!["claude-code".to_string()];

    write_workspace_config(root.path(), &config).expect("write");

    assert_eq!(read_workspace_config(root.path()).expect("read"), config);
}

#[test]
fn a_library_newer_than_this_app_is_refused_rather_than_migrated() {
    with_scoped_home(|_home| {
        let path = super::engine::library_path().expect("library path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        // A library written by a future version of the app.
        let connection = rusqlite::Connection::open(&path).expect("create db");
        connection
            .pragma_update(None, "user_version", 999_i64)
            .expect("stamp a future schema version");
        drop(connection);
        close_library();

        let status = library_status();

        assert!(!status.writable);
        let message = status.error.expect("an explanation");
        assert!(message.contains("schema_incompatible"), "{message}");
        assert!(message.contains("999"), "{message}");
        // Refusing is not the same as damaging: the file is still there.
        assert!(path.is_file());
    });
}

#[test]
fn a_library_that_cannot_be_written_disables_memory_with_a_reason() {
    with_scoped_home(|_home| {
        use std::os::unix::fs::PermissionsExt;

        let home = super::config::memory_home_dir().expect("memory home");
        std::fs::create_dir_all(&home).expect("mkdir");
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o555))
            .expect("make read-only");
        close_library();

        let status = library_status();

        // Restore before asserting so a failure cannot leave an unremovable dir.
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o755))
            .expect("restore permissions");

        assert!(!status.writable);
        let message = status.error.expect("an explanation");
        assert!(message.contains("memory_unavailable"), "{message}");
    });
}

#[test]
fn diagnostics_report_a_dangling_project_binding() {
    with_scoped_home(|_home| {
        let gone = tempfile::tempdir().expect("workspace");
        let wing = wing_for(gone.path()).expect("bind");
        let path = gone.path().to_path_buf();
        drop(gone);
        assert!(!path.exists(), "the workspace is gone for this test");

        let report = super::engine::diagnostics(&GlobalMemoryConfig::default());

        assert_eq!(report.projects, 1);
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.contains(&wing) && warning.contains("rebind")),
            "{:?}",
            report.warnings
        );
        // The missing model is the other thing a fresh home should be told about.
        assert!(!report.model.ready);
        assert_eq!(report.model.missing.len(), 3);
    });
}

#[test]
fn diagnostics_do_not_mention_the_upstream_command_line_tool() {
    with_scoped_home(|_home| {
        let report = super::engine::diagnostics(&GlobalMemoryConfig::default());
        let rendered = serde_json::to_string(&report).expect("serialize");

        assert!(
            !rendered.contains("mempal doctor"),
            "advice for a tool this app does not ship leaked into diagnostics: {rendered}"
        );
    });
}

/// Purging is the half of a delete that cannot be undone, and the half that gives
/// the disk space back.
///
/// The material goes in through the same writer production uses, with a fixed
/// embedder standing in for the model — a scoped home has none, and purging has
/// nothing to do with embeddings either way.
#[test]
fn purging_removes_what_a_delete_only_hid() {
    use mempal_runtime::core::types::SourceType;
    use mempal_runtime::embed::Embedder;

    use super::evidence::{write_text, TextEvidence};

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

    with_scoped_home(|_home| {
        let root = tempfile::tempdir().expect("workspace");
        let wing = wing_for(root.path()).expect("bind");

        let write = |content: &str| {
            super::engine::with_library(|database| {
                write_text(
                    database,
                    &FixedEmbedder,
                    TextEvidence {
                        workspace_root: root.path(),
                        wing: &wing,
                        room: "note",
                        content: content.to_string(),
                        source_type: SourceType::Manual,
                        source_file: Some(super::evidence::synthetic_source("note", content)),
                        importance: 1,
                    },
                )
                .map(|written| written.drawer_id)
            })
            .expect("write material")
        };

        let keep = write("a decision worth keeping");
        let drop = write("a note about to be deleted");

        assert!(super::api::delete(&drop).expect("soft delete"));
        // Still in the file, only hidden — which is what makes a delete
        // recoverable right up until a purge.
        assert_eq!(library_status().drawer_count, Some(1));

        let purged = super::api::purge(None).expect("purge");

        assert_eq!(purged, 1);
        assert!(super::api::show(&drop).is_err(), "the purged drawer is gone");
        assert!(super::api::show(&keep).is_ok(), "the other one is untouched");
        assert_eq!(library_status().drawer_count, Some(1));
    });
}
