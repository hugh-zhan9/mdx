use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::document::document_fingerprint;
use crate::models::{
    DraftCleanupResult, DraftDeleteResult, DraftGetResult, DraftListResult, DraftRecord,
    DraftSaveResult, DraftSummary, WorkspaceError,
};
use crate::path_guard::{canonicalize_workspace_root, is_allowed_markdown_file};

const SECONDS_PER_DAY: u64 = 86_400;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveRequest {
    pub real_path: String,
    pub display_path: Option<String>,
    pub markdown: String,
    pub base_fingerprint: Option<String>,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDraftRecord {
    draft_id: String,
    real_path: String,
    display_path: Option<String>,
    mode: String,
    base_fingerprint: Option<String>,
    updated_at: String,
    markdown: String,
}

struct DraftIdentity {
    draft_id: String,
    real_path: String,
}

#[tauri::command]
pub fn draft_save(request: DraftSaveRequest) -> Result<DraftSaveResult, WorkspaceError> {
    draft_save_in_dir(default_drafts_dir()?, request, SystemTime::now())
}

#[tauri::command]
pub fn draft_get(real_path: String) -> Result<DraftGetResult, WorkspaceError> {
    draft_get_in_dir(default_drafts_dir()?, real_path)
}

#[tauri::command]
pub fn draft_list_for_workspace(root_path: String) -> Result<DraftListResult, WorkspaceError> {
    draft_list_for_workspace_in_dir(default_drafts_dir()?, root_path)
}

#[tauri::command]
pub fn draft_delete(
    draft_id: Option<String>,
    real_path: Option<String>,
) -> Result<DraftDeleteResult, WorkspaceError> {
    draft_delete_in_dir(default_drafts_dir()?, draft_id, real_path)
}

#[tauri::command]
pub fn draft_cleanup_expired(retention_days: u64) -> Result<DraftCleanupResult, WorkspaceError> {
    cleanup_expired_drafts_in_dir(default_drafts_dir()?, retention_days, SystemTime::now())
}

pub fn draft_save_in_dir(
    drafts_dir: impl AsRef<Path>,
    request: DraftSaveRequest,
    now: SystemTime,
) -> Result<DraftSaveResult, WorkspaceError> {
    let drafts_dir = drafts_dir.as_ref();
    ensure_drafts_dir(drafts_dir)?;

    let identity = resolve_draft_identity(&request.real_path)?;
    let updated_at = timestamp_millis(now).to_string();
    let record = StoredDraftRecord {
        draft_id: identity.draft_id.clone(),
        real_path: identity.real_path,
        display_path: request.display_path,
        mode: request.mode,
        base_fingerprint: request.base_fingerprint,
        updated_at: updated_at.clone(),
        markdown: request.markdown,
    };

    write_draft_record(drafts_dir, &record)?;

    Ok(DraftSaveResult {
        draft_id: identity.draft_id,
        updated_at,
    })
}

pub fn draft_get_in_dir(
    drafts_dir: impl AsRef<Path>,
    real_path: String,
) -> Result<DraftGetResult, WorkspaceError> {
    let drafts_dir = drafts_dir.as_ref();
    ensure_drafts_dir(drafts_dir)?;

    let identity = resolve_draft_identity(&real_path)?;
    let draft_path = draft_file_path(drafts_dir, &identity.draft_id);
    let draft = read_draft_record(&draft_path)?.map(StoredDraftRecord::into_public);
    let (file_exists, current_fingerprint) = current_file_state(&identity.real_path)?;

    Ok(DraftGetResult {
        draft,
        file_exists,
        current_fingerprint,
    })
}

pub fn draft_list_for_workspace_in_dir(
    drafts_dir: impl AsRef<Path>,
    root_path: String,
) -> Result<DraftListResult, WorkspaceError> {
    let drafts_dir = drafts_dir.as_ref();
    ensure_drafts_dir(drafts_dir)?;
    let root = canonicalize_workspace_root(root_path)?;

    let mut drafts = Vec::new();
    for path in draft_json_files(drafts_dir)? {
        let Some(record) = read_draft_record(&path)? else {
            continue;
        };
        if !stored_path_is_under_root(&record.real_path, &root) {
            continue;
        }
        let file_exists = Path::new(&record.real_path).is_file();
        drafts.push(record.into_summary(file_exists));
    }

    drafts.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.real_path.cmp(&right.real_path))
    });

    Ok(DraftListResult { drafts })
}

