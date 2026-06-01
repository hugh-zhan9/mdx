use std::path::{Path, PathBuf};
use std::{fs, io};

use crate::models::WorkspaceError;

pub fn canonicalize_in_workspace(
    root: impl AsRef<Path>,
    candidate: impl AsRef<Path>,
) -> Result<PathBuf, WorkspaceError> {
    let root = canonicalize_workspace_root(root.as_ref())?;
    let candidate = resolve_candidate_path(&root, candidate.as_ref());
    let candidate = fs::canonicalize(&candidate).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::NotFound {
            "not_found"
        } else if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "path_failed"
        };

        WorkspaceError::from_io(code, "failed to resolve workspace path", &error)
    })?;

    if !candidate.starts_with(&root) {
        return Err(WorkspaceError::new(
            "outside_workspace",
            "path is outside the workspace root",
        ));
    }

    Ok(candidate)
}

pub fn canonicalize_workspace_root(root: impl AsRef<Path>) -> Result<PathBuf, WorkspaceError> {
    let root = root.as_ref();

    if !root.exists() {
        return Err(WorkspaceError::new(
            "root_not_found",
            "workspace root does not exist",
        ));
    }

    let root = fs::canonicalize(root).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to resolve workspace root", &error)
    })?;

    let metadata = fs::metadata(&root).map_err(|error| {
        let code = if error.kind() == io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "scan_failed"
        };
        WorkspaceError::from_io(code, "failed to inspect workspace root", &error)
    })?;

    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_directory",
            "workspace root is not a directory",
        ));
    }

    Ok(root)
}

pub fn resolve_candidate_path(root: &Path, candidate: &Path) -> PathBuf {
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    }
}

pub fn sanitize_filename(name: &str) -> Result<String, WorkspaceError> {
    let name = name.trim();

    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(WorkspaceError::new(
            "invalid_name",
            "filename must be a single valid path segment",
        ));
    }

    Ok(name.to_string())
}

pub fn is_allowed_markdown_file(path: impl AsRef<Path>) -> bool {
    let Some(extension) = path.as_ref().extension().and_then(|ext| ext.to_str()) else {
        return false;
    };

    matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
}

pub fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "dist" | "build" | ".next" | "target"
    )
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn rejects_paths_outside_workspace_root() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("note.md");
        std::fs::write(&outside_file, "# Outside").unwrap();

        let err = canonicalize_in_workspace(root.path(), &outside_file).unwrap_err();
        assert_eq!(err.error_code(), "outside_workspace");
    }

    #[test]
    fn untitled_name_skips_existing_files() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Untitled.md"), "").unwrap();
        std::fs::write(dir.path().join("Untitled1.md"), "").unwrap();

        let name = crate::workspace_fs::next_untitled_name(dir.path()).unwrap();
        assert_eq!(name, "Untitled2.md");
    }
}
