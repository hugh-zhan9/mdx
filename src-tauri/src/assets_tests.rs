use tempfile::tempdir;

use crate::assets::save_image_asset;

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
