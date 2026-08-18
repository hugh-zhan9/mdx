//! Bringing a workspace's old `memory/` directory into the library, once.
//!
//! This is a one-way door with the hinges deliberately left off the far side.
//! The old directory is read and nothing else: no file under
//! `<workspace>/memory/` is written, moved or deleted by any path in this
//! module, so the way back from a bad import is to stop using the new library,
//! not to restore anything. That is also why there is no schema migration —
//! the old Markdown files stay exactly where they are.
//!
//! Two things do not come across. The inbox held entries nobody confirmed, and
//! the working note held text that was rewritten every session; both concepts
//! were dropped, and importing them would resurrect them under a new name. They
//! are counted in the preflight so their absence afterwards is explained rather
//! than discovered.
//!
//! Everything that does come across arrives as **material**. A conclusion in
//! this product has to pass a gate, and nothing in a folder of old notes ever
//! did.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use mempal_runtime::core::db::Database;
use mempal_runtime::embed::Embedder;

use crate::memory::config::{memory_home_dir, read_global_config};
use crate::memory::embedder::readiness;
use crate::memory::models::legacy_import::{
    LegacyImportFailure, LegacyImportPreflight, LegacyImportReport, LegacyImportedEntry,
    LegacyNotImported, MATERIAL_NOT_CONCLUSIONS, NOT_IMPORTED_REASON,
};
use crate::models::WorkspaceError;

/// The old memory tree, relative to the workspace root.
const LEGACY_DIR: &str = "memory";

/// The two directories that carry content worth keeping, and the room each one
/// lands in.
///
/// The `legacy/` prefix is the point: imported material sits beside whatever
/// this workspace records from now on, and a room name is the only thing that
/// tells the two apart afterwards.
const IMPORTED_BUCKETS: [(&str, &str); 2] = [
    ("memories", "legacy/memories"),
    ("threads", "legacy/threads"),
];

/// The directory that is counted and skipped.
const INBOX_DIR: &str = "inbox";

/// The file that is counted and skipped.
const WORKING_FILE: &str = "working.md";

/// How many freshly imported entries the report lists by name.
///
/// Enough to start from, few enough to read. The full set is in the library.
const RECENT_LIMIT: usize = 20;

/// Reports what an import would do, touching nothing.
///
/// The counts here are a promise: `memories + threads` is exactly the number of
/// files [`import`] will scan, so the two can be compared without knowing how
/// either was computed.
pub fn preflight(workspace_root: &Path) -> Result<LegacyImportPreflight, WorkspaceError> {
    let scan = scan(workspace_root)?;
    let model_ready = readiness(&read_global_config()?)
        .map(|state| state.is_ready())
        .unwrap_or(false);

    Ok(LegacyImportPreflight {
        root_path: workspace_root.to_string_lossy().into_owned(),
        memories: scan.memories,
        threads: scan.threads,
        inbox: scan.inbox,
        working: scan.working,
        estimated_bytes: scan.bytes,
        model_ready,
        note: MATERIAL_NOT_CONCLUSIONS.to_string(),
    })
}

/// Reads the old directory into the library as material.
///
/// Re-running is safe and cheap to reason about: entry identity is derived from
/// the text, so a second run finds everything already stored and creates
/// nothing. One unreadable file is recorded and stepped over rather than
/// abandoning the other hundred — a half-finished import that says so beats an
/// all-or-nothing one that leaves the user guessing which half happened.
///
/// The report is written to `~/.loam/memory/import-reports/` before this
/// returns, so its path is available whether or not individual files failed.
pub fn import<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    workspace_root: &Path,
    wing: &str,
) -> Result<LegacyImportReport, WorkspaceError> {
    let legacy_root = workspace_root.join(LEGACY_DIR);
    if !legacy_root.is_dir() {
        return Err(WorkspaceError::new(
            "legacy_import_failed",
            format!(
                "{} has no {LEGACY_DIR} directory to import",
                workspace_root.display()
            ),
        ));
    }

    let scan = scan(workspace_root)?;
    let started_at = now_rfc3339();
    let before = active_drawer_ids(database)?;

    let mut files_imported = 0;
    let mut files_unchanged = 0;
    let mut entries_created = 0;
    let mut entries_already_present = 0;
    let mut failures = Vec::new();

    for file in &scan.files {
        match ingest_one(database, embedder, workspace_root, wing, file) {
            Ok(stats) => {
                if stats.created > 0 {
                    files_imported += 1;
                } else {
                    files_unchanged += 1;
                }
                entries_created += stats.created;
                entries_already_present += stats.already_present;
            }
            Err(error) => failures.push(LegacyImportFailure {
                path: relative_to(workspace_root, &file.path),
                reason: error.to_string(),
            }),
        }
    }

    let recent = recent_entries(database, &before)?;
    let report_path = report_path()?;
    let report = LegacyImportReport {
        root_path: workspace_root.to_string_lossy().into_owned(),
        wing: wing.to_string(),
        started_at,
        finished_at: now_rfc3339(),
        files_scanned: scan.files.len(),
        files_imported,
        files_unchanged,
        files_failed: failures.len(),
        entries_created,
        entries_already_present,
        not_imported: LegacyNotImported {
            inbox: scan.inbox,
            working: scan.working,
            reason: NOT_IMPORTED_REASON.to_string(),
        },
        failures,
        recent,
        report_path: report_path.to_string_lossy().into_owned(),
        note: MATERIAL_NOT_CONCLUSIONS.to_string(),
    };

    write_report(&report_path, &report)?;

    Ok(report)
}

