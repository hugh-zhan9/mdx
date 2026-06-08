# LLM Wiki Progress And Log Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** User report and debugging evidence from 2026-06-08. Live workspace evidence came from `/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox/llm-wiki-progress.md` and `/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox/log.md`.

**Goal:** Make LLM Wiki current progress, audit log, and UI status use consistent state: failed files do not appear as pending, backend panic failures are logged, and failed file reasons are visible in the panel.

**Architecture:** Keep `log.md` as append-only audit history and `llm-wiki-progress.md` plus `RawScanResult` as current state. Backend rescan owns current progress classification, including `pendingTotal` and `failed`; frontend consumes the backend result instead of inventing failure counts. Background task join/panic failures are logged at the Tauri command boundary because the blocking ingest task may not reach normal stage-level logging.

**Tech Stack:** Rust/Tauri commands, existing file-based LLM Wiki model, React 19, TypeScript, Vitest, Cargo tests.

---

## File Structure

- Modify `src-tauri/src/llm_wiki_models.rs`: extend `RawScanResult` with `pending_total` and `failed`.
- Modify `src-tauri/src/llm_wiki.rs`: compute failed files before pending batch selection, exclude failed files from pending, return failed files in `RawScanResult`, and log background ingest task failures.
- Modify `src-tauri/src/llm_wiki_tests.rs`: add regression tests for pending/failed exclusivity, returned failed entries, pending total, and background task failure audit logging.
- Modify `features/llm-wiki/lib/types.ts`: mirror the backend `RawScanResult` shape with `pendingTotal` and `failed`.
- Modify `features/llm-wiki/lib/status-view-model.ts`: carry failed file details into the status view model.
- Modify `features/llm-wiki/lib/status-view-model.test.ts`: cover pending total and failed detail view-model behavior.
- Modify `features/llm-wiki/lib/llm-wiki-client.test.ts`: update rescan expectations for the new result shape.
- Modify `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`: derive `pendingCount` from `scan.pendingTotal` and `failedCount` from `scan.failed.length`.
- Modify `features/llm-wiki/components/llm-wiki-panel.tsx`: render failed file details in the status tab.
- Create `features/llm-wiki/components/llm-wiki-panel.test.tsx`: verify failed file details render without introducing a new test library.

---

### Task 1: Return Failed Entries And Exclude Failed Files From Pending

**Files:**
- Modify: `src-tauri/src/llm_wiki_models.rs`
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write the failing Rust regression test for pending/failed exclusivity**

Add this test near `rescan_raw_persists_current_run_failures_to_progress` in `src-tauri/src/llm_wiki_tests.rs`:

```rust
#[test]
fn rescan_raw_excludes_persisted_failures_from_pending_and_returns_failed_entries() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    for name in ["a", "b", "c"] {
        std::fs::write(
            root.path().join(format!("raw/notes/{name}.md")),
            format!("# Note {name}\n"),
        )
        .unwrap();
    }

    llm_wiki_rescan_raw_sync_with_failures(
        root.path().to_string_lossy().into_owned(),
        vec!["raw/notes/a.md".to_string()],
        Some(vec![LlmWikiFailedFile {
            path: "raw/notes/a.md".to_string(),
            reason: "llm_failed: first failure".to_string(),
        }]),
    )
    .unwrap();

    let result = llm_wiki_rescan_raw_sync(root.path().to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.total, 3);
    assert_eq!(result.pending_total, 2);
    assert_eq!(
        result.pending,
        vec!["raw/notes/b.md".to_string(), "raw/notes/c.md".to_string()]
    );
    assert_eq!(
        result.failed,
        vec![LlmWikiFailedFile {
            path: "raw/notes/a.md".to_string(),
            reason: "llm_failed: first failure".to_string(),
        }]
    );
    let progress = std::fs::read_to_string(root.path().join("llm-wiki-progress.md")).unwrap();
    let pending_section = progress
        .split_once("## Pending")
        .unwrap()
        .1
        .split_once("\n## ")
        .unwrap()
        .0;
    let failed_section = progress
        .split_once("## Failed")
        .unwrap()
        .1
        .split_once("\n## ")
        .unwrap()
        .0;
    assert!(!pending_section.contains("raw/notes/a.md"));
    assert!(failed_section.contains("- raw/notes/a.md: llm_failed: first failure"));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd src-tauri
cargo test rescan_raw_excludes_persisted_failures_from_pending_and_returns_failed_entries --lib
```

