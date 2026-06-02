use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::llm_wiki_fs::{relative_path, write_managed_file};
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
        let contents = read_markdown(&path)?;
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
    write_managed_file(root, &digest_path, content.as_bytes())?;

    let index = read_optional_managed_text(root, "index.md")?;
    let index = ensure_line(index, &format!("- [[{safe_title}]]"));
    write_managed_file(root, "index.md", index.as_bytes())?;

    let log = read_optional_managed_text(root, "log.md")?;
    let log = ensure_line(log, &format!("- digest [[{safe_title}]]"));
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
        let contents = read_markdown(&path)?;
        for target in wikilink_targets(&contents) {
            if !pages.contains(&target) {
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

fn read_markdown(path: &Path) -> Result<String, WorkspaceError> {
    fs::read_to_string(path)
        .map_err(|error| WorkspaceError::from_io("read_failed", "failed to read wiki page", &error))
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

fn read_optional_managed_text(root: &Path, relative: &str) -> Result<String, WorkspaceError> {
    let path = root.join(relative);
    if !path.exists() {
        return Ok(String::new());
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
