use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::llm_wiki_fs::{ensure_managed_file_target, relative_path, write_managed_file};
use crate::llm_wiki_models::WikiSearchResult;
use crate::models::WorkspaceError;

pub fn search_wiki_pages(
    root: impl AsRef<Path>,
    query: &str,
) -> Result<Vec<WikiSearchResult>, WorkspaceError> {
    let root = root.as_ref();
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    for path in markdown_wiki_files(root)? {
        let contents = safe_read_wiki_markdown(root, &path)?;
        let Some(snippet) = matching_line(&contents, query) else {
            continue;
        };
        let title = file_stem_title(&path)?;
        results.push(WikiSearchResult {
            path: relative_path(root, &path)?,
            title,
            snippet,
        });
    }

    results.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(results)
}

pub fn write_digest_page(
    root: impl AsRef<Path>,
    title: &str,
    content: &str,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let safe_title = safe_digest_title(title)?;
    let digest_path = format!("wiki/syntheses/{safe_title}.md");

    ensure_managed_file_target(root, &digest_path)?;
    ensure_managed_file_target(root, "index.md")?;
    ensure_managed_file_target(root, "log.md")?;

    let index = read_required_managed_text(root, "index.md")?;
    let index = ensure_line(index, &format!("- [[{safe_title}]]"));

    let log = read_required_managed_text(root, "log.md")?;
    let log = ensure_line(log, &format!("- digest [[{safe_title}]]"));

    write_managed_file(root, &digest_path, content.as_bytes())?;
    write_managed_file(root, "index.md", index.as_bytes())?;
    write_managed_file(root, "log.md", log.as_bytes())?;

    Ok(digest_path)
}

pub fn mechanical_lint_report(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let files = markdown_wiki_files(root)?;
    let mut pages = BTreeSet::new();
    let mut broken = Vec::new();

    for path in &files {
        pages.insert(page_key(path)?);
    }

    for path in files {
        if relative_path(root, &path)? == "wiki/knowledge-graph.md" {
            continue;
        }
        let source = relative_path(root, &path)?;
        let contents = safe_read_wiki_markdown(root, &path)?;
        for target in wikilink_targets(&contents) {
            let Some(page_target) = normalize_wikilink_page_target(&target) else {
                continue;
            };
            if !pages.contains(&page_target) {
                broken.push(format!("- {source}: [[{target}]]"));
            }
        }
    }

    broken.sort();
    broken.dedup();

    let mut report = "# LLM Wiki Lint Report\n\n## 断链\n".to_string();
    if broken.is_empty() {
        report.push_str("无\n");
    } else {
        report.push_str(&broken.join("\n"));
        report.push('\n');
    }
    Ok(report)
}

fn markdown_wiki_files(root: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    let wiki = root.join("wiki");
    if !wiki.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_markdown_files(&wiki, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_markdown_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), WorkspaceError> {
    if is_symlink(dir)? {
        return Ok(());
    }

    let entries = fs::read_dir(dir).map_err(|error| {
        WorkspaceError::from_io("scan_failed", "failed to read llm wiki directory", &error)
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            WorkspaceError::from_io("scan_failed", "failed to read llm wiki entry", &error)
        })?;
        let path = entry.path();
        if is_symlink(&path)? {
            continue;
        }
        let metadata = entry.file_type().map_err(|error| {
            WorkspaceError::from_io("path_failed", "failed to inspect llm wiki entry", &error)
        })?;
        if metadata.is_dir() {
            collect_markdown_files(&path, files)?;
        } else if metadata.is_file() && path.extension().is_some_and(|ext| ext == "md") {
            files.push(path);
        }
    }
    Ok(())
}

fn is_symlink(path: &Path) -> Result<bool, WorkspaceError> {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .map_err(|error| WorkspaceError::from_io("path_failed", "failed to inspect path", &error))
}

fn safe_read_wiki_markdown(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to inspect wiki page", &error)
    })?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            "wiki page is not a regular file",
        ));
    }

    let mut file = open_wiki_page_no_follow(root, path)?;
    let opened_metadata = file.metadata().map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to inspect opened wiki page", &error)
    })?;
    if !opened_metadata.file_type().is_file() {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            "opened wiki page is not a regular file",
        ));
    }

    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read wiki page", &error)
    })?;
    Ok(contents)
}

