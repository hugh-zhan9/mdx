# Karpathy LLM Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/MDX Karpathy风格LLMWiki改造需求设计文档.md`

**Goal:** Rework MDX LLM Wiki into an index-first, LLM-maintained local wiki workflow close to Karpathy's design, covering schema, ingest, query, digest, lint, CLI, and visible long-operation state.

**Architecture:** Add a shared Rust wiki context selector that reads `index.md`, lets the LLM select wiki pages, validates page paths, expands stable wikilinks one hop, and builds bounded context for query, digest, ingest, and semantic lint. Keep raw documents out of query-time retrieval; let ingest read raw and automatically maintain wiki pages through safe file blocks. Expose the same backend behavior through Tauri commands, CLI, and the frontend LLM Wiki panel with stages, timeout, and cancellation.

**Tech Stack:** Rust/Tauri, reqwest blocking client, serde/serde_json, React/TypeScript, Vitest, Cargo tests, mdx-cli Unix socket protocol.

---

## Scope Check

The approved design touches several modules, but they are not independent products. Query, digest, ingest, lint, CLI, and frontend status all depend on one shared LLM Wiki workflow. This plan keeps them in one implementation track and orders tasks so each task produces testable behavior.

## File Structure

- Create: `src-tauri/src/llm_wiki_links.rs`
  - Stable wiki link parsing and resolution helpers shared by context selection, lint, and graph-compatible behavior.
- Create: `src-tauri/src/llm_wiki_context.rs`
  - Index-first page selection, strict JSON parsing, page path validation, one-hop wikilink expansion, bounded context building.
- Create: `src-tauri/src/llm_wiki_operation.rs`
  - In-process operation registry, stage labels, cancel flags, and cancellation checks for long LLM Wiki commands.
- Modify: `src-tauri/src/lib.rs`
  - Register new Rust modules.
- Modify: `src-tauri/src/llm_wiki_models.rs`
  - Add context selection, operation, lint, and CLI-facing response structs.
- Modify: `src-tauri/src/llm_wiki_fs.rs`
  - Strengthen `DEFAULT_AGENTS_MARKDOWN`; reuse stable link helpers where practical.
- Modify: `src-tauri/src/llm_wiki_query.rs`
  - Keep safe read/write utilities; expand mechanical lint; remove `line.contains(question)` as the query/digest primary path.
- Modify: `src-tauri/src/llm_wiki.rs`
  - Wire selector into query/digest/ingest/lint; add operation-aware commands; reduce LLM timeout behavior through `llm_wiki_llm.rs`.
- Modify: `src-tauri/src/llm_wiki_llm.rs`
  - Lower request timeout and expose cancellable stage boundaries around calls.
- Modify: `src-tauri/src/cli_protocol.rs`
  - Add requests/responses for status, ingest, digest, lint JSON, operation state/cancel if CLI needs it.
- Modify: `src-tauri/src/cli_server.rs`
  - Add socket handlers and current-workspace validation.
- Modify: `src-tauri/src/bin/mdx_cli.rs`
  - Add `llm-wiki status/ingest/digest/lint` commands and output modes.
- Modify: `src-tauri/src/llm_wiki_tests.rs`
  - Add Rust unit tests for schema, links, context selector, query/digest, ingest context, lint, and operation behavior.
- Modify: `src-tauri/src/cli_protocol_tests.rs`
  - Add serde tests for new CLI requests.
- Modify: `features/llm-wiki/lib/types.ts`
  - Add operation state, lint JSON, and richer query/digest types.
- Modify: `features/llm-wiki/lib/llm-wiki-client.ts`
  - Add operation state/cancel clients and updated command wrappers.
- Modify: `features/llm-wiki/lib/operation-state.ts`
  - Extend operation ids and labels for query/rescan/ingest stages.
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`
  - Consume backend stages, expose cancel action, remove synthetic heartbeat as primary state.
- Modify: `features/llm-wiki/components/llm-wiki-panel.tsx`
  - Show stage, cancel button, and references consistently.
- Modify: `features/llm-wiki/lib/status-view-model.test.ts`
  - Add frontend model coverage.

## Implementation Rules

- Use TDD for each task. Write the failing test first and run the narrow test before implementation.
- Do not use raw documents in query or digest.
- Do not change unrelated dirty worktree files except where this plan explicitly lists them.
- When committing, stage only the files listed in the task.
- Keep old workspaces compatible. New generated output follows the stable link contract; old links remain readable but lint reports them.

### Task 1: Stable Link Contract And Schema Rules

**Files:**
- Create: `src-tauri/src/llm_wiki_links.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/llm_wiki_fs.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing tests for stable wikilinks and schema rules**

Add these imports near the top of `src-tauri/src/llm_wiki_tests.rs`:

```rust
use crate::llm_wiki_links::{
    extract_stable_wikilinks, is_stable_wiki_link_target, resolve_wiki_link_target,
};
```

Add these tests near the existing LLM Wiki initialization and lint tests:

```rust
#[test]
fn default_agents_rules_describe_karpathy_style_schema() {
    let root = tempdir().unwrap();

    initialize_llm_wiki_workspace(root.path()).unwrap();

    let agents = std::fs::read_to_string(root.path().join("AGENTS.md")).unwrap();
    assert!(agents.contains("raw/ is the immutable source layer"));
    assert!(agents.contains("wiki/ is the maintained knowledge layer"));
    assert!(agents.contains("index.md is the navigation entry point"));
    assert!(agents.contains("[[entities/example|Readable Label]]"));
    assert!(agents.contains("Do not use raw documents during query"));
}

#[test]
fn stable_wikilink_parser_accepts_path_alias_links() {
    let links = extract_stable_wikilinks(
        "[[entities/karpathy|Karpathy]] and [[concepts/llm-wiki|LLM Wiki]]",
    );

    assert_eq!(links.len(), 2);
    assert_eq!(links[0].target, "entities/karpathy");
    assert_eq!(links[0].label.as_deref(), Some("Karpathy"));
    assert_eq!(links[1].target, "concepts/llm-wiki");
}

#[test]
fn stable_wikilink_contract_rejects_unqualified_name_links() {
    assert!(is_stable_wiki_link_target("entities/karpathy"));
    assert!(is_stable_wiki_link_target("concepts/llm-wiki"));
    assert!(is_stable_wiki_link_target("sources/raw-note"));
    assert!(is_stable_wiki_link_target("syntheses/karpathy-llm-wiki"));

    assert!(!is_stable_wiki_link_target("Karpathy"));
    assert!(!is_stable_wiki_link_target("../entities/karpathy"));
    assert!(!is_stable_wiki_link_target("wiki/entities/karpathy"));
    assert!(!is_stable_wiki_link_target("entities/karpathy.md"));
}

#[test]
fn stable_wikilink_resolution_maps_targets_to_wiki_markdown_paths() {
    assert_eq!(
        resolve_wiki_link_target("entities/karpathy").unwrap(),
        "wiki/entities/karpathy.md"
    );
    assert_eq!(
        resolve_wiki_link_target("concepts/llm-wiki#Query").unwrap(),
        "wiki/concepts/llm-wiki.md"
    );
    assert!(resolve_wiki_link_target("Karpathy").is_none());
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "default_agents_rules_describe_karpathy_style_schema|stable_wikilink" -- --nocapture
```

