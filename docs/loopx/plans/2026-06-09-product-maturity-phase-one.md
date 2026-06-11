# Product Maturity Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/产品成熟度第一阶段需求设计文档.md`

**Goal:** Deliver the first product-maturity phase for MDX: recover unsaved Markdown bodies, detect external file changes, add workspace full-text search, and polish the current UI without changing the three-column product model.

**Architecture:** Keep `~/.mdx/state.json` for app metadata and preferences only; add a separate plaintext `~/.mdx/drafts/` store for dirty Markdown bodies. Add Rust/Tauri services for drafts, file watching, and bounded workspace search, then coordinate recovery, conflict banners, read-only diff, and search results in React. Reuse existing Workspace/Document state boundaries, path guards, editor components, and settings flow.

**Tech Stack:** Tauri 2.10, Rust 2021, React 19, Next.js 16, TypeScript, Vitest, Cargo tests, `notify`, `lucide-react`.

---

## Scope Check

The design covers four visible capabilities plus UI polish. They are not independent products: draft recovery and diff UI are prerequisites for watcher conflicts, preferences feed both watcher and search, and the left panel/search UI must be polished with the rest of the shell. This plan keeps one implementation track, but each task is independently testable and commit-sized.

Do not add LLM Wiki onboarding, auto-update, PDF search, regex/fuzzy/semantic search, multi-root workspaces, encrypted drafts, editable merge, or a full redesign.

## File Structure

- Modify `package.json` and `package-lock.json`
  - Add `lucide-react`.
- Modify `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`
  - Add `notify`.
- Modify `src-tauri/src/lib.rs`
  - Register new modules, manage watcher/search state, and register Tauri commands.
- Modify `src-tauri/src/models.rs`
  - Add shared Rust response structs for drafts, watcher events, and search.
- Modify `src-tauri/src/state_store.rs`
  - Add defaulted app preferences: `fileWatchEnabled`, `searchMaxFileBytes`, `searchMaxResults`, `searchMaxMatchesPerFile`.
- Modify `src-tauri/src/state_store_tests.rs`
  - Verify new preferences default, save, reload, and old-state compatibility.
- Create `src-tauri/src/draft_store.rs`
  - Own draft id generation, draft JSON storage, permissions, save/get/list/delete/cleanup commands, and path handling for missing original files.
- Create `src-tauri/src/draft_store_tests.rs`
  - Test draft save/get/delete/list/cleanup, orphan drafts, corrupt draft isolation, Markdown-only guard, and permissions on Unix.
- Create `src-tauri/src/file_watch.rs`
  - Own `notify` watcher registry, watcher start/stop commands, event coalescing helpers, event payloads, and Tauri event emission.
- Create `src-tauri/src/file_watch_tests.rs`
  - Test pure coalescing, event classification, Markdown relevance, and registry lifecycle helpers.
- Create `src-tauri/src/workspace_search.rs`
  - Own bounded Markdown scanning, dirty overrides, cancellation tokens, result truncation, skipped summaries, and search commands.
- Create `src-tauri/src/workspace_search_tests.rs`
  - Test raw inclusion, hidden/ignored/binary/large-file skipping, case sensitivity, per-file/result limits, dirty overrides, and cancellation.
- Create `features/workspace/lib/preferences.ts`
  - Normalize and compare app preferences for frontend state and settings.
- Create `features/workspace/lib/preferences.test.ts`
  - Test default preferences, numeric bounds, exclude-dir normalization, and equality.
- Modify `features/workspace/lib/types.ts`
  - Add preference fields, search state, pending editor command variants, draft/search/watch frontend types used by workspace.
- Modify `features/workspace/hooks/use-workspace-bootstrap.ts`
  - Use shared preference helpers, run draft cleanup at startup, preserve state compatibility, and refresh watcher/search settings after preference updates.
- Create `features/recovery/lib/types.ts`
  - Shared frontend types for drafts, recovery prompts, external conflicts, delete prompts, and diff viewer props.
- Create `features/recovery/lib/draft-client.ts`
  - Tauri wrappers for draft commands.
- Create `features/recovery/lib/line-diff.ts`
  - Pure read-only line diff builder.
- Create `features/recovery/lib/recovery-state.ts`
  - Pure helpers for draft prompts, orphan actions, conflict action labels, and draft ownership.
- Create `features/recovery/lib/*.test.ts`
  - Vitest coverage for diff and recovery decisions.
- Create `features/recovery/components/recovery-banner.tsx`
  - Shared banner component for draft, conflict, and deletion prompts.
- Create `features/recovery/components/diff-viewer.tsx`
  - Shared read-only diff modal with explicit action buttons.
- Create `features/recovery/hooks/use-draft-autosave.ts`
  - Shared debounce/flush draft autosave hook for Workspace and Document modes.
- Create `features/file-watch/lib/types.ts`
  - Frontend watcher event and conflict types.
- Create `features/file-watch/lib/file-watch-client.ts`
  - Tauri wrappers for watcher commands.
- Create `features/file-watch/lib/external-change.ts`
  - Pure helpers for clean reload, dirty conflict, deleted-file behavior, rename handling, and self-write suppression.
- Create `features/file-watch/lib/external-change.test.ts`
  - Vitest coverage for event-to-action decisions.
- Create `features/file-watch/hooks/use-file-watch.ts`
  - Shared Tauri event subscription and watcher lifecycle hook.
- Modify `features/workspace/components/workspace-shell.tsx`
  - Wire draft autosave/recovery, watcher conflict handling, search UI, pending scroll-to-line command, save cleanup, and icon polish.
- Modify `features/workspace/components/editor-stage.tsx`
  - Accept banner slot and pending scroll-to-line command; load active Markdown with recovery checks.
- Modify `features/workspace/lib/workspace-save.ts`
  - Run save callbacks for draft deletion and self-write tracking; keep current race guards.
- Modify `features/workspace/lib/workspace-reducer.ts`
  - Add actions for search mode/results and clean external reload/delete state.
- Modify `features/workspace/lib/workspace-reducer.test.ts`
  - Cover new reducer actions.
- Create `features/workspace/lib/workspace-search.ts`
  - Frontend search state helpers, dirty override collection, and result grouping.
- Create `features/workspace/lib/workspace-search.test.ts`
  - Vitest coverage for dirty override collection, stale request discard, and skipped summary labels.
- Create `features/workspace/components/workspace-search-panel.tsx`
  - Full-text search input, case toggle, result list, skipped/truncated summary, and click handling.
- Modify `features/workspace/components/file-tree-panel.tsx`
  - Host tree/search tabs in the left panel and keep file tree refresh actions intact.
- Modify `features/workspace/components/file-tree-toolbar.tsx`
  - Replace character buttons with lucide icons and keep name filter behavior.
- Modify `features/workspace/components/tab-strip.tsx`
  - Replace close/dirty character controls with consistent icons where applicable.
- Modify `features/workspace/components/settings-button.tsx`
  - Add Search and Files settings sections; save new preferences; improve scroll and error wrapping.
- Modify `features/document/lib/types.ts`
  - Add document recovery/conflict fields if stored in local state.
- Modify `features/document/lib/document-state.ts`
  - Add pure external reload/conflict/delete state helpers.
- Modify `features/document/lib/document-state.test.ts`
  - Cover document external changes and draft restore transitions.
- Modify `features/document/lib/document-client.ts`
  - Add draft/watch wrappers only if shared clients need a document convenience export.
- Modify `features/document/components/document-shell.tsx`
  - Wire document draft autosave/recovery, watcher conflict handling, diff viewer, save cleanup, and icon polish.
- Modify `features/editor/components/editor-pane.tsx`
  - Add optional pending `scrollToLine` support.
- Create `features/editor/lib/markdown-line-scroll.ts`
  - Map Markdown line numbers to a rendered block and scroll it into view.
- Create `features/editor/lib/markdown-line-scroll.test.ts`
  - Test heading, paragraph, fenced-code, and out-of-range line scrolling.
- Modify `features/llm-wiki/components/llm-wiki-panel.tsx`
  - Keep progress visible above scrollable failure details; wrap long paths/reasons.
- Modify `common/components/ui-controls.tsx`
  - Normalize icon button size, tooltip, and text overflow behavior.
- Modify `README.zh-CN.md` and `README.md`
  - Document draft recovery, plaintext draft location, file watching, search, config limits, and first-phase non-goals.

## Implementation Rules

- Write the focused failing test before each implementation slice.
- Stage only the files listed in the current task. The worktree already has unrelated LLM Wiki edits; do not revert or stage them unless the current task explicitly touches them.
- Draft Markdown is plaintext and local. Do not write dirty Markdown into `state.json`.
- Search reads only `.md` and `.markdown` under the current workspace root, including `raw/`, and skips hidden directories, `.git`, `node_modules`, binary files, and files larger than the configured limit.
- Search queries must not be written to persistent logs.
- Watcher failures must not block editing or saving.
- A clean tab/document may auto-reload after an external change. A dirty tab/document must never be overwritten without an explicit user action.
- Use existing path guard patterns and `WorkspaceError` codes.

---

### Task 1: Preferences And Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/state_store.rs`
- Modify: `src-tauri/src/state_store_tests.rs`
- Create: `features/workspace/lib/preferences.ts`
- Create: `features/workspace/lib/preferences.test.ts`
- Modify: `features/workspace/lib/types.ts`
- Modify: `features/workspace/hooks/use-workspace-bootstrap.ts`
- Modify: `features/workspace/components/settings-button.tsx`

- [ ] **Step 1: Add dependency entries**

Run:

```bash
npm install lucide-react
cd src-tauri && cargo add notify@6
```

Expected: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` are updated. `package.json` contains `lucide-react`; `src-tauri/Cargo.toml` contains `notify = "6"`.

- [ ] **Step 2: Write failing Rust preference compatibility tests**

In `src-tauri/src/state_store_tests.rs`, add:

```rust
#[test]
fn app_preferences_include_file_watch_and_search_defaults() {
    let preferences = AppPreferences::default();

    assert!(preferences.file_watch_enabled);
    assert_eq!(preferences.search_max_file_bytes, 2_097_152);
    assert_eq!(preferences.search_max_results, 200);
    assert_eq!(preferences.search_max_matches_per_file, 20);
}