pub fn draft_delete_in_dir(
    drafts_dir: impl AsRef<Path>,
    draft_id: Option<String>,
    real_path: Option<String>,
) -> Result<DraftDeleteResult, WorkspaceError> {
    let drafts_dir = drafts_dir.as_ref();
    ensure_drafts_dir(drafts_dir)?;

    let draft_id = match draft_id {
        Some(draft_id) => validate_draft_id(&draft_id)?,
        None => {
            let real_path = real_path.ok_or_else(|| {
                WorkspaceError::new("invalid_draft_delete", "draft id or real path is required")
            })?;
            resolve_draft_identity(&real_path)?.draft_id
        }
    };

    let path = draft_file_path(drafts_dir, &draft_id);
    match fs::remove_file(&path) {
        Ok(()) => Ok(DraftDeleteResult { deleted: true }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DraftDeleteResult { deleted: false })
        }
        Err(error) => Err(WorkspaceError::from_io(
            "draft_delete_failed",
            "failed to delete draft",
            &error,
        )),
    }
}

pub fn cleanup_expired_drafts_in_dir(
    drafts_dir: impl AsRef<Path>,
    retention_days: u64,
    now: SystemTime,
) -> Result<DraftCleanupResult, WorkspaceError> {
    let drafts_dir = drafts_dir.as_ref();
    ensure_drafts_dir(drafts_dir)?;

    let retention = Duration::from_secs(retention_days.saturating_mul(SECONDS_PER_DAY));
    let cutoff = now.checked_sub(retention).unwrap_or(UNIX_EPOCH);
    let cutoff_millis = timestamp_millis(cutoff);
    let mut deleted = 0;
    let mut kept = 0;

    for path in draft_json_files(drafts_dir)? {
        let Some(record) = read_draft_record(&path)? else {
            continue;
        };
        let updated_at = match record.updated_at.parse::<u128>() {
            Ok(value) => value,
            Err(_) => {
                backup_corrupt_draft_file(&path)?;
                continue;
            }
        };

        if updated_at < cutoff_millis {
            fs::remove_file(&path).map_err(|error| {
                WorkspaceError::from_io(
                    "draft_cleanup_failed",
                    "failed to delete expired draft",
                    &error,
                )
            })?;
            deleted += 1;
        } else {
            kept += 1;
        }
    }

    Ok(DraftCleanupResult { deleted, kept })
}

impl StoredDraftRecord {
    fn into_public(self) -> DraftRecord {
        DraftRecord {
            draft_id: self.draft_id,
            real_path: self.real_path,
            display_path: self.display_path,
            mode: self.mode,
            base_fingerprint: self.base_fingerprint,
            updated_at: self.updated_at,
            markdown: self.markdown,
        }
    }

    fn into_summary(self, file_exists: bool) -> DraftSummary {
        DraftSummary {
            draft_id: self.draft_id,
            real_path: self.real_path,
            display_path: self.display_path,
            mode: self.mode,
            base_fingerprint: self.base_fingerprint,
            updated_at: self.updated_at,
            file_exists,
        }
    }
}

fn resolve_draft_identity(real_path: &str) -> Result<DraftIdentity, WorkspaceError> {
    let input_path = Path::new(real_path);
    if !is_allowed_markdown_file(input_path) {
        return Err(invalid_markdown_path());
    }

    match fs::metadata(input_path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(invalid_markdown_path());
            }
            let canonical = input_path.canonicalize().map_err(|error| {
                WorkspaceError::from_io("draft_path_failed", "failed to resolve draft path", &error)
            })?;
            if !is_allowed_markdown_file(&canonical) {
                return Err(invalid_markdown_path());
            }
            let real_path = path_to_string(&canonical);
            Ok(DraftIdentity {
                draft_id: sha256_hex(real_path.as_bytes()),
                real_path,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if !input_path.is_absolute() {
                return Err(invalid_markdown_path());
            }
            let normalized = normalize_absolute_path(input_path)?;
            let real_path = path_to_string(&normalized);
            Ok(DraftIdentity {
                draft_id: sha256_hex(real_path.as_bytes()),
                real_path,
            })
        }
        Err(error) => Err(WorkspaceError::from_io(
            "draft_path_failed",
            "failed to inspect draft path",
            &error,
        )),
    }
}

fn normalize_absolute_path(path: &Path) -> Result<PathBuf, WorkspaceError> {
    if !path.is_absolute() || !is_allowed_markdown_file(path) {
        return Err(invalid_markdown_path());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    if !normalized.is_absolute() || !is_allowed_markdown_file(&normalized) {
        return Err(invalid_markdown_path());
    }
    canonicalize_existing_prefix(&normalized)
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let mut missing_components = Vec::new();
    let mut existing = path;

    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return Ok(path.to_path_buf());
        };
        if let Some(name) = existing.file_name() {
            missing_components.push(name.to_os_string());
        }
        existing = parent;
    }

    let mut normalized = existing.canonicalize().map_err(|error| {
        WorkspaceError::from_io(
            "draft_path_failed",
            "failed to resolve draft path ancestor",
            &error,
        )
    })?;
    for component in missing_components.iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

