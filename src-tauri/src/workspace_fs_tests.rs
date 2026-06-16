use tempfile::tempdir;

use crate::document::document_fingerprint;
use crate::models::FileTreeNode;
use crate::workspace_fs::{
    create_markdown_file, open_path_with_default_application_impl, read_markdown_file,
    read_preview_binary_file, read_preview_text_file, scan_workspace_sync,
    scan_workspace_with_limit, scan_workspace_with_options, trash_path, write_markdown_file,
    ScanWorkspaceOptions,
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
fn scan_workspace_returns_folders_and_visible_files() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    std::fs::write(root.path().join("docs").join("a.md"), "# A").unwrap();
    std::fs::write(root.path().join("b.markdown"), "# B").unwrap();
    std::fs::write(root.path().join("image.png"), [1, 2, 3]).unwrap();
    std::fs::write(root.path().join(".hidden.md"), "# Hidden").unwrap();
    std::fs::create_dir(root.path().join("node_modules")).unwrap();
    std::fs::write(
        root.path().join("node_modules").join("hidden.md"),
        "# Hidden",
    )
    .unwrap();

    let scanned = scan_workspace_sync(root.path().to_string_lossy().into_owned(), None).unwrap();
    let names = collect_tree_names(&scanned.nodes);
    assert_eq!(names, vec!["docs", "a.md", "b.markdown", "image.png"]);
}

#[test]
fn scan_workspace_filters_custom_directories() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("docs/archive")).unwrap();
    std::fs::create_dir_all(root.path().join("vendor")).unwrap();
    std::fs::write(root.path().join("docs/keep.md"), "# Keep").unwrap();
    std::fs::write(root.path().join("docs/archive/old.md"), "# Old").unwrap();
    std::fs::write(root.path().join("vendor/lib.md"), "# Lib").unwrap();

    let scanned = scan_workspace_with_options(
        root.path().to_string_lossy().into_owned(),
        ScanWorkspaceOptions {
            exclude_dirs: vec!["docs/archive".to_string(), "vendor".to_string()],
        },
        5_000,
    )
    .unwrap();

    let names = collect_tree_names(&scanned.nodes);
    assert_eq!(names, vec!["docs", "keep.md"]);
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
fn default_scan_workspace_handles_large_local_wiki_trees() {
    let root = tempdir().unwrap();
    let raw_sources = root.path().join("brain").join("Raw Sources");
    std::fs::create_dir_all(&raw_sources).unwrap();

    for i in 0..5_100 {
        std::fs::write(raw_sources.join(format!("note-{i}.md")), "# Note").unwrap();
    }

    let scanned = scan_workspace_sync(root.path().to_string_lossy().into_owned(), None).unwrap();
    let names = collect_tree_names(&scanned.nodes);

    assert!(!scanned.truncated);
    assert!(names.contains(&"Raw Sources".to_string()));
    assert!(names.contains(&"note-5099.md".to_string()));
}

#[test]
fn scan_workspace_truncates_when_raw_entries_exceed_limit() {
    let root = tempdir().unwrap();
    for i in 0..6 {
        std::fs::write(root.path().join(format!("image-{i}.png")), [1, 2, 3]).unwrap();
    }

    let scanned = scan_workspace_with_limit(root.path().to_string_lossy().into_owned(), 5).unwrap();
    assert!(scanned.truncated);
    assert_eq!(scanned.entry_count, 5);
    assert_eq!(scanned.nodes.len(), 5);
}

#[test]
fn read_preview_text_file_allows_text_like_sources() {
    let root = tempdir().unwrap();
    let cases = [
        ("notes.txt", "plain notes"),
        ("page.html", "<h1>Page</h1>"),
        ("legacy.htm", "<p>Legacy</p>"),
        ("archive.mhtml", "MHTML"),
        ("Main.java", "class Main {}"),
        ("config.json", "{}"),
        ("app.yaml", "key: value"),
        ("schema.xsd", "<schema />"),
        ("LICENSE", "license text"),
    ];

    for (name, contents) in cases {
        let path = root.path().join(name);
        std::fs::write(&path, contents).unwrap();

        assert_eq!(
            read_preview_text_file(
                root.path().to_string_lossy().into_owned(),
                path.to_string_lossy().into_owned(),
            )
            .unwrap(),
            contents
        );
    }
}

#[test]
fn read_preview_text_file_rejects_markdown_sources() {
    let root = tempdir().unwrap();
    let markdown_path = root.path().join("note.md");
    std::fs::write(&markdown_path, "# Note").unwrap();

    let err = read_preview_text_file(
        root.path().to_string_lossy().into_owned(),
        markdown_path.to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "invalid_name");
}

#[test]
fn read_preview_binary_file_allows_pdf_sources() {
    let root = tempdir().unwrap();
    let pdf_path = root.path().join("book.pdf");
    std::fs::write(&pdf_path, b"%PDF-1.7").unwrap();

    let bytes = read_preview_binary_file(
        root.path().to_string_lossy().into_owned(),
        pdf_path.to_string_lossy().into_owned(),
    )
    .unwrap();

    assert_eq!(bytes, b"%PDF-1.7");
}