/// One old file, and where its material belongs.
struct LegacyFile {
    path: PathBuf,
    room: &'static str,
}

/// What is in the old directory.
struct LegacyScan {
    /// Only the files that will be imported, in a stable order.
    files: Vec<LegacyFile>,
    memories: usize,
    threads: usize,
    inbox: usize,
    working: bool,
    bytes: u64,
}

fn scan(workspace_root: &Path) -> Result<LegacyScan, WorkspaceError> {
    let legacy_root = workspace_root.join(LEGACY_DIR);
    let mut files = Vec::new();
    let mut counts = [0_usize; IMPORTED_BUCKETS.len()];
    let mut bytes = 0_u64;

    for (index, (directory, room)) in IMPORTED_BUCKETS.iter().enumerate() {
        let mut found = Vec::new();
        collect_markdown(&legacy_root.join(directory), &mut found)?;
        counts[index] = found.len();

        for path in found {
            bytes += file_size(&path);
            files.push(LegacyFile { path, room });
        }
    }

    let mut inbox = Vec::new();
    collect_markdown(&legacy_root.join(INBOX_DIR), &mut inbox)?;

    Ok(LegacyScan {
        files,
        memories: counts[0],
        threads: counts[1],
        inbox: inbox.len(),
        working: legacy_root.join(WORKING_FILE).is_file(),
        bytes,
    })
}

/// Every Markdown file under one directory, deepest paths included.
///
/// Symbolic links are stepped over, both the ones pointing at files and the
/// ones pointing at directories. A link is the one way a scan rooted inside the
/// workspace could end up reading — or looping over — something outside it, and
/// no old memory directory has ever legitimately contained one.
fn collect_markdown(directory: &Path, found: &mut Vec<PathBuf>) -> Result<(), WorkspaceError> {
    if !directory.is_dir() {
        return Ok(());
    }

    let mut pending = vec![directory.to_path_buf()];
    while let Some(current) = pending.pop() {
        let entries = std::fs::read_dir(&current).map_err(|error| {
            WorkspaceError::from_io(
                "legacy_import_failed",
                format!("failed to read {}", current.display()),
                &error,
            )
        })?;

        let mut directories = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| {
                WorkspaceError::from_io(
                    "legacy_import_failed",
                    format!("failed to list {}", current.display()),
                    &error,
                )
            })?;
            let file_type = entry.file_type().map_err(|error| {
                WorkspaceError::from_io(
                    "legacy_import_failed",
                    format!("failed to inspect {}", entry.path().display()),
                    &error,
                )
            })?;

            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                directories.push(entry.path());
            } else if is_markdown(&entry.path()) {
                found.push(entry.path());
            }
        }

        directories.sort();
        pending.extend(directories.into_iter().rev());
    }

    found.sort();

    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|data| data.len()).unwrap_or(0)
}

/// What one file did to the library.
struct FileOutcome {
    created: usize,
    already_present: usize,
}

/// Reads one old file into the library.
///
/// This calls the upstream ingest directly rather than going through
/// [`crate::memory::evidence::ingest_file`], for one reason: that door derives
/// the room from the file's own location, which would put every imported file
/// in a room called `memory`, and the import is specified to land in
/// `legacy/<directory>` so it stays distinguishable from live material.
/// Everything else — format detection, transcript noise stripping, chunking,
/// content-addressed identity, the per-source lock — is upstream's, unchanged.
fn ingest_one<E: Embedder + ?Sized>(
    database: &Database,
    embedder: &E,
    workspace_root: &Path,
    wing: &str,
    file: &LegacyFile,
) -> Result<FileOutcome, WorkspaceError> {
    let outcome = crate::memory::evidence::ingest_file(
        database,
        embedder,
        workspace_root,
        wing,
        &file.path,
        Some(file.room),
    )?;


    Ok(FileOutcome {
        created: outcome.chunks,
        already_present: outcome.skipped,
    })
}

