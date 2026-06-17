# MDX CLI LLM Wiki Query/Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [docs/loopx/design/MDX CLI LLM Wiki查询检索能力需求设计文档.md](../design/MDX%20CLI%20LLM%20Wiki查询检索能力需求设计文档.md)

**Goal:** Add narrow `mdx-cli llm-wiki query/search` support for querying and agent-facing retrieval against the active Workspace Mode LLM Wiki.

**Architecture:** Extend the existing `mdx-cli` Unix socket protocol with two request variants and query/search response fields. The CLI remains Workspace Mode only, uses the active workspace root from the running app snapshot, does not support headless `--root`, and does not expose init/scan/ingest/lint/graph/digest operations.

**Tech Stack:** Rust, Tauri 2, Clap, Serde JSON line protocol, existing LLM Wiki Rust services, Markdown docs.

---

## File Structure

- Modify `src-tauri/src/cli_protocol.rs`
  - Add protocol request variants for `llm-wiki-query` and `llm-wiki-search`.
  - Add CLI-facing search result DTO and response fields.
  - Keep JSON response fields in `snake_case`.
- Modify `src-tauri/src/cli_protocol_tests.rs`
  - Cover request parsing and JSON response serialization.
- Modify `src-tauri/src/bin/mdx_cli.rs`
  - Add `llm-wiki` nested Clap subcommands.
  - Join multiword query/question args.
  - Add `--json` for query.
  - Render query as plain text by default and JSON when requested.
- Modify `src-tauri/src/cli_server.rs`
  - Dispatch new requests.
  - Resolve active workspace root from current snapshot.
  - Reject non LLM Wiki workspaces with `llm_wiki_not_ready`.
  - Call existing `llm_wiki_search` and `llm_wiki_query_sync`.
  - Keep CLI quiet: do not emit UI events for query/search.
- Modify `README.md`, `README.zh-CN.md`
  - Add the two supported LLM Wiki CLI commands.
  - State that init/scan/ingest/lint/graph/digest are not exposed.

---

### Task 1: Extend CLI Protocol Types

**Files:**
- Modify: `src-tauri/src/cli_protocol.rs`
- Test: `src-tauri/src/cli_protocol_tests.rs`

- [ ] **Step 1: Write failing protocol tests**

Add these imports and tests to `src-tauri/src/cli_protocol_tests.rs`:

```rust
use crate::cli_protocol::{
    list_response_from_snapshot, resolve_cli_path, CliRequest, CliWikiSearchResult, TabSnapshot,
    WorkspaceSnapshot,
};

#[test]
fn parses_llm_wiki_query_and_search_commands() {
    let query: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-query","question":"raw 目录是什么"}"#)
            .unwrap();
    assert!(
        matches!(query, CliRequest::LlmWikiQuery { question } if question == "raw 目录是什么")
    );

    let search: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-search","query":"Document Mode"}"#)
            .unwrap();
    assert!(matches!(search, CliRequest::LlmWikiSearch { query } if query == "Document Mode"));
}

#[test]
fn serializes_llm_wiki_query_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        answer: Some("raw 目录用于存放一手素材。".to_string()),
        references: Some(vec![CliWikiSearchResult {
            path: "wiki/concepts/raw.md".to_string(),
            title: "raw".to_string(),
            snippet: "raw 目录用于存放一手素材".to_string(),
        }]),
        insufficient_context: Some(false),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""ok":true"#));
    assert!(json.contains(r#""answer":"raw 目录用于存放一手素材。""#));
    assert!(json.contains(r#""insufficient_context":false"#));
    assert!(json.contains(r#""references":[{"path":"wiki/concepts/raw.md","title":"raw","snippet":"raw 目录用于存放一手素材"}]"#));
    assert!(!json.contains("insufficientContext"));
}

#[test]
fn serializes_empty_llm_wiki_search_results() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        results: Some(Vec::new()),
        ..crate::cli_protocol::CliResponse::default()
    };

    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"ok":true,"results":[]}"#
    );
}
```

- [ ] **Step 2: Run the protocol tests to verify they fail**

