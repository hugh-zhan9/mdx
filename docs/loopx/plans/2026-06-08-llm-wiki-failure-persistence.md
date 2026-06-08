# LLM Wiki Failure Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** User-approved requirement from 2026-06-08 conversation: fix two LLM Wiki failure recording gaps. Early raw/PDF ingest failures must be written to `log.md`; current-run frontend failures must be persisted to `llm-wiki-progress.md`.

**Goal:** Make LLM Wiki success/failure records reflect the real ingest run, including PDF extraction failures that currently only appear in the UI.

**Architecture:** Keep the existing file-based status model. Backend ingest logs raw-source failures before returning, and backend raw rescan accepts an optional current-run failure list that is rendered into the existing `## Failed` progress section. Frontend keeps its in-memory failed list, converts it to backend `path`/`reason` entries, and passes it on every rescan that follows a failure plus the final rescan.

**Tech Stack:** Rust/Tauri commands, existing `WorkspaceError`, existing `llm-wiki-progress.md` writer, React hook state, TypeScript client wrappers, Cargo tests, Vitest.

---

## File Structure

- Modify `src-tauri/src/llm_wiki.rs`: log `prepare_raw_source` failures, accept optional `failed` records in `llm_wiki_rescan_raw`, normalize failed records, and pass them to `update_progress_markdown`.
- Modify `src-tauri/src/llm_wiki_tests.rs`: add regression tests for raw/PDF pre-LLM failure logging and rescan failure persistence.
- Modify `features/llm-wiki/lib/types.ts`: add a frontend `LlmWikiFailedFile` type matching the Rust `LlmWikiFailedFile` JSON shape.
- Modify `features/llm-wiki/lib/llm-wiki-client.ts`: extend `rescanRaw` to pass failed entries to the Tauri command.
- Modify `features/llm-wiki/lib/llm-wiki-client.test.ts`: update rescan expectations and add coverage for failed entries.
- Modify `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`: pass the runtime failed list into intermediate and final rescans.

---

### Task 1: Log Raw/PDF Source Failures Before LLM Work

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write the failing Rust regression test**

In `src-tauri/src/llm_wiki_tests.rs`, update the import from `crate::llm_wiki` to include `llm_wiki_ingest_raw_file_sync`:

```rust
use crate::llm_wiki::{
    llm_config_to_public, llm_wiki_digest_sync, llm_wiki_get_config, llm_wiki_get_log,
    llm_wiki_ingest_mock_output, llm_wiki_ingest_raw_file_sync, llm_wiki_lint,
    llm_wiki_query_sync, llm_wiki_refresh_graph_sync, llm_wiki_rescan_raw_sync,
    llm_wiki_rescan_raw_sync_with_exclusions, llm_wiki_search, llm_wiki_update_config,
    related_context_or_log_failure,
};
```

Add this test near the existing raw scan/progress tests:

```rust
#[test]
fn ingest_logs_raw_source_failure_before_llm_stage() {
    let root = tempdir().unwrap();
    let home = tempdir().unwrap();
    let _env = LlmConfigEnvGuard::use_home(home.path());
    save_llm_config_to_path(
        home.path().join(".mdx/llm-config.json"),
        &LlmProviderConfig {
            base_url: "https://api.example.com/v1".to_string(),
            model: "test-model".to_string(),
            api_key: Some("secret-key".to_string()),
            api_mode: "chat".to_string(),
        },
    )
    .unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();

    let error = llm_wiki_ingest_raw_file_sync(
        root.path().to_string_lossy().into_owned(),
        "raw/articles/broken.pdf".to_string(),
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "pdf_extract_failed");
    let log = std::fs::read_to_string(root.path().join("log.md")).unwrap();
    assert!(log.contains(
        "ingest failed raw/articles/broken.pdf raw source: pdf_extract_failed: failed to extract text from raw PDF source"
    ));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd src-tauri
cargo test ingest_logs_raw_source_failure_before_llm_stage --lib
```

Expected: FAIL because `log.md` does not yet contain the `raw source` failure entry.