#[test]
fn old_state_without_new_preferences_uses_defaults() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    std::fs::write(
        &path,
        r#"{
          "stateVersion": 1,
          "recentWorkspaceRoot": "/tmp/ws",
          "preferences": {
            "fileTreeExcludeDirs": ["vendor"]
          },
          "workspaces": [],
          "windowSize": { "width": 1280, "height": 820 }
        }"#,
    )
    .unwrap();

    let state = load_state_from_path(&path).unwrap();

    assert_eq!(state.preferences.file_tree_exclude_dirs, vec!["vendor"]);
    assert!(state.preferences.file_watch_enabled);
    assert_eq!(state.preferences.search_max_file_bytes, 2_097_152);
    assert_eq!(state.preferences.search_max_results, 200);
    assert_eq!(state.preferences.search_max_matches_per_file, 20);
}
```

- [ ] **Step 3: Run focused Rust tests and verify failure**

Run:

```bash
cd src-tauri
cargo test app_preferences --lib
```

Expected: FAIL to compile because the new `AppPreferences` fields do not exist.

- [ ] **Step 4: Implement Rust preference defaults**

In `src-tauri/src/state_store.rs`, replace the derived default on `AppPreferences` with explicit fields and default functions:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    #[serde(default)]
    pub file_tree_exclude_dirs: Vec<String>,
    #[serde(default = "default_file_watch_enabled")]
    pub file_watch_enabled: bool,
    #[serde(default = "default_search_max_file_bytes")]
    pub search_max_file_bytes: u64,
    #[serde(default = "default_search_max_results")]
    pub search_max_results: usize,
    #[serde(default = "default_search_max_matches_per_file")]
    pub search_max_matches_per_file: usize,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            file_tree_exclude_dirs: Vec::new(),
            file_watch_enabled: default_file_watch_enabled(),
            search_max_file_bytes: default_search_max_file_bytes(),
            search_max_results: default_search_max_results(),
            search_max_matches_per_file: default_search_max_matches_per_file(),
        }
    }
}

fn default_file_watch_enabled() -> bool {
    true
}

fn default_search_max_file_bytes() -> u64 {
    2_097_152
}

fn default_search_max_results() -> usize {
    200
}

fn default_search_max_matches_per_file() -> usize {
    20
}
```

Update the existing `saves_and_reloads_workspace_state` test fixture to set the new preference fields explicitly and assert the JSON keys `fileWatchEnabled`, `searchMaxFileBytes`, `searchMaxResults`, and `searchMaxMatchesPerFile`.

- [ ] **Step 5: Run Rust preference tests and verify pass**

Run:

```bash
cd src-tauri
cargo test state_store --lib
```

Expected: PASS for all state store tests.

- [ ] **Step 6: Write failing frontend preference tests**

Create `features/workspace/lib/preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    appPreferencesEqual,
    createDefaultAppPreferences,
    normalizeAppPreferences,
} from "./preferences";

describe("workspace preferences", () => {
    it("defaults file watching and bounded search settings", () => {
        expect(createDefaultAppPreferences()).toEqual({
            fileTreeExcludeDirs: [],
            fileWatchEnabled: true,
            searchMaxFileBytes: 2_097_152,
            searchMaxResults: 200,
            searchMaxMatchesPerFile: 20,
        });
    });

    it("normalizes old app state preferences", () => {
        expect(
            normalizeAppPreferences({
                fileTreeExcludeDirs: [" vendor ", "docs/archive", "../bad"],
            }),
        ).toEqual({
            fileTreeExcludeDirs: ["vendor", "docs/archive"],
            fileWatchEnabled: true,
            searchMaxFileBytes: 2_097_152,
            searchMaxResults: 200,
            searchMaxMatchesPerFile: 20,
        });
    });

    it("clamps invalid numeric search limits", () => {
        expect(
            normalizeAppPreferences({
                fileTreeExcludeDirs: [],
                fileWatchEnabled: false,
                searchMaxFileBytes: 8,
                searchMaxResults: 50_000,
                searchMaxMatchesPerFile: -1,
            }),
        ).toEqual({
            fileTreeExcludeDirs: [],
            fileWatchEnabled: false,
            searchMaxFileBytes: 1_024,
            searchMaxResults: 5_000,
            searchMaxMatchesPerFile: 1,
        });
    });

    it("compares every stored preference field", () => {
        const base = createDefaultAppPreferences();
        expect(appPreferencesEqual(base, { ...base })).toBe(true);
        expect(appPreferencesEqual(base, { ...base, fileWatchEnabled: false })).toBe(false);
        expect(appPreferencesEqual(base, { ...base, searchMaxResults: 300 })).toBe(false);
    });
});
```

- [ ] **Step 7: Run frontend preference tests and verify failure**

Run:

```bash
npm test -- features/workspace/lib/preferences.test.ts
```

Expected: FAIL because `features/workspace/lib/preferences.ts` does not exist.

- [ ] **Step 8: Implement frontend preference helpers**

Create `features/workspace/lib/preferences.ts` with:

```ts
import type { AppPreferences } from "./types";

const DEFAULT_SEARCH_MAX_FILE_BYTES = 2_097_152;
const DEFAULT_SEARCH_MAX_RESULTS = 200;
const DEFAULT_SEARCH_MAX_MATCHES_PER_FILE = 20;

export function createDefaultAppPreferences(): AppPreferences {
    return {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: DEFAULT_SEARCH_MAX_FILE_BYTES,
        searchMaxResults: DEFAULT_SEARCH_MAX_RESULTS,
        searchMaxMatchesPerFile: DEFAULT_SEARCH_MAX_MATCHES_PER_FILE,
    };
}

export function normalizeAppPreferences(
    preferences: Partial<AppPreferences> | undefined,
): AppPreferences {
    return {
        fileTreeExcludeDirs: normalizeExcludeDirs(preferences?.fileTreeExcludeDirs),
        fileWatchEnabled: preferences?.fileWatchEnabled !== false,
        searchMaxFileBytes: clampInteger(
            preferences?.searchMaxFileBytes,
            1_024,
            50 * 1_024 * 1_024,
            DEFAULT_SEARCH_MAX_FILE_BYTES,
        ),
        searchMaxResults: clampInteger(
            preferences?.searchMaxResults,
            1,
            5_000,
            DEFAULT_SEARCH_MAX_RESULTS,
        ),
        searchMaxMatchesPerFile: clampInteger(
            preferences?.searchMaxMatchesPerFile,
            1,
            500,
            DEFAULT_SEARCH_MAX_MATCHES_PER_FILE,
        ),
    };
}

export function appPreferencesEqual(left: AppPreferences, right: AppPreferences) {
    return (
        stringListsEqual(left.fileTreeExcludeDirs, right.fileTreeExcludeDirs) &&
        left.fileWatchEnabled === right.fileWatchEnabled &&
        left.searchMaxFileBytes === right.searchMaxFileBytes &&
        left.searchMaxResults === right.searchMaxResults &&
        left.searchMaxMatchesPerFile === right.searchMaxMatchesPerFile
    );
}

function normalizeExcludeDirs(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(
        new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.replaceAll("\\", "/").trim())
                .map((item) => item.replace(/^\/+|\/+$/g, ""))
                .filter((item) => item.length > 0)
                .filter(
                    (item) =>
                        !item
                            .split("/")
                            .some((part) => part === "." || part === ".."),
                ),
        ),
    );
}

function clampInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(Math.max(Math.round(value), min), max);
}

function stringListsEqual(left: string[], right: string[]) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((item, index) => item === right[index]);
}
```

Update `features/workspace/lib/types.ts`:

```ts
export interface AppPreferences {
    fileTreeExcludeDirs: string[];
    fileWatchEnabled: boolean;
    searchMaxFileBytes: number;
    searchMaxResults: number;
    searchMaxMatchesPerFile: number;
}
```

Update `features/workspace/hooks/use-workspace-bootstrap.ts` to import `appPreferencesEqual`, `createDefaultAppPreferences`, and `normalizeAppPreferences` from `../lib/preferences`, then remove the local duplicate helper implementations.

Update `features/workspace/components/settings-button.tsx` default preferences to use the same four new fields. The full settings UI is expanded in Task 12; this task only keeps compilation correct.

- [ ] **Step 9: Run focused frontend tests and verify pass**

Run:

```bash
npm test -- features/workspace/lib/preferences.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/state_store.rs src-tauri/src/state_store_tests.rs features/workspace/lib/preferences.ts features/workspace/lib/preferences.test.ts features/workspace/lib/types.ts features/workspace/hooks/use-workspace-bootstrap.ts features/workspace/components/settings-button.tsx
git commit -m "feat: add maturity phase preferences"
```

---

### Task 2: Draft Store Backend

**Files:**
- Create: `src-tauri/src/draft_store.rs`
- Create: `src-tauri/src/draft_store_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write failing draft store tests**

Create `src-tauri/src/draft_store_tests.rs`:

```rust
use std::time::{Duration, SystemTime};

use tempfile::tempdir;

use crate::draft_store::{
    cleanup_expired_drafts_in_dir, draft_delete_in_dir, draft_get_in_dir,
    draft_list_for_workspace_in_dir, draft_save_in_dir, DraftSaveRequest,
};

#[test]
fn saves_and_reads_plaintext_markdown_draft() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let file = workspace.path().join("raw/note.md");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "# Disk\n").unwrap();

    let saved = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: file.to_string_lossy().into_owned(),
            display_path: Some("raw/note.md".to_string()),
            markdown: "# Draft\n".to_string(),
            base_fingerprint: Some("disk-fingerprint".to_string()),
            mode: "workspace".to_string(),
        },
    )
    .unwrap();

    let read = draft_get_in_dir(home.path(), file.to_string_lossy().into_owned()).unwrap();
    let draft = read.draft.unwrap();
    assert_eq!(draft.draft_id, saved.draft_id);
    assert_eq!(draft.real_path, file.canonicalize().unwrap().to_string_lossy());
    assert_eq!(draft.display_path.as_deref(), Some("raw/note.md"));
    assert_eq!(draft.markdown, "# Draft\n");
    assert_eq!(draft.base_fingerprint.as_deref(), Some("disk-fingerprint"));
    assert_eq!(draft.mode, "workspace");
    assert!(read.file_exists);
}

#[test]
fn lists_workspace_orphan_drafts_when_original_file_is_missing() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let file = workspace.path().join("deleted.md");
    std::fs::write(&file, "# Draft\n").unwrap();
    let canonical = file.canonicalize().unwrap();

    draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: canonical.to_string_lossy().into_owned(),
            display_path: Some("deleted.md".to_string()),
            markdown: "# Unsaved\n".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();
    std::fs::remove_file(&file).unwrap();

    let drafts = draft_list_for_workspace_in_dir(
        home.path(),
        workspace.path().to_string_lossy().into_owned(),
    )
    .unwrap();

    assert_eq!(drafts.drafts.len(), 1);
    assert_eq!(drafts.drafts[0].real_path, canonical.to_string_lossy());
    assert!(!drafts.drafts[0].file_exists);
}