Run:

```bash
cargo test cli_protocol_tests --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with errors for missing `LlmWikiQuery`, `LlmWikiSearch`, `CliWikiSearchResult`, `answer`, `references`, `insufficient_context`, or `results`.

- [ ] **Step 3: Implement the protocol additions**

Modify `src-tauri/src/cli_protocol.rs`.

Add variants to `CliRequest`:

```rust
    LlmWikiQuery {
        question: String,
    },
    LlmWikiSearch {
        query: String,
    },
```

Add a CLI-facing result DTO after `SelectionSnapshot`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub struct CliWikiSearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}
```

Add fields to `CliResponse`:

```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<CliWikiSearchResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insufficient_context: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<CliWikiSearchResult>>,
```

Add this conversion helper near `list_response_from_snapshot`:

```rust
pub fn cli_wiki_search_results_from_models(
    results: Vec<crate::llm_wiki_models::WikiSearchResult>,
) -> Vec<CliWikiSearchResult> {
    results
        .into_iter()
        .map(|result| CliWikiSearchResult {
            path: result.path,
            title: result.title,
            snippet: result.snippet,
        })
        .collect()
}
```

- [ ] **Step 4: Run protocol tests again**

Run:

```bash
cargo test cli_protocol_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. The output should include `3 passed` or more for `cli_protocol_tests`.

- [ ] **Step 5: Commit Task 1**

```bash
git add src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs
git commit -m "Add LLM Wiki CLI protocol fields"
```

---

### Task 2: Add mdx-cli Nested Commands And Output Rendering

**Files:**
- Modify: `src-tauri/src/bin/mdx_cli.rs`

- [ ] **Step 1: Write failing binary unit tests**

Append this test module to `src-tauri/src/bin/mdx_cli.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mdx_lib::cli_protocol::{CliWikiSearchResult, CliResponse};

    #[test]
    fn llm_wiki_query_request_joins_multiword_question() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec![
                    "raw".to_string(),
                    "目录".to_string(),
                    "是什么".to_string(),
                ],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiQuery { question } if question == "raw 目录 是什么"
        ));
    }

    #[test]
    fn llm_wiki_search_request_joins_multiword_query() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["Document".to_string(), "Mode".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiSearch { query } if query == "Document Mode"
        ));
    }

    #[test]
    fn llm_wiki_query_rejects_blank_question() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec!["   ".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "question must not be empty");
    }

    #[test]
    fn llm_wiki_search_rejects_blank_query() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["   ".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "query must not be empty");
    }

    #[test]
    fn llm_wiki_query_default_output_is_answer_text_only() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec!["raw".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            answer: Some("raw 目录用于存放一手素材。".to_string()),
            references: Some(vec![CliWikiSearchResult {
                path: "wiki/concepts/raw.md".to_string(),
                title: "raw".to_string(),
                snippet: "raw 目录用于存放一手素材".to_string(),
            }]),
            insufficient_context: Some(false),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            "raw 目录用于存放一手素材。"
        );
    }

    #[test]
    fn llm_wiki_query_json_output_is_full_response_json() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: true,
                question: vec!["raw".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            answer: Some("资料不足。".to_string()),
            insufficient_context: Some(true),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            r#"{"ok":true,"answer":"资料不足。","insufficient_context":true}"#
        );
    }

    #[test]
    fn llm_wiki_search_output_is_json_with_empty_results() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["missing".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            results: Some(Vec::new()),
            ..CliResponse::default()
        };

        assert_eq!(success_output(&command, &response), r#"{"ok":true,"results":[]}"#);
    }
}
```

- [ ] **Step 2: Run the binary tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin mdx-cli
```

Expected: FAIL because `LlmWikiCommand`, `CommandLine::LlmWiki`, and `success_output` do not exist.

- [ ] **Step 3: Add nested Clap commands**

Modify `src-tauri/src/bin/mdx_cli.rs`.