Expected: FAIL to compile with errors that `RawScanResult` has no fields named `pending_total` and `failed`.

- [ ] **Step 3: Extend the backend scan result model**

In `src-tauri/src/llm_wiki_models.rs`, replace the existing `RawScanResult` definition:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanResult {
    pub total: usize,
    pub pending: Vec<String>,
    pub completed: Vec<String>,
    pub skipped: Vec<String>,
}
```

with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawScanResult {
    pub total: usize,
    pub pending_total: usize,
    pub pending: Vec<String>,
    pub completed: Vec<String>,
    pub failed: Vec<LlmWikiFailedFile>,
    pub skipped: Vec<String>,
}
```

- [ ] **Step 4: Add helpers for failed map conversion**

In `src-tauri/src/llm_wiki.rs`, replace `merged_progress_failures` with these functions:

```rust
fn merged_progress_failure_map(
    root: &Path,
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<BTreeMap<String, String>, WorkspaceError> {
    let mut merged = read_progress_failed_entries(root)?;
    if let Some(failed) = failed {
        for (path, reason) in normalize_failed_files(failed) {
            merged.insert(path, reason);
        }
    }

    Ok(merged)
}

fn remove_completed_failures(
    failed: &mut BTreeMap<String, String>,
    completed_paths: &BTreeSet<&String>,
) {
    for path in completed_paths {
        failed.remove(*path);
    }
}

fn failed_map_to_progress_entries(failed: &BTreeMap<String, String>) -> Vec<(String, String)> {
    failed
        .iter()
        .map(|(path, reason)| (path.clone(), reason.clone()))
        .collect()
}

fn failed_map_to_model_entries(failed: &BTreeMap<String, String>) -> Vec<LlmWikiFailedFile> {
    failed
        .iter()
        .map(|(path, reason)| LlmWikiFailedFile {
            path: path.clone(),
            reason: reason.clone(),
        })
        .collect()
}
```

- [ ] **Step 5: Teach raw progress scanning about failed paths and pending total**

In `src-tauri/src/llm_wiki.rs`, replace the `RawProgressSnapshot` struct:

```rust
struct RawProgressSnapshot {
    total: usize,
    pending: Vec<String>,
    completed: Vec<String>,
}
```

with:

```rust
struct RawProgressSnapshot {
    total: usize,
    pending_total: usize,
    pending: Vec<String>,
    completed: Vec<String>,
}
```

Then replace the `scan_raw_progress` signature and body with:

```rust
fn scan_raw_progress(
    root: &Path,
    config: &LlmWikiKnowledgeConfig,
    excluded_pending_paths: &BTreeSet<String>,
    failed_paths: &BTreeSet<String>,
) -> Result<RawProgressSnapshot, WorkspaceError> {
    let files = scan_raw_file_metadata(root, config)?;
    let cache = read_cache(root)?;
    let mut pending_total = 0;
    let mut pending = Vec::new();
    let mut completed = Vec::new();

    for file in &files {
        match cache.entries.get(&file.relative_path) {
            Some(entry)
                if entry.raw_size == Some(file.size)
                    && entry.raw_modified_ms == file.modified_ms =>
            {
                completed.push(file.relative_path.clone());
            }
            _ => {
                if failed_paths.contains(&file.relative_path) {
                    continue;
                }
                pending_total += 1;
                if pending.len() < RAW_RESCAN_PENDING_BATCH_SIZE
                    && !excluded_pending_paths.contains(&file.relative_path)
                {
                    pending.push(file.relative_path.clone());
                }
            }
        }
    }

    Ok(RawProgressSnapshot {
        total: files.len(),
        pending_total,
        pending,
        completed,
    })
}
```

