use tempfile::tempdir;

use crate::models::FileTreeNode;
use crate::workspace_fs::{scan_workspace, scan_workspace_with_limit, trash_path};

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
