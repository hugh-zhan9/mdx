use std::collections::BTreeMap;
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
    let display_title = title.trim();
    let digest_path = format!("wiki/syntheses/{safe_title}.md");

    ensure_managed_file_target(root, &digest_path)?;
    ensure_managed_file_target(root, "index.md")?;
    ensure_managed_file_target(root, "log.md")?;

    let index = read_required_managed_text(root, "index.md")?;
    let index = ensure_line(
        index,
        &format!("- [[syntheses/{safe_title}|{display_title}]]"),
    );

    let log = read_required_managed_text(root, "log.md")?;
    let log = ensure_line(
        log,
        &format!("- digest [[syntheses/{safe_title}|{display_title}]]"),
    );

    write_managed_file(root, &digest_path, content.as_bytes())?;
    write_managed_file(root, "index.md", index.as_bytes())?;
    write_managed_file(root, "log.md", log.as_bytes())?;

    Ok(digest_path)
}

pub fn mechanical_lint_report(root: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    let files = markdown_wiki_files(root)?;
    let page_index = LintPageIndex::new(root, &files)?;
    let mut broken = Vec::new();

    for path in files {
        let source = relative_path(root, &path)?;
        if source == "wiki/knowledge-graph.md" {
            continue;
        }
        let contents = safe_read_wiki_markdown(root, &path)?;
        for target in wikilink_targets(&contents) {
            if is_self_anchor_wikilink(&target) {
                continue;
            }
            if page_index.resolve(&source, &target).is_none() {
                broken.push(format!("- {source}: [[{target}]]"));
            }
        }
    }

    broken.sort();
    broken.dedup();

    let mut report = "# 知识库检查报告\n\n## 断链\n".to_string();
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
    safe_read_regular_text(root, path, "wiki page")
}

pub(crate) fn safe_read_regular_text(
    root: &Path,
    path: &Path,
    noun: &str,
) -> Result<String, WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "not_found"
        } else {
            "path_failed"
        };
        WorkspaceError::from_io(code, format!("failed to inspect {noun}"), &error)
    })?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            format!("{noun} is not a regular file"),
        ));
    }

    let mut file = open_file_no_follow(root, path, noun)?;
    let opened_metadata = file.metadata().map_err(|error| {
        WorkspaceError::from_io(
            "path_failed",
            format!("failed to inspect opened {noun}"),
            &error,
        )
    })?;
    if !opened_metadata.file_type().is_file() {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            format!("opened {noun} is not a regular file"),
        ));
    }

    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|error| {
        WorkspaceError::from_io("read_failed", format!("failed to read {noun}"), &error)
    })?;
    Ok(contents)
}

#[cfg(unix)]
fn open_file_no_follow(root: &Path, path: &Path, noun: &str) -> Result<fs::File, WorkspaceError> {
    use std::ffi::{CString, OsStr};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, WorkspaceError> {
        CString::new(value.as_bytes()).map_err(|_| {
            WorkspaceError::new(
                "invalid_llm_wiki_page",
                "llm wiki path contains an invalid component",
            )
        })
    }

    fn open_dir(path: &Path, noun: &str) -> Result<fs::File, WorkspaceError> {
        let name = os_str_to_cstring(path.as_os_str())?;
        let fd = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
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
            format!("failed to open {noun} root directory"),
            &error,
        ))
    }

    fn open_child(
        parent: &fs::File,
        name: &OsStr,
        flags: libc::c_int,
        noun: &str,
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
            format!("failed to open {noun} without following symlinks"),
            &error,
        ))
    }

    let relative = path.strip_prefix(root).map_err(|_| {
        WorkspaceError::new("outside_workspace", format!("{noun} is outside workspace"))
    })?;
    let components = relative.components().collect::<Vec<_>>();
    if components.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_page",
            format!("{noun} path is empty"),
        ));
    }

    let mut current = open_dir(root, noun)?;
    for component in &components[..components.len() - 1] {
        let std::path::Component::Normal(name) = component else {
            return Err(WorkspaceError::new(
                "invalid_llm_wiki_page",
                format!("{noun} path contains an invalid component"),
            ));
        };
        current = open_child(
            &current,
            name,
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            noun,
        )?;
    }

    let std::path::Component::Normal(name) = components[components.len() - 1] else {
        return Err(WorkspaceError::new(
            "invalid_llm_wiki_page",
            format!("{noun} path contains an invalid component"),
        ));
    };
    open_child(
        &current,
        name,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        noun,
    )
}