#[test]
fn delete_is_idempotent_by_path() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let file = workspace.path().join("note.markdown");
    std::fs::write(&file, "# Note").unwrap();

    draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: file.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Draft".to_string(),
            base_fingerprint: None,
            mode: "document".to_string(),
        },
    )
    .unwrap();

    assert!(draft_delete_in_dir(home.path(), None, Some(file.to_string_lossy().into_owned())).unwrap().deleted);
    assert!(!draft_delete_in_dir(home.path(), None, Some(file.to_string_lossy().into_owned())).unwrap().deleted);
}

#[test]
fn cleanup_removes_only_expired_drafts() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let old_file = workspace.path().join("old.md");
    let fresh_file = workspace.path().join("fresh.md");
    std::fs::write(&old_file, "# Old").unwrap();
    std::fs::write(&fresh_file, "# Fresh").unwrap();

    draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: old_file.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Old Draft".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();
    draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: fresh_file.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "# Fresh Draft".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap();

    let cutoff = SystemTime::now() - Duration::from_secs(30 * 24 * 60 * 60);
    let result = cleanup_expired_drafts_in_dir(home.path(), 30, cutoff).unwrap();

    assert_eq!(result.deleted, 0);
    assert_eq!(result.kept, 2);
}

#[test]
fn rejects_non_markdown_drafts() {
    let home = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let file = workspace.path().join("book.pdf");
    std::fs::write(&file, b"%PDF").unwrap();

    let err = draft_save_in_dir(
        home.path(),
        DraftSaveRequest {
            real_path: file.to_string_lossy().into_owned(),
            display_path: None,
            markdown: "pdf".to_string(),
            base_fingerprint: None,
            mode: "workspace".to_string(),
        },
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "invalid_markdown_path");
}
```

- [ ] **Step 2: Run focused Rust tests and verify failure**

Run:

```bash
cd src-tauri
cargo test draft_store --lib
```

Expected: FAIL to compile because `draft_store` does not exist.

- [ ] **Step 3: Add draft response models**

In `src-tauri/src/models.rs`, add these serializable structs:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveResult {
    pub draft_id: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftGetResult {
    pub draft: Option<DraftRecord>,
    pub file_exists: bool,
    pub current_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftListResult {
    pub drafts: Vec<DraftSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftDeleteResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftCleanupResult {
    pub deleted: usize,
    pub kept: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub draft_id: String,
    pub real_path: String,
    pub display_path: Option<String>,
    pub mode: String,
    pub base_fingerprint: Option<String>,
    pub updated_at: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub draft_id: String,
    pub real_path: String,
    pub display_path: Option<String>,
    pub mode: String,
    pub base_fingerprint: Option<String>,
    pub updated_at: String,
    pub file_exists: bool,
}
```

- [ ] **Step 4: Implement draft store**

Create `src-tauri/src/draft_store.rs` with these public command functions and test helpers:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveRequest {
    pub real_path: String,
    pub display_path: Option<String>,
    pub markdown: String,
    pub base_fingerprint: Option<String>,
    pub mode: String,
}

#[tauri::command]
pub fn draft_save(request: DraftSaveRequest) -> Result<DraftSaveResult, WorkspaceError>;

#[tauri::command]
pub fn draft_get(real_path: String) -> Result<DraftGetResult, WorkspaceError>;

#[tauri::command]
pub fn draft_list_for_workspace(root_path: String) -> Result<DraftListResult, WorkspaceError>;

#[tauri::command]
pub fn draft_delete(draft_id: Option<String>, real_path: Option<String>) -> Result<DraftDeleteResult, WorkspaceError>;

#[tauri::command]
pub fn draft_cleanup_expired(retention_days: u64) -> Result<DraftCleanupResult, WorkspaceError>;
```

Implementation requirements:

- Store draft files at `<mdx_home>/drafts/<draftId>.json`.
- Compute `draftId` with SHA-256 over the canonical Markdown path string when the file exists.
- If the original file is missing, accept only an absolute `.md` or `.markdown` path and hash that normalized path string; this allows orphan draft lookup without creating or reading the original path.
- Reject non-Markdown paths with `invalid_markdown_path`.
- Write JSON through a temp file and `fs::rename`.
- On Unix, create `~/.mdx/drafts` with `0700` when possible and draft files with `0600` when possible.
- `draft_list_for_workspace` must scan all draft files and return only records whose stored `realPath` is under the canonical workspace root string.
- If a draft JSON file is corrupt, rename it to `<name>.corrupt.<timestamp>` and continue scanning.
- `draft_get` returns `fileExists: false` and `currentFingerprint: null` when the original file is missing.
- Use `crate::document::document_fingerprint` for content fingerprints.

- [ ] **Step 5: Register module, commands, and tests**

In `src-tauri/src/lib.rs`:

```rust
mod draft_store;

#[cfg(test)]
mod draft_store_tests;
```

Add to `tauri::generate_handler!`:

```rust
draft_store::draft_save,
draft_store::draft_get,
draft_store::draft_list_for_workspace,
draft_store::draft_delete,
draft_store::draft_cleanup_expired,
```

- [ ] **Step 6: Run focused Rust tests and verify pass**

Run:

```bash
cd src-tauri
cargo test draft_store --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/draft_store.rs src-tauri/src/draft_store_tests.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "feat: add plaintext draft store"
```

---

### Task 3: Shared Recovery And Diff Frontend Primitives

**Files:**
- Create: `features/recovery/lib/types.ts`
- Create: `features/recovery/lib/draft-client.ts`
- Create: `features/recovery/lib/line-diff.ts`
- Create: `features/recovery/lib/line-diff.test.ts`
- Create: `features/recovery/lib/recovery-state.ts`
- Create: `features/recovery/lib/recovery-state.test.ts`
- Create: `features/recovery/components/recovery-banner.tsx`
- Create: `features/recovery/components/diff-viewer.tsx`
- Create: `features/recovery/hooks/use-draft-autosave.ts`

- [ ] **Step 1: Write failing line diff tests**

Create `features/recovery/lib/line-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLineDiff } from "./line-diff";

describe("buildLineDiff", () => {
    it("marks equal, removed, and added lines", () => {
        expect(buildLineDiff("a\nb\nc\n", "a\nx\nc\n")).toEqual([
            { kind: "equal", leftLine: 1, rightLine: 1, text: "a" },
            { kind: "removed", leftLine: 2, rightLine: null, text: "b" },
            { kind: "added", leftLine: null, rightLine: 2, text: "x" },
            { kind: "equal", leftLine: 3, rightLine: 3, text: "c" },
        ]);
    });

    it("keeps trailing empty lines readable", () => {
        expect(buildLineDiff("a\n", "a\n\n").at(-1)).toEqual({
            kind: "added",
            leftLine: null,
            rightLine: 2,
            text: "",
        });
    });
});
```

- [ ] **Step 2: Write failing recovery decision tests**

Create `features/recovery/lib/recovery-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    createDraftPrompt,
    createExternalConflictPrompt,
    createDeletedFilePrompt,
} from "./recovery-state";
import type { DraftRecord } from "./types";

const draft: DraftRecord = {
    draftId: "draft-1",
    realPath: "/tmp/ws/note.md",
    displayPath: "note.md",
    mode: "workspace",
    baseFingerprint: "base",
    updatedAt: "2026-06-09T00:00:00Z",
    markdown: "# Draft\n",
};

describe("recovery-state", () => {
    it("creates a draft prompt without deleting the draft", () => {
        expect(createDraftPrompt(draft, true)).toEqual({
            kind: "draft",
            draft,
            fileExists: true,
            priority: "normal",
        });
    });

    it("raises priority for orphan drafts", () => {
        expect(createDraftPrompt(draft, false).priority).toBe("high");
    });

    it("creates dirty external conflict prompts", () => {
        expect(
            createExternalConflictPrompt({
                path: "/tmp/ws/note.md",
                currentMarkdown: "# Mine\n",
                diskMarkdown: "# Disk\n",
            }),
        ).toMatchObject({
            kind: "externalConflict",
            path: "/tmp/ws/note.md",
            priority: "high",
        });
    });

    it("keeps dirty deleted files as high priority prompts", () => {
        expect(createDeletedFilePrompt("/tmp/ws/note.md", true).priority).toBe("high");
        expect(createDeletedFilePrompt("/tmp/ws/note.md", false).priority).toBe("normal");
    });
});
```

- [ ] **Step 3: Run recovery tests and verify failure**

Run:

```bash
npm test -- features/recovery/lib/line-diff.test.ts features/recovery/lib/recovery-state.test.ts
```

Expected: FAIL because the recovery modules do not exist.

- [ ] **Step 4: Implement shared recovery types and clients**

Create `features/recovery/lib/types.ts`:

```ts
export interface DraftRecord {
    draftId: string;
    realPath: string;
    displayPath?: string | null;
    mode: "workspace" | "document" | string;
    baseFingerprint?: string | null;
    updatedAt: string;
    markdown: string;
}

export interface DraftSummary extends Omit<DraftRecord, "markdown"> {
    fileExists: boolean;
}

export interface DraftGetResult {
    draft: DraftRecord | null;
    fileExists: boolean;
    currentFingerprint?: string | null;
}

export interface DraftPrompt {
    kind: "draft";
    draft: DraftRecord;
    fileExists: boolean;
    priority: "normal" | "high";
}

export interface ExternalConflictPrompt {
    kind: "externalConflict";
    path: string;
    currentMarkdown: string;
    diskMarkdown: string;
    priority: "high";
}

export interface DeletedFilePrompt {
    kind: "deletedFile";
    path: string;
    dirty: boolean;
    priority: "normal" | "high";
}

export type RecoveryPrompt =
    | DraftPrompt
    | ExternalConflictPrompt
    | DeletedFilePrompt;

export interface DiffLine {
    kind: "equal" | "added" | "removed";
    leftLine: number | null;
    rightLine: number | null;
    text: string;
}
```

Create `features/recovery/lib/draft-client.ts` with wrappers for `draft_save`, `draft_get`, `draft_list_for_workspace`, `draft_delete`, and `draft_cleanup_expired`. Use `tauriCore()` and camelCase arguments that match the Rust commands.

- [ ] **Step 5: Implement line diff and recovery helpers**

Create `features/recovery/lib/line-diff.ts` using a bounded dynamic-programming LCS for line arrays. Preserve empty trailing lines by splitting with:

```ts
function splitLines(value: string) {
    const lines = value.split(/\r?\n/);
    if (lines.at(-1) === "") {
        lines.pop();
    }
    return lines;
}
```

Create `features/recovery/lib/recovery-state.ts`:

```ts
import type {
    DeletedFilePrompt,
    DraftPrompt,
    DraftRecord,
    ExternalConflictPrompt,
} from "./types";