fn active_drawer_ids(database: &Database) -> Result<HashSet<String>, WorkspaceError> {
    let drawers = database.all_active_drawers().map_err(|error| {
        WorkspaceError::new(
            "legacy_import_failed",
            format!("failed to read what memory already holds: {error}"),
        )
    })?;

    Ok(drawers.into_iter().map(|(id, _)| id).collect())
}

/// The newest material this run produced.
///
/// Derived by comparing the library before and after rather than by trusting
/// the per-file counts, because upstream's ingest reports how many entries it
/// wrote but not which ones, and the panel needs identifiers it can hand
/// straight to distillation.
fn recent_entries(
    database: &Database,
    before: &HashSet<String>,
) -> Result<Vec<LegacyImportedEntry>, WorkspaceError> {
    let after = active_drawer_ids(database)?;
    let mut entries = Vec::new();

    for id in after.difference(before) {
        let drawer = database
            .get_drawer(id)
            .map_err(|error| {
                WorkspaceError::new(
                    "legacy_import_failed",
                    format!("failed to read back {id}: {error}"),
                )
            })?
            .ok_or_else(|| {
                WorkspaceError::new(
                    "legacy_import_failed",
                    format!("{id} disappeared while the import was running"),
                )
            })?;

        entries.push(LegacyImportedEntry {
            drawer_id: drawer.id,
            source_file: drawer.source_file.unwrap_or_default(),
            room: drawer.room.unwrap_or_default(),
            added_at: drawer.added_at,
        });
    }

    // Newest first, and by identifier where the clock cannot tell two entries
    // apart — the timestamps have one-second resolution and an import writes
    // far more than one entry a second.
    entries.sort_by(|left, right| {
        right
            .added_at
            .cmp(&left.added_at)
            .then_with(|| left.drawer_id.cmp(&right.drawer_id))
    });
    entries.truncate(RECENT_LIMIT);

    Ok(entries)
}

fn reports_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(memory_home_dir()?.join("import-reports"))
}

/// A path no earlier report is using.
///
/// Timestamps have one-second resolution, so two imports started in the same
/// second would otherwise overwrite each other's evidence of what happened.
fn report_path() -> Result<PathBuf, WorkspaceError> {
    let directory = reports_dir()?;
    let stamp = timestamp_slug();
    let candidate = directory.join(format!("{stamp}.json"));
    if !candidate.exists() {
        return Ok(candidate);
    }

    for attempt in 2..1000 {
        let candidate = directory.join(format!("{stamp}-{attempt}.json"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(WorkspaceError::new(
        "legacy_import_failed",
        format!("cannot find an unused report name in {}", directory.display()),
    ))
}

fn write_report(path: &Path, report: &LegacyImportReport) -> Result<(), WorkspaceError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "legacy_import_failed",
                "failed to create the import report directory",
                &error,
            )
        })?;
    }

    let mut contents = serde_json::to_string_pretty(report).map_err(|error| {
        WorkspaceError::new(
            "legacy_import_failed",
            format!("failed to encode the import report: {error}"),
        )
    })?;
    contents.push('\n');

    std::fs::write(path, contents).map_err(|error| {
        WorkspaceError::from_io(
            "legacy_import_failed",
            "failed to write the import report",
            &error,
        )
    })
}