#[cfg(not(unix))]
fn open_file_no_follow(_root: &Path, path: &Path, noun: &str) -> Result<fs::File, WorkspaceError> {
    fs::File::open(path).map_err(|error| {
        WorkspaceError::from_io("read_failed", format!("failed to open {noun}"), &error)
    })
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

fn is_self_anchor_wikilink(target: &str) -> bool {
    target
        .split('|')
        .next()
        .unwrap_or("")
        .trim()
        .starts_with('#')
}

struct LintPageIndex {
    path_keys: BTreeMap<String, String>,
    unambiguous_names: BTreeMap<String, String>,
}

impl LintPageIndex {
    fn new(root: &Path, files: &[PathBuf]) -> Result<Self, WorkspaceError> {
        let mut path_keys = BTreeMap::new();
        let mut name_counts = BTreeMap::<String, usize>::new();
        let mut name_targets = BTreeMap::new();

        for path in files {
            let relative = relative_path(root, path)?;
            let key = lint_link_path_key(&relative);
            let name = file_stem_title(path)?;
            path_keys.insert(key, relative.clone());
            *name_counts.entry(name.clone()).or_default() += 1;
            name_targets.insert(name, relative);
        }

        let unambiguous_names = name_targets
            .into_iter()
            .filter(|(name, _)| name_counts.get(name) == Some(&1))
            .collect();

        Ok(Self {
            path_keys,
            unambiguous_names,
        })
    }

    fn resolve(&self, source_path: &str, raw_target: &str) -> Option<String> {
        let target = LintLinkTarget::parse(raw_target);
        if target.path.is_empty() {
            return None;
        }

        if target.path.contains('/') {
            if target.root_qualified || is_wiki_root_qualified_link(&target.path) {
                return self.path_keys.get(&target.path).cloned();
            }
            if let Some(relative_target) = self.resolve_source_relative(source_path, &target.path) {
                return Some(relative_target);
            }
            return self.path_keys.get(&target.path).cloned();
        }

        self.unambiguous_names.get(&target.path).cloned()
    }

    fn resolve_source_relative(&self, source_path: &str, target: &str) -> Option<String> {
        let source_key = lint_link_path_key(source_path);
        let source_dir = source_key
            .rsplit_once('/')
            .map(|(dir, _)| dir)
            .unwrap_or("");
        let candidate = if source_dir.is_empty() {
            target.to_string()
        } else {
            format!("{source_dir}/{target}")
        };
        let candidate = normalize_lint_path(&candidate)?;

        self.path_keys.get(&candidate).cloned()
    }
}

struct LintLinkTarget {
    path: String,
    root_qualified: bool,
}

impl LintLinkTarget {
    fn parse(raw_target: &str) -> Self {
        let raw_target = raw_target.split('|').next().unwrap_or("").trim();
        if raw_target.starts_with('#') {
            return Self {
                path: String::new(),
                root_qualified: false,
            };
        }

        let target = raw_target.split('#').next().unwrap_or("").trim();
        let target = trim_markdown_extension(target).trim();
        let (path, root_qualified) = if let Some(rest) = target.strip_prefix("/wiki/") {
            (normalize_lint_path(rest).unwrap_or_default(), true)
        } else if let Some(rest) = target.strip_prefix('/') {
            (normalize_lint_path(rest).unwrap_or_default(), true)
        } else if let Some(rest) = target.strip_prefix("wiki/") {
            (normalize_lint_path(rest).unwrap_or_default(), true)
        } else {
            (target.to_string(), false)
        };

        Self {
            path,
            root_qualified,
        }
    }
}

fn lint_link_path_key(relative_path: &str) -> String {
    trim_markdown_extension(relative_path)
        .trim_start_matches("wiki/")
        .to_string()
}

fn is_wiki_root_qualified_link(target: &str) -> bool {
    matches!(
        target.split('/').next(),
        Some("sources" | "entities" | "concepts" | "syntheses")
    )
}

fn normalize_lint_path(path: &str) -> Option<String> {
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            segment => segments.push(segment),
        }
    }
    Some(segments.join("/"))
}

fn trim_markdown_extension(path: &str) -> &str {
    path.strip_suffix(".markdown")
        .or_else(|| path.strip_suffix(".md"))
        .unwrap_or(path)
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
            "综述文件名不能为空，只能包含英文字母、数字、连字符或下划线",
        ));
    }
    Ok(title.to_ascii_lowercase())
}

pub(crate) fn read_required_managed_text(
    root: &Path,
    relative: &str,
) -> Result<String, WorkspaceError> {
    let path = root.join(relative);
    safe_read_regular_text(root, &path, "llm wiki managed file")
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