- [ ] **Step 6: Update rescan to merge failures before choosing pending**

In `src-tauri/src/llm_wiki.rs`, replace the body of `llm_wiki_rescan_raw_sync_with_failures` with:

```rust
pub fn llm_wiki_rescan_raw_sync_with_failures(
    root_path: String,
    excluded_pending_paths: Vec<String>,
    failed: Option<Vec<LlmWikiFailedFile>>,
) -> Result<RawScanResult, WorkspaceError> {
    let root = canonicalize_workspace_root(root_path)?;
    ensure_default_agents_rules(&root)?;
    let config = read_knowledge_config(&root)?;
    let mut failed = merged_progress_failure_map(&root, failed)?;

    if config.paused {
        let failed_progress = failed_map_to_progress_entries(&failed);
        update_progress_markdown(&root, "paused", &[], &[], &failed_progress, &config.skip_paths)?;
        return Ok(RawScanResult {
            total: 0,
            pending_total: 0,
            pending: Vec::new(),
            completed: Vec::new(),
            failed: failed_map_to_model_entries(&failed),
            skipped: config.skip_paths,
        });
    }

    let excluded_pending_paths = normalize_excluded_pending_paths(excluded_pending_paths);
    let failed_paths = failed.keys().cloned().collect::<BTreeSet<_>>();
    let progress = scan_raw_progress(&root, &config, &excluded_pending_paths, &failed_paths)?;
    let completed_paths = progress.completed.iter().collect::<BTreeSet<_>>();
    remove_completed_failures(&mut failed, &completed_paths);
    let failed_progress = failed_map_to_progress_entries(&failed);

    let progress_status = if progress.pending_total == 0 {
        "completed"
    } else {
        "scanning"
    };

    update_progress_markdown(
        &root,
        progress_status,
        &progress.pending,
        &progress.completed,
        &failed_progress,
        &config.skip_paths,
    )?;

    Ok(RawScanResult {
        total: progress.total,
        pending_total: progress.pending_total,
        pending: progress.pending,
        completed: progress.completed,
        failed: failed_map_to_model_entries(&failed),
        skipped: config.skip_paths,
    })
}
```

- [ ] **Step 7: Update processing progress to exclude existing failed paths**

In `src-tauri/src/llm_wiki.rs`, replace `update_ingest_processing_progress` with:

```rust
fn update_ingest_processing_progress(
    root: &Path,
    config: &LlmWikiKnowledgeConfig,
    raw_relative_path: &str,
) -> Result<(), WorkspaceError> {
    let excluded = BTreeSet::from([raw_relative_path.to_string()]);
    let failed = read_progress_failed_entries(root).unwrap_or_default();
    let failed_paths = failed.keys().cloned().collect::<BTreeSet<_>>();
    let progress = scan_raw_progress(root, config, &excluded, &failed_paths)?;
    let failed = failed.into_iter().collect::<Vec<_>>();
    update_progress_markdown_with_processing(
        root,
        "processing",
        &progress.pending,
        &[raw_relative_path.to_string()],
        &progress.completed,
        &failed,
        &config.skip_paths,
    )
}
```

- [ ] **Step 8: Run the focused Rust test and verify it passes**

Run:

```bash
cd src-tauri
cargo test rescan_raw_excludes_persisted_failures_from_pending_and_returns_failed_entries --lib
```

Expected: PASS.

- [ ] **Step 9: Run related Rust progress tests**

Run:

```bash
cd src-tauri
cargo test rescan_raw_ --lib
```

Expected: PASS for all tests whose names start with `rescan_raw_`.

- [ ] **Step 10: Commit**

Run:

```bash
git add src-tauri/src/llm_wiki_models.rs src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: keep llm wiki failed raw out of pending"
```

Expected: commit succeeds.

---