#[cfg(unix)]
fn open_wiki_page_no_follow(root: &Path, path: &Path) -> Result<fs::File, WorkspaceError> {
    use std::ffi::{CString, OsStr};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, WorkspaceError> {
        CString::new(value.as_bytes()).map_err(|_| {
            WorkspaceError::new(
                "invalid_llm_wiki_page",
                "wiki page path contains an invalid component",
            )
        })
    }

    fn file_from_fd(fd: libc::c_int) -> Result<fs::File, WorkspaceError> {
        if fd < 0 {
            return Err(WorkspaceError::new(
                "read_failed",
                "failed to open wiki page",
            ));
        }
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }

    fn open_dir(path: &Path) -> Result<fs::File, WorkspaceError> {
        let name = os_str_to_cstring(path.as_os_str())?;
        let fd = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        file_from_fd(fd).map_err(|error| {
            if error.error_code() == "read_failed" {
                WorkspaceError::new("read_failed", "failed to open wiki root directory")
            } else {
                error
            }
        })
    }

    fn open_child(
        parent: &fs::File,
        name: &OsStr,
        flags: libc::c_int,
    ) -> Result<fs::File, WorkspaceError> {
        let name = os_str_to_cstring(name)?;
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd >= 0 {
            return Ok(unsafe { fs::File::from_raw_fd(fd) });
        }
        let error = std::io::Error::last_os_error();
        let code = match error.raw_os_error() {
            Some(libc::ELOOP) | Some(libc::ENOTDIR) => "path_type_conflict",
            Some(libc::ENOENT) => "not_found",
            _ => "read_failed",
        };
        Err(WorkspaceError::from_io(
            code,
            "failed to open wiki page without following symlinks",
            &error,
        ))
    }

    let relative = path
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::new("outside_workspace", "wiki page is outside workspace"))?;
    let components = relative.components().collect::<Vec<_>>();
    if components.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_page",
            "wiki page path is empty",
        ));
    }

    let mut current = open_dir(root)?;
    for component in &components[..components.len() - 1] {
        let std::path::Component::Normal(name) = component else {
            return Err(WorkspaceError::new(
                "invalid_llm_wiki_page",
                "wiki page path contains an invalid component",
            ));
        };
        current = open_child(
            &current,
            name,
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )?;
    }

    let std::path::Component::Normal(name) = components[components.len() - 1] else {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_page",
            "wiki page path contains an invalid component",
        ));
    };
    open_child(
        &current,
        name,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    )
}

#[cfg(not(unix))]
fn open_wiki_page_no_follow(_root: &Path, path: &Path) -> Result<fs::File, WorkspaceError> {
    fs::File::open(path)
        .map_err(|error| WorkspaceError::from_io("read_failed", "failed to open wiki page", &error))
}

fn matching_line(contents: &str, query: &str) -> Option<String> {
    contents
        .lines()
        .find(|line| line.contains(query))
        .map(|line| line.trim().to_string())
}

fn file_stem_title(path: &Path) -> Result<String, WorkspaceError> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .ok_or_else(|| WorkspaceError::new("invalid_llm_wiki_page", "wiki page has no valid title"))
}

fn page_key(path: &Path) -> Result<String, WorkspaceError> {
    file_stem_title(path)
}

fn wikilink_targets(contents: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut remaining = contents;
    while let Some(start) = remaining.find("[[") {
        remaining = &remaining[start + 2..];
        let Some(end) = remaining.find("]]") else {
            break;
        };
        let raw = &remaining[..end];
        let target = raw.split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            targets.push(target.to_string());
        }
        remaining = &remaining[end + 2..];
    }
    targets
}

fn normalize_wikilink_page_target(target: &str) -> Option<String> {
    let page = target.split('#').next().unwrap_or("").trim();
    if page.is_empty() {
        return None;
    }
    let page = page
        .strip_suffix(".markdown")
        .or_else(|| page.strip_suffix(".md"))
        .unwrap_or(page)
        .trim();
    if page.is_empty() {
        None
    } else {
        Some(page.to_string())
    }
}

fn safe_digest_title(title: &str) -> Result<String, WorkspaceError> {
    let title = title.trim();
    if title.is_empty()
        || !title
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_digest_title",
            "digest title must be a non-empty ASCII slug",
        ));
    }
    Ok(title.to_string())
}

fn read_required_managed_text(root: &Path, relative: &str) -> Result<String, WorkspaceError> {
    let path = root.join(relative);
    if !path.exists() {
        return Err(WorkspaceError::new(
            "not_found",
            format!("llm wiki managed file is missing: {relative}"),
        ));
    }
    if is_symlink(&path)? {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            format!("llm wiki managed file is a symlink: {relative}"),
        ));
    }
    fs::read_to_string(path).map_err(|error| {
        WorkspaceError::from_io(
            "read_failed",
            "failed to read llm wiki managed file",
            &error,
        )
    })
}

fn ensure_line(mut contents: String, line: &str) -> String {
    if contents.lines().any(|existing| existing.trim() == line) {
        return contents;
    }
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(line);
    contents.push('\n');
    contents
}