export function createDraftPrompt(
    draft: DraftRecord,
    fileExists: boolean,
): DraftPrompt {
    return {
        kind: "draft",
        draft,
        fileExists,
        priority: fileExists ? "normal" : "high",
    };
}

export function createExternalConflictPrompt(input: {
    path: string;
    currentMarkdown: string;
    diskMarkdown: string;
}): ExternalConflictPrompt {
    return {
        kind: "externalConflict",
        path: input.path,
        currentMarkdown: input.currentMarkdown,
        diskMarkdown: input.diskMarkdown,
        priority: "high",
    };
}

export function createDeletedFilePrompt(
    path: string,
    dirty: boolean,
): DeletedFilePrompt {
    return {
        kind: "deletedFile",
        path,
        dirty,
        priority: dirty ? "high" : "normal",
    };
}
```

- [ ] **Step 6: Implement banner and diff components**

Create `features/recovery/components/recovery-banner.tsx` with props:

```ts
interface RecoveryBannerProps {
    title: string;
    message: string;
    priority?: "normal" | "high";
    actions: Array<{
        label: string;
        onClick: () => void;
        destructive?: boolean;
        primary?: boolean;
        disabled?: boolean;
    }>;
}
```

Render a non-modal full-width banner with `break-words`, `min-w-0`, and action buttons that wrap on narrow widths.

Create `features/recovery/components/diff-viewer.tsx` with props:

```ts
interface DiffViewerProps {
    open: boolean;
    title: string;
    leftTitle: string;
    rightTitle: string;
    leftText: string;
    rightText: string;
    primaryAction: { label: string; onClick: () => void };
    secondaryActions: Array<{ label: string; onClick: () => void; destructive?: boolean }>;
    onClose: () => void;
}
```

Use `buildLineDiff` and render a read-only two-column diff inside `max-h-[70vh] overflow-auto`.

- [ ] **Step 7: Implement draft autosave hook**

Create `features/recovery/hooks/use-draft-autosave.ts` with:

```ts
interface DraftAutosaveInput {
    enabled: boolean;
    realPath: string | null;
    displayPath?: string | null;
    markdown: string | null;
    dirty: boolean;
    baseFingerprint?: string | null;
    mode: "workspace" | "document";
    delayMs?: number;
    onError?: (error: unknown) => void;
}

interface DraftAutosaveHandle {
    flush: () => Promise<void>;
    cancel: () => void;
}
```

Behavior:

- Save only when `enabled`, `dirty`, `realPath`, and `markdown !== null`.
- Default debounce is `1500` ms.
- `flush` immediately writes the latest dirty draft.
- `cancel` clears the timer.
- Do not delete drafts in this hook; deletion happens after successful file save or explicit discard.

- [ ] **Step 8: Run recovery tests and verify pass**

Run:

```bash
npm test -- features/recovery/lib/line-diff.test.ts features/recovery/lib/recovery-state.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add features/recovery/lib/types.ts features/recovery/lib/draft-client.ts features/recovery/lib/line-diff.ts features/recovery/lib/line-diff.test.ts features/recovery/lib/recovery-state.ts features/recovery/lib/recovery-state.test.ts features/recovery/components/recovery-banner.tsx features/recovery/components/diff-viewer.tsx features/recovery/hooks/use-draft-autosave.ts
git commit -m "feat: add recovery diff primitives"
```

---

### Task 4: Workspace Draft Autosave And Recovery

**Files:**
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`
- Modify: `features/workspace/lib/workspace-save.ts`
- Modify: `features/workspace/lib/workspace-save.test.ts`
- Modify: `features/workspace/lib/types.ts`
- Modify: `features/workspace/hooks/use-workspace-bootstrap.ts`

- [ ] **Step 1: Write failing workspace save draft cleanup test**

In `features/workspace/lib/workspace-save.test.ts`, add a test that verifies `afterSave` gets the saved path and can delete the draft after the file write:

```ts
it("runs afterSave after a clean successful write so callers can delete drafts", async () => {
    const afterSave = vi.fn();
    const workspace = createWorkspaceState("/tmp/ws");
    const opened = workspaceReducer(workspace, {
        type: "tab/opened",
        tab: {
            tabId: "tab-1",
            path: "/tmp/ws/note.md",
            title: "note.md",
            dirty: true,
            needsRenameOnFirstSave: false,
            markdown: "# Draft\n",
        },
    });
    let current = opened;
    const invoke = vi.fn(async () => undefined);

    const saved = await performSaveTab("tab-1", {
        getWorkspace: () => current,
        dispatch: (action) => {
            current = workspaceReducer(current, action);
        },
        invoke,
        promptName: async () => null,
        alert: vi.fn(),
        warn: vi.fn(),
        refreshTree: vi.fn(),
        afterSave,
    });

    expect(saved).toBe(true);
    expect(afterSave).toHaveBeenCalledWith({
        rootPath: "/tmp/ws",
        path: "/tmp/ws/note.md",
    });
});
```

- [ ] **Step 2: Run workspace save tests**

Run:

```bash
npm test -- features/workspace/lib/workspace-save.test.ts
```

Expected: PASS if `afterSave` already exists and works. If it fails, fix `performSaveTab` before continuing because draft cleanup depends on it.

- [ ] **Step 3: Add workspace draft lifecycle behavior**

In `features/workspace/components/workspace-shell.tsx`:

- Call `draftCleanupExpired(30)` once after Tauri runtime is ready.
- On workspace root change, call `draftListForWorkspace(workspace.rootPath)` and show a lightweight message such as `发现 N 个未保存草稿`.
- For the active Markdown tab, call `draftGet(activeTab.path)` after Markdown is loaded and show `RecoveryBanner` if a draft exists.
- Wire `useDraftAutosave` with:
  - `realPath: activeTab.path`
  - `displayPath: activeTab.path`
  - `markdown: activeTab.markdown ?? null`
  - `dirty: activeTab.dirty`
  - `baseFingerprint: null` for Workspace until a workspace file fingerprint command exists
  - `mode: "workspace"`
- On tab switch and tab close, call the autosave `flush`.
- On successful save in `afterSave`, call `draftDelete({ realPath: event.path })`.
- On recovery action:
  - `恢复草稿`: dispatch `tab/contentChanged` with `draft.markdown`.
  - `保留磁盘版本`: call `draftDelete({ draftId: draft.draftId })` and hide the banner.
  - `稍后`: hide the modal but keep the banner.
- For orphan drafts:
  - `另存为`: use existing save flow by creating a temporary dirty tab with draft markdown and `needsRenameOnFirstSave`.
  - `恢复原路径`: attempt `write_markdown_file` only when parent exists; otherwise keep the action disabled.
  - `删除`: call `draftDelete`.
  - `稍后`: keep draft.

- [ ] **Step 4: Ensure persisted tab state still excludes Markdown body**

In `features/workspace/hooks/use-workspace-bootstrap.ts`, keep `toPersistedWorkspace` mapping limited to:

```ts
{
    tabId,
    path,
    title,
    dirty,
    needsRenameOnFirstSave,
}
```

Do not add `markdown` to `PersistedWorkspaceTab`.

- [ ] **Step 5: Run focused frontend tests**

Run:

```bash
npm test -- features/workspace/lib/workspace-save.test.ts features/workspace/lib/persisted-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/workspace/components/workspace-shell.tsx features/workspace/components/editor-stage.tsx features/workspace/lib/workspace-save.ts features/workspace/lib/workspace-save.test.ts features/workspace/lib/types.ts features/workspace/hooks/use-workspace-bootstrap.ts
git commit -m "feat: recover workspace drafts"
```

---

### Task 5: Document Draft Autosave And Recovery

**Files:**
- Modify: `features/document/lib/document-state.ts`
- Modify: `features/document/lib/document-state.test.ts`
- Modify: `features/document/components/document-shell.tsx`

- [ ] **Step 1: Write failing document state recovery tests**

In `features/document/lib/document-state.test.ts`, add:

```ts
import { applyRecoveredDraft, markDocumentDeleted } from "./document-state";

it("applies recovered draft content and keeps the document dirty", () => {
    const clean = createLoadedDocumentState(loadedFile);
    const recovered = applyRecoveredDraft(clean, "# Recovered\n");

    expect(recovered.markdown).toBe("# Recovered\n");
    expect(recovered.savedMarkdown).toBe("# Note\n");
    expect(recovered.dirty).toBe(true);
});

it("marks a document as deleted without clearing dirty markdown", () => {
    const dirty = updateDocumentMarkdown(createLoadedDocumentState(loadedFile), "# Mine\n");
    const deleted = markDocumentDeleted(dirty);

    expect(deleted.markdown).toBe("# Mine\n");
    expect(deleted.deletedOnDisk).toBe(true);
    expect(deleted.dirty).toBe(true);
});
```

- [ ] **Step 2: Run document state tests and verify failure**

Run:

```bash
npm test -- features/document/lib/document-state.test.ts
```

Expected: FAIL because `applyRecoveredDraft`, `markDocumentDeleted`, and `deletedOnDisk` do not exist.

- [ ] **Step 3: Implement document recovery helpers**

Update `features/document/lib/types.ts`:

```ts
export interface LoadedDocumentState {
    fileName: string;
    displayPath: string;
    realPath: string;
    markdown: string;
    savedMarkdown: string;
    fingerprint: string;
    dirty: boolean;
    outlineCollapsed: boolean;
    deletedOnDisk?: boolean;
}
```

Update `features/document/lib/document-state.ts`:

```ts
export function applyRecoveredDraft(
    state: LoadedDocumentState,
    markdown: string,
): LoadedDocumentState {
    return {
        ...state,
        markdown,
        dirty: markdown !== state.savedMarkdown,
        deletedOnDisk: false,
    };
}

export function markDocumentDeleted(
    state: LoadedDocumentState,
): LoadedDocumentState {
    return {
        ...state,
        deletedOnDisk: true,
    };
}
```

- [ ] **Step 4: Run document state tests and verify pass**

Run:

```bash
npm test -- features/document/lib/document-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire document draft lifecycle**

In `features/document/components/document-shell.tsx`:

- After `readDocumentFile(session.realPath)` succeeds, call `draftGet(file.realPath)`.
- If a draft exists, show `RecoveryBanner`.
- Use `useDraftAutosave` with:
  - `realPath: state.realPath`
  - `displayPath: state.displayPath`
  - `markdown: state.markdown`
  - `dirty: state.dirty`
  - `baseFingerprint: state.fingerprint`
  - `mode: "document"`
- Before close prompt actions, call draft `flush`.
- After `saveDocumentFile` or `overwriteDocumentFile` succeeds, call `draftDelete({ realPath: saveSnapshot.realPath })`.
- Replace the existing external-modified confirm overwrite path with a conflict banner and diff viewer:
  - `保留我的编辑`: call `overwriteDocumentFile`.
  - `重新加载磁盘`: call `readDocumentFile` and replace state.
  - `另存为/复制当前内容`: use a save-as flow if available; if not available in this task, show a copyable modal with current markdown.
  - `稍后`: keep banner.

- [ ] **Step 6: Run document-focused tests**

Run:

```bash
npm test -- features/document/lib/document-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/document/lib/types.ts features/document/lib/document-state.ts features/document/lib/document-state.test.ts features/document/components/document-shell.tsx
git commit -m "feat: recover document drafts"
```

---

### Task 6: File Watch Backend

**Files:**
- Create: `src-tauri/src/file_watch.rs`
- Create: `src-tauri/src/file_watch_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write failing file watch helper tests**

Create `src-tauri/src/file_watch_tests.rs`:

```rust
use std::path::PathBuf;

use crate::file_watch::{
    coalesce_watch_events, is_markdown_or_assets_relevant, FileWatchKind, PendingWatchEvent,
};

#[test]
fn coalesces_repeated_change_events_by_path() {
    let events = vec![
        PendingWatchEvent {
            kind: FileWatchKind::Changed,
            path: PathBuf::from("/tmp/ws/a.md"),
            new_path: None,
        },
        PendingWatchEvent {
            kind: FileWatchKind::Changed,
            path: PathBuf::from("/tmp/ws/a.md"),
            new_path: None,
        },
    ];

    let coalesced = coalesce_watch_events(events);

    assert_eq!(coalesced.len(), 1);
    assert_eq!(coalesced[0].kind, FileWatchKind::Changed);
}

#[test]
fn coalesces_create_then_delete_as_no_event() {
    let events = vec![
        PendingWatchEvent {
            kind: FileWatchKind::Created,
            path: PathBuf::from("/tmp/ws/temp.md"),
            new_path: None,
        },
        PendingWatchEvent {
            kind: FileWatchKind::Deleted,
            path: PathBuf::from("/tmp/ws/temp.md"),
            new_path: None,
        },
    ];

    assert!(coalesce_watch_events(events).is_empty());
}

#[test]
fn document_watch_accepts_markdown_and_sibling_assets_only() {
    let doc = PathBuf::from("/tmp/ws/note.md");

    assert!(is_markdown_or_assets_relevant(&doc, &PathBuf::from("/tmp/ws/note.md")));
    assert!(is_markdown_or_assets_relevant(&doc, &PathBuf::from("/tmp/ws/.assets/image.png")));
    assert!(!is_markdown_or_assets_relevant(&doc, &PathBuf::from("/tmp/ws/other.md")));
    assert!(!is_markdown_or_assets_relevant(&doc, &PathBuf::from("/tmp/ws/sub/other.md")));
}
```

- [ ] **Step 2: Run focused Rust tests and verify failure**

Run:

```bash
cd src-tauri
cargo test file_watch --lib
```

Expected: FAIL to compile because `file_watch` does not exist.

- [ ] **Step 3: Add watch models**

In `src-tauri/src/models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStartResult {
    pub watch_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStopResult {
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchEventPayload {
    pub watch_id: String,
    pub root_path: Option<String>,
    pub path: String,
    pub new_path: Option<String>,
    pub fingerprint: Option<String>,
    pub event_time: String,
}
```

- [ ] **Step 4: Implement file watch module**

Create `src-tauri/src/file_watch.rs`:

- Public commands:
  - `watch_start_workspace(root_path: String, window_label: String, app: AppHandle, state: State<Mutex<FileWatchState>>) -> Result<WatchStartResult, WorkspaceError>`
  - `watch_start_document(real_path: String, window_label: String, app: AppHandle, state: State<Mutex<FileWatchState>>) -> Result<WatchStartResult, WorkspaceError>`
  - `watch_stop(watch_id: String, state: State<Mutex<FileWatchState>>) -> Result<WatchStopResult, WorkspaceError>`
- Events:
  - `mdx-file-changed`
  - `mdx-file-deleted`
  - `mdx-file-renamed`
  - `mdx-file-created`
  - `mdx-watch-error`
- Workspace watcher:
  - Watch the current root recursively.
  - Emit only relevant create/change/delete/rename events for `.md` and `.markdown` files plus directory changes needed to refresh the tree.
- Document watcher:
  - Watch the document file's parent non-recursively.
  - Treat only the current document and sibling `.assets/` paths as relevant.
- Coalesce events over a short delay between 150 ms and 300 ms.
- Use `tauri::async_runtime::spawn` for event delivery.
- Store watcher handles in `FileWatchState` keyed by `watchId`.

- [ ] **Step 5: Register module, state, commands, and tests**

In `src-tauri/src/lib.rs`:

```rust
mod file_watch;

#[cfg(test)]
mod file_watch_tests;
```

In `.setup`:

```rust
app.manage(Mutex::new(file_watch::FileWatchState::default()));
```

In `generate_handler!`:

```rust
file_watch::watch_start_workspace,
file_watch::watch_start_document,
file_watch::watch_stop,
```

- [ ] **Step 6: Run focused Rust tests and verify pass**

Run:

```bash
cd src-tauri
cargo test file_watch --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/file_watch.rs src-tauri/src/file_watch_tests.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "feat: add file watch service"
```

---

### Task 7: Workspace External Change Handling

**Files:**
- Create: `features/file-watch/lib/types.ts`
- Create: `features/file-watch/lib/file-watch-client.ts`
- Create: `features/file-watch/lib/external-change.ts`
- Create: `features/file-watch/lib/external-change.test.ts`
- Create: `features/file-watch/hooks/use-file-watch.ts`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/lib/workspace-reducer.ts`
- Modify: `features/workspace/lib/workspace-reducer.test.ts`
- Modify: `features/workspace/lib/types.ts`

- [ ] **Step 1: Write failing external-change decision tests**

Create `features/file-watch/lib/external-change.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideWorkspaceExternalChange } from "./external-change";
import type { WorkspaceState } from "@/features/workspace/lib/types";
import { createWorkspaceState, workspaceReducer } from "@/features/workspace/lib/workspace-reducer";

function workspaceWithTab(dirty: boolean): WorkspaceState {
    const opened = workspaceReducer(createWorkspaceState("/tmp/ws"), {
        type: "tab/opened",
        tab: {
            tabId: "tab-1",
            path: "/tmp/ws/note.md",
            title: "note.md",
            dirty,
            needsRenameOnFirstSave: false,
            markdown: dirty ? "# Mine\n" : "# Disk\n",
        },
    });
    return opened;
}

describe("decideWorkspaceExternalChange", () => {
    it("reloads clean open markdown changes", () => {
        expect(
            decideWorkspaceExternalChange({
                workspace: workspaceWithTab(false),
                event: { kind: "changed", path: "/tmp/ws/note.md" },
                selfWrite: null,
            }),
        ).toEqual({ kind: "reloadCleanTab", tabId: "tab-1", path: "/tmp/ws/note.md" });
    });

    it("shows conflict for dirty open markdown changes", () => {
        expect(
            decideWorkspaceExternalChange({
                workspace: workspaceWithTab(true),
                event: { kind: "changed", path: "/tmp/ws/note.md" },
                selfWrite: null,
            }),
        ).toEqual({ kind: "showConflict", tabId: "tab-1", path: "/tmp/ws/note.md" });
    });

    it("suppresses delayed self-write changes", () => {
        expect(
            decideWorkspaceExternalChange({
                workspace: workspaceWithTab(true),
                event: { kind: "changed", path: "/tmp/ws/note.md" },
                selfWrite: { path: "/tmp/ws/note.md", markdown: "# Disk\n" },
            }),
        ).toEqual({ kind: "ignore" });
    });

    it("keeps dirty deleted files open", () => {
        expect(
            decideWorkspaceExternalChange({
                workspace: workspaceWithTab(true),
                event: { kind: "deleted", path: "/tmp/ws/note.md" },
                selfWrite: null,
            }),
        ).toEqual({ kind: "showDeletedPrompt", tabId: "tab-1", path: "/tmp/ws/note.md", dirty: true });
    });
});
```

- [ ] **Step 2: Run external-change tests and verify failure**

Run:

```bash
npm test -- features/file-watch/lib/external-change.test.ts
```

Expected: FAIL because file-watch frontend modules do not exist.

- [ ] **Step 3: Implement frontend watcher types and client**

Create `features/file-watch/lib/types.ts`:

```ts
export interface FileWatchPayload {
    watchId: string;
    rootPath?: string | null;
    path: string;
    newPath?: string | null;
    fingerprint?: string | null;
    eventTime: string;
}

export type FrontendFileWatchEvent =
    | { kind: "changed"; path: string }
    | { kind: "deleted"; path: string }
    | { kind: "created"; path: string }
    | { kind: "renamed"; path: string; newPath: string };

export interface SelfWriteMarker {
    path: string;
    markdown: string;
}
```

Create `features/file-watch/lib/file-watch-client.ts` wrappers for `watch_start_workspace`, `watch_start_document`, and `watch_stop`.

- [ ] **Step 4: Implement external-change pure helpers**

Create `features/file-watch/lib/external-change.ts`:

```ts
import { normalizeWorkspacePath } from "@/features/workspace/lib/path";
import type { WorkspaceState } from "@/features/workspace/lib/types";
import type { FrontendFileWatchEvent, SelfWriteMarker } from "./types";

export type WorkspaceExternalChangeDecision =
    | { kind: "ignore" }
    | { kind: "refreshTree" }
    | { kind: "reloadCleanTab"; tabId: string; path: string }
    | { kind: "showConflict"; tabId: string; path: string }
    | { kind: "showDeletedPrompt"; tabId: string; path: string; dirty: boolean }
    | { kind: "remapPath"; fromPath: string; toPath: string };

export function decideWorkspaceExternalChange(input: {
    workspace: WorkspaceState;
    event: FrontendFileWatchEvent;
    selfWrite: SelfWriteMarker | null;
}): WorkspaceExternalChangeDecision {
    const path = normalizeWorkspacePath(input.event.path);
    const tab = findTabByPath(input.workspace, path);

    if (
        input.event.kind === "changed" &&
        input.selfWrite &&
        normalizeWorkspacePath(input.selfWrite.path) === path
    ) {
        return { kind: "ignore" };
    }

    if (input.event.kind === "created") {
        return { kind: "refreshTree" };
    }

    if (input.event.kind === "renamed") {
        return {
            kind: "remapPath",
            fromPath: path,
            toPath: normalizeWorkspacePath(input.event.newPath),
        };
    }

    if (!tab) {
        return { kind: "refreshTree" };
    }

    if (input.event.kind === "deleted") {
        return {
            kind: "showDeletedPrompt",
            tabId: tab.tabId,
            path,
            dirty: tab.dirty,
        };
    }

    return tab.dirty
        ? { kind: "showConflict", tabId: tab.tabId, path }
        : { kind: "reloadCleanTab", tabId: tab.tabId, path };
}

