use std::collections::BTreeSet;
use std::path::Path;

use crate::llm_wiki_links::{extract_stable_wikilinks, resolve_wiki_link_target};
use crate::llm_wiki_models::{WikiContextBundle, WikiContextReference, WikiContextSelection};
use crate::llm_wiki_query::safe_read_regular_text;
use crate::models::WorkspaceError;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct WikiContextRequest {
    pub purpose: String,
    pub prompt: String,
    pub max_selected_pages: usize,
    pub max_expanded_pages: usize,
    pub max_context_bytes: usize,
}

#[allow(dead_code)]
pub fn parse_page_selection(output: &str) -> Result<WikiContextSelection, WorkspaceError> {
    serde_json::from_str(output).map_err(|error| {
        WorkspaceError::new(
            "llm_wiki_selection_failed",
            format!("failed to parse llm wiki page selection JSON: {error}"),
        )
    })
}

#[allow(dead_code)]
pub fn build_page_selection_prompt(index: &str, request: &WikiContextRequest) -> String {
    format!(
        r#"You are selecting LLM Wiki pages for context.

Return strict JSON only. Do not include markdown fences or explanatory text.
The JSON schema is:
{{"paths":["wiki/concepts/example.md"],"reason":"short reason"}}

Rules:
- Select pages only from wiki/sources, wiki/entities, wiki/concepts, or wiki/syntheses.
- Paths must end in .md.
- Select at most {max_selected_pages} pages.
- Use the index first. Do not invent paths that are not supported by the index.

Purpose:
{purpose}

User prompt:
{prompt}

Index:
{index}
"#,
        max_selected_pages = request.max_selected_pages,
        purpose = request.purpose,
        prompt = request.prompt,
        index = index
    )
}

#[allow(dead_code)]
pub fn build_wiki_context_with_selector_output(
    root: impl AsRef<Path>,
    request: WikiContextRequest,
    selector_output: &str,
) -> Result<WikiContextBundle, WorkspaceError> {
    let root = root.as_ref();
    let selection = parse_page_selection(selector_output)?;
    let selected_paths = selected_page_paths(&selection, request.max_selected_pages)?;

    let mut pages = Vec::new();
    let mut seen = BTreeSet::new();
    for path in selected_paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let contents = read_wiki_page(root, &path)?;
        pages.push(ContextPage { path, contents });
    }

    let mut expanded_paths = Vec::new();
    if request.max_expanded_pages > 0 {
        let mut expanded_seen = BTreeSet::new();
        for page in &pages {
            for link in extract_stable_wikilinks(&page.contents) {
                let Some(target_path) = resolve_wiki_link_target(&link.target) else {
                    continue;
                };
                let target_path = validate_wiki_page_path(&target_path)?;
                if seen.contains(&target_path) || !expanded_seen.insert(target_path.clone()) {
                    continue;
                }
                expanded_paths.push(target_path);
                if expanded_paths.len() >= request.max_expanded_pages {
                    break;
                }
            }
            if expanded_paths.len() >= request.max_expanded_pages {
                break;
            }
        }
    }

    for path in expanded_paths {
        seen.insert(path.clone());
        match read_wiki_page(root, &path) {
            Ok(contents) => pages.push(ContextPage { path, contents }),
            Err(error) if is_skippable_expanded_page_error(&error) => continue,
            Err(error) => return Err(error),
        }
    }

    let mut references = Vec::new();
    let mut markdown = String::new();
    for page in pages {
        let block = page.markdown_block();
        if !references.is_empty() && markdown.len() + block.len() > request.max_context_bytes {
            break;
        }
        references.push(page.reference()?);
        markdown.push_str(&block);
    }

    Ok(WikiContextBundle {
        references,
        markdown,
        selection_reason: selection.reason,
    })
}

#[allow(dead_code)]
pub fn validate_wiki_page_path(path: &str) -> Result<String, WorkspaceError> {
    if path.is_empty()
        || path.contains('\\')
        || path.contains('\0')
        || !path.ends_with(".md")
        || Path::new(path).is_absolute()
    {
        return Err(invalid_wiki_page_path(path));
    }

    let segments = path.split('/').collect::<Vec<_>>();
    if segments.len() < 3
        || segments[0] != "wiki"
        || !matches!(
            segments[1],
            "sources" | "entities" | "concepts" | "syntheses"
        )
    {
        return Err(invalid_wiki_page_path(path));
    }

    for segment in &segments {
        if segment.is_empty() || *segment == "." || *segment == ".." || segment.starts_with('.') {
            return Err(invalid_wiki_page_path(path));
        }
    }

    Ok(path.to_string())
}

fn selected_page_paths(
    selection: &WikiContextSelection,
    max_selected_pages: usize,
) -> Result<Vec<String>, WorkspaceError> {
    let mut paths = Vec::new();
    for path in selection.paths.iter().take(max_selected_pages) {
        paths.push(validate_wiki_page_path(path)?);
    }
    Ok(paths)
}

fn read_wiki_page(root: &Path, path: &str) -> Result<String, WorkspaceError> {
    safe_read_regular_text(root, &root.join(path), "llm wiki page")
}

fn invalid_wiki_page_path(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        "invalid_llm_wiki_page",
        format!("unsafe llm wiki page path: {path}"),
    )
}

fn is_skippable_expanded_page_error(error: &WorkspaceError) -> bool {
    matches!(error.error_code(), "not_found" | "path_type_conflict")
}

struct ContextPage {
    path: String,
    contents: String,
}

impl ContextPage {
    fn reference(&self) -> Result<WikiContextReference, WorkspaceError> {
        Ok(WikiContextReference {
            path: self.path.clone(),
            title: file_stem_title(&self.path)?,
            snippet: first_non_empty_line(&self.contents).unwrap_or_default(),
        })
    }

    fn markdown_block(&self) -> String {
        let mut block = format!("---PAGE: {}---\n{}", self.path, self.contents);
        if !block.ends_with('\n') {
            block.push('\n');
        }
        block
    }
}

fn file_stem_title(path: &str) -> Result<String, WorkspaceError> {
    path.rsplit('/')
        .next()
        .and_then(|name| name.strip_suffix(".md"))
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .ok_or_else(|| WorkspaceError::new("invalid_llm_wiki_page", "wiki page has no valid title"))
}

fn first_non_empty_line(contents: &str) -> Option<String> {
    contents
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}