### Task 2: Log Background Ingest Task Failures

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write the failing Rust audit-log regression test**

Add this test near `ingest_logs_raw_source_failure_before_llm_stage` in `src-tauri/src/llm_wiki_tests.rs`:

```rust
#[test]
fn ingest_background_task_failure_is_written_to_log() {
    let root = tempdir().unwrap();
    initialize_llm_wiki_workspace(root.path()).unwrap();
    std::fs::write(root.path().join("raw/articles/Maven实战.pdf"), b"%PDF-1.7\n").unwrap();
    let error = WorkspaceError::new(
        "background_task_failed",
        "failed to join llm wiki background task: task 76 panicked with message \"unsupported encoding GBK-EUC-H\"",
    );

    crate::llm_wiki::append_background_ingest_failure_log_for_test(
        root.path().to_string_lossy().as_ref(),
        "raw/articles/Maven实战.pdf",
        &error,
    );

    let log = std::fs::read_to_string(root.path().join("log.md")).unwrap();
    assert!(log.contains(
        "ingest failed raw/articles/Maven实战.pdf background task: background_task_failed: failed to join llm wiki background task: task 76 panicked with message \"unsupported encoding GBK-EUC-H\""
    ));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd src-tauri
cargo test ingest_background_task_failure_is_written_to_log --lib
```

Expected: FAIL to compile because `append_background_ingest_failure_log_for_test` does not exist.

- [ ] **Step 3: Add the background failure logging helper**

In `src-tauri/src/llm_wiki.rs`, add this helper after `run_blocking`:

```rust
fn append_background_ingest_failure_log(
    root_path: &str,
    raw_relative_path: &str,
    error: &WorkspaceError,
) {
    if error.error_code() != "background_task_failed" {
        return;
    }

    let Ok(root) = canonicalize_workspace_root(root_path.to_string()) else {
        return;
    };
    let Ok(raw_relative_path) = validate_raw_relative_path(&root, raw_relative_path) else {
        return;
    };

    let _ = append_log_entry(
        &root,
        &format!("ingest failed {raw_relative_path} background task: {error}"),
    );
}

#[cfg(test)]
pub(crate) fn append_background_ingest_failure_log_for_test(
    root_path: &str,
    raw_relative_path: &str,
    error: &WorkspaceError,
) {
    append_background_ingest_failure_log(root_path, raw_relative_path, error);
}
```

- [ ] **Step 4: Wire the helper into the async ingest command**

In `src-tauri/src/llm_wiki.rs`, replace the body of `llm_wiki_ingest_raw_file` with:

```rust
pub async fn llm_wiki_ingest_raw_file(
    root_path: String,
    raw_relative_path: String,
    operation_id: Option<String>,
) -> Result<(), WorkspaceError> {
    let operation = begin_operation(operation_id, "ingest")?;
    let operation_id = operation.operation_id();
    let root_path_for_log = root_path.clone();
    let raw_path_for_log = raw_relative_path.clone();
    let result = run_blocking(move || {
        let _operation = operation;
        llm_wiki_ingest_raw_file_sync_with_operation(root_path, raw_relative_path, operation_id)
    })
    .await;

    if let Err(error) = &result {
        append_background_ingest_failure_log(&root_path_for_log, &raw_path_for_log, error);
    }

    result
}
```

- [ ] **Step 5: Run the focused Rust test and verify it passes**

Run:

```bash
cd src-tauri
cargo test ingest_background_task_failure_is_written_to_log --lib
```

Expected: PASS.

- [ ] **Step 6: Run ingest failure logging tests**

Run:

```bash
cd src-tauri
cargo test ingest_logs_raw_source_failure_before_llm_stage --lib
cargo test ingest_background_task_failure_is_written_to_log --lib
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: log llm wiki background ingest failures"
```

Expected: commit succeeds.

---

### Task 3: Mirror Backend Progress Shape In TypeScript

