use std::fs;

use tempfile::tempdir;

use crate::background::{
    MAX_BACKGROUND_BYTES, clear_background_image_in_dir, load_background_image_in_dir,
    save_background_image_in_dir,
};

/// The boundary around the stored background image.
///
/// Two things are being pinned here. One background is in effect at a time, so
/// storing a new one has to leave the directory holding only that one — the
/// alternative is a directory that grows by a photograph every time someone
/// tries another picture. And the name in the preference is ordinary storage the
/// user can edit, so a name in it must not be able to reach a file outside this
/// directory by any route.

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nnot really a png, but bytes are bytes";

#[test]
fn stores_the_image_under_a_content_named_file() {
    let directory = tempdir().expect("temp dir");

    let stored = save_background_image_in_dir(directory.path(), "光.png", PNG).expect("save");

    assert!(stored.file_name.ends_with(".png"));
    assert_eq!(
        fs::read(directory.path().join(&stored.file_name)).expect("read"),
        PNG,
    );
}

#[test]
fn reads_back_what_it_stored() {
    let directory = tempdir().expect("temp dir");
    let stored = save_background_image_in_dir(directory.path(), "wall.jpeg", PNG).expect("save");

    let loaded = load_background_image_in_dir(directory.path(), &stored.file_name).expect("load");

    assert_eq!(loaded, PNG);
    // The MIME type is not carried back: the response is raw bytes, and the
    // front end derives the type from the extension in this name.
    assert!(stored.file_name.ends_with(".jpeg"));
}

#[test]
fn keeps_a_file_that_this_module_did_not_write() {
    let directory = tempdir().expect("temp dir");
    fs::create_dir_all(directory.path()).expect("create");
    // Not a content hash, so not one of its own copies. Pruning is "delete the
    // copies I made", not "empty this directory".
    let by_hand = directory.path().join("wallpaper.png");
    fs::write(&by_hand, b"mine").expect("write");
    // The shape `write_deduped_asset` gives an in-flight write. An overlapping
    // save must not have its temporary deleted out from under it.
    let temporary = directory.path().join(".abc.png.tmp-1234");
    fs::write(&temporary, b"partial").expect("write");

    save_background_image_in_dir(directory.path(), "a.png", PNG).expect("save");
    clear_background_image_in_dir(directory.path()).expect("clear");

    assert_eq!(fs::read(&by_hand).expect("read"), b"mine");
    assert_eq!(fs::read(&temporary).expect("read"), b"partial");
}

#[test]
fn refuses_an_image_over_the_cap() {
    let directory = tempdir().expect("temp dir");
    let too_big = vec![0u8; MAX_BACKGROUND_BYTES + 1];

    let error =
        save_background_image_in_dir(directory.path(), "big.png", &too_big).expect_err("refused");

    assert_eq!(error.error_code(), "background_too_large");
}

#[test]
fn refuses_to_read_an_image_over_the_cap() {
    let directory = tempdir().expect("temp dir");
    fs::create_dir_all(directory.path()).expect("create");
    // Written past the writer rather than through it, which is the state a file
    // that was replaced on disk would leave behind.
    let name = format!("{}.png", "a".repeat(64));
    fs::write(
        directory.path().join(&name),
        vec![0u8; MAX_BACKGROUND_BYTES + 1],
    )
    .expect("write");

    let error = load_background_image_in_dir(directory.path(), &name).expect_err("refused");

    assert_eq!(error.error_code(), "background_too_large");
}

#[test]
fn a_new_background_replaces_the_previous_one() {
    let directory = tempdir().expect("temp dir");
    let first = save_background_image_in_dir(directory.path(), "a.png", b"first").expect("save");
    let second = save_background_image_in_dir(directory.path(), "b.png", b"second").expect("save");

    assert_ne!(first.file_name, second.file_name);
    assert!(!directory.path().join(&first.file_name).exists());
    assert!(directory.path().join(&second.file_name).exists());
}

#[test]
fn clearing_leaves_no_stored_image() {
    let directory = tempdir().expect("temp dir");
    let stored = save_background_image_in_dir(directory.path(), "a.png", PNG).expect("save");

    clear_background_image_in_dir(directory.path()).expect("clear");

    assert!(!directory.path().join(&stored.file_name).exists());
    // A second clear is not an error: the directory is allowed to be empty, and
    // removing a background twice is something the panel can do.
    clear_background_image_in_dir(directory.path()).expect("clear again");
}

#[test]
fn clearing_a_directory_that_was_never_created_is_not_an_error() {
    let home = tempdir().expect("temp dir");

    clear_background_image_in_dir(&home.path().join("background")).expect("clear");
}

#[test]
fn refuses_a_name_that_is_not_a_single_file_name() {
    let directory = tempdir().expect("temp dir");
    fs::write(directory.path().join("real.png"), PNG).expect("write");

    for name in [
        "../real.png",
        "sub/real.png",
        "/etc/hosts.png",
        "..\\real.png",
        ".hidden.png",
        "",
    ] {
        let error = load_background_image_in_dir(directory.path(), name).expect_err(name);

        assert_eq!(error.error_code(), "background_name_invalid", "{name}");
    }
}

#[test]
fn refuses_a_name_that_is_not_an_image() {
    let directory = tempdir().expect("temp dir");
    fs::write(directory.path().join("notes.md"), b"# hi").expect("write");

    let error = load_background_image_in_dir(directory.path(), "notes.md").expect_err("refused");

    assert_eq!(error.error_code(), "invalid_name");
}

#[test]
fn refuses_to_store_a_file_that_is_not_an_image() {
    let directory = tempdir().expect("temp dir");

    let error = save_background_image_in_dir(directory.path(), "notes.md", b"# hi")
        .expect_err("refused");

    assert_eq!(error.error_code(), "invalid_name");
}

#[test]
fn a_missing_image_reports_that_rather_than_a_read_failure() {
    let directory = tempdir().expect("temp dir");

    let error = load_background_image_in_dir(directory.path(), "gone.png").expect_err("refused");

    assert_eq!(error.error_code(), "background_not_found");
}

#[cfg(unix)]
#[test]
fn a_symlink_in_the_directory_is_not_read_and_not_deleted() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().expect("temp dir");
    let secret = outside.path().join("secret.png");
    fs::write(&secret, b"secret").expect("write");

    let directory = tempdir().expect("temp dir");
    fs::create_dir_all(directory.path()).expect("create");
    let link = directory.path().join("link.png");
    symlink(&secret, &link).expect("symlink");

    let error = load_background_image_in_dir(directory.path(), "link.png").expect_err("refused");
    assert_eq!(error.error_code(), "background_not_found");

    // Storing a new background prunes the images it replaces. A link is not one
    // of its own copies, so it is left where it is rather than followed or
    // removed — and the file it points at is untouched either way.
    save_background_image_in_dir(directory.path(), "a.png", PNG).expect("save");

    assert!(fs::symlink_metadata(&link).is_ok());
    assert_eq!(fs::read(&secret).expect("read"), b"secret");
}