function findTabByPath(workspace: WorkspaceState, path: string) {
    return workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .find((tab) => tab && normalizeWorkspacePath(tab.path) === path) ?? null;
}
```

- [ ] **Step 5: Implement watcher lifecycle hook**

Create `features/file-watch/hooks/use-file-watch.ts`:

- Starts workspace watcher when `mode: "workspace"` and `preferences.fileWatchEnabled`.
- Starts document watcher when `mode: "document"` and `preferences.fileWatchEnabled`.
- Subscribes to the five Tauri events.
- Converts backend payloads into `FrontendFileWatchEvent`.
- Calls the supplied `onEvent` callback.
- Stops the watcher on root/path/preference change and unmount.
- Surfaces watch errors through `onError`.

- [ ] **Step 6: Wire workspace watcher handling**

In `features/workspace/components/workspace-shell.tsx`:

- Start workspace watcher when `preferences.fileWatchEnabled`.
- On `created`, `deleted`, or `renamed`, refresh the file tree through existing `refreshTree`.
- On clean changed open tab, read disk with `read_markdown_file` and dispatch `tab/saved`.
- On dirty changed open tab, read disk and show `RecoveryBanner` plus `DiffViewer`.
- On deleted clean tab, keep the tab open and show a normal deleted prompt with `关闭` and `另存为`.
- On deleted dirty tab, keep content and show high-priority prompt with `另存为`, `恢复原路径`, `关闭且不保存`.
- On reliable rename, dispatch `tab/pathRemapped`; otherwise rely on delete/create behavior.
- Record a short-lived self-write marker in the save `afterSave` callback with path and saved markdown; expire it after 5 seconds.

- [ ] **Step 7: Run focused frontend tests**

Run:

```bash
npm test -- features/file-watch/lib/external-change.test.ts features/workspace/lib/workspace-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add features/file-watch/lib/types.ts features/file-watch/lib/file-watch-client.ts features/file-watch/lib/external-change.ts features/file-watch/lib/external-change.test.ts features/file-watch/hooks/use-file-watch.ts features/workspace/components/workspace-shell.tsx features/workspace/lib/workspace-reducer.ts features/workspace/lib/workspace-reducer.test.ts features/workspace/lib/types.ts
git commit -m "feat: handle workspace external changes"
```

---

### Task 8: Document File Watch And External Changes

**Files:**
- Modify: `features/document/lib/document-state.ts`
- Modify: `features/document/lib/document-state.test.ts`
- Modify: `features/document/components/document-shell.tsx`

- [ ] **Step 1: Write failing document external reload tests**

In `features/document/lib/document-state.test.ts`, add:

```ts
import { applyExternalDocumentReload, createDocumentExternalConflict } from "./document-state";

it("auto reloads clean document content from disk", () => {
    const state = createLoadedDocumentState(loadedFile);
    const reloaded = applyExternalDocumentReload(state, {
        content: "# Disk Changed\n",
        fingerprint: "fingerprint-b",
    });

    expect(reloaded.markdown).toBe("# Disk Changed\n");
    expect(reloaded.savedMarkdown).toBe("# Disk Changed\n");
    expect(reloaded.fingerprint).toBe("fingerprint-b");
    expect(reloaded.dirty).toBe(false);
});

it("creates external conflict from dirty document state", () => {
    const dirty = updateDocumentMarkdown(createLoadedDocumentState(loadedFile), "# Mine\n");

    expect(
        createDocumentExternalConflict(dirty, {
            content: "# Disk\n",
            fingerprint: "fingerprint-b",
        }),
    ).toEqual({
        path: "/tmp/note.md",
        currentMarkdown: "# Mine\n",
        diskMarkdown: "# Disk\n",
        diskFingerprint: "fingerprint-b",
    });
});
```

- [ ] **Step 2: Run document tests and verify failure**

Run:

```bash
npm test -- features/document/lib/document-state.test.ts
```

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement document external helpers**

In `features/document/lib/document-state.ts`, add:

```ts
export function applyExternalDocumentReload(
    state: LoadedDocumentState,
    file: { content: string; fingerprint: string },
): LoadedDocumentState {
    return {
        ...state,
        markdown: file.content,
        savedMarkdown: file.content,
        fingerprint: file.fingerprint,
        dirty: false,
        deletedOnDisk: false,
    };
}

export function createDocumentExternalConflict(
    state: LoadedDocumentState,
    file: { content: string; fingerprint: string },
) {
    return {
        path: state.realPath,
        currentMarkdown: state.markdown,
        diskMarkdown: file.content,
        diskFingerprint: file.fingerprint,
    };
}
```

- [ ] **Step 4: Wire document watcher**

In `features/document/components/document-shell.tsx`:

- Start document watcher with `watch_start_document` when file watch is enabled.
- If the watched document changes and `state.dirty === false`, call `readDocumentFile(state.realPath)` and apply `applyExternalDocumentReload`.
- If the watched document changes and `state.dirty === true`, call `readDocumentFile(state.realPath)`, set external conflict state, and show `RecoveryBanner` plus `DiffViewer`.
- If the document is deleted, keep current markdown and call `markDocumentDeleted`.
- For deleted clean documents, show `关闭` and `另存为`.
- For deleted dirty documents, show `另存为`, `恢复原路径`, and `关闭且不保存`.
- Ignore sibling `.assets/` changes unless image rendering needs a reload; do not turn `.assets/` changes into document content conflicts.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- features/document/lib/document-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/document/lib/document-state.ts features/document/lib/document-state.test.ts features/document/components/document-shell.tsx
git commit -m "feat: handle document external changes"
```

---

### Task 9: Workspace Search Backend

**Files:**
- Create: `src-tauri/src/workspace_search.rs`
- Create: `src-tauri/src/workspace_search_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write failing workspace search tests**

Create `src-tauri/src/workspace_search_tests.rs`:

```rust
use tempfile::tempdir;

use crate::workspace_search::{
    workspace_search_sync, DirtySearchOverride, WorkspaceSearchRequest,
};

#[test]
fn searches_markdown_files_including_raw_by_default() {
    let root = tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("raw/articles")).unwrap();
    std::fs::write(root.path().join("note.md"), "alpha\nbeta\n").unwrap();
    std::fs::write(root.path().join("raw/articles/source.md"), "raw alpha\n").unwrap();
    std::fs::write(root.path().join("book.pdf"), "alpha").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-1".to_string(),
    })
    .unwrap();

    let paths: Vec<_> = result.results.iter().map(|item| item.path.as_str()).collect();
    assert!(paths.iter().any(|path| path.ends_with("note.md")));
    assert!(paths.iter().any(|path| path.ends_with("raw/articles/source.md")));
    assert!(!paths.iter().any(|path| path.ends_with("book.pdf")));
}

#[test]
fn applies_dirty_override_instead_of_disk_contents() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "disk only\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "unsaved".to_string(),
        case_sensitive: false,
        max_file_bytes: 2_097_152,
        max_results: 20,
        max_matches_per_file: 20,
        dirty_overrides: vec![DirtySearchOverride {
            path: file.to_string_lossy().into_owned(),
            markdown: "unsaved match\n".to_string(),
        }],
        request_id: "req-2".to_string(),
    })
    .unwrap();

    assert_eq!(result.results.len(), 1);
    assert!(result.results[0].dirty);
    assert_eq!(result.results[0].line_number, 1);
}

#[test]
fn skips_large_files_and_truncates_results() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("large.md"), "alpha alpha alpha").unwrap();
    std::fs::write(root.path().join("small.md"), "alpha\nalpha\n").unwrap();

    let result = workspace_search_sync(WorkspaceSearchRequest {
        root_path: root.path().to_string_lossy().into_owned(),
        query: "alpha".to_string(),
        case_sensitive: false,
        max_file_bytes: 8,
        max_results: 1,
        max_matches_per_file: 20,
        dirty_overrides: vec![],
        request_id: "req-3".to_string(),
    })
    .unwrap();

    assert_eq!(result.skipped_large_files, 1);
    assert_eq!(result.results.len(), 1);
    assert!(result.truncated);
}
```

- [ ] **Step 2: Run focused Rust tests and verify failure**

Run:

```bash
cd src-tauri
cargo test workspace_search --lib
```

Expected: FAIL to compile because `workspace_search` does not exist.

- [ ] **Step 3: Add search models**

In `src-tauri/src/models.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub request_id: String,
    pub results: Vec<SearchResultItem>,
    pub skipped_large_files: usize,
    pub skipped_unreadable_files: usize,
    pub truncated: bool,
    pub searched_files: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub path: String,
    pub line_number: usize,
    pub column_start: usize,
    pub column_end: usize,
    pub line: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchCancelResult {
    pub cancelled: bool,
}
```

- [ ] **Step 4: Implement backend search**

Create `src-tauri/src/workspace_search.rs`:

- Request struct:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchRequest {
    pub root_path: String,
    pub query: String,
    pub case_sensitive: bool,
    pub max_file_bytes: u64,
    pub max_results: usize,
    pub max_matches_per_file: usize,
    pub dirty_overrides: Vec<DirtySearchOverride>,
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtySearchOverride {
    pub path: String,
    pub markdown: String,
}
```

- Commands:
  - `workspace_search(request: WorkspaceSearchRequest, state: State<WorkspaceSearchState>)`
  - `workspace_search_cancel(request_id: String, state: State<WorkspaceSearchState>)`
- Pure helper:
  - `workspace_search_sync(request: WorkspaceSearchRequest) -> Result<WorkspaceSearchResult, WorkspaceError>`
- Rules:
  - Empty trimmed query returns an empty result with `searchedFiles: 0`.
  - Use `canonicalize_workspace_root`.
  - Scan recursively.
  - Include `.md` and `.markdown`.
  - Include `raw/`.
  - Skip hidden directories, `.git`, `node_modules`, binary files, files larger than `max_file_bytes`, and symlinks outside the root.
  - Do not use LLM Wiki `skipPaths`.
  - Dirty override paths must be under root and Markdown files.
  - For dirty overrides, search the override text instead of disk text and mark result `dirty: true`.
  - Stop collecting when `max_results` is reached and set `truncated: true`.
  - Stop per-file matching when `max_matches_per_file` is reached.

- [ ] **Step 5: Register module, state, and commands**

In `src-tauri/src/lib.rs`:

```rust
mod workspace_search;

#[cfg(test)]
mod workspace_search_tests;
```

In `.setup`:

```rust
app.manage(workspace_search::WorkspaceSearchState::default());
```

In `generate_handler!`:

```rust
workspace_search::workspace_search,
workspace_search::workspace_search_cancel,
```

- [ ] **Step 6: Run focused Rust tests and verify pass**

Run:

```bash
cd src-tauri
cargo test workspace_search --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/workspace_search.rs src-tauri/src/workspace_search_tests.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "feat: add workspace full text search backend"
```

---

### Task 10: Workspace Search UI And Scroll-To-Line

**Files:**
- Create: `features/workspace/lib/workspace-search.ts`
- Create: `features/workspace/lib/workspace-search.test.ts`
- Create: `features/workspace/components/workspace-search-panel.tsx`
- Modify: `features/workspace/components/file-tree-panel.tsx`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`
- Modify: `features/workspace/lib/types.ts`
- Modify: `features/workspace/lib/workspace-reducer.ts`
- Modify: `features/workspace/lib/workspace-reducer.test.ts`
- Create: `features/editor/lib/markdown-line-scroll.ts`
- Create: `features/editor/lib/markdown-line-scroll.test.ts`
- Modify: `features/editor/components/editor-pane.tsx`

- [ ] **Step 1: Write failing search helper tests**

Create `features/workspace/lib/workspace-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    collectDirtySearchOverrides,
    formatSearchSummary,
    shouldAcceptSearchResponse,
} from "./workspace-search";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";

describe("workspace-search helpers", () => {
    it("collects opened dirty markdown overrides", () => {
        let workspace = createWorkspaceState("/tmp/ws");
        workspace = workspaceReducer(workspace, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/raw/note.md",
                title: "note.md",
                dirty: true,
                needsRenameOnFirstSave: false,
                markdown: "# Unsaved\n",
            },
        });

        expect(collectDirtySearchOverrides(workspace)).toEqual([
            { path: "/tmp/ws/raw/note.md", markdown: "# Unsaved\n" },
        ]);
    });

    it("rejects stale search responses", () => {
        expect(shouldAcceptSearchResponse("req-2", { requestId: "req-1" })).toBe(false);
        expect(shouldAcceptSearchResponse("req-2", { requestId: "req-2" })).toBe(true);
    });

    it("formats skipped and truncated summary", () => {
        expect(
            formatSearchSummary({
                skippedLargeFiles: 2,
                skippedUnreadableFiles: 1,
                truncated: true,
                searchedFiles: 9,
            }),
        ).toBe("已搜索 9 个文件，跳过 2 个大文件、1 个无法读取文件，仅显示前若干结果。");
    });
});
```

- [ ] **Step 2: Write failing line-scroll tests**

Create `features/editor/lib/markdown-line-scroll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { markdownLineToBlockIndex, scrollMarkdownLineIntoView } from "./markdown-line-scroll";

describe("markdown line scroll", () => {
    it("maps markdown lines to approximate rendered block indexes", () => {
        const markdown = "# Title\n\nParagraph one\ncontinued\n\n```js\ncode\n```\n\nAfter\n";

        expect(markdownLineToBlockIndex(markdown, 1)).toBe(0);
        expect(markdownLineToBlockIndex(markdown, 3)).toBe(1);
        expect(markdownLineToBlockIndex(markdown, 7)).toBe(2);
        expect(markdownLineToBlockIndex(markdown, 10)).toBe(3);
    });

    it("scrolls the matching rendered block into view", () => {
        const root = document.createElement("div");
        const domd = document.createElement("div");
        domd.className = "DOMD-Root";
        const first = document.createElement("h1");
        const second = document.createElement("p");
        second.scrollIntoView = vi.fn();
        domd.append(first, second);
        root.append(domd);

        expect(scrollMarkdownLineIntoView(root, "# Title\n\nParagraph\n", 3)).toBe(true);
        expect(second.scrollIntoView).toHaveBeenCalledWith({
            block: "center",
            inline: "nearest",
        });
    });
});
```

- [ ] **Step 3: Run focused frontend tests and verify failure**

Run:

```bash
npm test -- features/workspace/lib/workspace-search.test.ts features/editor/lib/markdown-line-scroll.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement search helper and reducer state**

Create `features/workspace/lib/workspace-search.ts` with:

- `collectDirtySearchOverrides(workspace)`
- `shouldAcceptSearchResponse(currentRequestId, response)`
- `formatSearchSummary(summary)`
- `normalizeSearchQuery(query)`

Update `features/workspace/lib/types.ts`:

```ts
export interface WorkspaceSearchResultItem {
    path: string;
    lineNumber: number;
    columnStart: number;
    columnEnd: number;
    line: string;
    before?: string | null;
    after?: string | null;
    dirty: boolean;
}

export interface WorkspaceFullTextSearchState {
    query: string;
    caseSensitive: boolean;
    status: "idle" | "typing" | "searching" | "complete" | "error";
    requestId: string | null;
    results: WorkspaceSearchResultItem[];
    summary: {
        skippedLargeFiles: number;
        skippedUnreadableFiles: number;
        truncated: boolean;
        searchedFiles: number;
    };
    error: string | null;
}
```

Keep the existing file-name filter query either as `treeFilterQuery` or inside a left-panel state object. Do not remove file-tree filtering.

- [ ] **Step 5: Implement line scroll helper and editor command**

Create `features/editor/lib/markdown-line-scroll.ts`:

- `markdownLineToBlockIndex(markdown: string, lineNumber: number): number`
- `scrollMarkdownLineIntoView(viewport: HTMLElement | null, markdown: string, lineNumber: number): boolean`

Rules:

- Treat headings, paragraphs, lists, and fenced code blocks as rendered blocks.
- Blank lines separate paragraphs.
- Fenced code block lines map to the code block.
- Clamp out-of-range line numbers to the nearest block.

Update `features/workspace/lib/types.ts` pending editor command:

```ts
export interface PendingCliEditorCommand {
    id: string;
    kind: "focus" | "insert" | "scrollToLine";
    tabId: string;
    text?: string;
    lineNumber?: number;
}
```

Update `features/editor/components/editor-pane.tsx` to handle `scrollToLine` by calling `scrollMarkdownLineIntoView(editorViewportRef.current, bridge.currentMarkdown, pendingCliCommand.lineNumber)`.

- [ ] **Step 6: Implement search panel**

Create `features/workspace/components/workspace-search-panel.tsx`:

Props:

```ts
interface WorkspaceSearchPanelProps {
    rootPath: string;
    state: WorkspaceFullTextSearchState;
    preferences: AppPreferences;
    onQueryChange: (query: string) => void;
    onCaseSensitiveToggle: () => void;
    onResultClick: (result: WorkspaceSearchResultItem) => void;
}
```

UI requirements:

- Search input with 300 ms debounce owned by the parent or a local effect.
- Case-sensitive toggle.
- Results list with path, line number, matching line, optional context, and an `未保存` mark for dirty override results.
- Summary row for skipped/truncated status.
- `min-h-0 overflow-auto` for results.
- Long paths and lines use `break-words`.

- [ ] **Step 7: Wire workspace search**

In `features/workspace/components/workspace-shell.tsx`:

- Add left-panel mode state: `"tree" | "search"`.
- Cancel the previous request with `workspace_search_cancel` before starting a new one.
- Generate request ids with `nanoid(8)`.
- Pass `dirtyOverrides: collectDirtySearchOverrides(workspaceRef.current)`.
- Use preference limits.
- Drop stale responses by request id.
- On result click:
  - Open or activate the file tab.
  - Queue pending command `{ kind: "scrollToLine", tabId, lineNumber }`.

In `features/workspace/components/file-tree-panel.tsx`:

- Keep the existing file tree and name filter.
- Add tabs or segmented control for `文件` and `全文`.
- Render `WorkspaceSearchPanel` in the `全文` mode.

- [ ] **Step 8: Run focused frontend tests**

Run:

```bash
npm test -- features/workspace/lib/workspace-search.test.ts features/editor/lib/markdown-line-scroll.test.ts features/workspace/lib/workspace-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add features/workspace/lib/workspace-search.ts features/workspace/lib/workspace-search.test.ts features/workspace/components/workspace-search-panel.tsx features/workspace/components/file-tree-panel.tsx features/workspace/components/workspace-shell.tsx features/workspace/components/editor-stage.tsx features/workspace/lib/types.ts features/workspace/lib/workspace-reducer.ts features/workspace/lib/workspace-reducer.test.ts features/editor/lib/markdown-line-scroll.ts features/editor/lib/markdown-line-scroll.test.ts features/editor/components/editor-pane.tsx
git commit -m "feat: add workspace full text search"
```

---

### Task 11: Settings UI For Watch And Search Limits

**Files:**
- Modify: `features/workspace/components/settings-button.tsx`
- Modify: `features/workspace/lib/preferences.ts`
- Modify: `features/workspace/lib/preferences.test.ts`

- [ ] **Step 1: Extend preference tests for settings form values**

In `features/workspace/lib/preferences.test.ts`, add:

```ts
import { parsePositiveIntegerSetting } from "./preferences";

it("parses positive integer settings with fallback and bounds", () => {
    expect(parsePositiveIntegerSetting("2048", 1024, 4096, 2000)).toBe(2048);
    expect(parsePositiveIntegerSetting("bad", 1024, 4096, 2000)).toBe(2000);
    expect(parsePositiveIntegerSetting("1", 1024, 4096, 2000)).toBe(1024);
    expect(parsePositiveIntegerSetting("9000", 1024, 4096, 2000)).toBe(4096);
});
```

- [ ] **Step 2: Run preference tests and verify failure**

Run:

```bash
npm test -- features/workspace/lib/preferences.test.ts
```

Expected: FAIL because `parsePositiveIntegerSetting` is not exported.

- [ ] **Step 3: Implement numeric parser**

In `features/workspace/lib/preferences.ts`, export:

```ts
export function parsePositiveIntegerSetting(
    value: string,
    min: number,
    max: number,
    fallback: number,
) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
}
```

- [ ] **Step 4: Update settings dialog sections**

In `features/workspace/components/settings-button.tsx`:

- Change `SettingsSection` to `"general" | "search" | "files" | "llm"`.
- Add section labels:
  - `通用`
  - `搜索`
  - `文件`
  - `LLM`
- Add local state:
  - `fileWatchEnabled`
  - `searchMaxFileBytesText`
  - `searchMaxResultsText`
  - `searchMaxMatchesPerFileText`
- Sync these values when `preferences` changes.
- In `saveSettings`, call `onPreferencesChange` with all fields:

