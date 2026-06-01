use tempfile::tempdir;

use crate::assets::{
    load_image_asset, load_image_asset_with_global_assets_dir, save_image_asset,
    save_image_asset_with_global_assets_dir,
};

#[test]
fn saves_workspace_asset_once_for_identical_bytes() {
    let root = tempdir().unwrap();
    let bytes = vec![1, 2, 3, 4];

    let first = save_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        None,
        "paste.png".to_string(),
        bytes.clone(),
    )
    .unwrap();
    let second = save_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        None,
        "paste.png".to_string(),
        bytes,
    )
    .unwrap();

    assert_eq!(first.markdown_path, second.markdown_path);
    assert_eq!(first.stored_path, second.stored_path);

    let asset_count = root.path().join(".assets").read_dir().unwrap().count();
    assert_eq!(asset_count, 1);
}

#[test]
fn falls_back_to_global_assets_without_workspace_root() {
    let global_assets_dir = tempdir().unwrap();
    let result = save_image_asset_with_global_assets_dir(
        None,
        None,
        "paste.png".to_string(),
        vec![9, 8, 7],
        global_assets_dir.path(),
    )
    .unwrap();

    assert!(result.used_fallback);
    assert!(!result.markdown_path.starts_with(".assets/"));
    assert!(std::path::Path::new(&result.markdown_path).is_absolute());
    assert!(result.markdown_path.ends_with(".png"));
    assert_eq!(result.markdown_path, result.stored_path);
    assert!(std::path::Path::new(&result.stored_path).exists());
}

#[test]
#[cfg(unix)]
fn falls_back_when_workspace_assets_is_a_symlink() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    symlink(outside.path(), root.path().join(".assets")).unwrap();

    let global_assets_dir = tempdir().unwrap();
    let result = save_image_asset_with_global_assets_dir(
        Some(root.path().to_string_lossy().into_owned()),
        None,
        "paste.png".to_string(),
        vec![1, 2, 3, 4],
        global_assets_dir.path(),
    )
    .unwrap();

    assert!(result.used_fallback);
    let global_assets_dir_path = std::fs::canonicalize(global_assets_dir.path()).unwrap();
    assert!(result
        .markdown_path
        .starts_with(global_assets_dir_path.to_string_lossy().as_ref()));
    assert!(global_assets_dir
        .path()
        .join(result.stored_path.rsplit('/').next().unwrap())
        .exists());
    assert!(outside.path().read_dir().unwrap().next().is_none());
}

#[test]
fn loads_allowed_workspace_asset_image() {
    let root = tempdir().unwrap();
    let asset_dir = root.path().join(".assets");
    std::fs::create_dir(&asset_dir).unwrap();
    let asset_path = asset_dir.join("abc123.png");
    std::fs::write(&asset_path, [1, 2, 3, 4]).unwrap();
    let doc_path = root.path().join("doc.md");
    std::fs::write(&doc_path, "# Doc").unwrap();

    let loaded = load_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        Some(doc_path.to_string_lossy().into_owned()),
        ".assets/abc123.png".to_string(),
    )
    .unwrap();

    assert_eq!(loaded.mime_type, "image/png");
    assert_eq!(loaded.bytes, vec![1, 2, 3, 4]);
    assert_eq!(
        loaded.path,
        std::fs::canonicalize(asset_path).unwrap().to_string_lossy()
    );
}

#[test]
fn rejects_traversal_outside_workspace_for_image_loading() {
    let root = tempdir().unwrap();
    let subdir = root.path().join("docs");
    std::fs::create_dir(&subdir).unwrap();
    let doc_path = subdir.join("doc.md");
    std::fs::write(&doc_path, "# Doc").unwrap();

    let err = load_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        Some(doc_path.to_string_lossy().into_owned()),
        "../../../escape.png".to_string(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
fn rejects_absolute_outside_image_loading() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("escape.png");
    std::fs::write(&outside_file, [9, 8, 7]).unwrap();
    let doc_path = root.path().join("doc.md");
    std::fs::write(&doc_path, "# Doc").unwrap();

    let err = load_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        Some(doc_path.to_string_lossy().into_owned()),
        outside_file.to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
fn rejects_non_image_extensions() {
    let root = tempdir().unwrap();
    let doc_path = root.path().join("doc.md");
    std::fs::write(&doc_path, "# Doc").unwrap();

    let err = load_image_asset(
        Some(root.path().to_string_lossy().into_owned()),
        Some(doc_path.to_string_lossy().into_owned()),
        ".assets/not-image.txt".to_string(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "invalid_name");
}

#[test]
fn loads_image_from_global_assets_directory() {
    let global_assets_dir = tempdir().unwrap();
    let asset_path = global_assets_dir.path().join("abc123.png");
    std::fs::write(&asset_path, [7, 6, 5]).unwrap();

    let loaded = load_image_asset_with_global_assets_dir(
        None,
        None,
        asset_path.to_string_lossy().into_owned(),
        global_assets_dir.path(),
    )
    .unwrap();

    assert_eq!(loaded.mime_type, "image/png");
    assert_eq!(loaded.bytes, vec![7, 6, 5]);
    assert_eq!(
        loaded.path,
        std::fs::canonicalize(asset_path).unwrap().to_string_lossy()
    );
}

#[test]
#[cfg(unix)]
fn rejects_symlinked_global_assets_directory_on_save() {
    use std::os::unix::fs::symlink;

    let home = tempdir().unwrap();
    let mdx_home = home.path().join(".mdx");
    let outside = tempdir().unwrap();
    std::fs::create_dir(&mdx_home).unwrap();
    symlink(outside.path(), mdx_home.join("assets")).unwrap();

    let err = save_image_asset_with_global_assets_dir(
        None,
        None,
        "paste.png".to_string(),
        vec![1, 2, 3],
        &mdx_home.join("assets"),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
    assert!(outside.path().read_dir().unwrap().next().is_none());
}

#[test]
#[cfg(unix)]
fn rejects_symlinked_global_assets_directory_on_load() {
    use std::os::unix::fs::symlink;

    let home = tempdir().unwrap();
    let mdx_home = home.path().join(".mdx");
    let outside = tempdir().unwrap();
    std::fs::create_dir(&mdx_home).unwrap();
    symlink(outside.path(), mdx_home.join("assets")).unwrap();
    let symlinked_image = mdx_home.join("assets").join("abc123.png");
    std::fs::write(outside.path().join("abc123.png"), [9, 9, 9]).unwrap();

    let err = load_image_asset_with_global_assets_dir(
        None,
        None,
        symlinked_image.to_string_lossy().into_owned(),
        &mdx_home.join("assets"),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}