#[test]
fn read_preview_binary_file_allows_image_sources() {
    let root = tempdir().unwrap();
    let image_path = root.path().join("cover.jfif");
    std::fs::write(&image_path, [255, 216, 255, 224]).unwrap();

    let bytes = read_preview_binary_file(
        root.path().to_string_lossy().into_owned(),
        image_path.to_string_lossy().into_owned(),
    )
    .unwrap();

    assert_eq!(bytes, vec![255, 216, 255, 224]);
}

#[test]
fn read_preview_binary_file_allows_awebp_sources() {
    let root = tempdir().unwrap();
    let image_path = root.path().join("animated.awebp");
    std::fs::write(&image_path, b"RIFF").unwrap();

    let bytes = read_preview_binary_file(
        root.path().to_string_lossy().into_owned(),
        image_path.to_string_lossy().into_owned(),
    )
    .unwrap();

    assert_eq!(bytes, b"RIFF");
}

#[test]
fn read_preview_binary_file_rejects_non_pdf_sources() {
    let root = tempdir().unwrap();
    let text_path = root.path().join("notes.txt");
    std::fs::write(&text_path, "plain notes").unwrap();

    let err = read_preview_binary_file(
        root.path().to_string_lossy().into_owned(),
        text_path.to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "invalid_name");
}

#[test]
fn open_path_with_default_application_resolves_workspace_files() {
    let root = tempdir().unwrap();
    let doc_path = root.path().join("brief.docx");
    std::fs::write(&doc_path, "docx").unwrap();

    let opened_path = open_path_with_default_application_impl(
        root.path().to_string_lossy().into_owned(),
        doc_path.to_string_lossy().into_owned(),
        |path| Ok(path.to_path_buf()),
    )
    .unwrap();

    assert_eq!(opened_path, doc_path.canonicalize().unwrap());
}

#[test]
#[cfg(unix)]
fn open_path_with_default_application_rejects_symlink_leaf() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_target = outside.path().join("brief.docx");
    std::fs::write(&outside_target, "docx").unwrap();
    let symlink_path = root.path().join("brief.docx");
    symlink(&outside_target, &symlink_path).unwrap();

    let err = open_path_with_default_application_impl(
        root.path().to_string_lossy().into_owned(),
        symlink_path.to_string_lossy().into_owned(),
        |path| Ok(path.to_path_buf()),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
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
        None,
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
    assert!(!outside_target.exists());
}

#[test]
fn write_markdown_file_rejects_stale_expected_fingerprint() {
    let root = tempdir().unwrap();
    let path = root.path().join("note.md");
    std::fs::write(&path, "# External").unwrap();

    let err = write_markdown_file(
        root.path().to_string_lossy().into_owned(),
        path.to_string_lossy().into_owned(),
        "# Local".to_string(),
        Some(document_fingerprint("# Original")),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "external_modified");
    assert_eq!(std::fs::read_to_string(path).unwrap(), "# External");
}

#[test]
#[cfg(unix)]
fn read_markdown_file_rejects_symlink_intermediate_to_outside_root() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("note.md");
    std::fs::write(&outside_file, "# Outside").unwrap();
    let symlink_dir = root.path().join("linked");
    symlink(outside.path(), &symlink_dir).unwrap();

    let err = read_markdown_file(
        root.path().to_string_lossy().into_owned(),
        symlink_dir.join("note.md").to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
#[cfg(unix)]
fn read_preview_text_file_rejects_symlink_intermediate_to_outside_root() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("note.txt");
    std::fs::write(&outside_file, "Outside").unwrap();
    let symlink_dir = root.path().join("linked");
    symlink(outside.path(), &symlink_dir).unwrap();

    let err = read_preview_text_file(
        root.path().to_string_lossy().into_owned(),
        symlink_dir.join("note.txt").to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
#[cfg(unix)]
fn read_preview_binary_file_rejects_symlink_intermediate_to_outside_root() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("book.pdf");
    std::fs::write(&outside_file, b"%PDF-1.7").unwrap();
    let symlink_dir = root.path().join("linked");
    symlink(outside.path(), &symlink_dir).unwrap();

    let err = read_preview_binary_file(
        root.path().to_string_lossy().into_owned(),
        symlink_dir.join("book.pdf").to_string_lossy().into_owned(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
#[cfg(unix)]
fn write_markdown_file_rejects_symlink_intermediate_to_outside_root() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("note.md");
    std::fs::write(&outside_file, "# Outside").unwrap();
    let symlink_dir = root.path().join("linked");
    symlink(outside.path(), &symlink_dir).unwrap();

    let err = write_markdown_file(
        root.path().to_string_lossy().into_owned(),
        symlink_dir.join("note.md").to_string_lossy().into_owned(),
        "# Escaped".to_string(),
        None,
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "outside_workspace");
    assert_eq!(std::fs::read_to_string(outside_file).unwrap(), "# Outside");
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
