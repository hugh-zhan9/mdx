//! Opening the library, and deciding which project a workspace is.
//!
//! One library serves every workspace: `~/.mdx/memory/palace.db`. That is what
//! makes cross-project recall possible at all, and it is also why the process
//! holds a single handle behind a mutex — several windows and a sidecar now
//! write to the same file, and the in-process serialization is the part we can
//! actually guarantee. Across processes, SQLite's own write lock and the
//! upstream per-source advisory lock are what remain.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mempal_runtime::core::db::{CURRENT_SCHEMA_VERSION, Database, DbError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::memory::config::{memory_home_dir, GlobalMemoryConfig};
use crate::memory::embedder::{build_embedder, readiness, ModelReadiness};
use crate::models::WorkspaceError;

static LIBRARY: Mutex<Option<Database>> = Mutex::new(None);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
struct WingBindings {
    #[serde(default)]
    bindings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub path: String,
    pub exists: bool,
    pub schema_version: Option<u32>,
    pub supported_schema_version: u32,
    pub writable: bool,
    pub drawer_count: Option<i64>,
    pub embedding_dim: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexReport {
    pub reembedded: usize,
    pub dimensions: usize,
}

pub fn library_path() -> Result<PathBuf, WorkspaceError> {
    Ok(memory_home_dir()?.join("palace.db"))
}

fn wings_path() -> Result<PathBuf, WorkspaceError> {
    Ok(memory_home_dir()?.join("wings.json"))
}

/// Runs one operation against the library, opening it on first use.
///
/// Everything that touches memory goes through here, so writes from different
/// windows queue up instead of interleaving.
pub fn with_library<T>(
    operation: impl FnOnce(&Database) -> Result<T, WorkspaceError>,
) -> Result<T, WorkspaceError> {
    let mut guard = LIBRARY.lock().map_err(|_| {
        WorkspaceError::new(
            "memory_unavailable",
            "the memory library is in an unrecoverable state in this session",
        )
    })?;

    if guard.is_none() {
        *guard = Some(open_library()?);
    }

    let database = guard.as_ref().expect("library was opened above");
    operation(database)
}

/// Drops the process-wide handle so the next call reopens the file.
///
/// Needed after anything that replaces the database underneath us — a restore,
/// or a test pointing `HOME` somewhere else.
pub fn close_library() {
    if let Ok(mut guard) = LIBRARY.lock() {
        *guard = None;
    }
}

fn open_library() -> Result<Database, WorkspaceError> {
    let path = library_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "memory_unavailable",
                "failed to create the memory library directory",
                &error,
            )
        })?;
    }

    Database::open(&path).map_err(|error| match error {
        DbError::UnsupportedSchemaVersion { current, supported } => WorkspaceError::new(
            "schema_incompatible",
            format!(
                "the memory library is at schema version {current}, but this version of the app supports {supported}. Update the app; memory stays read-only until then."
            ),
        ),
        other => WorkspaceError::new(
            "memory_unavailable",
            format!("failed to open the memory library at {}: {other}", path.display()),
        ),
    })
}