**Files:**
- Modify: `features/llm-wiki/lib/types.ts`
- Modify: `features/llm-wiki/lib/llm-wiki-client.test.ts`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`

- [ ] **Step 1: Write the failing client result-shape test**

In `features/llm-wiki/lib/llm-wiki-client.test.ts`, replace the mocked return value and expected result in `passes excluded pending paths and failed files when continuing after failures` with:

```ts
const invoke = vi.fn(async () => ({
  total: 2,
  pendingTotal: 1,
  pending: ["raw/notes/b.md"],
  completed: [],
  failed: [
    {
      path: "raw/notes/a.md",
      reason:
        "pdf_extract_empty: raw PDF source does not contain extractable text",
    },
  ],
  skipped: [],
}));
```

and:

```ts
).resolves.toEqual({
  total: 2,
  pendingTotal: 1,
  pending: ["raw/notes/b.md"],
  completed: [],
  failed: [
    {
      path: "raw/notes/a.md",
      reason:
        "pdf_extract_empty: raw PDF source does not contain extractable text",
    },
  ],
  skipped: [],
});
```

- [ ] **Step 2: Run the focused TypeScript test**

Run:

```bash
npm test -- --run features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: PASS at runtime because `rescanRaw` passes through the backend object. This is a type-shape test that will be enforced by the next full TypeScript/ESLint checks.

- [ ] **Step 3: Extend the frontend raw scan type**

In `features/llm-wiki/lib/types.ts`, replace:

```ts
export interface RawScanResult {
    total: number;
    pending: string[];
    completed: string[];
    skipped: string[];
}
```

with:

```ts
export interface RawScanResult {
    total: number;
    pendingTotal: number;
    pending: string[];
    completed: string[];
    failed: LlmWikiFailedFile[];
    skipped: string[];
}
```

- [ ] **Step 4: Update the empty scan constant**

In `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`, replace `EMPTY_SCAN` with:

```ts
const EMPTY_SCAN: RawScanResult = {
  total: 0,
  pendingTotal: 0,
  pending: [],
  completed: [],
  failed: [],
  skipped: [],
};
```

- [ ] **Step 5: Run the focused TypeScript tests**

Run:

```bash
npm test -- --run features/llm-wiki/lib/llm-wiki-client.test.ts features/llm-wiki/lib/status-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add features/llm-wiki/lib/types.ts features/llm-wiki/lib/llm-wiki-client.test.ts features/llm-wiki/hooks/use-llm-wiki-workspace.ts
git commit -m "fix: mirror llm wiki raw failure scan state"
```

Expected: commit succeeds.

---

### Task 4: Show Failed File Details In The Status View Model

**Files:**
- Modify: `features/llm-wiki/lib/types.ts`
- Modify: `features/llm-wiki/lib/status-view-model.ts`
- Modify: `features/llm-wiki/lib/status-view-model.test.ts`
- Modify: `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`

- [ ] **Step 1: Write the failing view-model test**

Add this test to `features/llm-wiki/lib/status-view-model.test.ts`:

```ts
it("exposes failed raw files with reasons", () => {
    const viewModel = createLlmWikiStatusViewModel({
        mode: "llmWiki",
        llmConfigured: true,
        paused: false,
        totalRawFiles: 3,
        pendingCount: 1,
        completedCount: 1,
        failedCount: 1,
        failed: [
            {
                path: "raw/notes/a.md",
                reason: "llm_failed: first failure",
            },
        ],
        skippedCount: 0,
    });

    expect(viewModel.statusLines).toContain("待处理：1");
    expect(viewModel.statusLines).toContain("失败：1");
    expect(viewModel.failed).toEqual([
        {
            path: "raw/notes/a.md",
            reason: "llm_failed: first failure",
        },
    ]);
});
```

- [ ] **Step 2: Run the focused view-model test and verify it fails**

Run:

```bash
npm test -- --run features/llm-wiki/lib/status-view-model.test.ts
```

Expected: FAIL because `LlmWikiPanelState` and `LlmWikiStatusViewModel` do not include `failed`.

- [ ] **Step 3: Extend the frontend view-model types**