fn relative_to(workspace_root: &Path, path: &Path) -> String {
    path.strip_prefix(workspace_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn timestamp_slug() -> String {
    let now = time::OffsetDateTime::now_utc();

    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::engine::{library_path, wing_for};

    /// A stand-in for the real model: deterministic, offline, four dimensions.
    struct FixedEmbedder;

    #[async_trait::async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, texts: &[&str]) -> mempal_runtime::embed::Result<Vec<Vec<f32>>> {
            Ok(texts
                .iter()
                .map(|text| vec![text.len() as f32, 0.25, 0.5, 0.75])
                .collect())
        }

        fn dimensions(&self) -> usize {
            4
        }

        fn name(&self) -> &str {
            "fixed-test-embedder"
        }
    }

    fn open_library() -> Database {
        let path = library_path().expect("library path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        Database::open(&path).expect("open library")
    }

    fn write_file(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&path, contents).expect("write");
    }

    /// An old memory directory with one of everything.
    fn legacy_workspace() -> tempfile::TempDir {
        let workspace = tempfile::tempdir().expect("workspace");
        let root = workspace.path();

        write_file(
            root,
            "memory/memories/2026-01-02-pdf-export.md",
            "# PDF export\n\nExports embed a subset of a system CJK face.\n",
        );
        write_file(
            root,
            "memory/memories/nested/2026-02-03-fonts.md",
            "# Fonts\n\nThe fallback chain ends at the platform face.\n",
        );
        write_file(
            root,
            "memory/threads/codex/2026-03-04-session.md",
            "# Session\n\nWe worked through the layout regression together.\n",
        );
        write_file(
            root,
            "memory/inbox/2026-04-05-unconfirmed.md",
            "an unconfirmed guess nobody ever accepted\n",
        );
        write_file(
            root,
            "memory/inbox/2026-04-06-also-unconfirmed.md",
            "another unconfirmed guess\n",
        );
        write_file(
            root,
            "memory/working.md",
            "scratch notes that were rewritten every session\n",
        );
        // Not Markdown, and not counted.
        write_file(root, "memory/memories/notes.txt", "not markdown\n");

        workspace
    }

    /// Path, size and modification time for everything under a directory.
    fn tree_fingerprint(directory: &Path) -> Vec<(PathBuf, u64, std::time::SystemTime)> {
        let mut entries = Vec::new();
        let mut pending = vec![directory.to_path_buf()];

        while let Some(current) = pending.pop() {
            for entry in std::fs::read_dir(&current).expect("read dir") {
                let entry = entry.expect("entry");
                let metadata = entry.metadata().expect("metadata");
                if metadata.is_dir() {
                    pending.push(entry.path());
                } else {
                    entries.push((
                        entry.path(),
                        metadata.len(),
                        metadata.modified().expect("mtime"),
                    ));
                }
            }
        }

        entries.sort();
        entries
    }

    #[test]
    fn the_preflight_counts_what_comes_in_and_what_stays_out() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();

            let preflight = preflight(workspace.path()).expect("preflight");

            assert_eq!(preflight.memories, 2, "one at the top level, one nested");
            assert_eq!(preflight.threads, 1);
            assert_eq!(preflight.inbox, 2);
            assert!(preflight.working);
            assert!(
                !preflight.model_ready,
                "no model has been downloaded into this home"
            );
            assert!(preflight.note.contains("material"));

            // Only the three files that will actually be read are measured.
            let expected: u64 = [
                "memory/memories/2026-01-02-pdf-export.md",
                "memory/memories/nested/2026-02-03-fonts.md",
                "memory/threads/codex/2026-03-04-session.md",
            ]
            .iter()
            .map(|relative| {
                std::fs::metadata(workspace.path().join(relative))
                    .expect("metadata")
                    .len()
            })
            .sum();
            assert_eq!(preflight.estimated_bytes, expected);
        });
    }

    #[test]
    fn a_workspace_without_an_old_directory_is_refused() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let preflight = preflight(workspace.path()).expect("preflight");
            assert_eq!(preflight.memories, 0);
            assert_eq!(preflight.threads, 0);
            assert!(!preflight.working);

            let error = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect_err("nothing to import");

            assert_eq!(error.error_code(), "legacy_import_failed");
        });
    }

    #[test]
    fn the_import_matches_the_preflight_and_lands_as_material() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let preflight = preflight(workspace.path()).expect("preflight");
            let report = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("import");

            assert_eq!(
                report.files_scanned,
                preflight.memories + preflight.threads,
                "the preflight promised a different number of files"
            );
            assert_eq!(report.files_imported, report.files_scanned);
            assert_eq!(report.files_unchanged, 0);
            assert_eq!(report.files_failed, 0);
            assert!(report.entries_created >= report.files_scanned);
            assert_eq!(report.entries_already_present, 0);
            assert_eq!(report.wing, wing);

            // Everything that arrived is material, in a legacy room, still
            // pointing at the file it came from.
            let ids = active_drawer_ids(&database).expect("ids");
            assert_eq!(ids.len(), report.entries_created);
            for id in &ids {
                let drawer = database.get_drawer(id).expect("lookup").expect("stored");
                assert_eq!(
                    drawer.memory_kind,
                    mempal_runtime::core::types::MemoryKind::Evidence,
                    "importing must not manufacture conclusions"
                );
                assert!(drawer.status.is_none(), "material has no lifecycle status");
                assert!(drawer.tier.is_none());
                assert_eq!(drawer.wing, wing);
                let room = drawer.room.expect("room");
                assert!(
                    room == "legacy/memories" || room == "legacy/threads",
                    "unexpected room {room}"
                );
                let source = drawer.source_file.expect("source file");
                assert!(
                    source.starts_with("memory/memories/") || source.starts_with("memory/threads/"),
                    "unexpected source {source}"
                );
            }

            assert!(report.note.contains("material, not conclusions"));
            assert!(!report.recent.is_empty(), "the report has to name something");
            assert!(report.recent.len() <= RECENT_LIMIT);
            for entry in &report.recent {
                assert!(ids.contains(&entry.drawer_id));
            }
        });
    }

    #[test]
    fn the_inbox_and_the_working_note_never_reach_the_library() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let report = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("import");

            assert_eq!(report.not_imported.inbox, 2);
            assert!(report.not_imported.working);
            assert!(report.not_imported.reason.contains("inbox"));

            for (id, content) in database.all_active_drawers().expect("drawers") {
                assert!(
                    !content.contains("unconfirmed guess"),
                    "an inbox entry reached the library as {id}"
                );
                assert!(
                    !content.contains("rewritten every session"),
                    "the working note reached the library as {id}"
                );
                let drawer = database.get_drawer(&id).expect("lookup").expect("stored");
                let source = drawer.source_file.unwrap_or_default();
                assert!(!source.contains("inbox"), "{source}");
                assert!(!source.contains("working.md"), "{source}");
            }
        });
    }

    #[test]
    fn running_it_twice_changes_nothing() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let first = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("first import");
            let after_first = database.drawer_count().expect("count");

            let second = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("second import");

            assert_eq!(second.files_scanned, first.files_scanned);
            assert_eq!(second.files_imported, 0, "nothing was new the second time");
            assert_eq!(second.files_unchanged, second.files_scanned);
            assert_eq!(second.entries_created, 0);
            assert_eq!(second.entries_already_present, first.entries_created);
            assert!(second.recent.is_empty());
            assert_eq!(database.drawer_count().expect("count"), after_first);
        });
    }

    #[test]
    fn the_old_directory_is_left_exactly_as_it_was() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();
            let legacy_root = workspace.path().join(LEGACY_DIR);
            let before = tree_fingerprint(&legacy_root);

            preflight(workspace.path()).expect("preflight");
            import(&database, &FixedEmbedder, workspace.path(), &wing).expect("import");
            import(&database, &FixedEmbedder, workspace.path(), &wing).expect("second import");

            assert_eq!(
                tree_fingerprint(&legacy_root),
                before,
                "the old memory directory must be read-only"
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn one_unreadable_file_does_not_stop_the_others() {
        use std::os::unix::fs::PermissionsExt;

        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let blocked = workspace
                .path()
                .join("memory/memories/2026-05-06-locked.md");
            std::fs::write(&blocked, "a file this process may not read\n").expect("write");
            std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o000))
                .expect("chmod");

            let report = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("the import as a whole still succeeds");

            assert_eq!(report.files_failed, 1);
            assert_eq!(
                report.failures[0].path,
                "memory/memories/2026-05-06-locked.md"
            );
            assert!(!report.failures[0].reason.is_empty());
            assert_eq!(
                report.files_imported, 3,
                "the other three files still went in"
            );
            assert!(Path::new(&report.report_path).is_file());

            // Let the temporary directory clean itself up.
            std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o644))
                .expect("restore");
        });
    }

    #[test]
    fn the_report_is_written_under_the_application_home_and_reads_back() {
        with_scoped_home(|home| {
            let workspace = legacy_workspace();
            let wing = wing_for(workspace.path()).expect("wing");
            let database = open_library();

            let report = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("import");

            let path = PathBuf::from(&report.report_path);
            assert!(
                path.starts_with(home.path().join("memory").join("import-reports")),
                "the report escaped the application home: {}",
                path.display()
            );
            let stored: LegacyImportReport =
                serde_json::from_str(&std::fs::read_to_string(&path).expect("read"))
                    .expect("the report on disk parses back");
            assert_eq!(stored, report);

            // A second run keeps the first report rather than overwriting it.
            let again = import(&database, &FixedEmbedder, workspace.path(), &wing)
                .expect("second import");
            assert_ne!(again.report_path, report.report_path);
            assert!(path.is_file(), "the earlier report was overwritten");
        });
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed() {
        with_scoped_home(|_home| {
            let workspace = legacy_workspace();
            let outside = tempfile::tempdir().expect("outside");
            std::fs::write(outside.path().join("secret.md"), "not ours to read\n")
                .expect("write");
            std::os::unix::fs::symlink(
                outside.path(),
                workspace.path().join("memory/memories/linked"),
            )
            .expect("symlink");

            let preflight = preflight(workspace.path()).expect("preflight");

            assert_eq!(preflight.memories, 2, "the linked tree must not be counted");
        });
    }
}