/// A status report that answers rather than fails.
///
/// The panel needs to say what is wrong with the library, which means this
/// cannot be the thing that refuses to produce an answer when the library is
/// broken.
pub fn library_status() -> LibraryStatus {
    let path = match library_path() {
        Ok(path) => path,
        Err(error) => {
            return LibraryStatus {
                path: String::new(),
                exists: false,
                schema_version: None,
                supported_schema_version: CURRENT_SCHEMA_VERSION,
                writable: false,
                drawer_count: None,
                embedding_dim: None,
                error: Some(error.to_string()),
            };
        }
    };
    let exists = path.is_file();

    match with_library(|database| {
        Ok((
            database.schema_version().ok(),
            database.drawer_count().ok(),
            database.embedding_dim().ok().flatten(),
        ))
    }) {
        Ok((schema_version, drawer_count, embedding_dim)) => LibraryStatus {
            path: path.to_string_lossy().into_owned(),
            exists,
            schema_version,
            supported_schema_version: CURRENT_SCHEMA_VERSION,
            writable: true,
            drawer_count,
            embedding_dim,
            error: None,
        },
        Err(error) => LibraryStatus {
            path: path.to_string_lossy().into_owned(),
            exists,
            schema_version: None,
            supported_schema_version: CURRENT_SCHEMA_VERSION,
            writable: false,
            drawer_count: None,
            embedding_dim: None,
            error: Some(error.to_string()),
        },
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDiagnostics {
    pub library: LibraryStatus,
    pub model: ModelDiagnostics,
    pub projects: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDiagnostics {
    pub model: String,
    pub ready: bool,
    pub dir: String,
    pub missing: Vec<String>,
}

/// One report covering everything that decides whether memory works.
///
/// The upstream report contributes what it knows about the database file. Its
/// install section is deliberately dropped: it describes a command-line tool
/// this application does not ship, and telling a user to run `mempal doctor`
/// would be advice they cannot follow.
pub fn diagnostics(config: &GlobalMemoryConfig) -> MemoryDiagnostics {
    let library = library_status();
    let mut warnings = Vec::new();

    if let Ok(path) = library_path() {
        let upstream = mempal_runtime::doctor::build_doctor_report(&path);
        if !upstream.db.compatible {
            warnings.push(format!(
                "the library reports schema version {:?}, supported is {}",
                upstream.db.schema_version, upstream.supported_schema_version
            ));
        }
        if let Some(error) = upstream.db.error {
            warnings.push(error);
        }
    }

    let model = match readiness(config) {
        Ok(ModelReadiness::Ready { model, dir }) => ModelDiagnostics {
            model,
            ready: true,
            dir: dir.to_string_lossy().into_owned(),
            missing: Vec::new(),
        },
        Ok(ModelReadiness::Missing { model, missing }) => {
            warnings.push(format!(
                "the embedding model {model} is not downloaded; memory cannot be written to until it is"
            ));
            ModelDiagnostics {
                model,
                ready: false,
                dir: String::new(),
                missing,
            }
        }
        Err(error) => {
            warnings.push(error.to_string());
            ModelDiagnostics {
                model: config.embedding.model.clone(),
                ready: false,
                dir: String::new(),
                missing: Vec::new(),
            }
        }
    };

    let projects = match wing_bindings() {
        Ok(bindings) => {
            for (path, wing) in &bindings {
                if !Path::new(path).is_dir() {
                    warnings.push(format!(
                        "project {wing} is bound to {path}, which no longer exists — rebind it or its memories stay unreachable"
                    ));
                }
            }
            bindings.len()
        }
        Err(error) => {
            warnings.push(error.to_string());
            0
        }
    };

    MemoryDiagnostics {
        library,
        model,
        projects,
        warnings,
    }
}

/// The wing a workspace belongs to, creating the binding on first sight.
///
/// The name carries a hash of the absolute path because two projects can be
/// called `notes`, and merging their memories would be worse than any naming
/// awkwardness.
pub fn wing_for(root: &Path) -> Result<String, WorkspaceError> {
    let key = binding_key(root);
    let mut bindings = read_bindings()?;

    if let Some(wing) = bindings.bindings.get(&key) {
        return Ok(wing.clone());
    }

    let wing = derive_wing_name(root);
    bindings.bindings.insert(key, wing.clone());
    write_bindings(&bindings)?;

    Ok(wing)
}

/// Whether this workspace already has a wing, without creating one.
pub fn bound_wing(root: &Path) -> Result<Option<String>, WorkspaceError> {
    Ok(read_bindings()?.bindings.get(&binding_key(root)).cloned())
}

/// Points an existing wing at a moved or renamed workspace.
///
/// Explicit on purpose: a renamed directory looks exactly like a new project,
/// and guessing wrong either splits one project in two or merges two into one.
/// Only the user knows which happened.
pub fn rebind_wing(wing: &str, new_root: &Path) -> Result<(), WorkspaceError> {
    let mut bindings = read_bindings()?;
    let known = bindings
        .bindings
        .values()
        .any(|candidate| candidate == wing);
    if !known {
        return Err(WorkspaceError::new(
            "wing_unbound",
            format!("no memory project named {wing} is bound to any path"),
        ));
    }

    bindings
        .bindings
        .retain(|_, candidate| candidate != wing);
    bindings
        .bindings
        .insert(binding_key(new_root), wing.to_string());
    write_bindings(&bindings)
}

pub fn wing_bindings() -> Result<BTreeMap<String, String>, WorkspaceError> {
    Ok(read_bindings()?.bindings)
}

/// Re-embeds every drawer after a model or dimension change.
///
/// The vector table is keyed by dimension, so a different model does not
/// degrade search — it makes the stored vectors unusable. This is the explicit,
/// interruptible way back, not something that happens quietly at startup.
pub fn reindex(config: &GlobalMemoryConfig) -> Result<ReindexReport, WorkspaceError> {
    let embedder = build_embedder(config)?;
    let dimensions = {
        use mempal_runtime::embed::Embedder;
        embedder.dimensions()
    };

    with_library(|database| {
        database.recreate_vectors_table(dimensions).map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to reset the vector index: {error}"),
            )
        })?;

        let drawers = database.all_active_drawers().map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to list stored memory: {error}"),
            )
        })?;

        let mut reembedded = 0;
        for (drawer_id, content) in drawers {
            let vector = embed_one(&embedder, &content)?;
            database.insert_vector(&drawer_id, &vector).map_err(|error| {
                WorkspaceError::new(
                    "memory_unavailable",
                    format!("failed to store a vector for {drawer_id}: {error}"),
                )
            })?;
            reembedded += 1;
        }

        Ok(ReindexReport {
            reembedded,
            dimensions,
        })
    })
}