In `features/llm-wiki/lib/types.ts`, replace `LlmWikiPanelState` with:

```ts
export interface LlmWikiPanelState {
    mode: LlmWikiMode;
    llmConfigured: boolean;
    paused: boolean;
    totalRawFiles: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    failed: LlmWikiFailedFile[];
    skippedCount: number;
}
```

Then replace `LlmWikiStatusViewModel` with:

```ts
export interface LlmWikiStatusViewModel {
    title: string;
    primaryAction: string;
    statusLines: string[];
    failed: LlmWikiFailedFile[];
    modes: LlmWikiPanelModeViewModel[];
    secondaryActions: LlmWikiSecondaryActionViewModel[];
    emptyState: LlmWikiEmptyStateViewModel | null;
}
```

- [ ] **Step 4: Populate failed entries in the status view model**

In `features/llm-wiki/lib/status-view-model.ts`, add `failed: []` to the ordinary workspace return object:

```ts
return {
    title: "普通 Markdown 工作区",
    primaryAction: "初始化 LLM Wiki",
    statusLines: ["后台 LLM 未启用"],
    failed: [],
    modes: createModes(false),
    secondaryActions: createSecondaryActions(true),
    emptyState: {
        title: "初始化 LLM Wiki",
        description: "创建 Wiki 目录后，可以用当前工作区内容提问或生成综述。",
        actionLabel: "初始化 LLM Wiki",
    },
};
```

Then add `failed: state.failed` to the LLM Wiki return object:

```ts
return {
    title: "LLM Wiki",
    primaryAction: state.paused
        ? "恢复后台处理"
        : state.llmConfigured
          ? "重新扫描 raw"
          : "配置 LLM",
    statusLines,
    failed: state.failed,
    modes: createModes(state.llmConfigured),
    secondaryActions: createSecondaryActions(!state.llmConfigured),
    emptyState: state.llmConfigured
        ? null
        : {
              title: "先配置 LLM",
              description:
                  "配置 Base URL、模型和 API Key 后，才能提问或生成综述。",
              actionLabel: "配置 LLM",
          },
};
```

- [ ] **Step 5: Update existing status view-model tests to include failed**

In `features/llm-wiki/lib/status-view-model.test.ts`, add `failed: []` to every `LlmWikiPanelState` object that does not intentionally include failures. For example:

```ts
const viewModel = createLlmWikiStatusViewModel({
    mode: "ordinary",
    llmConfigured: false,
    paused: false,
    totalRawFiles: 0,
    pendingCount: 0,
    completedCount: 0,
    failedCount: 0,
    failed: [],
    skippedCount: 0,
});
```

- [ ] **Step 6: Update panel state derivation**

In `features/llm-wiki/hooks/use-llm-wiki-workspace.ts`, replace the `panelState` object with:

```ts
const panelState = useMemo<LlmWikiPanelState>(
  () => ({
    mode: status?.mode ?? "ordinary",
    llmConfigured: Boolean(
      config?.baseUrl && config.model && config.hasApiKey,
    ),
    paused: false,
    totalRawFiles: scan.total,
    pendingCount: scan.pendingTotal,
    completedCount: scan.completed.length,
    failedCount: scan.failed.length,
    failed: scan.failed,
    skippedCount: scan.skipped.length,
  }),
  [config, scan, status],
);
```

- [ ] **Step 7: Run focused TypeScript tests and verify they pass**

Run:

```bash
npm test -- --run features/llm-wiki/lib/status-view-model.test.ts features/llm-wiki/lib/llm-wiki-client.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add features/llm-wiki/lib/types.ts features/llm-wiki/lib/status-view-model.ts features/llm-wiki/lib/status-view-model.test.ts features/llm-wiki/hooks/use-llm-wiki-workspace.ts
git commit -m "fix: expose llm wiki failed raw details"
```

Expected: commit succeeds.

---

### Task 5: Render Failed Details In The LLM Wiki Panel