fn current_file_state(real_path: &str) -> Result<(bool, Option<String>), WorkspaceError> {
    let path = Path::new(real_path);
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let content = fs::read_to_string(path).map_err(|error| {
                WorkspaceError::from_io(
                    "draft_read_failed",
                    "failed to read current markdown file",
                    &error,
                )
            })?;
            Ok((true, Some(document_fingerprint(&content))))
        }
        Ok(_) => Ok((false, None)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((false, None)),
        Err(error) => Err(WorkspaceError::from_io(
            "draft_path_failed",
            "failed to inspect current markdown file",
            &error,
        )),
    }
}

fn write_draft_record(drafts_dir: &Path, record: &StoredDraftRecord) -> Result<(), WorkspaceError> {
    let bytes = serde_json::to_vec_pretty(record).map_err(|error| {
        WorkspaceError::new(
            "draft_save_failed",
            format!("failed to serialize draft: {error}"),
        )
    })?;
    let final_path = draft_file_path(drafts_dir, &record.draft_id);
    let temp_path = drafts_dir.join(format!(
        ".{}.tmp.{}.{}",
        final_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("draft.json"),
        std::process::id(),
        timestamp_nanos()
    ));

    {
        let mut file = create_private_file(&temp_path)?;
        file.write_all(&bytes).map_err(|error| {
            WorkspaceError::from_io(
                "draft_save_failed",
                "failed to write draft temp file",
                &error,
            )
        })?;
        file.sync_all().map_err(|error| {
            WorkspaceError::from_io(
                "draft_save_failed",
                "failed to sync draft temp file",
                &error,
            )
        })?;
    }

    fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        WorkspaceError::from_io("draft_save_failed", "failed to replace draft file", &error)
    })?;
    set_private_file_permissions(&final_path);

    Ok(())
}

fn create_private_file(path: &Path) -> Result<fs::File, WorkspaceError> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options.open(path).map_err(|error| {
        WorkspaceError::from_io(
            "draft_save_failed",
            "failed to create draft temp file",
            &error,
        )
    })
}

fn read_draft_record(path: &Path) -> Result<Option<StoredDraftRecord>, WorkspaceError> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<StoredDraftRecord>(&bytes) {
            Ok(record) => Ok(Some(record)),
            Err(_) => {
                backup_corrupt_draft_file(path)?;
                Ok(None)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WorkspaceError::from_io(
            "draft_read_failed",
            "failed to read draft",
            &error,
        )),
    }
}

fn draft_json_files(drafts_dir: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    let mut files = Vec::new();
    for entry in fs::read_dir(drafts_dir).map_err(|error| {
        WorkspaceError::from_io(
            "draft_list_failed",
            "failed to read draft directory",
            &error,
        )
    })? {
        let entry = entry.map_err(|error| {
            WorkspaceError::from_io("draft_list_failed", "failed to read draft entry", &error)
        })?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
            files.push(path);
        }
    }
    Ok(files)
}

fn backup_corrupt_draft_file(path: &Path) -> Result<(), WorkspaceError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("draft.json");
    let backup_path = parent.join(format!("{file_name}.corrupt.{}", timestamp_nanos()));

    fs::rename(path, backup_path).map_err(|error| {
        WorkspaceError::from_io(
            "draft_read_failed",
            "failed to back up corrupt draft file",
            &error,
        )
    })
}

fn stored_path_is_under_root(real_path: &str, root: &Path) -> bool {
    let path = Path::new(real_path);
    if !path.is_absolute() || !is_allowed_markdown_file(path) {
        return false;
    }

    let normalized = if path.exists() {
        match path.canonicalize() {
            Ok(path) => path,
            Err(_) => return false,
        }
    } else {
        match normalize_absolute_path(path) {
            Ok(path) => path,
            Err(_) => return false,
        }
    };

    normalized.starts_with(root)
}

fn draft_file_path(drafts_dir: &Path, draft_id: &str) -> PathBuf {
    drafts_dir.join(format!("{draft_id}.json"))
}

fn validate_draft_id(draft_id: &str) -> Result<String, WorkspaceError> {
    if draft_id.len() == 64 && draft_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(draft_id.to_ascii_lowercase())
    } else {
        Err(WorkspaceError::new(
            "invalid_draft_id",
            "draft id must be a SHA-256 hex string",
        ))
    }
}

fn ensure_drafts_dir(path: &Path) -> Result<(), WorkspaceError> {
    fs::create_dir_all(path).map_err(|error| {
        WorkspaceError::from_io(
            "draft_path_failed",
            "failed to create draft directory",
            &error,
        )
    })?;
    set_private_dir_permissions(path);
    Ok(())
}

fn default_drafts_dir() -> Result<PathBuf, WorkspaceError> {
    Ok(mdx_home_dir()?.join("drafts"))
}

fn mdx_home_dir() -> Result<PathBuf, WorkspaceError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| WorkspaceError::new("draft_path_failed", "home directory is not set"))?;
    Ok(PathBuf::from(home).join(".mdx"))
}

fn invalid_markdown_path() -> WorkspaceError {
    WorkspaceError::new(
        "invalid_markdown_path",
        "draft path must be an absolute Markdown file path",
    )
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn timestamp_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) {}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) {}