/// Refuses to write when the stored vectors were made by another model.
pub fn ensure_embedding_dim_matches(config: &GlobalMemoryConfig) -> Result<(), WorkspaceError> {
    let ModelReadiness::Ready { .. } = readiness(config)? else {
        return Err(WorkspaceError::new(
            "embedding_model_missing",
            "the embedding model has not been downloaded yet",
        ));
    };
    let embedder = build_embedder(config)?;
    let dimensions = {
        use mempal_runtime::embed::Embedder;
        embedder.dimensions()
    };

    with_library(|database| {
        let stored = database.embedding_dim().map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("failed to read the stored vector dimension: {error}"),
            )
        })?;

        match stored {
            Some(stored) if stored != dimensions => Err(WorkspaceError::new(
                "embedding_dim_mismatch",
                format!(
                    "the library holds {stored}-dimension vectors but the current model produces {dimensions}. Re-index before writing."
                ),
            )),
            _ => Ok(()),
        }
    })
}

pub(crate) fn embed_one(
    embedder: &(impl mempal_runtime::embed::Embedder + ?Sized),
    content: &str,
) -> Result<Vec<f32>, WorkspaceError> {
    let vectors = block_on(embedder.embed(&[content])).map_err(|error| {
        WorkspaceError::new(
            "embedding_failed",
            format!("failed to embed stored memory: {error}"),
        )
    })?;

    vectors.into_iter().next().ok_or_else(|| {
        WorkspaceError::new("embedding_failed", "the embedder returned no vector")
    })
}

/// Runs one future to completion on the calling thread.
///
/// The upstream read and write paths are async because they touch files; every
/// caller here is already on a blocking Tauri command thread, so borrowing the
/// application's runtime is simpler than threading async all the way up.
pub(crate) fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn binding_key(root: &Path) -> String {
    root.canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn derive_wing_name(root: &Path) -> String {
    let key = binding_key(root);
    let name = Path::new(&key)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workspace".to_string());
    let slug: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let slug = if slug.is_empty() {
        "workspace".to_string()
    } else {
        slug
    };

    let digest = Sha256::digest(key.as_bytes());
    let suffix: String = format!("{digest:x}").chars().take(6).collect();

    format!("{slug}-{suffix}")
}

fn read_bindings() -> Result<WingBindings, WorkspaceError> {
    let path = wings_path()?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|error| {
            WorkspaceError::new(
                "memory_unavailable",
                format!("{} is not a readable project binding file: {error}", path.display()),
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(WingBindings::default()),
        Err(error) => Err(WorkspaceError::from_io(
            "memory_unavailable",
            "failed to read the memory project bindings",
            &error,
        )),
    }
}

fn write_bindings(bindings: &WingBindings) -> Result<(), WorkspaceError> {
    let path = wings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorkspaceError::from_io(
                "memory_unavailable",
                "failed to create the memory home directory",
                &error,
            )
        })?;
    }

    let mut contents = serde_json::to_string_pretty(bindings).map_err(|error| {
        WorkspaceError::new(
            "memory_unavailable",
            format!("failed to encode the memory project bindings: {error}"),
        )
    })?;
    contents.push('\n');

    std::fs::write(&path, contents).map_err(|error| {
        WorkspaceError::from_io(
            "memory_unavailable",
            "failed to write the memory project bindings",
            &error,
        )
    })
}
