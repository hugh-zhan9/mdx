use tempfile::tempdir;

use crate::document::document_fingerprint;
use crate::models::{FileTreeNode, NoteGroup};
use crate::workspace_fs::{
    create_markdown_file, open_path_with_default_application_impl, read_markdown_file,
    reveal_path_in_file_manager_impl,
    read_preview_binary_file, read_preview_text_file, scan_workspace_sync,
    scan_workspace_with_limit, scan_workspace_with_options, trash_path,
    workspace_note_page_sync, write_markdown_file, ScanWorkspaceOptions,
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

/// Writes notes oldest first, pausing so the file system gives each its own
/// modification time, and returns their names newest first.
fn write_notes_in_order(root: &std::path::Path, names: &[&str]) {
    for name in names {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("# {name}\n\nBody of {name}.\n")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

fn page_names(result: &crate::models::NotePageResult) -> Vec<String> {
    result
        .notes
        .iter()
        .map(|note| {
            std::path::Path::new(&note.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn note_page_returns_the_newest_notes_and_reads_only_those() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    write_notes_in_order(root, &["old.md", "mid.md", "new.md"]);
    // Not a note: the index describes the documents, not everything on disk.
    std::fs::write(root.join("photo.png"), [0u8, 1, 2]).unwrap();

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        2,
        None,
        None,
    )
    .unwrap();

    assert_eq!(page_names(&result), vec!["new.md", "mid.md"]);
    // The page is two notes; the count is what the workspace holds.
    assert_eq!(result.matched, 3);
    assert_eq!(result.counts.all, 3);
    assert!(result.notes.iter().all(|note| !note.head.is_empty()));
}

#[test]
fn note_page_continues_where_the_last_one_stopped() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    write_notes_in_order(root, &["old.md", "mid.md", "new.md"]);

    let second = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        2,
        2,
        None,
        None,
    )
    .unwrap();

    assert_eq!(page_names(&second), vec!["old.md"]);
    assert_eq!(second.matched, 3);
}

#[test]
fn note_page_counts_every_group_whichever_one_it_is_a_page_of() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    write_notes_in_order(root, &["filed/deep.md", "root-note.md"]);

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::Unfiled,
        String::new(),
        0,
        50,
        None,
        None,
    )
    .unwrap();

    // The page holds the group it was asked for.
    assert_eq!(page_names(&result), vec!["root-note.md"]);
    assert_eq!(result.matched, 1);
    // The counts describe the workspace, not the page.
    assert_eq!(result.counts.all, 2);
    assert_eq!(result.counts.unfiled, 1);
    // Both were written just now, so both are recently edited.
    assert_eq!(result.counts.recent, 2);
}

#[test]
fn note_page_filters_by_name_and_still_counts_the_whole_group() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    write_notes_in_order(root, &["Meeting Notes.md", "grocery.md"]);

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        // Case-insensitive, and a fragment is enough.
        "meeting".to_string(),
        0,
        50,
        None,
        None,
    )
    .unwrap();

    assert_eq!(page_names(&result), vec!["Meeting Notes.md"]);
    assert_eq!(result.matched, 1);
    assert_eq!(result.counts.all, 2);
}

#[test]
fn note_page_reads_only_the_beginning_of_a_long_note() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let body = "x".repeat(4096);
    std::fs::write(root.join("long.md"), &body).unwrap();

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        10,
        None,
        None,
    )
    .unwrap();
    let note = &result.notes[0];

    assert_eq!(note.head.len(), 1024);
    assert!(note.head_truncated);
    assert!(note.head.len() < body.len());
}

#[test]
fn note_page_cuts_a_head_on_a_character_boundary() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    // 1024 is not a multiple of 3, so a wall of three-byte characters
    // guarantees the read lands inside one.
    std::fs::write(root.join("cjk.md"), "写".repeat(600)).unwrap();

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        10,
        None,
        None,
    )
    .unwrap();
    let note = &result.notes[0];

    assert!(note.head_truncated);
    // No replacement character: a partial character is not text.
    assert!(!note.head.contains('\u{FFFD}'));
    assert_eq!(note.head.chars().count(), 341);
    assert!(note.head.chars().all(|character| character == '写'));
}