- [ ] **Step 3: Implement raw-source failure logging**

In `src-tauri/src/llm_wiki.rs`, replace the direct `prepare_raw_source` call:

```rust
let raw_source = prepare_raw_source(&root, &raw_relative_path)?;
```

with:

```rust
let raw_source = match prepare_raw_source(&root, &raw_relative_path) {
    Ok(raw_source) => raw_source,
    Err(error) => {
        let _ = append_log_entry(
            &root,
            &format!("ingest failed {raw_relative_path} raw source: {error}"),
        );
        return Err(error);
    }
};
```

Do not move this block before `validate_raw_relative_path`; the log path must already be validated and normalized.

- [ ] **Step 4: Run the focused Rust test and verify it passes**

Run:

```bash
cd src-tauri
cargo test ingest_logs_raw_source_failure_before_llm_stage --lib
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: log llm wiki raw source failures"
```

---

### Task 2: Persist Current-Run Failures in Progress Markdown

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write the failing Rust progress test**

In `src-tauri/src/llm_wiki_tests.rs`, update the models import to include `LlmWikiFailedFile`:

```rust
use crate::llm_wiki_models::{LlmProviderConfig, LlmWikiCache, LlmWikiFailedFile};
```

Update the `crate::llm_wiki` import to include the new sync helper that this task will add:

```rust
llm_wiki_rescan_raw_sync_with_failures,
```

Add this test near `rescan_raw_excludes_failed_pending_paths_for_current_run`:

```rust
#[test]
fn rescan_raw_persists_current_run_failures_to_progress() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    for name in ["a", "b", "c"] {
        std::fs::write(
            root.path().join(format!("raw/notes/{name}.md")),
            format!("# Note {name}\n"),
        )
        .unwrap();
    }

    let result = llm_wiki_rescan_raw_sync_with_failures(
        root.path().to_string_lossy().into_owned(),
        vec!["raw/notes/a.md".to_string()],
        vec![LlmWikiFailedFile {
            path: "raw/notes/a.md".to_string(),
            reason: "pdf_extract_empty: raw PDF source does not contain extractable text"
                .to_string(),
        }],
    )
    .unwrap();

    assert_eq!(result.total, 3);
    assert_eq!(
        result.pending,
        vec!["raw/notes/b.md".to_string(), "raw/notes/c.md".to_string()]
    );
    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    assert!(progress.contains("## Failed"));
    assert!(progress.contains(
        "- raw/notes/a.md: pdf_extract_empty: raw PDF source does not contain extractable text"
    ));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd src-tauri
cargo test rescan_raw_persists_current_run_failures_to_progress --lib
```

Expected: FAIL to compile because `llm_wiki_rescan_raw_sync_with_failures` does not exist yet.

- [ ] **Step 3: Add failed-list support to rescan**

In `src-tauri/src/llm_wiki.rs`, update the imports so `LlmWikiFailedFile` is available:

```rust
use crate::llm_wiki_models::{
    InitializeLlmWikiResult, LlmProviderConfig, LlmProviderConfigUpdate, LlmWikiFailedFile,
    LlmWikiKnowledgeConfig, LlmWikiOperationState, LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig, RawScanResult, WikiContextBundle, WikiSearchResult,
};
```

Change the Tauri command signature:

```rust
#[tauri::command]
pub async fn llm_wiki_rescan_raw(
    root_path: String,
    excluded_pending_paths: Option<Vec<String>>,
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<RawScanResult, WorkspaceError> {
    run_blocking(move || {
        llm_wiki_rescan_raw_sync_with_failures(
            root_path,
            excluded_pending_paths.unwrap_or_default(),
            failed.unwrap_or_default(),
        )
    })
    .await
}
```

Keep the existing no-failure helper as a compatibility wrapper:

```rust
pub fn llm_wiki_rescan_raw_sync(root_path: String) -> Result<RawScanResult, WorkspaceError> {
    llm_wiki_rescan_raw_sync_with_failures(root_path, Vec::new(), Vec::new())
}

pub fn llm_wiki_rescan_raw_sync_with_exclusions(
    root_path: String,
    excluded_pending_paths: Vec<String>,
) -> Result<RawScanResult, WorkspaceError> {
    llm_wiki_rescan_raw_sync_with_failures(root_path, excluded_pending_paths, Vec::new())
}
```

Add the new helper by moving the body of the current `llm_wiki_rescan_raw_sync_with_exclusions` into it:

```rust
pub fn llm_wiki_rescan_raw_sync_with_failures(
    root_path: String,
    excluded_pending_paths: Vec<String>,
    failed: Vec<LlmWikiFailedFile>,
) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    ensure_default_agents_rules(&root)?;
    let config = read_knowledge_config(&root)?;
    let failed = normalize_failed_files(failed);
    if config.paused {
        update_progress_markdown(&root, "paused", &[], &[], &failed, &config.skip_paths)?;
        return Ok(RawScanResult {
            total: 0,
            pending: Vec::new(),
            completed: Vec::new(),
            skipped: config.skip_paths,
        });
    }

    let excluded_pending_paths = normalize_excluded_pending_paths(excluded_pending_paths);
    let progress = scan_raw_progress(&root, &config, &excluded_pending_paths)?;

    let progress_status = if progress.pending.is_empty() {
        "completed"
    } else {
        "scanning"
    };

    update_progress_markdown(
        &root,
        progress_status,
        &progress.pending,
        &progress.completed,
        &failed,
        &config.skip_paths,
    )?;

    Ok(RawScanResult {
        total: progress.total,
        pending: progress.pending,
        completed: progress.completed,
        skipped: config.skip_paths,
    })
}
```

Add the normalizer near `normalize_excluded_pending_paths`:

```rust
fn normalize_failed_files(files: Vec<LlmWikiFailedFile>) -> Vec<(String, String)> {
    files
        .into_iter()
        .filter_map(|file| {
            let path = file.path.trim().trim_matches('/').replace('\\', "/");
            if !path.starts_with("raw/") {
                return None;
            }
            let reason = file
                .reason
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let reason = if reason.is_empty() {
                "unknown".to_string()
            } else {
                reason
            };
            Some((path, reason))
        })
        .collect()
}
```

- [ ] **Step 4: Run focused Rust progress tests**

Run:

```bash
cd src-tauri
cargo test rescan_raw_persists_current_run_failures_to_progress --lib
cargo test rescan_raw_excludes_failed_pending_paths_for_current_run --lib
cargo test update_progress_markdown_writes_visible_status_document --lib
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: persist llm wiki run failures in progress"
```

---

### Task 3: Pass Frontend Runtime Failures Into Rescan