Add `Debug, Clone, PartialEq, Eq` derives to `CommandLine`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum CommandLine {
```

Add this variant to `CommandLine`:

```rust
    LlmWiki {
        #[command(subcommand)]
        command: LlmWikiCommand,
    },
```

Add this enum after `CommandLine`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum LlmWikiCommand {
    Query {
        #[arg(long)]
        json: bool,
        #[arg(required = true, num_args = 1..)]
        question: Vec<String>,
    },
    Search {
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
}
```

- [ ] **Step 4: Convert nested commands to protocol requests**

Add this helper near `normalize_cli_path`:

```rust
fn join_required_words(words: &[String], noun: &str) -> io::Result<String> {
    let value = words.join(" ");
    let value = value.trim();
    if value.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{noun} must not be empty"),
        ));
    }
    Ok(value.to_string())
}
```

Add this match arm in `request_from_command`:

```rust
        CommandLine::LlmWiki { command } => match command {
            LlmWikiCommand::Query { question, .. } => CliRequest::LlmWikiQuery {
                question: join_required_words(question, "question")?,
            },
            LlmWikiCommand::Search { query } => CliRequest::LlmWikiSearch {
                query: join_required_words(query, "query")?,
            },
        },
```

- [ ] **Step 5: Add success output rendering**

Add this helper before `print_response`:

```rust
fn success_output(command: &CommandLine, response: &CliResponse) -> String {
    match command {
        CommandLine::Content { .. } => response.content.clone().unwrap_or_default(),
        CommandLine::LlmWiki {
            command:
                LlmWikiCommand::Query {
                    json: false, ..
                },
        } => response.answer.clone().unwrap_or_default(),
        _ => serde_json::to_string(response).unwrap_or_else(|_| "{\"ok\":true}".into()),
    }
}
```

Replace the success branch in `print_response` with:

```rust
    let output = success_output(&command, &response);
    print!("{output}");
    if !matches!(
        command,
        CommandLine::Content { .. }
            | CommandLine::LlmWiki {
                command:
                    LlmWikiCommand::Query {
                        json: false, ..
                    },
            }
    ) {
        println!();
    }
    let _ = io::stdout().flush();
    ExitCode::SUCCESS
```

This keeps `content` and default `llm-wiki query` newline-free, matching existing `content` behavior and the design requirement that default query prints answer text only.

- [ ] **Step 6: Run binary tests again**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin mdx-cli
```

Expected: PASS. The binary test target should report 7 passed tests.

- [ ] **Step 7: Run protocol tests after binary changes**

Run:

```bash
cargo test cli_protocol_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src-tauri/src/bin/mdx_cli.rs
git commit -m "Add LLM Wiki mdx-cli commands"
```

---

### Task 3: Add CLI Server LLM Wiki Handlers

**Files:**
- Modify: `src-tauri/src/cli_server.rs`

- [ ] **Step 1: Write failing server helper tests**

Append this test module to `src-tauri/src/cli_server.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli_protocol::WorkspaceSnapshot;
    use crate::llm_wiki_fs::initialize_llm_wiki_workspace;
    use tempfile::TempDir;

    #[test]
    fn llm_wiki_search_response_rejects_ordinary_workspace() {
        let root = TempDir::new().unwrap();

        let response = llm_wiki_search_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "raw".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }

    #[test]
    fn llm_wiki_search_response_returns_empty_results() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_search_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "missing".to_string(),
        );

        assert!(response.ok);
        assert_eq!(response.results, Some(Vec::new()));
    }

    #[test]
    fn llm_wiki_query_response_returns_insufficient_context_without_llm_config() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_query_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "missing".to_string(),
        );

        assert!(response.ok);
        assert_eq!(
            response.answer.as_deref(),
            Some("当前知识库中没有足够上下文回答这个问题。")
        );
        assert_eq!(response.insufficient_context, Some(true));
    }

    #[test]
    fn llm_wiki_active_root_requires_workspace_root() {
        let snapshot = WindowSnapshot {
            workspace: WorkspaceSnapshot::default(),
            tab_contents: HashMap::new(),
            tab_selections: HashMap::new(),
        };

        let response = llm_wiki_active_root(&snapshot).unwrap_err();
        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("no_workspace"));
    }
}
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_server::tests
```

Expected: FAIL because the helper functions do not exist.

- [ ] **Step 3: Import LLM Wiki helpers**

Modify the imports at the top of `src-tauri/src/cli_server.rs`:

```rust
use crate::cli_protocol::{
    active_or_requested_tab, cli_wiki_search_results_from_models, list_response_from_snapshot,
    resolve_cli_path, CliProtocolError, CliRequest, CliResponse, SelectionSnapshot,
    WorkspaceSnapshot,
};
use crate::llm_wiki;
use crate::llm_wiki_fs::detect_llm_wiki_workspace;
```

- [ ] **Step 4: Dispatch new request variants**

Add these match arms in `dispatch`:

```rust
        CliRequest::LlmWikiQuery { question } => handle_llm_wiki_query(app, question),
        CliRequest::LlmWikiSearch { query } => handle_llm_wiki_search(app, query),
