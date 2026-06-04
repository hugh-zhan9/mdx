use tempfile::tempdir;

use crate::document::{
    document_fingerprint, overwrite_document_file_sync, read_document_file_sync,
    save_document_file_sync,
};

#[test]
fn read_document_file_accepts_markdown_and_returns_fingerprint() {
    let root = tempdir().unwrap();
    let path = root.path().join("note.md");
    let content = "# Note\n";
    std::fs::write(&path, content).unwrap();

    let result = read_document_file_sync(path.to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.content, content);
    assert_eq!(result.file_name, "note.md");
    assert_eq!(result.display_path, path.to_string_lossy());
    assert_eq!(
        result.real_path,
        path.canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(result.fingerprint, document_fingerprint(content));
}

#[test]
fn read_document_file_rejects_mdx() {
    let root = tempdir().unwrap();
    let path = root.path().join("component.mdx");
    std::fs::write(&path, "# Component\n").unwrap();

    let err = read_document_file_sync(path.to_string_lossy().into_owned()).unwrap_err();

    assert_eq!(err.error_code(), "unsupported_file_type");
}

#[test]
#[cfg(unix)]
fn read_document_file_canonicalizes_unix_symlink() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let real_path = root.path().join("real.md");
    let link_path = root.path().join("link.md");
    std::fs::write(&real_path, "# Real\n").unwrap();
    symlink(&real_path, &link_path).unwrap();

    let result = read_document_file_sync(link_path.to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.display_path, link_path.to_string_lossy());
    assert_eq!(
        result.real_path,
        real_path.canonicalize().unwrap().to_string_lossy()
    );
}

#[test]
fn save_document_file_rejects_external_modification() {
    let root = tempdir().unwrap();
    let path = root.path().join("note.markdown");
    std::fs::write(&path, "original").unwrap();
    let loaded = read_document_file_sync(path.to_string_lossy().into_owned()).unwrap();
    std::fs::write(&path, "external").unwrap();

    let err = save_document_file_sync(
        loaded.real_path,
        "local edit".to_string(),
        loaded.fingerprint,
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "external_modified");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external");
}

#[test]
fn overwrite_document_file_writes_and_updates_fingerprint() {
    let root = tempdir().unwrap();
    let path = root.path().join("note.md");
    std::fs::write(&path, "external").unwrap();

    let result = overwrite_document_file_sync(
        path.to_string_lossy().into_owned(),
        "local edit".to_string(),
    )
    .unwrap();

    assert_eq!(std::fs::read_to_string(&path).unwrap(), "local edit");
    assert_eq!(result.fingerprint, document_fingerprint("local edit"));
}

#[test]
#[cfg(unix)]
fn overwrite_document_file_does_not_follow_predictable_temp_symlink() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let path = root.path().join("note.md");
    let symlink_target = root.path().join("outside.md");
    let old_temp_path = root
        .path()
        .join(format!(".note.md.mdx-tmp-{}", std::process::id()));
    std::fs::write(&path, "document").unwrap();
    std::fs::write(&symlink_target, "outside").unwrap();
    symlink(&symlink_target, &old_temp_path).unwrap();

    let _ = overwrite_document_file_sync(
        path.to_string_lossy().into_owned(),
        "local edit".to_string(),
    );

    assert_eq!(std::fs::read_to_string(&symlink_target).unwrap(), "outside");
}