```ts
await onPreferencesChange?.({
    fileTreeExcludeDirs: nextExcludeDirs,
    fileWatchEnabled,
    searchMaxFileBytes: parsePositiveIntegerSetting(
        searchMaxFileBytesText,
        1_024,
        50 * 1_024 * 1_024,
        preferences.searchMaxFileBytes,
    ),
    searchMaxResults: parsePositiveIntegerSetting(
        searchMaxResultsText,
        1,
        5_000,
        preferences.searchMaxResults,
    ),
    searchMaxMatchesPerFile: parsePositiveIntegerSetting(
        searchMaxMatchesPerFileText,
        1,
        500,
        preferences.searchMaxMatchesPerFile,
    ),
});
```

- Add plaintext draft storage text in the Files section:
  - `未保存正文会以明文草稿保存在 ~/.mdx/drafts/，保存或丢弃后会清理对应草稿。`
- Ensure modal body remains scrollable with `max-h-[70vh] overflow-auto`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- features/workspace/lib/preferences.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/workspace/components/settings-button.tsx features/workspace/lib/preferences.ts features/workspace/lib/preferences.test.ts
git commit -m "feat: configure watch and search settings"
```

---

### Task 12: UI Polish And Scroll Regions

**Files:**
- Modify: `common/components/ui-controls.tsx`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/workspace/components/file-tree-toolbar.tsx`
- Modify: `features/workspace/components/file-tree-node.tsx`
- Modify: `features/workspace/components/tab-strip.tsx`
- Modify: `features/workspace/components/settings-button.tsx`
- Modify: `features/document/components/document-shell.tsx`
- Modify: `features/llm-wiki/components/llm-wiki-panel.tsx`
- Modify: `features/llm-wiki/components/llm-wiki-panel.test.tsx`

- [ ] **Step 1: Write failing LLM Wiki layout test**

In `features/llm-wiki/components/llm-wiki-panel.test.tsx`, add a test that renders a long failure list and asserts the progress area text is still present before the failure scroller:

```tsx
it("keeps current progress visible above scrollable failure details", () => {
    const llmWiki = createPanelState({
        operation: {
            kind: "raw",
            status: "running",
            currentPath: "raw/articles/current.md",
            currentIndex: 3,
            total: 10,
            completed: 2,
            failed: Array.from({ length: 50 }, (_, index) => ({
                path: `raw/articles/failed-${index}.md`,
                reason: "very long failure reason that should wrap inside the failure scroller",
            })),
            skipped: 0,
            waitingSeconds: 12,
        },
    });

    const tree = LlmWikiPanel({ llmWiki, onConfigureLlm: () => {} });

    expect(JSON.stringify(tree)).toContain("正在处理 raw");
    expect(JSON.stringify(tree)).toContain("failed-49.md");
});
```

Use the existing test helpers in that file; if the helper name differs, adapt the fixture to the current local helper but keep the assertion intent.

- [ ] **Step 2: Run LLM Wiki panel test**

Run:

```bash
npm test -- features/llm-wiki/components/llm-wiki-panel.test.tsx
```

Expected: FAIL if the current component does not expose a stable scroll region for failures, or PASS if prior LLM Wiki work already fixed it. Continue either way.

- [ ] **Step 3: Replace character icons with lucide icons**

Update primary button imports to use lucide icons such as:

```ts
import {
    ChevronLeft,
    ChevronRight,
    FilePlus,
    FolderPlus,
    Menu,
    RefreshCw,
    Save,
    Search,
    Settings,
    Trash2,
    X,
} from "lucide-react";
```

Replace visible character icons in:

- `workspace-shell.tsx`: panel toggles and settings/open actions.
- `file-tree-toolbar.tsx`: refresh/create/trash/rename/menu actions.
- `tab-strip.tsx`: close button.
- `document-shell.tsx`: save and outline buttons where icon+text improves scanability.

Keep icon buttons at stable dimensions: `h-7 min-w-7` or `h-8 min-w-8`.

- [ ] **Step 4: Normalize control overflow**

In `common/components/ui-controls.tsx`:

- Ensure `IconButton` wraps `icon` in `inline-flex h-4 w-4 items-center justify-center`.
- Ensure `TextControlButton` uses `inline-flex items-center gap-1 whitespace-nowrap`.
- Add `max-w-full min-w-0` where text can truncate.

- [ ] **Step 5: Fix scroll regions and long text wrapping**

Apply these layout rules:

- `features/llm-wiki/components/llm-wiki-panel.tsx`
  - Current progress/status block remains outside failure details scroller.
  - Failure details use `max-h-48 overflow-auto break-words`.
  - Long paths use `break-all` or `break-words`.
- `features/workspace/components/settings-button.tsx`
  - Dialog grid works down to narrow width using `w-[min(94vw,880px)]` and `min-w-0`.
  - Sidebar and content both allow scrolling when needed.
- `features/workspace/components/workspace-search-panel.tsx`
  - Results list uses `min-h-0 overflow-auto`.
- `features/recovery/components/diff-viewer.tsx`
  - Diff body uses `grid-cols-1 md:grid-cols-2` or a horizontal scroll that does not overlap buttons.

- [ ] **Step 6: Run focused UI tests**

Run:

```bash
npm test -- features/llm-wiki/components/llm-wiki-panel.test.tsx features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add common/components/ui-controls.tsx features/workspace/components/workspace-shell.tsx features/workspace/components/file-tree-toolbar.tsx features/workspace/components/file-tree-node.tsx features/workspace/components/tab-strip.tsx features/workspace/components/settings-button.tsx features/document/components/document-shell.tsx features/llm-wiki/components/llm-wiki-panel.tsx features/llm-wiki/components/llm-wiki-panel.test.tsx
git commit -m "polish: refine workspace controls and scroll regions"
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.zh-CN.md`
- Modify: `README.md`

- [ ] **Step 1: Update Chinese README**

In `README.zh-CN.md`:

- Remove or revise the statement that the MVP lacks full-text search and live file watching.
- Add:
  - Workspace full-text search for `.md` and `.markdown`, including `raw/`.
  - Default search limits: 2 MB per file, 200 total results, 20 matches per file.
  - File watching for Workspace and Document modes.
  - Dirty external edits show a conflict prompt and read-only diff.
  - Unsaved Markdown drafts are stored as plaintext in `~/.mdx/drafts/`.
  - Drafts are deleted after save/discard and cleaned after 30 days.
- Keep non-goals clear:
  - no PDF/image/binary search
  - no auto-update chain
  - no LLM Wiki onboarding in this phase

- [ ] **Step 2: Update English README**

In `README.md`, mirror the same capability and privacy notes in concise English.

- [ ] **Step 3: Check docs for stale wording**

Run:

```bash
rg -n "全文搜索|file watching|实时文件|未保存|draft|auto-update|自动更新|MVP" README.zh-CN.md README.md
```

Expected: output shows the new statements and no stale claim that full-text search or live file watching are still absent.

- [ ] **Step 4: Commit**

```bash
git add README.zh-CN.md README.md
git commit -m "docs: describe maturity phase features"
```

---

### Task 14: Full Verification, Build, Install, And Screenshots

**Files:**
- No source files should be edited in this task unless verification exposes a defect. If a defect is found, fix it in the relevant source file and rerun the failing command before committing.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS and Next.js build completes.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 5: Run Tauri build**

Run:

```bash
npx tauri build
```

Expected: PASS and a macOS `.app` bundle plus installer artifact are created under `src-tauri/target/release/bundle/`.

- [ ] **Step 6: Install latest local app**

Run:

```bash
rm -rf /Applications/MDX.app
cp -R src-tauri/target/release/bundle/macos/MDX.app /Applications/MDX.app
```

Expected: `/Applications/MDX.app` exists.

- [ ] **Step 7: Verify installed app checksum matches build output**

Run:

```bash
find src-tauri/target/release/bundle/macos/MDX.app -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/mdx-built.sha256
find /Applications/MDX.app -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/mdx-installed.sha256
diff /tmp/mdx-built.sha256 /tmp/mdx-installed.sha256
```

Expected: `diff` prints no output.

- [ ] **Step 8: Run manual acceptance checks**

Use the installed app and verify:

- Workspace Mode:
  - Edit a Markdown tab, force close the app, reopen, and see a draft banner.
  - Use diff viewer and restore draft.
  - Save the file and confirm the draft disappears from `~/.mdx/drafts/`.
  - Modify a clean open file externally and confirm it auto-reloads.
  - Modify a dirty open file externally and confirm a conflict banner plus diff appears.
  - Delete a dirty open file externally and confirm content remains with save-as/restore choices.
  - Search text under `raw/` and confirm Markdown results appear.
  - Search a dirty open tab and confirm the result is marked `未保存`.
- Document Mode:
  - Open one `.md` file directly.
  - Edit, force close, reopen, and see draft recovery.
  - Modify the clean document externally and confirm auto-reload.
  - Modify the dirty document externally and confirm diff conflict.
- UI:
  - LLM Wiki progress remains visible while failure details scroll.
  - Settings modal scrolls and wraps long text.
  - Narrow window does not overlap text/buttons.

- [ ] **Step 9: Capture wide and narrow screenshots**

Run the app, then use the in-app browser or system screenshots to capture:

- Workspace wide viewport around `1280x820`.
- Workspace narrow viewport near the app minimum width.
- Settings dialog.
- LLM Wiki panel with long failure details.
- Search results under the left panel.

Expected: no text overlap, no button label clipping, and no hidden active progress behind failure details.

- [ ] **Step 10: Final commit for verification-only fixes**

If any verification-only fix was needed:

```bash
git add <fixed-files>
git commit -m "fix: resolve maturity phase verification issues"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Unsaved Workspace and Document draft recovery: Tasks 2-5.
  - Read-only diff viewer: Task 3, wired in Tasks 4, 5, 7, 8.
  - Workspace and Document file watching: Tasks 6-8.
  - Workspace full-text search including `raw/`: Tasks 9-10.
  - Configurable search limits and watch toggle: Tasks 1 and 11.
  - UI polish and scroll regions: Task 12.
  - README updates and plaintext draft disclosure: Task 13.
  - Full verification, build, install, checksum: Task 14.
- Placeholder scan:
  - This plan intentionally avoids unresolved requirement placeholders. Any implementation naming not fixed by the spec is fixed in the file structure and task steps above.
- Type consistency:
  - Draft structs use camelCase across Rust serde and TypeScript.
  - Preference field names match `state_store.rs`, `types.ts`, and settings UI.
  - Search request/result field names match the design and frontend helper tests.
- Design drift:
  - No encryption, live index, PDF search, merge editor, onboarding, auto-update, or large redesign is introduced.

## Execution Handoff

Use `loopx:subagent-exec` or `loopx:exec` to implement this plan. Recommended execution is task-by-task with commits after each task and a review checkpoint after Tasks 5, 8, 10, 12, and 14.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
