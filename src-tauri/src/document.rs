use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;

use crate::models::{DocumentFileResult, DocumentSaveResult, WorkspaceError};

#[tauri::command]
pub fn read_document_file(path: String) -> Result<DocumentFileResult, WorkspaceError> {
    read_document_file_sync(path)
}

#[tauri::command]
pub fn save_document_file(
    real_path: String,
    content: String,
    expected_fingerprint: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    save_document_file_sync(real_path, content, expected_fingerprint)
}

#[tauri::command]
pub fn overwrite_document_file(
    real_path: String,
    content: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    overwrite_document_file_sync(real_path, content)
}

pub fn read_document_file_sync(path: String) -> Result<DocumentFileResult, WorkspaceError> {
    let display_path = PathBuf::from(&path);
    let real_path = canonicalize_document_path(&display_path)?;
    let content = read_document_content(&real_path)?;
    let file_name = real_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| WorkspaceError::new("invalid_name", "document path has no file name"))?
        .to_string();

    Ok(DocumentFileResult {
        content: content.clone(),
        file_name,
        display_path: path,
        real_path: real_path.to_string_lossy().into_owned(),
        fingerprint: document_fingerprint(&content),
    })
}

pub fn save_document_file_sync(
    real_path: String,
    content: String,
    expected_fingerprint: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    let path = canonicalize_document_path(Path::new(&real_path))?;
    let current_content = read_document_content(&path)?;
    let current_fingerprint = document_fingerprint(&current_content);
    if current_fingerprint != expected_fingerprint {
        return Err(WorkspaceError::new(
            "external_modified",
            "document was modified outside Loam",
        ));
    }

    write_document_content(&path, &content)?;

    Ok(DocumentSaveResult {
        fingerprint: document_fingerprint(&content),
    })
}

pub fn overwrite_document_file_sync(
    real_path: String,
    content: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    let path = canonicalize_document_path(Path::new(&real_path))?;
    write_document_content(&path, &content)?;

    Ok(DocumentSaveResult {
        fingerprint: document_fingerprint(&content),
    })
}

pub fn document_fingerprint(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn canonicalize_document_path(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let real_path = path.canonicalize().map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to resolve document path", &error)
    })?;
    ensure_markdown_document_path(&real_path)?;
    ensure_regular_file(&real_path)?;
    Ok(real_path)
}

fn read_document_content(path: &Path) -> Result<String, WorkspaceError> {
    fs::read_to_string(path)
        .map_err(|error| WorkspaceError::from_io("read_failed", "failed to read document", &error))
}

fn write_document_content(path: &Path, content: &str) -> Result<(), WorkspaceError> {
    ensure_regular_file(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceError::new("write_failed", "document path has no parent"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let mut temp_file = TempFileBuilder::new()
        .prefix(&format!(".{file_name}.mdx-tmp-"))
        .tempfile_in(parent)
        .map_err(|error| {
            WorkspaceError::from_io(
                "write_failed",
                "failed to create document temp file",
                &error,
            )
        })?;
    temp_file.write_all(content.as_bytes()).map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to write document temp file", &error)
    })?;
    temp_file.flush().map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to flush document temp file", &error)
    })?;
    temp_file.as_file().sync_all().map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to sync document temp file", &error)
    })?;
    temp_file.persist(path).map_err(|error| {
        WorkspaceError::new(
            "write_failed",
            format!("failed to replace document file: {}", error.error),
        )
    })?;

    Ok(())
}

fn ensure_markdown_document_path(path: &Path) -> Result<(), WorkspaceError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown") => Ok(()),
        _ => Err(WorkspaceError::new(
            "unsupported_file_type",
            "document mode only supports Markdown files",
        )),
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::metadata(path).map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to inspect document path", &error)
    })?;
    if metadata.is_file() {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "invalid_path",
            "document path must be a regular file",
        ))
    }
}