**Files:**
- Modify: `features/llm-wiki/components/llm-wiki-panel.tsx`
- Create: `features/llm-wiki/components/llm-wiki-panel.test.tsx`

- [ ] **Step 1: Create the failing panel rendering test**

Create `features/llm-wiki/components/llm-wiki-panel.test.tsx` with:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmWikiPanel } from "./llm-wiki-panel";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function createHook(overrides: Partial<LlmWikiWorkspaceHook> = {}): LlmWikiWorkspaceHook {
    return {
        status: {
            mode: "llmWiki",
            hasLlmWiki: true,
            canInitialize: false,
            missingPaths: [],
        },
        viewModel: {
            title: "LLM Wiki",
            primaryAction: "重新扫描 raw",
            statusLines: [
                "状态：就绪",
                "raw 文件：3",
                "待处理：1",
                "已完成：1",
                "失败：1",
                "已跳过：0",
            ],
            failed: [
                {
                    path: "raw/notes/a.md",
                    reason: "llm_failed: first failure",
                },
            ],
            modes: [
                { id: "status", label: "状态", disabled: false },
                { id: "ask", label: "提问", disabled: false },
                { id: "digest", label: "综述", disabled: false },
            ],
            secondaryActions: [
                { id: "lint", label: "检查", disabled: false },
                { id: "graph", label: "图谱", disabled: false },
            ],
            emptyState: null,
        },
        message: null,
        queryAnswer: null,
        isReady: true,
        isLoading: false,
        isQuerying: false,
        isProcessing: false,
        activeOperation: null,
        activeOperationId: null,
        activeOperationLabel: null,
        activeStageLabel: null,
        cancelActiveOperation: vi.fn(),
        initialize: vi.fn(),
        rescan: vi.fn(),
        lint: vi.fn(),
        graph: vi.fn(),
        digest: vi.fn(),
        query: vi.fn(),
        refresh: vi.fn(),
        handleRawFileSaved: vi.fn(),
        ...overrides,
    };
}

