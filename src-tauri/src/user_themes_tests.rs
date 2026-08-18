use std::fs;

use tempfile::tempdir;

use crate::user_themes::{read_user_themes_in_dir, save_user_theme_in_dir};

/// Reading the user's theme directory.
///
/// This layer only decides what is readable and what is reported — the meaning
/// of a theme belongs to the front-end parser, which is why nothing here parses
/// CSS. What it does own is the boundary: the directory is a place for the
/// user's own files, and everything that is not one of those is either skipped
/// or reported with a reason.

#[test]
fn a_missing_directory_is_not_an_error() {
    let home = tempdir().expect("temp dir");
    // Most users will never create this directory. Answering "no themes" is the
    // correct answer, not a failure to surface.
    let themes = read_user_themes_in_dir(&home.path().join("themes")).expect("read");

    assert!(themes.is_empty());
}

#[test]
fn reads_css_files_and_leaves_the_text_unparsed() {
    let directory = tempdir().expect("temp dir");
    fs::write(
        directory.path().join("kraft.css"),
        ":root { --mdx-theme-appearance: light; }",
    )
    .expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].file_name, "kraft.css");
    assert_eq!(
        themes[0].text.as_deref(),
        Some(":root { --mdx-theme-appearance: light; }")
    );
    assert!(themes[0].error.is_none());
}

#[test]
fn ignores_files_that_are_not_css() {
    let directory = tempdir().expect("temp dir");
    fs::write(directory.path().join("notes.md"), "# not a theme").expect("write");
    fs::write(directory.path().join("theme.css"), "/* ok */").expect("write");
    fs::write(directory.path().join("THEME2.CSS"), "/* ok */").expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    let names: Vec<&str> = themes
        .iter()
        .map(|theme| theme.file_name.as_str())
        .collect();
    assert_eq!(names, vec!["THEME2.CSS", "theme.css"]);
}

#[test]
fn ignores_subdirectories() {
    let directory = tempdir().expect("temp dir");
    fs::create_dir(directory.path().join("nested.css")).expect("create dir");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    assert!(themes.is_empty());
}

#[test]
fn refuses_to_follow_a_symlink_out_of_the_directory() {
    let directory = tempdir().expect("temp dir");
    let outside = tempdir().expect("temp dir");
    let secret = outside.path().join("secret.css");
    fs::write(&secret, "/* outside the theme directory */").expect("write");

    #[cfg(unix)]
    std::os::unix::fs::symlink(&secret, directory.path().join("link.css"))
        .expect("symlink");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    // Reported rather than silently skipped, and its contents are not read: the
    // directory is the boundary, and following a link would make it a weaker
    // one than it appears.
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].file_name, "link.css");
    assert!(themes[0].text.is_none());
    assert!(themes[0].error.is_some());
}

#[test]
fn reports_a_file_too_large_to_be_a_theme() {
    let directory = tempdir().expect("temp dir");
    let oversized = "a".repeat(64 * 1024 + 1);
    fs::write(directory.path().join("huge.css"), oversized).expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    assert_eq!(themes.len(), 1);
    assert!(themes[0].text.is_none());
    let error = themes[0].error.as_deref().unwrap_or_default();
    assert!(error.contains("64"), "expected a size limit reason: {error}");
}

#[test]
fn reports_a_file_that_is_not_utf8() {
    let directory = tempdir().expect("temp dir");
    fs::write(directory.path().join("binary.css"), [0xff, 0xfe, 0x00, 0x01])
        .expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    assert_eq!(themes.len(), 1);
    assert!(themes[0].text.is_none());
    assert!(themes[0].error.is_some());
}

#[test]
fn orders_themes_by_name_so_the_list_is_stable() {
    let directory = tempdir().expect("temp dir");
    for name in ["zulu.css", "alpha.css", "mike.css"] {
        fs::write(directory.path().join(name), "/* ok */").expect("write");
    }

    let themes = read_user_themes_in_dir(directory.path()).expect("read");

    let names: Vec<&str> = themes
        .iter()
        .map(|theme| theme.file_name.as_str())
        .collect();
    assert_eq!(names, vec!["alpha.css", "mike.css", "zulu.css"]);
}

/// Writing a theme file.
///
/// The front end sends a name and CSS text; the directory is chosen here and the
/// name is checked here, so nothing a caller sends can name a place outside it.
/// The text is never judged — a theme is data, and its contract lives on the
/// other side of this boundary.

#[test]
fn writes_a_theme_the_reader_can_read_back() {
    let directory = tempdir().expect("temp dir");
    let css = ":root { --mdx-theme-name: \"Kraft\"; --mdx-theme-appearance: light; }";

    let written =
        save_user_theme_in_dir(directory.path(), "kraft.css", css).expect("write");

    assert!(written.ends_with("kraft.css"));
    let themes = read_user_themes_in_dir(directory.path()).expect("read");
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].text.as_deref(), Some(css));
}

#[test]
fn makes_the_directory_when_it_is_not_there_yet() {
    // The first theme a user saves is also the moment the directory has to exist.
    let home = tempdir().expect("temp dir");
    let directory = home.path().join("themes");

    save_user_theme_in_dir(&directory, "first.css", ":root { }").expect("write");

    assert!(directory.join("first.css").is_file());
}

#[test]
fn writing_the_same_name_replaces_it() {
    // Which is what editing a theme is: the file is the theme's identity.
    let directory = tempdir().expect("temp dir");
    save_user_theme_in_dir(directory.path(), "one.css", "/* first */").expect("write");

    save_user_theme_in_dir(directory.path(), "one.css", "/* second */").expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].text.as_deref(), Some("/* second */"));
}

#[test]
fn refuses_a_name_that_is_a_path() {
    let directory = tempdir().expect("temp dir");

    for name in [
        "../escape.css",
        "nested/theme.css",
        "/absolute.css",
        "..",
        ".",
        "sub\\theme.css",
    ] {
        let error = save_user_theme_in_dir(directory.path(), name, ":root { }")
            .expect_err(name);
        assert_eq!(error.error_code(), "theme_name_invalid", "{name}");
    }

    // Nothing was created on the way to refusing.
    assert!(read_user_themes_in_dir(directory.path())
        .expect("read")
        .is_empty());
}

#[test]
fn refuses_a_name_that_is_not_a_theme_file() {
    let directory = tempdir().expect("temp dir");

    for name in ["", "   ", "theme", "theme.txt", ".css", ".hidden.css"] {
        let error = save_user_theme_in_dir(directory.path(), name, ":root { }")
            .expect_err(name);
        assert_eq!(error.error_code(), "theme_name_invalid", "{name}");
    }
}

#[test]
fn refuses_a_theme_larger_than_the_reader_would_accept() {
    // Writing what could never be read back is the one thing worse than
    // refusing: the theme would be listed with an error instead of a palette.
    let directory = tempdir().expect("temp dir");
    let css = "a".repeat(64 * 1024 + 1);

    let error =
        save_user_theme_in_dir(directory.path(), "big.css", &css).expect_err("refused");

    assert_eq!(error.error_code(), "theme_too_large");
}

#[test]
fn accepts_a_name_with_spaces_and_unicode() {
    // It is the user's own file in the user's own directory; only the shape of
    // the name is this layer's business.
    let directory = tempdir().expect("temp dir");

    save_user_theme_in_dir(directory.path(), " 我的 主题.css ", ":root { }").expect("write");

    let themes = read_user_themes_in_dir(directory.path()).expect("read");
    assert_eq!(themes[0].file_name, "我的 主题.css");
}