Expected: compile failure because `llm_wiki_links` does not exist, or assertions fail because the schema text is not yet updated.

- [ ] **Step 3: Create stable link utilities**

Create `src-tauri/src/llm_wiki_links.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StableWikiLink {
    pub target: String,
    pub label: Option<String>,
}

pub fn extract_stable_wikilinks(contents: &str) -> Vec<StableWikiLink> {
    let mut links = Vec::new();
    let mut remaining = contents;

    while let Some(start) = remaining.find("[[") {
        remaining = &remaining[start + 2..];
        let Some(end) = remaining.find("]]") else {
            break;
        };

        let raw = &remaining[..end];
        let mut parts = raw.splitn(2, '|');
        let target = parts.next().unwrap_or("").trim();
        let label = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if is_stable_wiki_link_target(target) {
            links.push(StableWikiLink {
                target: target.to_string(),
                label,
            });
        }

        remaining = &remaining[end + 2..];
    }

    links
}

pub fn is_stable_wiki_link_target(target: &str) -> bool {
    let target = target.split('#').next().unwrap_or("").trim();
    let Some((section, slug)) = target.split_once('/') else {
        return false;
    };

    matches!(section, "sources" | "entities" | "concepts" | "syntheses")
        && is_ascii_slug_path(slug)
}

pub fn resolve_wiki_link_target(target: &str) -> Option<String> {
    let target = target.split('#').next().unwrap_or("").trim();
    if !is_stable_wiki_link_target(target) {
        return None;
    }

    Some(format!("wiki/{target}.md"))
}

fn is_ascii_slug_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains("//")
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || byte == b'-'
                        || byte == b'_'
                })
        })
}
```

Modify `src-tauri/src/lib.rs` to register the module:

```rust
mod llm_wiki_links;
```

- [ ] **Step 4: Strengthen default AGENTS schema**

Replace `DEFAULT_AGENTS_MARKDOWN` in `src-tauri/src/llm_wiki_fs.rs` with:

```rust
pub(crate) const DEFAULT_AGENTS_MARKDOWN: &str = r#"# LLM Wiki Rules

## Layers

- `raw/` is the immutable source layer. Read raw sources during ingest only.
- `wiki/` is the maintained knowledge layer. The LLM may create and update wiki pages.
- `AGENTS.md` is the schema layer. Follow these rules before writing or answering.
- `index.md` is the navigation entry point for humans and LLMs.
- `log.md` is the audit timeline for ingest, query, digest, lint, and graph operations.

## Query Boundary

- Do not use raw documents during query.
- Answer questions from `index.md` and selected wiki pages only.
- If the wiki context is insufficient, say so instead of inventing facts.
- Query should append `log.md` but must not automatically write new wiki pages.

## Ingest Workflow

- Read one raw source, `purpose.md`, `AGENTS.md`, `index.md`, and relevant existing wiki pages.
- Produce one source summary under `wiki/sources/`.
- Update related pages under `wiki/entities/`, `wiki/concepts/`, and `wiki/syntheses/` when useful.
- Update `index.md` so it remains the navigation entry point.
- Append `log.md`.
- Preserve uncertainty, disagreements, and provenance.

## Digest Workflow

- Use digest only when the user explicitly wants to persist a synthesis.
- Write cross-source synthesis pages under `wiki/syntheses/`.
- Update `index.md` and append `log.md`.

## Page Types

- Put source summaries under `wiki/sources/`.
- Put named people, projects, products, systems, and organizations under `wiki/entities/`.
- Put reusable ideas, methods, terms, workflows, constraints, and decisions under `wiki/concepts/`.
- Put cross-source summaries and comparisons under `wiki/syntheses/`.

## Paths And Links

- File paths must be ASCII lowercase slugs using letters, digits, hyphens, underscores, and `/`.
- Link to wiki pages with stable path links and aliases:
  - `[[sources/example-source|Readable Label]]`
  - `[[entities/example|Readable Label]]`
  - `[[concepts/example-concept|Readable Label]]`
  - `[[syntheses/example-synthesis|Readable Label]]`
- Avoid unqualified links such as `[[Karpathy]]` in new generated pages.

## Page Quality

- Write concise Chinese by default unless the source clearly requires another language.
- Keep pages scan-friendly with clear headings and short sections.
- Include source provenance in generated source pages and factual claims.
- Do not invent facts.
"#;
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
cd src-tauri && cargo test "default_agents_rules_describe_karpathy_style_schema|stable_wikilink" -- --nocapture
```

Expected: all new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/llm_wiki_fs.rs src-tauri/src/llm_wiki_links.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: define llm wiki schema link contract"
```

### Task 2: Index-First Context Selector Core

**Files:**
- Create: `src-tauri/src/llm_wiki_context.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing tests for selection JSON and page expansion**

Add these imports to `src-tauri/src/llm_wiki_tests.rs`:

```rust
use crate::llm_wiki_context::{
    build_wiki_context_with_selector_output, parse_page_selection, WikiContextRequest,
};
```

Add these tests:

```rust
#[test]
fn parse_page_selection_accepts_strict_json_paths() {
    let selection = parse_page_selection(
        r#"{"paths":["wiki/concepts/llm-wiki.md","wiki/entities/karpathy.md"],"reason":"index match"}"#,
    )
    .unwrap();

    assert_eq!(
        selection.paths,
        vec![
            "wiki/concepts/llm-wiki.md".to_string(),
            "wiki/entities/karpathy.md".to_string()
        ]
    );
    assert_eq!(selection.reason.as_deref(), Some("index match"));
}

#[test]
fn parse_page_selection_rejects_non_json_output() {
    let error = parse_page_selection("Here are the pages:\nwiki/concepts/a.md").unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_selection_failed");
}

#[test]
fn context_selector_reads_selected_pages_and_expands_one_hop_links() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/concepts/llm-wiki.md",
        "# LLM Wiki\n\nSee [[entities/karpathy|Karpathy]].\n".as_bytes(),
    )
    .unwrap();
    write_managed_file(
        root.path(),
        "wiki/entities/karpathy.md",
        "# Karpathy\n\nSource-backed note.\n".as_bytes(),
    )
    .unwrap();

    let context = build_wiki_context_with_selector_output(
        root.path(),
        WikiContextRequest {
            purpose: "query".to_string(),
            prompt: "What is LLM Wiki?".to_string(),
            max_selected_pages: 8,
            max_expanded_pages: 8,
            max_context_bytes: 64 * 1024,
        },
        r#"{"paths":["wiki/concepts/llm-wiki.md"],"reason":"index match"}"#,
    )
    .unwrap();

    assert_eq!(
        context
            .references
            .iter()
            .map(|reference| reference.path.as_str())
            .collect::<Vec<_>>(),
        vec!["wiki/concepts/llm-wiki.md", "wiki/entities/karpathy.md"]
    );
    assert!(context.markdown.contains("---PAGE: wiki/concepts/llm-wiki.md---"));
    assert!(context.markdown.contains("---PAGE: wiki/entities/karpathy.md---"));
}

#[test]
fn context_selector_rejects_paths_outside_wiki() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let error = build_wiki_context_with_selector_output(
        root.path(),
        WikiContextRequest {
            purpose: "query".to_string(),
            prompt: "bad".to_string(),
            max_selected_pages: 8,
            max_expanded_pages: 8,
            max_context_bytes: 64 * 1024,
        },
        r#"{"paths":["raw/notes/a.md"],"reason":"bad"}"#,
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "invalid_llm_wiki_page");
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "parse_page_selection|context_selector" -- --nocapture
```