#[test]
fn revealing_a_file_resolves_it_inside_the_workspace() {
    let root = tempdir().unwrap();
    let notes = root.path().join("notes");
    std::fs::create_dir(&notes).unwrap();
    let doc_path = notes.join("note.md");
    std::fs::write(&doc_path, "# Note\n").unwrap();

    let revealed = reveal_path_in_file_manager_impl(
        root.path().to_string_lossy().into_owned(),
        doc_path.to_string_lossy().into_owned(),
        |path| Ok(path.to_path_buf()),
    )
    .unwrap();

    assert_eq!(
        revealed.canonicalize().unwrap(),
        doc_path.canonicalize().unwrap()
    );
}

#[test]
fn revealing_refuses_a_path_outside_the_workspace() {
    let root = tempdir().unwrap();
    let elsewhere = tempdir().unwrap();
    let outside = elsewhere.path().join("secret.md");
    std::fs::write(&outside, "# Secret\n").unwrap();

    let error = reveal_path_in_file_manager_impl(
        root.path().to_string_lossy().into_owned(),
        outside.to_string_lossy().into_owned(),
        |path| Ok(path.to_path_buf()),
    )
    .expect_err("a path outside the workspace is not revealed");

    assert_eq!(error.error_code(), "outside_workspace");
}

#[test]
fn revealing_refuses_a_file_that_is_not_there() {
    let root = tempdir().unwrap();

    let error = reveal_path_in_file_manager_impl(
        root.path().to_string_lossy().into_owned(),
        root.path()
            .join("missing.md")
            .to_string_lossy()
            .into_owned(),
        |path| Ok(path.to_path_buf()),
    )
    .expect_err("a missing file is not revealed");

    assert_eq!(error.error_code(), "not_found");
}

#[test]
fn note_page_lists_only_the_folder_it_was_pointed_at() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    write_notes_in_order(
        root,
        &["wiki/generated.md", "raw/a.md", "raw/deep/b.md", "root-note.md"],
    );

    let result = workspace_note_page_sync(
        root.to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        50,
        Some(root.join("raw").to_string_lossy().into_owned()),
        None,
    )
    .unwrap();

    let mut names = page_names(&result);
    names.sort();
    assert_eq!(names, vec!["a.md", "b.md"]);
    // Every count is about the folder being looked at, not the workspace.
    assert_eq!(result.matched, 2);
    assert_eq!(result.counts.all, 2);
    // Unfiled means "directly in this folder" while a folder is being looked at.
    assert_eq!(result.counts.unfiled, 1);
}

#[test]
fn note_page_refuses_a_folder_outside_the_workspace() {
    let dir = tempdir().unwrap();
    let elsewhere = tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "# A\n").unwrap();

    let error = workspace_note_page_sync(
        dir.path().to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        50,
        Some(elsewhere.path().to_string_lossy().into_owned()),
        None,
    )
    .expect_err("a folder outside the workspace is refused");

    assert_eq!(error.error_code(), "outside_workspace");
}

#[test]
fn note_page_reads_a_folder_that_is_no_longer_there_as_empty() {
    let dir = tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "# A\n").unwrap();

    let result = workspace_note_page_sync(
        dir.path().to_string_lossy().into_owned(),
        NoteGroup::All,
        String::new(),
        0,
        50,
        // Inside the workspace, but nothing is filed there any more.
        Some(dir.path().join("gone").to_string_lossy().into_owned()),
        None,
    );

    match result {
        Ok(page) => {
            assert!(page.notes.is_empty());
            assert_eq!(page.counts.all, 0);
        }
        // Resolving a missing folder is also an acceptable answer, as long as it
        // is not reported as somewhere outside the workspace.
        Err(error) => assert_ne!(error.error_code(), "outside_workspace"),
    }
}