**Files:**
- Modify: `features/llm-wiki/lib/types.ts`
- Modify: `features/llm-wiki/lib/llm-wiki-client.ts`
- Modify: `features/llm-wiki/lib/llm-wiki-client.test.ts`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`

- [ ] **Step 1: Write/update the failing TypeScript client test**

In `features/llm-wiki/lib/llm-wiki-client.test.ts`, update the existing `rescanRaw` test to expect the `failed` argument:

```ts
describe("rescanRaw", () => {
  it("passes excluded pending paths and failed files when continuing after failures", async () => {
    const invoke = vi.fn(async () => ({
      total: 2,
      pending: ["raw/notes/b.md"],
      completed: [],
      skipped: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(
      rescanRaw("/tmp/wiki", ["raw/notes/a.md"], [
        {
          path: "raw/notes/a.md",
          reason: "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ]),
    ).resolves.toEqual({
      total: 2,
      pending: ["raw/notes/b.md"],
      completed: [],
      skipped: [],
    });

    expect(invoke).toHaveBeenCalledWith("llm_wiki_rescan_raw", {
      rootPath: "/tmp/wiki",
      excludedPendingPaths: ["raw/notes/a.md"],
      failed: [
        {
          path: "raw/notes/a.md",
          reason: "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the focused Vitest test and verify it fails**

Run:

```bash
npx vitest run features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: FAIL because `rescanRaw` currently accepts only two arguments and does not send `failed`.

- [ ] **Step 3: Add the frontend failed-file type**

In `features/llm-wiki/lib/types.ts`, add this interface after `RawScanResult`:

```ts
export interface LlmWikiFailedFile {
  path: string;
  reason: string;
}
```

- [ ] **Step 4: Extend the rescan client wrapper**

In `features/llm-wiki/lib/llm-wiki-client.ts`, add `LlmWikiFailedFile` to the type imports:

```ts
  LlmWikiFailedFile,
```

Change `rescanRaw` to:

```ts
export function rescanRaw(
  rootPath: string,
  excludedPendingPaths: string[] = [],
  failed: LlmWikiFailedFile[] = [],
): Promise<RawScanResult> {
  return invokeCommand("llm_wiki_rescan_raw", {
    rootPath,
    excludedPendingPaths,
    failed,
  });
}
```

- [ ] **Step 5: Pass runtime failures from the background ingest hook**

In `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`, add this local helper near `runBackgroundIngest`:

```ts
function toProgressFailures(failed: Array<{ path: string; error: string }>) {
  return failed.map((item) => ({
    path: item.path,
    reason: item.error,
  }));
}
```

Update both existing `rescanRaw` calls inside `runBackgroundIngest` so they pass the current failure list.

First rescan after each batch:

```ts
const next = await rescanRaw(
  ingestRootPath,
  Array.from(failedPaths),
  toProgressFailures(failed),
);
```

Final rescan:

```ts
const latest = await rescanRaw(
  ingestRootPath,
  Array.from(failedPaths),
  toProgressFailures(failed),
);
```

Do not change the existing UI `message` formatting in this task.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npx vitest run features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/llm-wiki/lib/types.ts features/llm-wiki/lib/llm-wiki-client.ts features/llm-wiki/lib/llm-wiki-client.test.ts features/llm-wiki/hooks/use-llm-wiki-workspace.ts
git commit -m "fix: persist frontend llm wiki failures"
```

---

### Task 4: Full Verification

**Files:**
- No source files beyond Tasks 1-3.

- [ ] **Step 1: Run the LLM Wiki Rust test suite**

Run:

```bash
cd src-tauri
cargo test llm_wiki --lib
```

Expected: all `llm_wiki` tests PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npx vitest run features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run global frontend checks**

Run:

```bash
npm test
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs features/llm-wiki/lib/types.ts features/llm-wiki/lib/llm-wiki-client.ts features/llm-wiki/lib/llm-wiki-client.test.ts features/llm-wiki/hooks/use-llm-wiki-workspace.ts
```

Expected: diff only touches the planned files and implements:

- `prepare_raw_source` failures append `ingest failed <path> raw source: <error>` to `log.md`.
- `llm_wiki_rescan_raw` accepts optional `failed`.
- `llm-wiki-progress.md` gets a populated `## Failed` section for current-run failed files.
- Frontend passes its runtime failed list to `rescanRaw`.

- [ ] **Step 5: Optional manual smoke test on a temporary workspace**

Run only on a disposable workspace, not the user's live inbox:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/raw/articles"
printf '%%PDF-1.7\n' > "$tmp/raw/articles/broken.pdf"
/Applications/MDX.app/Contents/MacOS/mdx-cli llm-wiki status
```

Expected: use a disposable app/dev setup for manual validation if needed. Do not run a live ingest against `/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox` during verification.

---

## Self-Review

- Spec coverage: Task 1 covers early raw/PDF ingest failures in `log.md`; Tasks 2-3 cover frontend current-run failures in `llm-wiki-progress.md`; Task 4 covers verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Rust uses existing `LlmWikiFailedFile { path, reason }`; TypeScript adds the same `path`/`reason` shape.
- Design drift: no new storage file, no database, no UI redesign, no changes to ingest ordering beyond logging failures and passing failed records into existing progress output.