Expected: compile failure because `llm_wiki_context` does not exist.

- [ ] **Step 3: Add context models**

Append to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiContextReference {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiContextSelection {
    pub paths: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiContextBundle {
    pub references: Vec<WikiContextReference>,
    pub markdown: String,
    pub selection_reason: Option<String>,
}
```

- [ ] **Step 4: Create context selector core**

Create `src-tauri/src/llm_wiki_context.rs`:

```rust
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::llm_wiki_links::{extract_stable_wikilinks, resolve_wiki_link_target};
use crate::llm_wiki_models::{WikiContextBundle, WikiContextReference, WikiContextSelection};
use crate::llm_wiki_query::safe_read_regular_text;
use crate::models::WorkspaceError;

#[derive(Debug, Clone)]
pub struct WikiContextRequest {
    pub purpose: String,
    pub prompt: String,
    pub max_selected_pages: usize,
    pub max_expanded_pages: usize,
    pub max_context_bytes: usize,
}

pub fn parse_page_selection(output: &str) -> Result<WikiContextSelection, WorkspaceError> {
    serde_json::from_str::<WikiContextSelection>(output.trim()).map_err(|error| {
        WorkspaceError::new(
            "llm_wiki_selection_failed",
            format!("failed to parse llm wiki page selection JSON: {error}"),
        )
    })
}

pub fn build_page_selection_prompt(index: &str, request: &WikiContextRequest) -> String {
    format!(
        r#"Select relevant LLM Wiki pages from the index.

Return strict JSON only:
{{"paths":["wiki/concepts/example.md"],"reason":"short reason"}}

Rules:
- Select only existing-looking wiki page paths from the index.
- Use paths under wiki/sources, wiki/entities, wiki/concepts, or wiki/syntheses.
- Do not select raw files.
- Prefer 1-8 pages.

Purpose:
{}

User request:
{}

Index:
{}
"#,
        request.purpose, request.prompt, index
    )
}

pub fn build_wiki_context_with_selector_output(
    root: impl AsRef<Path>,
    request: WikiContextRequest,
    selector_output: &str,
) -> Result<WikiContextBundle, WorkspaceError> {
    let root = root.as_ref();
    let selection = parse_page_selection(selector_output)?;
    let selected_paths = selection
        .paths
        .iter()
        .take(request.max_selected_pages)
        .map(|path| validate_wiki_page_path(path))
        .collect::<Result<Vec<_>, _>>()?;

    let mut ordered_paths = Vec::new();
    let mut seen = BTreeSet::new();
    for path in selected_paths {
        if seen.insert(path.clone()) {
            ordered_paths.push(path);
        }
    }

    let mut expanded = 0usize;
    let selected_snapshot = ordered_paths.clone();
    for path in selected_snapshot {
        if expanded >= request.max_expanded_pages {
            break;
        }
        let contents = read_wiki_page(root, &path)?;
        for link in extract_stable_wikilinks(&contents) {
            if expanded >= request.max_expanded_pages {
                break;
            }
            let Some(target_path) = resolve_wiki_link_target(&link.target) else {
                continue;
            };
            let target_path = validate_wiki_page_path(&target_path)?;
            if !root.join(&target_path).is_file() {
                continue;
            }
            if seen.insert(target_path.clone()) {
                ordered_paths.push(target_path);
                expanded += 1;
            }
        }
    }

    let mut markdown = String::new();
    let mut references = Vec::new();
    for path in ordered_paths {
        let contents = read_wiki_page(root, &path)?;
        let next_block = format!("---PAGE: {path}---\n{}\n", ensure_trailing_newline(&contents));
        if !markdown.is_empty()
            && markdown.len().saturating_add(next_block.len()) > request.max_context_bytes
        {
            break;
        }
        markdown.push_str(&next_block);
        references.push(WikiContextReference {
            title: file_stem_title(&path),
            snippet: first_non_empty_line(&contents),
            path,
        });
    }

    Ok(WikiContextBundle {
        references,
        markdown,
        selection_reason: selection.reason,
    })
}

pub fn validate_wiki_page_path(path: &str) -> Result<String, WorkspaceError> {
    let path = path.trim().trim_start_matches('/');
    if path.is_empty()
        || path.contains('\\')
        || path.contains('\0')
        || !path.ends_with(".md")
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.starts_with('.')
        })
    {
        return Err(invalid_page_path());
    }

    let allowed = ["wiki/sources/", "wiki/entities/", "wiki/concepts/", "wiki/syntheses/"];
    if !allowed.iter().any(|prefix| path.starts_with(prefix)) {
        return Err(invalid_page_path());
    }

    Ok(path.to_string())
}

fn read_wiki_page(root: &Path, relative: &str) -> Result<String, WorkspaceError> {
    let path = root.join(relative);
    let path = normalize_joined_path(root, &path)?;
    safe_read_regular_text(root, &path, "wiki page")
}

fn normalize_joined_path(root: &Path, path: &Path) -> Result<PathBuf, WorkspaceError> {
    if path.starts_with(root) {
        Ok(path.to_path_buf())
    } else {
        Err(invalid_page_path())
    }
}

fn invalid_page_path() -> WorkspaceError {
    WorkspaceError::new(
        "invalid_llm_wiki_page",
        "llm wiki page path must be under wiki/sources, wiki/entities, wiki/concepts, or wiki/syntheses",
    )
}