```

- [ ] **Step 5: Add active root and readiness helpers**

Add these helpers near `handle_rename`:

```rust
fn handle_llm_wiki_query(app: &AppHandle, question: String) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    llm_wiki_query_response_for_root(root_path, question)
}

fn handle_llm_wiki_search(app: &AppHandle, query: String) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    llm_wiki_search_response_for_root(root_path, query)
}

fn llm_wiki_active_root(snapshot: &WindowSnapshot) -> Result<String, CliResponse> {
    snapshot
        .workspace
        .root_path
        .clone()
        .ok_or_else(|| CliResponse::error("no_workspace", "no workspace root is available"))
}

fn ensure_llm_wiki_ready(root_path: &str) -> Result<(), CliResponse> {
    match detect_llm_wiki_workspace(root_path) {
        Ok(status) if status.has_llm_wiki => Ok(()),
        Ok(_) => Err(CliResponse::error(
            "llm_wiki_not_ready",
            "current workspace is not an LLM Wiki workspace",
        )),
        Err(error) => Err(workspace_error(error)),
    }
}
```

- [ ] **Step 6: Add query/search response helpers**

Add these helpers after `ensure_llm_wiki_ready`:

```rust
fn llm_wiki_search_response_for_root(root_path: String, query: String) -> CliResponse {
    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }

    match llm_wiki::llm_wiki_search(root_path, query) {
        Ok(results) => CliResponse {
            ok: true,
            results: Some(cli_wiki_search_results_from_models(results)),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}

fn llm_wiki_query_response_for_root(root_path: String, question: String) -> CliResponse {
    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }

    match llm_wiki::llm_wiki_query_sync(root_path, question) {
        Ok(result) => CliResponse {
            ok: true,
            answer: Some(result.answer),
            references: Some(cli_wiki_search_results_from_models(result.references)),
            insufficient_context: Some(result.insufficient_context),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}
```

These handlers intentionally do not call `emit_to_window`; query/search must not affect UI state.

- [ ] **Step 7: Run server tests again**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_server::tests
```

Expected: PASS.

- [ ] **Step 8: Run focused CLI and LLM Wiki tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_protocol_tests
cargo test --manifest-path src-tauri/Cargo.toml llm_wiki_tests::search_wiki_pages_finds_query_terms_in_generated_wiki
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src-tauri/src/cli_server.rs
git commit -m "Handle LLM Wiki CLI query and search"
```

---

### Task 4: Update README CLI Documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Update English README command list**

In `README.md`, add these lines inside the supported commands code block after `mdx-cli rename <path> <new-name>`:

```bash
mdx-cli llm-wiki query [--json] <question...>
mdx-cli llm-wiki search <query...>
```

Add this paragraph immediately after the code block:

```markdown
The LLM Wiki CLI surface is intentionally read/query oriented: it exposes `query` and `search` for the active Workspace Mode root, but does not expose initialization, scanning, ingest, lint, graph, or digest operations.
```

- [ ] **Step 2: Update Chinese README command list**

In `README.zh-CN.md`, add these lines inside the supported commands code block after `mdx-cli rename <path> <new-name>`:

```bash
mdx-cli llm-wiki query [--json] <question...>
mdx-cli llm-wiki search <query...>
```

Add this paragraph immediately after the code block:

```markdown
LLM Wiki 的 CLI 能力刻意保持为查询/检索入口：只针对当前 Workspace Mode root 暴露 `query` 和 `search`，不对外暴露初始化、扫描、ingest、lint、graph、digest 等操作能力。
```

- [ ] **Step 3: Verify docs contain no operation commands**

Run:

```bash
rg -n "llm-wiki (init|scan|rescan|ingest|lint|graph|digest)" README.md README.zh-CN.md
```

Expected: exit 1 with no matches.

- [ ] **Step 4: Commit Task 4**

```bash
git add README.md README.zh-CN.md
git commit -m "Document LLM Wiki CLI query commands"
```

---

### Task 5: Final Verification And Packaging Check

**Files:**
- No code changes expected.

- [ ] **Step 1: Format Rust**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Expected: exit 0.

- [ ] **Step 2: Run full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS with all Rust tests passing, including:

- `cli_protocol_tests`
- `cli_server::tests`
- `llm_wiki_tests`
- `mdx-cli` binary unit tests

- [ ] **Step 3: Run frontend LLM Wiki client test**

Run:

```bash
npm test -- --run features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: PASS. This guards existing UI LLM Wiki command wrappers even though this plan does not change frontend code.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. Output should include `Compiled successfully` and `Running TypeScript`.

- [ ] **Step 6: Verify diff scope**

Run:

```bash
git diff --stat HEAD
```

Expected: only these implementation files should appear:

```text
README.md
README.zh-CN.md
src-tauri/src/bin/mdx_cli.rs
src-tauri/src/cli_protocol.rs
src-tauri/src/cli_protocol_tests.rs
src-tauri/src/cli_server.rs
```

The plan and design docs may also appear if they were not committed before implementation began:

```text
.loopx/intake/clarify-mdx-cli-llm-wiki-query-20260604-155445.md
docs/loopx/design/MDX CLI LLM Wiki查询检索能力需求设计文档.md
docs/loopx/plans/2026-06-04-mdx-cli-llm-wiki-query-search.md
```

- [ ] **Step 7: Commit final cleanup if needed**

If `cargo fmt` or docs adjustments changed files after Task 4, commit them:

```bash
git add README.md README.zh-CN.md src-tauri/src/bin/mdx_cli.rs src-tauri/src/cli_protocol.rs src-tauri/src/cli_protocol_tests.rs src-tauri/src/cli_server.rs
git commit -m "Polish LLM Wiki CLI query support"
```

If there are no changes, skip this commit.

---

## Self-Review Checklist

- Spec coverage:
  - `mdx-cli llm-wiki query [--json] <question...>` covered by Tasks 1, 2, 3, and 4.
  - `mdx-cli llm-wiki search <query...>` covered by Tasks 1, 2, 3, and 4.
  - Active Workspace Mode root only covered by Task 3.
  - No headless `--root`, no stdin, no limit, no aliases covered by Task 2 command shape and Task 4 docs.
  - No init/scan/ingest/lint/graph/digest exposure covered by Task 4 verification.
  - `query` default text and `--json` covered by Task 2.
  - `search` empty `results: []` covered by Tasks 1 and 2.
  - `llm_wiki_not_ready` covered by Task 3.
  - No UI state impact covered by Task 3: handlers do not call `emit_to_window`.
- Placeholder scan: no placeholders remain.
- Type consistency:
  - `CliWikiSearchResult`, `answer`, `references`, `insufficient_context`, and `results` are introduced in Task 1 and used consistently in Tasks 2 and 3.
  - `LlmWikiCommand` is introduced in Task 2 before tests reference it.
  - Server helper names in Task 3 match the tests in the same task.
- Design drift:
  - The plan does not add headless mode, `--root`, stdin, limit, aliases, UI effects, or operation-class LLM Wiki commands.
