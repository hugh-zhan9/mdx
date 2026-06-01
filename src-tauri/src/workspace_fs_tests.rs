use tempfile::tempdir;

use crate::models::FileTreeNode;
use crate::workspace_fs::{
    create_markdown_file, read_markdown_file, scan_workspace, scan_workspace_with_limit,
    trash_path, write_markdown_file,
};

fn collect_tree_names(nodes: &[FileTreeNode]) -> Vec<String> {
    let mut names = Vec::new();

    for node in nodes {
        match node {
            FileTreeNode::File { name, .. } => names.push(name.clone()),
            FileTreeNode::Folder { name, children, .. } => {
                names.push(name.clone());
                names.extend(collect_tree_names(children));
            }
        }
    }

    names
}

#[test]
fn scan_workspace_returns_only_markdown_and_folders() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    std::fs::write(root.path().join("docs").join("a.md"), "# A").unwrap();
    std::fs::write(root.path().join("b.markdown"), "# B").unwrap();
    std::fs::write(root.path().join("image.png"), [1, 2, 3]).unwrap();
    std::fs::create_dir(root.path().join("node_modules")).unwrap();
    std::fs::write(
        root.path().join("node_modules").join("hidden.md"),
        "# Hidden",
    )
    .unwrap();

    let scanned = scan_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let names = collect_tree_names(&scanned.nodes);
    assert_eq!(names, vec!["docs", "a.md", "b.markdown"]);
}

#[test]
fn scan_workspace_marks_large_trees_as_truncated() {
    let root = tempdir().unwrap();
    for i in 0..6 {
        std::fs::write(root.path().join(format!("note-{i}.md")), "# Note").unwrap();
    }

    let scanned = scan_workspace_with_limit(root.path().to_string_lossy().into_owned(), 5).unwrap();
    assert!(scanned.truncated);
    assert_eq!(scanned.entry_count, 5);
    assert!(scanned.warnings.iter().any(|w| w.contains("too large")));
}

#[test]
#[cfg(target_os = "macos")]
fn trash_path_uses_macos_trash() {
    let root = tempdir().unwrap();
    let file = root.path().join("delete-me.md");
    std::fs::write(&file, "# Delete").unwrap();

    trash_path(
        root.path().to_string_lossy().into_owned(),
        file.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert!(!file.exists());
}

#[test]
#[cfg(unix)]
fn read_markdown_file_rejects_broken_symlink_leaf() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_target = outside.path().join("missing.md");
    let symlink_path = root.path().join("note.md");
    symlink(&outside_target, &symlink_path).unwrap();

    let err = read_markdown_file(
        root.path().to_string_lossy().into_owned(),
        symlink_path.to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
#[cfg(unix)]
fn write_markdown_file_rejects_broken_symlink_leaf_to_outside_root() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_target = outside.path().join("escaped.md");
    let symlink_path = root.path().join("note.md");
    symlink(&outside_target, &symlink_path).unwrap();

    let err = write_markdown_file(
        root.path().to_string_lossy().into_owned(),
        symlink_path.to_string_lossy().into_owned(),
        "# Escaped".to_string(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
    assert!(!outside_target.exists());
}

#[test]
#[cfg(unix)]
fn temporary_untitled_skips_broken_symlink_entries() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_target = outside.path().join("untitled-outside.md");
    symlink(&outside_target, root.path().join("Untitled.md")).unwrap();

    let created = create_markdown_file(
        root.path().to_string_lossy().into_owned(),
        root.path().to_string_lossy().into_owned(),
        None,
        Some(true),
    )
    .unwrap();

    assert_eq!(created.name, "Untitled1.md");
    assert!(root.path().join("Untitled1.md").exists());
    assert!(!outside_target.exists());
}

#[test]
#[cfg(unix)]
fn create_markdown_file_rejects_explicit_broken_symlink_entry() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_target = outside.path().join("explicit-outside.md");
    symlink(&outside_target, root.path().join("Pinned.md")).unwrap();

    let err = create_markdown_file(
        root.path().to_string_lossy().into_owned(),
        root.path().to_string_lossy().into_owned(),
        Some("Pinned.md".to_string()),
        Some(false),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "already_exists");
    assert!(!outside_target.exists());
}
