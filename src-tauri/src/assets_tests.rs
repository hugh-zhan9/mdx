use tempfile::tempdir;

use crate::assets::{save_image_asset, save_image_asset_with_global_assets_dir};

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