fn file_stem_title(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn first_non_empty_line(contents: &str) -> String {
    contents
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}

fn ensure_trailing_newline(contents: &str) -> String {
    if contents.ends_with('\n') {
        contents.to_string()
    } else {
        format!("{contents}\n")
    }
}
```

Modify `src-tauri/src/lib.rs`:

```rust
mod llm_wiki_context;
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
cd src-tauri && cargo test "parse_page_selection|context_selector" -- --nocapture
```

Expected: all new selector tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/llm_wiki_context.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: add index first wiki context selector"
```

### Task 3: Query And Digest Use Index-First Context

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_query.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing tests for query/digest not using raw or line contains**

Add tests to `src-tauri/src/llm_wiki_tests.rs`:

```rust
#[test]
fn query_context_can_be_built_from_index_selection_without_matching_question_line() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(
        root.path().join("index.md"),
        "# Index\n\n- [[concepts/llm-wiki|LLM Wiki]]\n",
    )
    .unwrap();
    write_managed_file(
        root.path(),
        "wiki/concepts/llm-wiki.md",
        "# LLM Wiki\n\nA maintained wiki knowledge layer.\n".as_bytes(),
    )
    .unwrap();

    let context = crate::llm_wiki::build_query_context_from_selection_for_test(
        root.path(),
        "Explain Karpathy design".to_string(),
        r#"{"paths":["wiki/concepts/llm-wiki.md"],"reason":"index"}"#,
    )
    .unwrap();

    assert!(context.markdown.contains("maintained wiki knowledge layer"));
    assert_eq!(context.references[0].path, "wiki/concepts/llm-wiki.md");
}

#[test]
fn digest_page_index_entry_uses_stable_synthesis_link() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();

    let path = write_digest_page(root.path(), "karpathy-llm-wiki", "# Karpathy LLM Wiki\n").unwrap();

    assert_eq!(path, "wiki/syntheses/karpathy-llm-wiki.md");
    let index = std::fs::read_to_string(root.path().join("index.md")).unwrap();
    assert!(index.contains("[[syntheses/karpathy-llm-wiki|karpathy-llm-wiki]]"));
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "query_context_can_be_built_from_index_selection_without_matching_question_line|digest_page_index_entry_uses_stable_synthesis_link" -- --nocapture
```

Expected: compile failure for `build_query_context_from_selection_for_test`, and digest index assertion fails until `write_digest_page` uses stable links.

- [ ] **Step 3: Add query context helper and map references**

Modify imports in `src-tauri/src/llm_wiki.rs`:

```rust
use crate::llm_wiki_context::{
    build_page_selection_prompt, build_wiki_context_with_selector_output, WikiContextRequest,
};
use crate::llm_wiki_models::WikiContextBundle;
```

Add helper functions near the current `build_query_context`:

```rust
const DEFAULT_SELECTED_PAGE_LIMIT: usize = 8;
const DEFAULT_EXPANDED_PAGE_LIMIT: usize = 8;
const DEFAULT_CONTEXT_LIMIT_BYTES: usize = 64 * 1024;

fn wiki_context_references_to_search_results(
    references: Vec<crate::llm_wiki_models::WikiContextReference>,
) -> Vec<WikiSearchResult> {
    references
        .into_iter()
        .map(|reference| WikiSearchResult {
            path: reference.path,
            title: reference.title,
            snippet: reference.snippet,
        })
        .collect()
}

fn default_context_request(purpose: &str, prompt: &str) -> WikiContextRequest {
    WikiContextRequest {
        purpose: purpose.to_string(),
        prompt: prompt.to_string(),
        max_selected_pages: DEFAULT_SELECTED_PAGE_LIMIT,
        max_expanded_pages: DEFAULT_EXPANDED_PAGE_LIMIT,
        max_context_bytes: DEFAULT_CONTEXT_LIMIT_BYTES,
    }
}

fn select_wiki_context(
    root: &Path,
    config: &LlmProviderConfig,
    purpose: &str,
    prompt: &str,
) -> Result<WikiContextBundle, WorkspaceError> {
    let index = read_optional_managed_text(root, "index.md")?;
    if index.trim().is_empty() {
        return Ok(WikiContextBundle {
            references: Vec::new(),
            markdown: String::new(),
            selection_reason: Some("index is empty".to_string()),
        });
    }

    let request = default_context_request(purpose, prompt);
    let selection_prompt = build_page_selection_prompt(&index, &request);
    let selection_output = call_chat_completion(
        config,
        vec![
            system_message("You select LLM Wiki pages. Return strict JSON only."),
            user_message(selection_prompt),
        ],
    )?;

    build_wiki_context_with_selector_output(root, request, &selection_output)
}

#[cfg(test)]
pub(crate) fn build_query_context_from_selection_for_test(
    root: &Path,
    question: String,
    selector_output: &str,
) -> Result<WikiContextBundle, WorkspaceError> {
    build_wiki_context_with_selector_output(
        root,
        default_context_request("query", &question),
        selector_output,
    )
}
```

Update `llm_wiki_query_sync`:

```rust
pub fn llm_wiki_query_sync(
    root_path: String,
    question: String,
) -> Result<LlmWikiQueryResponse, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    let question = question.trim().to_string();
    append_log_entry(&root, &format!("query {question}"))?;

    if question.is_empty() {
        return Err(WorkspaceError::new("invalid_question", "question must not be empty"));
    }

    let config = load_llm_config_from_path(default_llm_config_path()?)?;
    let context = select_wiki_context(&root, &config, "query", &question)?;
    let references = wiki_context_references_to_search_results(context.references);

    if context.markdown.trim().is_empty() || references.is_empty() {
        return Ok(LlmWikiQueryResponse {
            answer: "当前知识库中没有足够上下文回答这个问题。".to_string(),
            references,
            insufficient_context: true,
        });
    }

    let answer = call_chat_completion(
        &config,
        vec![
            system_message(
                "You answer using only the supplied LLM Wiki pages. Cite wiki page paths in Chinese.",
            ),
            user_message(format!(
                "Question:\n{question}\n\nWiki context:\n{}\n\nAnswer in Chinese. Do not use raw documents or information outside the wiki context.",
                context.markdown
            )),
        ],
    )?;

    Ok(LlmWikiQueryResponse {
        answer,
        references,
        insufficient_context: false,
    })
}
```

Update `llm_wiki_digest_sync` to call `select_wiki_context` with purpose `digest` and prompt `format!("{title}\n{prompt}")`, then pass `context.markdown` to the synthesis prompt.

- [ ] **Step 4: Update digest index stable link**

Modify `write_digest_page` in `src-tauri/src/llm_wiki_query.rs`:

```rust
let index = read_required_managed_text(root, "index.md")?;
let index = ensure_line(
    index,
    &format!("- [[syntheses/{safe_title}|{safe_title}]]"),
);
```

Keep the log line:

```rust
let log = ensure_line(log, &format!("- digest [[syntheses/{safe_title}|{safe_title}]]"));
```

- [ ] **Step 5: Run narrow tests**

Run:

```bash
cd src-tauri && cargo test "query_context_can_be_built_from_index_selection_without_matching_question_line|digest_page_index_entry_uses_stable_synthesis_link|llm_wiki_query_returns_insufficient_context_without_llm_call_when_search_is_empty|write_digest_page_saves_under_syntheses_and_updates_index_and_log" -- --nocapture
```

Expected: new tests pass. The old insufficient-context test may need its name and setup updated because query now loads LLM config before selection. If it fails due missing LLM config, rewrite it to assert `build_query_context_from_selection_for_test` returns empty context for `{"paths":[],"reason":"none"}` instead of calling the full LLM-backed query.

- [ ] **Step 6: Remove old primary query context path**

Keep `search_wiki_pages` for CLI search, but ensure `llm_wiki_query_sync` and `llm_wiki_digest_sync` no longer call it. Verify:

```bash
rg -n "search_wiki_pages\\(&root, &question\\)|search_wiki_pages\\(&root, &format" src-tauri/src/llm_wiki.rs
```

Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_query.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: route query and digest through wiki index context"
```

### Task 4: Ingest Reads Related Existing Wiki Pages

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_ingest.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing tests for ingest prompts**

Add tests:

```rust
#[test]
fn ingest_generation_prompt_includes_related_existing_wiki_context() {
    let analysis = r#"{"source_summary":"new source","entities":["Karpathy"],"concepts":["LLM Wiki"],"suggested_source_slug":"note"}"#;
    let existing_context = "# Purpose\nBuild wiki\n\n# Index\n- [[concepts/llm-wiki|LLM Wiki]]\n\n---PAGE: wiki/concepts/llm-wiki.md---\n# LLM Wiki\nExisting page.\n";

    let prompt = build_ingest_generation_prompt(analysis, existing_context);

    assert!(prompt.contains("---PAGE: wiki/concepts/llm-wiki.md---"));
    assert!(prompt.contains("Update related entity and concept pages"));
    assert!(prompt.contains("[[concepts/example-concept|Readable Label]]"));
}

#[test]
fn ingest_analysis_prompt_reinforces_raw_only_for_ingest() {
    let prompt = build_ingest_analysis_prompt("# Raw", "# Purpose", "# AGENTS", "# Index");

    assert!(prompt.contains("Analyze this raw source for ingest"));
    assert!(prompt.contains("Do not answer user queries from raw sources"));
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "ingest_generation_prompt_includes_related_existing_wiki_context|ingest_analysis_prompt_reinforces_raw_only_for_ingest" -- --nocapture
```

Expected: assertions fail until prompts are strengthened.

- [ ] **Step 3: Strengthen ingest prompts**

In `build_ingest_analysis_prompt`, change the prompt opening to:

```rust
r#"Analyze this raw source for ingest into an LLM Wiki workspace.

Return strict JSON only. Do not include markdown fences.
Do not answer user queries from raw sources. Raw sources are used only during ingest.
Identify:
...
"#
```

In `build_ingest_generation_prompt`, add these rules before `Analysis JSON`:

```rust
- Update related entity and concept pages when the source adds useful facts, contradictions, or provenance.
- Preserve existing wiki context instead of replacing it blindly.
- Use stable wikilinks with aliases, such as [[concepts/example-concept|Readable Label]].
- Include source provenance for factual claims.
- If the source conflicts with existing wiki context, record the disagreement instead of erasing either side.
```

- [ ] **Step 4: Wire existing wiki context into ingest**

In `llm_wiki_ingest_raw_file_sync`, after `analysis_json` is produced and before `generation_prompt`, replace the current `existing_context` with selector-backed context:

```rust
let selection_prompt = format!("{raw_relative_path}\n{analysis_json}");
let related_context = select_wiki_context(&root, &config, "ingest", &selection_prompt)
    .map(|bundle| bundle.markdown)
    .unwrap_or_default();
let existing_context = format!(
    "# Purpose\n{purpose}\n\n# AGENTS\n{agents}\n\n# Index\n{index}\n\n# Related Wiki Pages\n{related_context}\n"
);
```

If `select_wiki_context` is private, keep it private and add the ingest wiring inside `src-tauri/src/llm_wiki.rs` where the function already lives.

- [ ] **Step 5: Run ingest prompt tests and existing ingest parser tests**

Run:

```bash
cd src-tauri && cargo test "ingest_generation_prompt_includes_related_existing_wiki_context|ingest_analysis_prompt_reinforces_raw_only_for_ingest|ingest_parse_file_blocks|ingest_write_outputs" -- --nocapture
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_ingest.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: include related wiki context during ingest"
```

### Task 5: Mechanical And Semantic Lint

**Files:**
- Modify: `src-tauri/src/llm_wiki_query.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing mechanical lint tests**

Add tests:

```rust
#[test]
fn mechanical_lint_reports_orphan_pages_and_missing_index_entries() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/concepts/orphan.md",
        "# Orphan\n\nNo backlinks.\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("## 孤儿页面"));
    assert!(report.contains("wiki/concepts/orphan.md"));
    assert!(report.contains("## Index 缺失"));
    assert!(report.contains("[[concepts/orphan|orphan]]"));
}

#[test]
fn mechanical_lint_reports_unstable_wikilinks_and_missing_source_provenance() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    write_managed_file(
        root.path(),
        "wiki/concepts/llm-wiki.md",
        "# LLM Wiki\n\nSee [[Karpathy]].\n".as_bytes(),
    )
    .unwrap();
    write_managed_file(
        root.path(),
        "wiki/sources/note.md",
        "# Note\n\nNo raw path here.\n".as_bytes(),
    )
    .unwrap();

    let report = mechanical_lint_report(root.path()).unwrap();

    assert!(report.contains("## 非稳定 Wikilink"));
    assert!(report.contains("wiki/concepts/llm-wiki.md: [[Karpathy]]"));
    assert!(report.contains("## Source provenance 缺失"));
    assert!(report.contains("wiki/sources/note.md"));
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "mechanical_lint_reports_orphan_pages_and_missing_index_entries|mechanical_lint_reports_unstable_wikilinks_and_missing_source_provenance" -- --nocapture
```

Expected: report lacks the new sections.

- [ ] **Step 3: Extend mechanical lint report**

In `src-tauri/src/llm_wiki_query.rs`, extend `mechanical_lint_report` to collect:

```rust
let mut orphan_pages = Vec::new();
let mut missing_index_entries = Vec::new();
let mut unstable_links = Vec::new();
let mut source_pages_missing_provenance = Vec::new();
```

Use these exact section headings in the final report:

```rust
append_report_section(&mut report, "## 断链", &broken);
append_report_section(&mut report, "## 孤儿页面", &orphan_pages);
append_report_section(&mut report, "## Index 缺失", &missing_index_entries);
append_report_section(&mut report, "## 非稳定 Wikilink", &unstable_links);
append_report_section(
    &mut report,
    "## Source provenance 缺失",
    &source_pages_missing_provenance,
);
```

Add helper:

```rust
fn append_report_section(report: &mut String, heading: &str, lines: &[String]) {
    report.push_str(heading);
    report.push('\n');
    if lines.is_empty() {
        report.push_str("无\n");
    } else {
        report.push_str(&lines.join("\n"));
        report.push('\n');
    }
}
```

Use `extract_stable_wikilinks` for stable links and a small raw wikilink extractor for reporting non-stable links. Treat source provenance as present when a source page contains either `raw/` or `Source:` or `来源：`.

- [ ] **Step 4: Add semantic lint response model**

Append to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiLintResponse {
    pub report: String,
    pub semantic_ran: bool,
}
```

In `llm_wiki.rs`, keep the existing `llm_wiki_lint(root_path) -> Result<String, WorkspaceError>` for frontend compatibility, and add an internal helper:

```rust
fn build_semantic_lint_prompt(index: &str, mechanical_report: &str) -> String {
    format!(
        "Review this LLM Wiki mechanically generated report and index. Report potential contradictions, stale claims, duplicate pages, missing concepts, and follow-up questions in Chinese. Do not modify files.\n\nIndex:\n{index}\n\nMechanical report:\n{mechanical_report}"
    )
}
```

Call LLM semantic lint only when `load_optional_llm_config_from_path(default_llm_config_path()?)?` returns `Some(config)`. If semantic lint fails, append a report section:

```text
## LLM 语义检查
LLM 语义检查失败：{error}
```

If config is missing, append:

```text
## LLM 语义检查
未配置 LLM，已跳过。
```

- [ ] **Step 5: Run lint tests**

Run:

```bash
cd src-tauri && cargo test "mechanical_lint_reports|llm_wiki_lint_records_log_entry" -- --nocapture
```

Expected: all lint tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/llm_wiki_query.rs src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: expand llm wiki lint coverage"
```

### Task 6: Operation Stages, Timeout, And Cancellation

**Files:**
- Create: `src-tauri/src/llm_wiki_operation.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/llm_wiki_llm.rs`
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write failing tests for operation state and timeout constant**

Add tests:

```rust
#[test]
fn llm_wiki_operation_registry_tracks_stage_and_cancel() {
    let registry = crate::llm_wiki_operation::LlmWikiOperationRegistry::new();
    let id = registry.start("query");

    registry.set_stage(&id, "selecting_pages").unwrap();
    let state = registry.state(&id).unwrap();
    assert_eq!(state.operation, "query");
    assert_eq!(state.stage, "selecting_pages");
    assert!(!state.cancelled);

    registry.cancel(&id).unwrap();
    assert!(registry.is_cancelled(&id));
}

#[test]
fn llm_timeout_is_not_six_hundred_seconds() {
    assert!(crate::llm_wiki_llm::llm_request_timeout_secs_for_test() <= 120);
    assert!(crate::llm_wiki_llm::llm_request_timeout_secs_for_test() >= 60);
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "llm_wiki_operation_registry_tracks_stage_and_cancel|llm_timeout_is_not_six_hundred_seconds" -- --nocapture
```

Expected: compile failure for missing module/test helper, or timeout assertion fails.

- [ ] **Step 3: Add operation model and registry**

Append to `src-tauri/src/llm_wiki_models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiOperationState {
    pub operation_id: String,
    pub operation: String,
    pub stage: String,
    pub cancelled: bool,
}
```

Create `src-tauri/src/llm_wiki_operation.rs`:

```rust
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::llm_wiki_models::LlmWikiOperationState;
use crate::models::WorkspaceError;

#[derive(Clone, Default)]
pub struct LlmWikiOperationRegistry {
    counter: Arc<AtomicU64>,
    states: Arc<Mutex<BTreeMap<String, LlmWikiOperationState>>>,
}

impl LlmWikiOperationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(&self, operation: &str) -> String {
        let id = format!("llm-wiki-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        let state = LlmWikiOperationState {
            operation_id: id.clone(),
            operation: operation.to_string(),
            stage: "starting".to_string(),
            cancelled: false,
        };
        self.states.lock().expect("operation registry lock").insert(id.clone(), state);
        id
    }

    pub fn set_stage(&self, id: &str, stage: &str) -> Result<(), WorkspaceError> {
        let mut states = self.states.lock().expect("operation registry lock");
        let state = states.get_mut(id).ok_or_else(operation_not_found)?;
        state.stage = stage.to_string();
        Ok(())
    }

    pub fn state(&self, id: &str) -> Result<LlmWikiOperationState, WorkspaceError> {
        self.states
            .lock()
            .expect("operation registry lock")
            .get(id)
            .cloned()
            .ok_or_else(operation_not_found)
    }

    pub fn cancel(&self, id: &str) -> Result<(), WorkspaceError> {
        let mut states = self.states.lock().expect("operation registry lock");
        let state = states.get_mut(id).ok_or_else(operation_not_found)?;
        state.cancelled = true;
        Ok(())
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        self.states
            .lock()
            .expect("operation registry lock")
            .get(id)
            .map(|state| state.cancelled)
            .unwrap_or(false)
    }

    pub fn finish(&self, id: &str) {
        self.states.lock().expect("operation registry lock").remove(id);
    }
}

pub fn ensure_not_cancelled(registry: &LlmWikiOperationRegistry, id: &str) -> Result<(), WorkspaceError> {
    if registry.is_cancelled(id) {
        return Err(WorkspaceError::new("cancelled", "llm wiki operation was cancelled"));
    }
    Ok(())
}

fn operation_not_found() -> WorkspaceError {
    WorkspaceError::new("operation_not_found", "llm wiki operation was not found")
}
```

Register module in `src-tauri/src/lib.rs`:

```rust
mod llm_wiki_operation;
```

- [ ] **Step 4: Lower LLM timeout and expose test helper**

In `src-tauri/src/llm_wiki_llm.rs`, change:

```rust
const LLM_REQUEST_TIMEOUT_SECS: u64 = 90;
```

Add:

```rust
#[cfg(test)]
pub(crate) fn llm_request_timeout_secs_for_test() -> u64 {
    LLM_REQUEST_TIMEOUT_SECS
}
```

- [ ] **Step 5: Add Tauri commands for operation state and cancel**

In `src-tauri/src/llm_wiki.rs`, add commands:

```rust
#[tauri::command]
pub fn llm_wiki_operation_cancel(operation_id: String) -> Result<(), WorkspaceError> {
    let registry = crate::llm_wiki_operation::LlmWikiOperationRegistry::new();
    registry.cancel(&operation_id)
}

#[tauri::command]
pub fn llm_wiki_operation_state(
    operation_id: String,
) -> Result<crate::llm_wiki_models::LlmWikiOperationState, WorkspaceError> {
    let registry = crate::llm_wiki_operation::LlmWikiOperationRegistry::new();
    registry.state(&operation_id)
}
```

Then adjust the implementation to use a process-global registry instead of constructing a new one per command. The concrete code should be:

```rust
use std::sync::OnceLock;
use crate::llm_wiki_operation::LlmWikiOperationRegistry;

static LLM_WIKI_OPERATIONS: OnceLock<LlmWikiOperationRegistry> = OnceLock::new();

fn llm_wiki_operations() -> &'static LlmWikiOperationRegistry {
    LLM_WIKI_OPERATIONS.get_or_init(LlmWikiOperationRegistry::new)
}
```

Use `llm_wiki_operations()` in both commands.

- [ ] **Step 6: Add stage boundaries to query/digest/ingest**

Add optional `operation_id: Option<String>` parameters only to new operation-aware internal helpers first. For each stage, call:

```rust
if let Some(operation_id) = operation_id.as_deref() {
    llm_wiki_operations().set_stage(operation_id, "selecting_pages")?;
    crate::llm_wiki_operation::ensure_not_cancelled(llm_wiki_operations(), operation_id)?;
}
```

Use exact stage strings:

```text
reading_index
selecting_pages
reading_pages
answering
writing_synthesis
analyzing_raw
generating_updates
writing_pages
mechanical_linting
semantic_linting
completed
```

- [ ] **Step 7: Run operation tests**

Run:

```bash
cd src-tauri && cargo test "llm_wiki_operation_registry_tracks_stage_and_cancel|llm_timeout_is_not_six_hundred_seconds" -- --nocapture
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/llm_wiki_operation.rs src-tauri/src/llm_wiki_llm.rs src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "feat: add llm wiki operation stages"
```

### Task 7: CLI LLM Wiki Command Expansion

**Files:**
- Modify: `src-tauri/src/cli_protocol.rs`
- Modify: `src-tauri/src/cli_protocol_tests.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`

- [ ] **Step 1: Write failing CLI protocol tests**

Add tests to `src-tauri/src/cli_protocol_tests.rs`:

```rust
#[test]
fn parses_llm_wiki_status_request() {
    let request: CliRequest = serde_json::from_str(r#"{"cmd":"llm-wiki-status"}"#).unwrap();

    assert_eq!(request, CliRequest::LlmWikiStatus);
}

#[test]
fn parses_llm_wiki_ingest_request() {
    let request: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-ingest","rawPath":"raw/notes/a.md"}"#).unwrap();

    assert_eq!(
        request,
        CliRequest::LlmWikiIngest {
            raw_path: "raw/notes/a.md".to_string()
        }
    );
}

#[test]
fn parses_llm_wiki_digest_request() {
    let request: CliRequest = serde_json::from_str(
        r#"{"cmd":"llm-wiki-digest","title":"karpathy-llm-wiki","prompt":"Summarize"}"#,
    )
    .unwrap();

    assert_eq!(
        request,
        CliRequest::LlmWikiDigest {
            title: "karpathy-llm-wiki".to_string(),
            prompt: "Summarize".to_string()
        }
    );
}

#[test]
fn parses_llm_wiki_lint_request() {
    let request: CliRequest = serde_json::from_str(r#"{"cmd":"llm-wiki-lint"}"#).unwrap();

    assert_eq!(request, CliRequest::LlmWikiLint);
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri && cargo test "parses_llm_wiki_status_request|parses_llm_wiki_ingest_request|parses_llm_wiki_digest_request|parses_llm_wiki_lint_request" -- --nocapture
```

Expected: enum variants missing.

- [ ] **Step 3: Extend CLI protocol**

Add variants to `CliRequest` in `src-tauri/src/cli_protocol.rs`:

```rust
LlmWikiStatus,
LlmWikiIngest {
    #[serde(alias = "rawPath")]
    raw_path: String,
},
LlmWikiDigest {
    title: String,
    prompt: String,
},
LlmWikiLint,
```

Add optional fields to `CliResponse`:

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub llm_wiki_mode: Option<String>,
#[serde(skip_serializing_if = "Option::is_none")]
pub has_llm_wiki: Option<bool>,
#[serde(skip_serializing_if = "Option::is_none")]
pub digest_path: Option<String>,
#[serde(skip_serializing_if = "Option::is_none")]
pub lint_report: Option<String>,
```

- [ ] **Step 4: Extend mdx-cli parser**

In `src-tauri/src/bin/mdx_cli.rs`, extend `LlmWikiCommand`:

```rust
Status,
Ingest {
    raw_path: String,
},
Digest {
    #[arg(long)]
    title: String,
    #[arg(required = true, num_args = 1..)]
    prompt: Vec<String>,
},
Lint {
    #[arg(long)]
    json: bool,
},
```

Update `request_from_command`:

```rust
LlmWikiCommand::Status => CliRequest::LlmWikiStatus,
LlmWikiCommand::Ingest { raw_path } => CliRequest::LlmWikiIngest {
    raw_path: raw_path.clone(),
},
LlmWikiCommand::Digest { title, prompt } => CliRequest::LlmWikiDigest {
    title: title.trim().to_string(),
    prompt: join_required_words(prompt, "prompt")?,
},
LlmWikiCommand::Lint { .. } => CliRequest::LlmWikiLint,
```

Update `success_output`:

```rust
CommandLine::LlmWiki {
    command: LlmWikiCommand::Lint { json: false },
} => response.lint_report.clone().unwrap_or_default(),
CommandLine::LlmWiki {
    command: LlmWikiCommand::Digest { .. },
} => response.digest_path.clone().unwrap_or_default(),
```

- [ ] **Step 5: Extend CLI server handlers**

In `src-tauri/src/cli_server.rs`, add match arms:

```rust
CliRequest::LlmWikiStatus => handle_llm_wiki_status(app),
CliRequest::LlmWikiIngest { raw_path } => handle_llm_wiki_ingest(app, raw_path),
CliRequest::LlmWikiDigest { title, prompt } => handle_llm_wiki_digest(app, title, prompt),
CliRequest::LlmWikiLint => handle_llm_wiki_lint(app),
```

Each handler must:

1. Use the existing current workspace snapshot helper.
2. Return `no_workspace` if root missing.
3. Return `llm_wiki_not_ready` if `detect_llm_wiki_workspace` says not ready.
4. Call the corresponding `llm_wiki::*` sync function.

For status response:

```rust
CliResponse {
    ok: true,
    root_path: Some(root_path),
    llm_wiki_mode: Some(status.mode),
    has_llm_wiki: Some(status.has_llm_wiki),
    ..CliResponse::default()
}
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
cd src-tauri && cargo test "llm_wiki_|parses_llm_wiki" -- --nocapture
```

Expected: protocol and server tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/cli_server.rs src-tauri/src/bin/mdx_cli.rs
git commit -m "feat: expand llm wiki cli commands"
```

### Task 8: Frontend Stage And Cancel UI

**Files:**
- Modify: `features/llm-wiki/lib/types.ts`
- Modify: `features/llm-wiki/lib/llm-wiki-client.ts`
- Modify: `features/llm-wiki/lib/operation-state.ts`
- Modify: `features/llm-wiki/lib/status-view-model.test.ts`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`
- Modify: `features/llm-wiki/components/llm-wiki-panel.tsx`

- [ ] **Step 1: Write failing frontend operation tests**

Create or extend `features/llm-wiki/lib/operation-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLlmWikiOperationLabel, getLlmWikiStageLabel } from "./operation-state";

describe("llm wiki operation labels", () => {
  it("labels query and backend stages", () => {
    expect(getLlmWikiOperationLabel("query")).toBe("正在查询");
    expect(getLlmWikiStageLabel("selecting_pages")).toBe("选择相关页面");
    expect(getLlmWikiStageLabel("answering")).toBe("生成回答");
  });

  it("falls back to raw stage ids for unknown stages", () => {
    expect(getLlmWikiStageLabel("custom_stage")).toBe("custom_stage");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test -- features/llm-wiki/lib/operation-state.test.ts
```

Expected: missing query operation and stage label helper.

- [ ] **Step 3: Extend frontend types and client**

In `features/llm-wiki/lib/types.ts`, add:

```ts
export type LlmWikiOperationId =
  | "initialize"
  | "rescan"
  | "ingest"
  | "query"
  | "lint"
  | "graph"
  | "digest";

export interface LlmWikiOperationState {
  operationId: string;
  operation: string;
  stage: string;
  cancelled: boolean;
}
```

In `features/llm-wiki/lib/llm-wiki-client.ts`, add:

```ts
import type { LlmWikiOperationState } from "./types";

export function getLlmWikiOperationState(
  operationId: string,
): Promise<LlmWikiOperationState> {
  return invokeCommand("llm_wiki_operation_state", { operationId });
}

export function cancelLlmWikiOperation(operationId: string): Promise<void> {
  return invokeCommand("llm_wiki_operation_cancel", { operationId });
}
```

- [ ] **Step 4: Extend operation labels**

Modify `features/llm-wiki/lib/operation-state.ts`:

```ts
export type LlmWikiOperation =
  | "initialize"
  | "rescan"
  | "ingest"
  | "query"
  | "lint"
  | "graph"
  | "digest";

export function getLlmWikiStageLabel(stage: string | null) {
  switch (stage) {
    case "reading_index":
      return "读取 index";
    case "selecting_pages":
      return "选择相关页面";
    case "reading_pages":
      return "读取 Wiki 页面";
    case "answering":
      return "生成回答";
    case "writing_synthesis":
      return "写入综述";
    case "analyzing_raw":
      return "分析 raw";
    case "generating_updates":
      return "生成 Wiki 更新";
    case "writing_pages":
      return "写入 Wiki 页面";
    case "mechanical_linting":
      return "机械检查";
    case "semantic_linting":
      return "语义检查";
    case "completed":
      return "完成";
    case null:
      return null;
    default:
      return stage;
  }
}
```

Add `query` and `ingest` cases to `getLlmWikiOperationLabel`:

```ts
case "ingest":
  return "正在处理 raw";
case "query":
  return "正在查询";
```

- [ ] **Step 5: Wire hook cancel state**

In `use-llm-wiki-workspace.ts`, add to `LlmWikiWorkspaceHook`:

```ts
activeStageLabel: string | null;
cancelActiveOperation: () => Promise<void>;
```

Add `activeOperationId: string | null` and `activeStage: string | null` to `RootSnapshot`.

For the first implementation, keep operation id optional until backend query/digest commands accept it. Use the backend operation polling only for commands that return an operation id if that response is implemented in Task 6. If not, expose cancellation for future operations with:

```ts
const cancelActiveOperation = useCallback(async () => {
  const operationId = currentSnapshot.activeOperationId;
  if (!operationId) {
    return;
  }
  await cancelLlmWikiOperation(operationId);
}, [currentSnapshot.activeOperationId]);
```

Set `activeStageLabel` using `getLlmWikiStageLabel(currentSnapshot.activeStage)`.

- [ ] **Step 6: Add cancel UI**

In `LlmWikiPanel`, destructure:

```ts
activeStageLabel,
cancelActiveOperation,
```

In the status area, render the stage and cancel button only when an operation is active:

```tsx
{activeOperation ? (
  <div className="space-y-2 border border-base-300 bg-base-200 p-2">
    <div className="text-xs text-base-content/75">
      {activeStageLabel ?? activeOperationLabel ?? "正在处理"}
    </div>
    <button
      type="button"
      className="h-8 w-full border border-base-content/40 px-3 text-xs text-base-content outline-none transition-colors hover:border-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={() => void cancelActiveOperation()}
      disabled={!llmWiki.activeOperationId}
    >
      取消
    </button>
  </div>
) : null}
```

If `activeOperationId` is not part of the public hook yet, add it to the hook interface:

```ts
activeOperationId: string | null;
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
npm run test -- features/llm-wiki/lib/operation-state.test.ts features/llm-wiki/lib/status-view-model.test.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```bash
git add features/llm-wiki/lib/types.ts features/llm-wiki/lib/llm-wiki-client.ts features/llm-wiki/lib/operation-state.ts features/llm-wiki/lib/operation-state.test.ts features/llm-wiki/lib/status-view-model.test.ts features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/components/llm-wiki-panel.tsx
git commit -m "feat: show llm wiki operation stages"
```

### Task 9: Verification, Smoke, And Packaging

**Files:**
- Modify only if previous tasks reveal missing exports or compile issues.

- [ ] **Step 1: Run Rust focused tests**

Run:

```bash
cd src-tauri && cargo test "llm_wiki|stable_wikilink|context_selector|parse_page_selection|mechanical_lint|parses_llm_wiki" -- --nocapture
```

Expected: all focused Rust tests pass.

- [ ] **Step 2: Run full Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: all Rust tests pass.

- [ ] **Step 3: Run frontend lint**

Run:

```bash
npm run lint
```

Expected: lint exits 0.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm run test
```

Expected: all frontend tests pass.

- [ ] **Step 5: Run frontend build**

Run:

```bash
npm run build
```

Expected: production build exits 0.

- [ ] **Step 6: Run Tauri build**

Run:

```bash
npx tauri build
```

Expected: macOS app and dmg are produced under `src-tauri/target/release/bundle/`.

- [ ] **Step 7: Check for unexpected verification changes**

Run:

```bash
git status --short
```

Expected: no new changes beyond already committed task work. If verification produced changes, stop and inspect the exact paths before committing them in a separate fix step.

## Self-Review

- Spec coverage:
  - Schema: Task 1.
  - Index-first context selector: Task 2.
  - Query and digest: Task 3.
  - Ingest related context: Task 4.
  - Mechanical and semantic lint: Task 5.
  - Timeout, stages, cancellation: Task 6.
  - CLI expansion: Task 7.
  - Frontend stage/cancel UI: Task 8.
  - Verification and packaging: Task 9.
- Placeholder scan:
  - No unresolved placeholder terms or open product decisions remain.
  - Conditional verification fixes are handled by stopping for inspection instead of using generic path placeholders.
- Type consistency:
  - Rust context types are introduced before query/digest use them.
  - Operation state types are introduced before frontend client uses them.
  - CLI request variants are introduced before CLI parser/server handlers use them.
- Design drift:
  - The plan does not introduce raw query-time RAG.
  - The plan does not add vector/BM25/rerank.
  - The plan does not make query auto-write wiki pages.