describe("LlmWikiPanel", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("renders failed raw file paths and reasons in status mode", async () => {
        await act(async () => {
            root.render(<LlmWikiPanel llmWiki={createHook()} />);
        });

        expect(host.textContent).toContain("失败明细");
        expect(host.textContent).toContain("raw/notes/a.md");
        expect(host.textContent).toContain("llm_failed: first failure");
    });
});
```

- [ ] **Step 2: Run the panel test and verify it fails**

Run:

```bash
npm test -- --run features/llm-wiki/components/llm-wiki-panel.test.tsx
```

Expected: FAIL because `LlmWikiPanel` does not render `失败明细`.

- [ ] **Step 3: Render failed details in the status tab**

In `features/llm-wiki/components/llm-wiki-panel.tsx`, add this block inside the `effectiveMode === "status"` branch after the secondary action grid:

```tsx
{viewModel.failed.length > 0 ? (
  <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
    <div className="text-xs font-semibold text-base-content/75">
      失败明细
    </div>
    <div className="space-y-2">
      {viewModel.failed.map((failure) => (
        <div
          key={failure.path}
          className="min-w-0 border-t border-base-300 pt-2 first:border-t-0 first:pt-0"
          title={`${failure.path}\n${failure.reason}`}
        >
          <div className="break-words text-xs font-medium text-base-content/80">
            {failure.path}
          </div>
          <div className="mt-1 break-words text-xs leading-relaxed text-base-content/65">
            {failure.reason}
          </div>
        </div>
      ))}
    </div>
  </div>
) : null}
```

- [ ] **Step 4: Run the panel test and verify it passes**

Run:

```bash
npm test -- --run features/llm-wiki/components/llm-wiki-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add features/llm-wiki/components/llm-wiki-panel.tsx features/llm-wiki/components/llm-wiki-panel.test.tsx
git commit -m "fix: show llm wiki failed raw details"
```

Expected: commit succeeds.

---

### Task 6: Update Existing Rust Tests For New RawScanResult Fields

**Files:**
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Run the full Rust LLM Wiki test module**

Run:

```bash
cd src-tauri
cargo test llm_wiki --lib
```

Expected: FAIL in tests that construct or compare `RawScanResult` assumptions without `pending_total` and `failed`.

- [ ] **Step 2: Add focused assertions to existing progress tests**

In `rescan_raw_returns_no_pending_files_when_config_is_paused`, add:

```rust
assert_eq!(result.pending_total, 0);
assert!(result.failed.is_empty());
```

In `rescan_raw_marks_cached_files_completed_instead_of_pending`, add:

```rust
assert_eq!(result.pending_total, 0);
assert!(result.failed.is_empty());
```

In `rescan_raw_returns_bounded_pending_batch_for_large_raw_trees`, add:

```rust
assert_eq!(result.pending_total, 8);
```

In `rescan_raw_excludes_failed_pending_paths_for_current_run`, add:

```rust
assert_eq!(result.pending_total, 8);
assert!(result.failed.is_empty());
```

`excluded_pending_paths` only suppresses files from the next bounded `pending` batch. It is not failed state, so it does not reduce `pending_total`.

In `rescan_raw_persists_current_run_failures_to_progress`, add:

```rust
assert_eq!(result.pending_total, 2);
assert_eq!(
    result.failed,
    vec![LlmWikiFailedFile {
        path: "raw/notes/a.md".to_string(),
        reason: "pdf_extract_empty: raw PDF source does not contain extractable text".to_string(),
    }]
);
```

- [ ] **Step 3: Run the full Rust LLM Wiki test module**

Run:

```bash
cd src-tauri
cargo test llm_wiki --lib
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src-tauri/src/llm_wiki_tests.rs
git commit -m "test: cover llm wiki raw progress counts"
```

Expected: commit succeeds. If no test-only changes remain because Task 1 already updated every affected test, skip this commit and record that Task 6 produced no diff.

---

### Task 7: Final Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run all LLM Wiki frontend tests**

Run:

```bash
npm test -- --run features/llm-wiki/lib/*.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run all Rust LLM Wiki tests**

Run:

```bash
cd src-tauri
cargo test llm_wiki --lib
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 4: Build the Next renderer**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Verify live workspace progress invariants without modifying files**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const progressPath = '/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox/llm-wiki-progress.md';
const progress = fs.readFileSync(progressPath, 'utf8');

function section(name) {
  const marker = `## ${name}`;
  const start = progress.indexOf(marker);
  if (start < 0) return [];
  const after = progress.slice(start + marker.length);
  const next = after.search(/\n## /);
  const body = next >= 0 ? after.slice(0, next) : after;
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && line !== '- None')
    .map((line) => line.slice(2).split(': ')[0]);
}

const pending = new Set(section('Pending'));
const failed = section('Failed');
const overlap = failed.filter((path) => pending.has(path));
console.log(JSON.stringify({ pending: pending.size, failed: failed.length, overlap }, null, 2));
if (overlap.length > 0) {
  process.exit(1);
}
NODE
```

Expected before the app performs a fresh rescan with the new binary: this may still print the existing overlap from the old progress file. Expected after opening the updated app and running `重新扫描 raw`: JSON prints `"overlap": []`.

- [ ] **Step 6: Commit final verification note if no code changed**

Run:

```bash
git status --short
```

Expected: no unstaged source changes except build artifacts ignored by git.

---

## Self-Review

- Spec coverage: The plan covers all confirmed defects: Pending/Failed overlap, frontend failed count/details missing, pending batch being used as total pending, and background task panic failures missing from `log.md`.
- Placeholder scan: No `TBD`, `TODO`, "implement later", or undefined task references remain.
- Type consistency: Rust uses `pending_total` with serde camelCase as `pendingTotal`; TypeScript uses `pendingTotal`. Rust and TypeScript both use `failed` with `{ path, reason }`.
- Design drift: The plan does not make `log.md` the current-state source. It preserves the existing audit-log architecture and makes backend rescan the current-state source of truth.
