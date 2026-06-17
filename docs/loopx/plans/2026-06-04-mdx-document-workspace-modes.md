# MDX Document And Workspace Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/MDX双模式文档与工作区需求设计文档.md`

**Goal:** Build MDX as a dual-mode macOS Markdown app: single Markdown files open in lightweight Document Mode, while direct app launch and folder workflows keep the existing Workspace Mode with optional LLM Wiki.

**Architecture:** Add a Rust-owned window/session layer with one Workspace window and many Document windows. Add independent Document file commands and a React `DocumentShell` that reuses the editor and outline but does not mount workspace file tree, tabs, CLI sync, or LLM Wiki. Preserve existing Workspace Mode behavior and update bundle file associations and docs.

**Tech Stack:** Tauri 2.10, Rust 2021, React 19, Next.js 16, TypeScript, Vitest, `@do-md/react`, macOS Launch Services.

---

## File Structure

- Create `src-tauri/src/document.rs`
  - Owns single-document file validation, canonical real-path resolution, reading, saving, overwrite saving, and file fingerprint generation.
- Create `src-tauri/src/document_tests.rs`
  - Rust unit tests for `.md/.markdown` support, `.mdx` rejection, symlink canonicalization, save conflict detection, overwrite behavior, and missing/not-file errors.
- Create `src-tauri/src/window_sessions.rs`
  - Owns runtime window role/session registry, document path de-duplication, workspace window label, and pure helpers for route decisions. Tauri window creation hooks can live here once helper behavior is tested.
- Create `src-tauri/src/window_sessions_tests.rs`
  - Rust unit tests for unique workspace window, document path de-duplication, destroyed window cleanup, and Markdown URL filtering.
- Modify `src-tauri/src/lib.rs`
  - Register new modules, manage session state, create workspace/document windows, route `RunEvent::Opened { urls }`, route `RunEvent::Reopen`, add document commands, and make menu dispatch role-aware.
- Modify `src-tauri/tauri.conf.json`
  - Disable default static startup window creation and add `.md/.markdown` file association.
- Create `features/app/lib/app-session.ts`
  - TypeScript types and helpers for `AppWindowSession` returned by Tauri.
- Create `features/app/components/app-shell.tsx`
  - Top-level frontend router: render `WorkspaceApp`, `DocumentApp`, or a document error view from `get_window_session`.
- Modify `app/page.tsx`
  - Render `AppShell` instead of `WorkspaceApp`.
- Create `features/document/lib/types.ts`
  - Document state types, file response types, save result types.
- Create `features/document/lib/document-state.ts`
  - Pure reducer/helpers for dirty calculation, title text, conflict states, and outline collapsed state.
- Create `features/document/lib/document-state.test.ts`
  - Vitest tests for dirty state and title behavior.
- Create `features/document/lib/document-client.ts`
  - Tauri command wrappers for document read/save/overwrite and asset save.
- Create `features/document/components/document-app.tsx`
  - Dialog provider wrapper for Document Mode.
- Create `features/document/components/document-shell.tsx`
  - Lightweight editor + outline UI, document load/save/close guard, menu listeners, title updates.
- Create `features/document/components/document-error.tsx`
  - Error view for failed single-file opens.
- Modify `features/editor/components/editor-pane.tsx`
  - Make editor props generic enough for Document Mode: accept `imageLoaderOptions`, optional CLI command props, optional selection callback, and allow wikilink handler to be omitted.
- Modify `common/lib/image-storage.ts`
  - Add `storeImageForDocument` / document asset wrapper or a mode option that calls `save_document_image_asset`.
- Modify `src-tauri/src/assets.rs`
  - Add document sibling `.assets/` save path with global fallback, or expose a document-specific asset command that reuses existing helpers.
- Modify `src-tauri/src/assets_tests.rs`
  - Add document asset tests.
- Modify `features/workspace/components/workspace-app.tsx`
  - Keep Workspace Mode behavior; optionally listen for focused-window menu events that now come from role-aware dispatcher.
- Modify `features/workspace/components/workspace-shell.tsx`
  - Keep LLM Wiki mounted only here; add optional conflict lookup event if needed.
- Modify `features/workspace/lib/types.ts`
  - Add any shared dirty-path snapshot type only if needed for cross-window conflict warning.
- Modify `README.zh-CN.md`, `README.md` if existing translations are maintained together
  - Update product positioning and mode descriptions.

---

### Task 1: Document File Commands

**Files:**
- Create: `src-tauri/src/document.rs`
- Create: `src-tauri/src/document_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write failing Rust tests for document read, type validation, symlink canonicalization, and save conflicts**

Create `src-tauri/src/document_tests.rs`:

```rust
use tempfile::tempdir;

use crate::document::{
    document_fingerprint, read_document_file_sync, overwrite_document_file_sync,
    save_document_file_sync,
};

#[test]
fn read_document_file_accepts_markdown_and_returns_fingerprint() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "# Note\n").unwrap();

    let result = read_document_file_sync(file.to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.file_name, "note.md");
    assert_eq!(result.content, "# Note\n");
    assert_eq!(result.real_path, file.canonicalize().unwrap().to_string_lossy());
    assert!(!result.fingerprint.is_empty());
}

#[test]
fn read_document_file_rejects_mdx() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.mdx");
    std::fs::write(&file, "# Note\n").unwrap();

    let err = read_document_file_sync(file.to_string_lossy().into_owned()).unwrap_err();

    assert_eq!(err.error_code(), "unsupported_file_type");
}

#[test]
#[cfg(unix)]
fn read_document_file_resolves_symlink_to_real_path() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let target_dir = tempdir().unwrap();
    let target = target_dir.path().join("real.markdown");
    let link = root.path().join("link.md");
    std::fs::write(&target, "# Real\n").unwrap();
    symlink(&target, &link).unwrap();

    let result = read_document_file_sync(link.to_string_lossy().into_owned()).unwrap();

    assert_eq!(result.display_path, link.to_string_lossy());
    assert_eq!(result.real_path, target.canonicalize().unwrap().to_string_lossy());
    assert_eq!(result.content, "# Real\n");
}

#[test]
fn save_document_file_rejects_external_modification() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "first\n").unwrap();
    let opened = read_document_file_sync(file.to_string_lossy().into_owned()).unwrap();
    std::fs::write(&file, "external\n").unwrap();

    let err = save_document_file_sync(
        opened.real_path.clone(),
        "mine\n".to_string(),
        opened.fingerprint.clone(),
    )
    .unwrap_err();

    assert_eq!(err.error_code(), "external_modified");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "external\n");
}

#[test]
fn overwrite_document_file_writes_and_updates_fingerprint() {
    let root = tempdir().unwrap();
    let file = root.path().join("note.md");
    std::fs::write(&file, "first\n").unwrap();
    let opened = read_document_file_sync(file.to_string_lossy().into_owned()).unwrap();
    std::fs::write(&file, "external\n").unwrap();

    let saved = overwrite_document_file_sync(opened.real_path, "mine\n".to_string()).unwrap();

    assert_eq!(std::fs::read_to_string(&file).unwrap(), "mine\n");
    assert_eq!(saved.fingerprint, document_fingerprint(&file.canonicalize().unwrap()).unwrap());
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test document_file
cargo test read_document_file save_document_file overwrite_document_file
```

Expected: compile failure because `crate::document` and the tested functions do not exist.

- [ ] **Step 3: Add document result models**

Modify `src-tauri/src/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileResult {
    pub content: String,
    pub file_name: String,
    pub display_path: String,
    pub real_path: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveResult {
    pub fingerprint: String,
}
```

- [ ] **Step 4: Implement document file IO**

Create `src-tauri/src/document.rs`:

```rust
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::models::{DocumentFileResult, DocumentSaveResult, WorkspaceError};

#[tauri::command]
pub fn read_document_file(path: String) -> Result<DocumentFileResult, WorkspaceError> {
    read_document_file_sync(path)
}

#[tauri::command]
pub fn save_document_file(
    real_path: String,
    content: String,
    expected_fingerprint: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    save_document_file_sync(real_path, content, expected_fingerprint)
}

#[tauri::command]
pub fn overwrite_document_file(
    real_path: String,
    content: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    overwrite_document_file_sync(real_path, content)
}

pub fn read_document_file_sync(path: String) -> Result<DocumentFileResult, WorkspaceError> {
    let display_path = PathBuf::from(path);
    let real_path = fs::canonicalize(&display_path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "path_failed"
        };
        WorkspaceError::from_io(code, "failed to resolve document path", &error)
    })?;

    ensure_supported_markdown_document(&real_path)?;
    ensure_regular_file(&real_path)?;

    let mut file = open_document_for_read(&real_path)?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read document file", &error)
    })?;

    Ok(DocumentFileResult {
        content,
        file_name: real_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        display_path: path_to_string(&display_path),
        real_path: path_to_string(&real_path),
        fingerprint: document_fingerprint(&real_path)?,
    })
}

pub fn save_document_file_sync(
    real_path: String,
    content: String,
    expected_fingerprint: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    let path = canonicalize_existing_real_document_path(&real_path)?;
    let current_fingerprint = document_fingerprint(&path)?;

    if current_fingerprint != expected_fingerprint {
        return Err(WorkspaceError::new(
            "external_modified",
            "document changed on disk since it was opened or last saved",
        ));
    }

    write_document_file(&path, content)
}

pub fn overwrite_document_file_sync(
    real_path: String,
    content: String,
) -> Result<DocumentSaveResult, WorkspaceError> {
    let path = canonicalize_existing_real_document_path(&real_path)?;
    write_document_file(&path, content)
}

pub fn document_fingerprint(path: &Path) -> Result<String, WorkspaceError> {
    let bytes = fs::read(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "read_failed"
        };
        WorkspaceError::from_io(code, "failed to read document fingerprint", &error)
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn canonicalize_existing_real_document_path(path: &str) -> Result<PathBuf, WorkspaceError> {
    let path = fs::canonicalize(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "not_found"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "path_failed"
        };
        WorkspaceError::from_io(code, "failed to resolve document path", &error)
    })?;
    ensure_supported_markdown_document(&path)?;
    ensure_regular_file(&path)?;
    Ok(path)
}

fn write_document_file(path: &Path, content: String) -> Result<DocumentSaveResult, WorkspaceError> {
    ensure_supported_markdown_document(path)?;
    ensure_regular_file(path)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|error| {
            WorkspaceError::from_io("write_failed", "failed to open document file", &error)
        })?;
    file.write_all(content.as_bytes()).map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to write document file", &error)
    })?;
    file.sync_all().map_err(|error| {
        WorkspaceError::from_io("write_failed", "failed to sync document file", &error)
    })?;
    Ok(DocumentSaveResult {
        fingerprint: document_fingerprint(path)?,
    })
}

fn ensure_supported_markdown_document(path: &Path) -> Result<(), WorkspaceError> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if matches!(extension.as_deref(), Some("md" | "markdown")) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "unsupported_file_type",
            "document mode only supports .md and .markdown files",
        ))
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::metadata(path).map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to inspect document file", &error)
    })?;
    if metadata.is_file() {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "not_file",
            "document path is not a regular file",
        ))
    }
}

fn open_document_for_read(path: &Path) -> Result<fs::File, WorkspaceError> {
    fs::File::open(path).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to open document file", &error)
    })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
```

- [ ] **Step 5: Register module and commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod document;
```

Add test module:

```rust
#[cfg(test)]
mod document_tests;
```

Add to `tauri::generate_handler![...]`:

```rust
document::read_document_file,
document::save_document_file,
document::overwrite_document_file,
```

- [ ] **Step 6: Run targeted Rust tests**

Run:

```bash
cd src-tauri
cargo test document
```

Expected: all new document tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/document.rs src-tauri/src/document_tests.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "Add document mode file commands"
```

---

### Task 2: Window Session Registry And macOS Open Routing

**Files:**
- Create: `src-tauri/src/window_sessions.rs`
- Create: `src-tauri/src/window_sessions_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write failing Rust tests for session registry behavior**

Create `src-tauri/src/window_sessions_tests.rs`:

```rust
use std::path::PathBuf;

use crate::window_sessions::{normalize_opened_url_path, WindowSessionRegistry, WindowRole};

#[test]
fn registry_keeps_one_workspace_window() {
    let mut registry = WindowSessionRegistry::default();

    assert_eq!(registry.claim_workspace_window("workspace-main"), "workspace-main");
    assert_eq!(registry.claim_workspace_window("workspace-second"), "workspace-main");
    assert_eq!(registry.role_for_label("workspace-main"), Some(WindowRole::Workspace));
}

#[test]
fn registry_deduplicates_document_windows_by_real_path() {
    let mut registry = WindowSessionRegistry::default();
    let path = PathBuf::from("/tmp/a.md");

    assert_eq!(registry.claim_document_window(&path, "document-1"), "document-1");
    assert_eq!(registry.claim_document_window(&path, "document-2"), "document-1");
    assert_eq!(registry.role_for_label("document-1"), Some(WindowRole::Document));
}

#[test]
fn registry_removes_document_when_window_is_destroyed() {
    let mut registry = WindowSessionRegistry::default();
    let path = PathBuf::from("/tmp/a.md");
    registry.claim_document_window(&path, "document-1");

    registry.remove_label("document-1");

    assert_eq!(registry.claim_document_window(&path, "document-2"), "document-2");
}

#[test]
fn opened_url_path_accepts_file_urls_and_rejects_non_files() {
    let file_url = url::Url::from_file_path("/tmp/a.md").unwrap();
    let http_url = url::Url::parse("https://example.com/a.md").unwrap();

    assert_eq!(normalize_opened_url_path(&file_url), Some(PathBuf::from("/tmp/a.md")));
    assert_eq!(normalize_opened_url_path(&http_url), None);
}
```

- [ ] **Step 2: Add `url` dependency for tests/implementation if not re-exported by Tauri**

Modify `src-tauri/Cargo.toml` dependencies:

```toml
url = "2"
```

If `tauri::Url` is available and accepted by the compiler, use that instead and do not add `url`. The tests above should import the type actually used.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test window_sessions
```

Expected: compile failure because `window_sessions` does not exist.

- [ ] **Step 4: Implement pure window session registry**

Create `src-tauri/src/window_sessions.rs`:

```rust
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowRole {
    Workspace,
    Document,
}

#[derive(Debug, Default)]
pub struct WindowSessionRegistry {
    workspace_window_label: Option<String>,
    document_windows: BTreeMap<PathBuf, String>,
}

impl WindowSessionRegistry {
    pub fn claim_workspace_window(&mut self, requested_label: &str) -> String {
        if let Some(label) = &self.workspace_window_label {
            return label.clone();
        }
        self.workspace_window_label = Some(requested_label.to_string());
        requested_label.to_string()
    }

    pub fn claim_document_window(&mut self, real_path: &Path, requested_label: &str) -> String {
        if let Some(label) = self.document_windows.get(real_path) {
            return label.clone();
        }
        self.document_windows
            .insert(real_path.to_path_buf(), requested_label.to_string());
        requested_label.to_string()
    }

    pub fn role_for_label(&self, label: &str) -> Option<WindowRole> {
        if self.workspace_window_label.as_deref() == Some(label) {
            return Some(WindowRole::Workspace);
        }
        if self.document_windows.values().any(|value| value == label) {
            return Some(WindowRole::Document);
        }
        None
    }

    pub fn remove_label(&mut self, label: &str) {
        if self.workspace_window_label.as_deref() == Some(label) {
            self.workspace_window_label = None;
        }
        self.document_windows.retain(|_, window_label| window_label != label);
    }
}

pub fn normalize_opened_url_path(url: &url::Url) -> Option<PathBuf> {
    if url.scheme() != "file" {
        return None;
    }
    url.to_file_path().ok()
}

pub fn is_supported_document_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    matches!(extension.as_deref(), Some("md" | "markdown"))
}
```

- [ ] **Step 5: Register module and managed state**

Modify `src-tauri/src/lib.rs`:

```rust
mod window_sessions;
```

Add test module:

```rust
#[cfg(test)]
mod window_sessions_tests;
```

Add imports:

```rust
use std::sync::Mutex;
use window_sessions::WindowSessionRegistry;
```

In `.setup`, manage the registry before window creation:

```rust
app.manage(Mutex::new(WindowSessionRegistry::default()));
```

- [ ] **Step 6: Change default window config to manual creation**

Modify `src-tauri/tauri.conf.json` window config:

```json
"windows": [
  {
    "label": "workspace-main",
    "create": false,
    "title": "MDX",
    "url": "/",
    "width": 1280,
    "height": 820,
    "minWidth": 1100,
    "minHeight": 640,
    "resizable": true,
    "fullscreen": false
  }
]
```

This prevents cold single-file launches from creating a workspace window before the open-file event is handled.

- [ ] **Step 7: Add file association**

Modify `src-tauri/tauri.conf.json` under `bundle`:

```json
"fileAssociations": [
  {
    "ext": ["md", "markdown"],
    "name": "Markdown Document",
    "role": "Editor",
    "rank": "Alternate",
    "contentTypes": ["net.daringfireball.markdown", "public.plain-text"]
  }
]
```

Keep existing `active`, `targets`, and `icon`.

- [ ] **Step 8: Add first-pass runtime routing**

Modify `src-tauri/src/lib.rs`:

- Keep `new_workspace_window(app)` but make it use label `"workspace-main"` through the registry instead of `w{n}` for the Workspace window.
- Add `new_document_window(app, real_path)` that creates `document-{WIN_ID}` labels.
- Replace `.run(tauri::generate_context!())` with `.build(...).expect(...).run(|app, event| match event { ... })`.
- Handle:

```rust
tauri::RunEvent::Ready => {
    // If no document open event has created a document window yet, create/focus workspace window.
}
tauri::RunEvent::Opened { urls } => {
    // Convert file URLs to paths, filter .md/.markdown, canonicalize, claim/focus document windows.
}
tauri::RunEvent::Reopen { .. } => {
    // Focus/create workspace window.
}
tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
    // remove label from registry
}
_ => {}
```

Use the exact `RunEvent::Opened { urls }` API verified in `/Users/zhangyukun/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.10.3/src/app.rs`.

- [ ] **Step 9: Run targeted tests and config validation**

Run:

```bash
cd src-tauri
cargo test window_sessions
cd ..
npm run build
```

Expected:
- `cargo test window_sessions` passes.
- `npm run build` passes.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/window_sessions.rs src-tauri/src/window_sessions_tests.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Add window sessions and markdown file association"
```

---

### Task 3: AppShell Session Routing

**Files:**
- Create: `features/app/lib/app-session.ts`
- Create: `features/app/lib/app-session.test.ts`
- Create: `features/app/components/app-shell.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Write failing tests for app session normalization**

Create `features/app/lib/app-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeAppWindowSession } from "./app-session";

describe("normalizeAppWindowSession", () => {
    it("normalizes workspace sessions", () => {
        expect(normalizeAppWindowSession({ kind: "workspace" })).toEqual({
            kind: "workspace",
        });
    });

    it("normalizes document sessions", () => {
        expect(
            normalizeAppWindowSession({
                kind: "document",
                fileName: "Note.md",
                displayPath: "/tmp/link.md",
                realPath: "/tmp/Note.md",
            }),
        ).toEqual({
            kind: "document",
            fileName: "Note.md",
            displayPath: "/tmp/link.md",
            realPath: "/tmp/Note.md",
        });
    });

    it("falls back to document error for malformed document sessions", () => {
        expect(normalizeAppWindowSession({ kind: "document" })).toEqual({
            kind: "documentError",
            message: "无法打开文档。",
            path: null,
        });
    });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npx vitest run features/app/lib/app-session.test.ts
```

Expected: compile failure because `features/app/lib/app-session.ts` does not exist.

- [ ] **Step 3: Implement session types and normalization**

Create `features/app/lib/app-session.ts`:

```ts
export type AppWindowSession =
    | { kind: "workspace" }
    | {
          kind: "document";
          fileName: string;
          displayPath: string;
          realPath: string;
      }
    | {
          kind: "documentError";
          message: string;
          path: string | null;
      };

export function normalizeAppWindowSession(input: unknown): AppWindowSession {
    if (!input || typeof input !== "object" || !("kind" in input)) {
        return { kind: "workspace" };
    }

    const raw = input as Record<string, unknown>;

    if (raw.kind === "workspace") {
        return { kind: "workspace" };
    }

    if (
        raw.kind === "document" &&
        typeof raw.fileName === "string" &&
        typeof raw.displayPath === "string" &&
        typeof raw.realPath === "string"
    ) {
        return {
            kind: "document",
            fileName: raw.fileName,
            displayPath: raw.displayPath,
            realPath: raw.realPath,
        };
    }

    if (raw.kind === "documentError") {
        return {
            kind: "documentError",
            message:
                typeof raw.message === "string"
                    ? raw.message
                    : "无法打开文档。",
            path: typeof raw.path === "string" ? raw.path : null,
        };
    }

    return {
        kind: "documentError",
        message: "无法打开文档。",
        path: null,
    };
}
```

- [ ] **Step 4: Add frontend AppShell**

Create `features/app/components/app-shell.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { DocumentApp } from "@/features/document/components/document-app";
import { DocumentError } from "@/features/document/components/document-error";
import { WorkspaceApp } from "@/features/workspace/components/workspace-app";
import {
    normalizeAppWindowSession,
    type AppWindowSession,
} from "../lib/app-session";

export function AppShell() {
    const [session, setSession] = useState<AppWindowSession | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadSession() {
            if (!isTauriRuntime()) {
                setSession({ kind: "workspace" });
                return;
            }

            try {
                const { invoke } = await tauriCore();
                const rawSession = await invoke("get_window_session");
                if (!cancelled) {
                    setSession(normalizeAppWindowSession(rawSession));
                }
            } catch (error) {
                console.warn("Failed to load MDX window session.", error);
                if (!cancelled) {
                    setSession({ kind: "workspace" });
                }
            }
        }

        void loadSession();

        return () => {
            cancelled = true;
        };
    }, []);

    if (!session) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 text-sm text-base-content/70">
                正在打开 MDX...
            </main>
        );
    }

    if (session.kind === "document") {
        return <DocumentApp session={session} />;
    }

    if (session.kind === "documentError") {
        return <DocumentError session={session} />;
    }

    return <WorkspaceApp />;
}

function isTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
```

This references `DocumentApp` and `DocumentError`, which are created in Task 4. If TypeScript build is run before Task 4, add temporary minimal stubs exactly as described in Task 4 Step 3.

- [ ] **Step 5: Change Next page entry**

Modify `app/page.tsx`:

```tsx
import { AppShell } from "@/features/app/components/app-shell";

export default function Page() {
    return <AppShell />;
}
```

- [ ] **Step 6: Add backend session command**

Modify `src-tauri/src/lib.rs` to add a command:

```rust
#[tauri::command]
fn get_window_session(window: tauri::Window, state: tauri::State<'_, std::sync::Mutex<window_sessions::WindowSessionRegistry>>) -> serde_json::Value {
    let label = window.label().to_string();
    let registry = state.lock().expect("window session registry poisoned");

    match registry.session_for_label(&label) {
        Some(window_sessions::WindowSession::Document(session)) => serde_json::json!({
            "kind": "document",
            "fileName": session.file_name,
            "displayPath": session.display_path,
            "realPath": session.real_path,
        }),
        Some(window_sessions::WindowSession::DocumentError(session)) => serde_json::json!({
            "kind": "documentError",
            "message": session.message,
            "path": session.path,
        }),
        _ => serde_json::json!({ "kind": "workspace" }),
    }
}
```

If `WindowSessionRegistry` does not yet expose `session_for_label`, add that method in `src-tauri/src/window_sessions.rs` and test it.

Register command in `generate_handler!`.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run features/app/lib/app-session.test.ts
npm run build
cd src-tauri && cargo test window_sessions
```

Expected:
- app-session test passes.
- build passes after Document stubs from Task 4 are present or Task 4 is implemented immediately after.
- window session tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx features/app/lib/app-session.ts features/app/lib/app-session.test.ts features/app/components/app-shell.tsx src-tauri/src/lib.rs src-tauri/src/window_sessions.rs src-tauri/src/window_sessions_tests.rs
git commit -m "Route app windows by session"
```

---

### Task 4: DocumentShell MVP

**Files:**
- Create: `features/document/lib/types.ts`
- Create: `features/document/lib/document-state.ts`
- Create: `features/document/lib/document-state.test.ts`
- Create: `features/document/lib/document-client.ts`
- Create: `features/document/components/document-app.tsx`
- Create: `features/document/components/document-error.tsx`
- Create: `features/document/components/document-shell.tsx`
- Modify: `features/editor/components/editor-pane.tsx`

- [ ] **Step 1: Write failing document state tests**

Create `features/document/lib/document-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
    createLoadedDocumentState,
    documentWindowTitle,
    updateDocumentMarkdown,
    markDocumentSaved,
} from "./document-state";

describe("document-state", () => {
    it("tracks dirty state from markdown changes", () => {
        const loaded = createLoadedDocumentState({
            fileName: "Note.md",
            displayPath: "/tmp/Note.md",
            realPath: "/tmp/Note.md",
            content: "# Note\n",
            fingerprint: "a",
        });

        const dirty = updateDocumentMarkdown(loaded, "# Changed\n");

        expect(dirty.dirty).toBe(true);
        expect(documentWindowTitle(dirty)).toBe("● Note.md - MDX");
    });

    it("marks saved with a new fingerprint", () => {
        const dirty = updateDocumentMarkdown(
            createLoadedDocumentState({
                fileName: "Note.md",
                displayPath: "/tmp/Note.md",
                realPath: "/tmp/Note.md",
                content: "# Note\n",
                fingerprint: "a",
            }),
            "# Changed\n",
        );

        const saved = markDocumentSaved(dirty, "b");

        expect(saved.dirty).toBe(false);
        expect(saved.fingerprint).toBe("b");
        expect(documentWindowTitle(saved)).toBe("Note.md - MDX");
    });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npx vitest run features/document/lib/document-state.test.ts
```

Expected: compile failure because document state files do not exist.

- [ ] **Step 3: Add document types and state helpers**

Create `features/document/lib/types.ts`:

```ts
export interface DocumentSession {
    kind: "document";
    fileName: string;
    displayPath: string;
    realPath: string;
}

export interface DocumentFileResult {
    content: string;
    fileName: string;
    displayPath: string;
    realPath: string;
    fingerprint: string;
}

export interface DocumentSaveResult {
    fingerprint: string;
}

export interface LoadedDocumentState {
    fileName: string;
    displayPath: string;
    realPath: string;
    markdown: string;
    savedMarkdown: string;
    fingerprint: string;
    dirty: boolean;
    outlineCollapsed: boolean;
}
```

Create `features/document/lib/document-state.ts`:

```ts
import type { DocumentFileResult, LoadedDocumentState } from "./types";

export function createLoadedDocumentState(
    file: DocumentFileResult,
): LoadedDocumentState {
    return {
        fileName: file.fileName,
        displayPath: file.displayPath,
        realPath: file.realPath,
        markdown: file.content,
        savedMarkdown: file.content,
        fingerprint: file.fingerprint,
        dirty: false,
        outlineCollapsed: false,
    };
}

export function updateDocumentMarkdown(
    state: LoadedDocumentState,
    markdown: string,
): LoadedDocumentState {
    return {
        ...state,
        markdown,
        dirty: markdown !== state.savedMarkdown,
    };
}

export function markDocumentSaved(
    state: LoadedDocumentState,
    fingerprint: string,
): LoadedDocumentState {
    return {
        ...state,
        savedMarkdown: state.markdown,
        fingerprint,
        dirty: false,
    };
}

export function documentWindowTitle(state: LoadedDocumentState) {
    return `${state.dirty ? "● " : ""}${state.fileName} - MDX`;
}
```

- [ ] **Step 4: Implement document client**

Create `features/document/lib/document-client.ts`:

```ts
import { tauriCore } from "@/common/lib/tauri";
import type { DocumentFileResult, DocumentSaveResult } from "./types";

export async function readDocumentFile(path: string) {
    const { invoke } = await tauriCore();
    return invoke<DocumentFileResult>("read_document_file", { path });
}

export async function saveDocumentFile(
    realPath: string,
    content: string,
    expectedFingerprint: string,
) {
    const { invoke } = await tauriCore();
    return invoke<DocumentSaveResult>("save_document_file", {
        realPath,
        content,
        expectedFingerprint,
    });
}

export async function overwriteDocumentFile(realPath: string, content: string) {
    const { invoke } = await tauriCore();
    return invoke<DocumentSaveResult>("overwrite_document_file", {
        realPath,
        content,
    });
}
```

- [ ] **Step 5: Make `EditorPane` usable without CLI/wikilink**

Modify `features/editor/components/editor-pane.tsx`:

- Keep `rootPath` but allow it to be `string | null`.
- Make `pendingCliCommand`, `onPendingCliCommandHandled`, and `onSelectionChange` optional.
- Keep `onOpenWikilink` optional.
- In the `useEffect` that reports selection, no-op if `onSelectionChange` is missing.
- In the pending CLI `useEffect`, no-op if `pendingCliCommand` or handler is missing.

Patch shape:

```tsx
interface EditorPaneProps {
    rootPath: string | null;
    tab: WorkspaceTab;
    onMarkdownChange: (tabId: string, markdown: string) => void;
    editorViewportRef?: RefObject<HTMLDivElement | null>;
    pendingCliCommand?: PendingCliEditorCommand | null;
    onPendingCliCommandHandled?: (commandId: string) => void;
    onOpenWikilink?: (target: string, sourcePath: string) => void;
    onSelectionChange?: (
        tabId: string,
        selection: Record<string, unknown> | null,
    ) => void;
}
```

Update `imageLoader` call:

```tsx
imageLoader={(src) =>
    loadImage(src, {
        rootPath,
        currentFilePath: tab.path,
    })
}
```

This already supports `rootPath: null`.

- [ ] **Step 6: Create Document UI components**

Create `features/document/components/document-app.tsx`:

```tsx
"use client";

import type { AppWindowSession } from "@/features/app/lib/app-session";
import { AppDialogProvider } from "@/features/workspace/components/app-dialogs";
import { DocumentShell } from "./document-shell";

export function DocumentApp({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "document" }>;
}) {
    return (
        <AppDialogProvider>
            <DocumentShell session={session} />
        </AppDialogProvider>
    );
}
```

Create `features/document/components/document-error.tsx`:

```tsx
"use client";

import type { AppWindowSession } from "@/features/app/lib/app-session";
import { EmptyState, TextControlButton } from "@/common/components/ui-controls";

export function DocumentError({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "documentError" }>;
}) {
    return (
        <main className="flex h-screen items-center justify-center bg-base-100 px-6 text-base-content">
            <EmptyState
                title="无法打开 Markdown 文档"
                description={[session.message, session.path].filter(Boolean).join(" ")}
                actionLabel={null}
            />
        </main>
    );
}
```

Create `features/document/components/document-shell.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorPane } from "@/features/editor/components/editor-pane";
import type { AppWindowSession } from "@/features/app/lib/app-session";
import { parseMarkdownOutline } from "@/features/workspace/lib/outline";
import { scrollRenderedHeadingIntoView } from "@/features/workspace/lib/outline-scroll";
import { OutlinePanel } from "@/features/workspace/components/outline-panel";
import { IconButton } from "@/common/components/ui-controls";
import { useAppDialogs } from "@/features/workspace/components/app-dialogs";
import {
    createLoadedDocumentState,
    documentWindowTitle,
    markDocumentSaved,
    updateDocumentMarkdown,
} from "../lib/document-state";
import { overwriteDocumentFile, readDocumentFile, saveDocumentFile } from "../lib/document-client";
import type { LoadedDocumentState } from "../lib/types";

export function DocumentShell({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "document" }>;
}) {
    const dialogs = useAppDialogs();
    const editorViewportRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<LoadedDocumentState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void readDocumentFile(session.realPath)
            .then((file) => {
                if (!cancelled) {
                    setState(createLoadedDocumentState(file));
                    setError(null);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setError(formatError(error, "加载文档失败。"));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [session.realPath]);

    useEffect(() => {
        if (state && typeof document !== "undefined") {
            document.title = documentWindowTitle(state);
        }
    }, [state]);

    const headings = useMemo(
        () => (state ? parseMarkdownOutline(state.markdown) : []),
        [state],
    );

    const save = useCallback(async () => {
        if (!state || saving) {
            return false;
        }
        setSaving(true);
        try {
            const result = await saveDocumentFile(
                state.realPath,
                state.markdown,
                state.fingerprint,
            );
            setState((current) =>
                current ? markDocumentSaved(current, result.fingerprint) : current,
            );
            return true;
        } catch (error) {
            if (isExternalModifiedError(error)) {
                const overwrite = await dialogs.confirm({
                    title: "文件已被外部修改",
                    message: "磁盘上的文件已变化。是否用当前编辑内容覆盖保存？",
                    confirmLabel: "覆盖保存",
                    destructive: true,
                });
                if (!overwrite) {
                    return false;
                }
                const result = await overwriteDocumentFile(state.realPath, state.markdown);
                setState((current) =>
                    current ? markDocumentSaved(current, result.fingerprint) : current,
                );
                return true;
            }
            void dialogs.alert({
                title: "保存失败",
                message: formatError(error, "保存文档失败。"),
            });
            return false;
        } finally {
            setSaving(false);
        }
    }, [dialogs, saving, state]);

    if (error) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 px-6 text-sm text-error">
                {error}
            </main>
        );
    }

    if (!state) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 text-sm text-base-content/70">
                正在加载文档...
            </main>
        );
    }

    return (
        <main className="grid h-screen min-h-0 grid-rows-[44px_minmax(0,1fr)] bg-base-100 text-base-content">
            <header className="flex min-w-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
                <div className="min-w-0 truncate text-sm font-medium" title={state.displayPath}>
                    {state.dirty ? "● " : ""}{state.fileName}
                </div>
                <div className="flex items-center gap-2">
                    <IconButton label="保存" title="保存" icon="💾" onClick={() => void save()} />
                    <IconButton
                        label={state.outlineCollapsed ? "展开目录" : "收起目录"}
                        title={state.outlineCollapsed ? "展开目录" : "收起目录"}
                        icon="☰"
                        onClick={() =>
                            setState((current) =>
                                current
                                    ? { ...current, outlineCollapsed: !current.outlineCollapsed }
                                    : current,
                            )
                        }
                    />
                </div>
            </header>
            <div
                className="grid min-h-0"
                style={{
                    gridTemplateColumns: state.outlineCollapsed
                        ? "minmax(0,1fr) 0px"
                        : "minmax(0,1fr) 280px",
                }}
            >
                <section className="min-h-0 overflow-hidden">
                    <EditorPane
                        rootPath={null}
                        tab={{
                            tabId: "document",
                            path: state.realPath,
                            title: state.fileName,
                            dirty: state.dirty,
                            needsRenameOnFirstSave: false,
                            markdown: state.markdown,
                        }}
                        onMarkdownChange={(_, markdown) =>
                            setState((current) =>
                                current
                                    ? updateDocumentMarkdown(current, markdown)
                                    : current,
                            )
                        }
                        editorViewportRef={editorViewportRef}
                    />
                </section>
                <OutlinePanel
                    headings={headings}
                    collapsed={state.outlineCollapsed}
                    onHeadingClick={(_, index) =>
                        scrollRenderedHeadingIntoView(editorViewportRef.current, index)
                    }
                    resizeHandleProps={{}}
                />
            </div>
        </main>
    );
}

function isExternalModifiedError(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        "errorCode" in error &&
        error.errorCode === "external_modified"
    );
}

function formatError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return `${fallback} ${error.message}`;
    if (typeof error === "string" && error) return `${fallback} ${error}`;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return `${fallback} ${error.message}`;
    }
    return fallback;
}
```

Use lucide only if already available. It is not in current dependencies, so this plan keeps existing `IconButton` pattern.

- [ ] **Step 7: Run targeted frontend tests**

Run:

```bash
npx vitest run features/document/lib/document-state.test.ts features/app/lib/app-session.test.ts
npm run build
```

Expected: tests pass and Next build passes.

- [ ] **Step 8: Commit**

```bash
git add features/document features/editor/components/editor-pane.tsx features/app app/page.tsx
git commit -m "Add document mode shell"
```

---

### Task 5: Document Close Guard, Menu Events, And Workspace Window Reuse

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `features/document/components/document-shell.tsx`
- Modify: `features/workspace/components/workspace-app.tsx`
- Test: `features/document/lib/document-state.test.ts`

- [ ] **Step 1: Add failing tests for close choice state helper**

Extend `features/document/lib/document-state.test.ts`:

```ts
import { canCloseDocumentWithoutPrompt } from "./document-state";

it("requires a close prompt only when dirty", () => {
    const clean = createLoadedDocumentState({
        fileName: "Note.md",
        displayPath: "/tmp/Note.md",
        realPath: "/tmp/Note.md",
        content: "# Note\n",
        fingerprint: "a",
    });
    const dirty = updateDocumentMarkdown(clean, "# Changed\n");

    expect(canCloseDocumentWithoutPrompt(clean)).toBe(true);
    expect(canCloseDocumentWithoutPrompt(dirty)).toBe(false);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npx vitest run features/document/lib/document-state.test.ts
```

Expected: failure because `canCloseDocumentWithoutPrompt` is not exported.

- [ ] **Step 3: Implement close helper**

Modify `features/document/lib/document-state.ts`:

```ts
export function canCloseDocumentWithoutPrompt(state: LoadedDocumentState) {
    return !state.dirty;
}
```

- [ ] **Step 4: Add DocumentShell close-request handling**

Modify `features/document/components/document-shell.tsx`:

- Listen to `getCurrentWindow().onCloseRequested`.
- If clean, allow close.
- If dirty, `event.preventDefault()`, show `dialogs.choice` with 保存 / 丢弃 / 取消.
- Save then close if save succeeds; discard closes; cancel does nothing.
- Use a `closingRef` guard to avoid repeated prompts.

Code shape:

```tsx
useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
            const current = stateRef.current;
            if (!current || !current.dirty || closingRef.current) return;
            event.preventDefault();
            closingRef.current = true;
            void dialogs.choice({
                title: "未保存更改",
                message: `“${current.fileName}” 有未保存更改。请选择保存、丢弃或取消。`,
                choices: [
                    { label: "保存", value: "save" },
                    { label: "丢弃", value: "discard", destructive: true },
                ],
                cancelLabel: "取消",
            }).then(async (choice) => {
                if (choice === "discard") {
                    await getCurrentWindow().close();
                    return;
                }
                if (choice === "save" && await saveRef.current()) {
                    await getCurrentWindow().close();
                    return;
                }
                closingRef.current = false;
            });
        }),
    ).then((fn) => {
        unlisten = fn;
        if (disposed) unlisten();
    });
    return () => {
        disposed = true;
        unlisten?.();
    };
}, [dialogs]);
```

- [ ] **Step 5: Add document menu listeners**

Modify `features/document/components/document-shell.tsx`:

- Listen for `mdx-menu-save` and call `save`.
- Listen for `mdx-menu-open-folder` and invoke a new Tauri command `focus_or_create_workspace_window` then emit/handle workspace choose event.

Frontend code shape:

```tsx
useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
        unlisteners.push(
            await listen("mdx-menu-save", () => void saveRef.current()),
            await listen("mdx-menu-open-folder", () => void focusWorkspaceAndChooseFolder()),
        );
        if (disposed) unlisteners.forEach((unlisten) => unlisten());
    });
    return () => {
        disposed = true;
        unlisteners.forEach((unlisten) => unlisten());
    };
}, []);
```

- [ ] **Step 6: Implement role-aware menu dispatch in Rust**

Modify `src-tauri/src/lib.rs`:

- `emit_menu_event` should inspect focused window label and registry role.
- For Document role:
  - allow `open-folder` → `mdx-menu-open-folder`
  - allow `save` → `mdx-menu-save`
  - route close via native window close or emit `mdx-menu-close-window`
  - ignore workspace-only events.
- For Workspace role:
  - preserve current behavior.

Add `focus_or_create_workspace_window` command:

```rust
#[tauri::command]
fn focus_or_create_workspace_window(app: AppHandle) -> Result<(), WorkspaceError> {
    focus_or_create_workspace_window_impl(&app)
}
```

Make it create or focus the unique workspace window and emit `mdx-menu-open-folder` to it.

- [ ] **Step 7: Ensure WorkspaceApp still handles open folder**

Modify `features/workspace/components/workspace-app.tsx` only if event naming changed. It already listens to `mdx-menu-open-folder`; keep this behavior.

- [ ] **Step 8: Run verification**

Run:

```bash
npx vitest run features/document/lib/document-state.test.ts
npm run build
cd src-tauri && cargo test window_sessions
```

Expected: tests and build pass.

- [ ] **Step 9: Commit**

```bash
git add features/document/lib/document-state.ts features/document/lib/document-state.test.ts features/document/components/document-shell.tsx features/workspace/components/workspace-app.tsx src-tauri/src/lib.rs
git commit -m "Wire document mode close and menu actions"
```

---

### Task 6: Document Image Assets

**Files:**
- Modify: `src-tauri/src/assets.rs`
- Modify: `src-tauri/src/assets_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `common/lib/image-storage.ts`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/document/components/document-shell.tsx`

- [ ] **Step 1: Add failing Rust asset tests**

Extend `src-tauri/src/assets_tests.rs`:

```rust
use crate::assets::save_document_image_asset_with_global_assets_dir;

#[test]
fn save_document_image_asset_prefers_sibling_assets_directory() {
    let root = tempfile::tempdir().unwrap();
    let document = root.path().join("Note.md");
    std::fs::write(&document, "# Note\n").unwrap();
    let global = tempfile::tempdir().unwrap();

    let result = save_document_image_asset_with_global_assets_dir(
        document.to_string_lossy().into_owned(),
        "image.png".to_string(),
        vec![1, 2, 3],
        global.path(),
    )
    .unwrap();

    assert!(!result.used_fallback);
    assert!(result.markdown_path.starts_with(".assets/"));
    assert!(root.path().join(&result.markdown_path).is_file());
}

#[test]
fn save_document_image_asset_falls_back_when_document_parent_is_not_writable() {
    let root = tempfile::tempdir().unwrap();
    let missing_document = root.path().join("missing").join("Note.md");
    let global = tempfile::tempdir().unwrap();

    let result = save_document_image_asset_with_global_assets_dir(
        missing_document.to_string_lossy().into_owned(),
        "image.png".to_string(),
        vec![1, 2, 3],
        global.path(),
    )
    .unwrap();

    assert!(result.used_fallback);
    assert!(std::path::Path::new(&result.markdown_path).is_absolute());
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test save_document_image_asset
```

Expected: compile failure because document asset functions do not exist.

- [ ] **Step 3: Implement document asset save command**

Modify `src-tauri/src/assets.rs`:

```rust
#[tauri::command]
pub fn save_document_image_asset(
    document_path: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    save_document_image_asset_impl(document_path, name, bytes, None)
}

fn save_document_image_asset_impl(
    document_path: String,
    name: String,
    bytes: Vec<u8>,
    global_assets_dir: Option<&Path>,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    let extension = image_extension(&name)?;
    let filename = format!("{}.{}", sha256_hex(&bytes), extension);

    if let Ok(result) = save_document_sibling_asset(&document_path, &filename, &bytes) {
        return Ok(result);
    }

    save_global_asset(&filename, &bytes, global_assets_dir)
}

#[cfg(test)]
pub fn save_document_image_asset_with_global_assets_dir(
    document_path: String,
    name: String,
    bytes: Vec<u8>,
    global_assets_dir: &Path,
) -> Result<SaveImageAssetResult, WorkspaceError> {
    save_document_image_asset_impl(document_path, name, bytes, Some(global_assets_dir))
}

fn save_document_sibling_asset(
    document_path: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<SaveImageAssetResult, WorkspaceError> {
    let document_path = PathBuf::from(document_path);
    let parent = document_path.parent().ok_or_else(|| {
        WorkspaceError::new("outside_workspace", "document path has no parent")
    })?;
    let parent = fs::canonicalize(parent).map_err(|error| {
        WorkspaceError::from_io(
            "asset_write_failed",
            "failed to resolve document asset parent directory",
            &error,
        )
    })?;
    let assets_dir = parent.join(".assets");
    let stored_path = write_deduped_asset(&assets_dir, filename, bytes)?;
    Ok(SaveImageAssetResult {
        markdown_path: format!(".assets/{filename}"),
        stored_path: path_to_string(&stored_path),
        used_fallback: false,
    })
}
```

Register `assets::save_document_image_asset` in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Add frontend image storage helper**

Modify `common/lib/image-storage.ts`:

```ts
export async function storeImageForDocument(
    file: File,
    options: {
        documentPath: string;
        invoke?: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
    },
): Promise<StoredWorkspaceImage> {
    const ext = extOf(file);
    const name = file.name || `image.${ext}`;
    const altText = name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { invoke } = options.invoke
        ? { invoke: options.invoke }
        : await tauriCore();
    const response = await invoke<SaveImageAssetResponse>(
        "save_document_image_asset",
        {
            documentPath: options.documentPath,
            name,
            bytes,
        },
    );
    return {
        url: response.markdownPath,
        altText,
        storedPath: response.storedPath,
        usedFallback: response.usedFallback,
    };
}
```

- [ ] **Step 5: Let EditorPane receive a custom image saver**

Modify `features/editor/components/editor-pane.tsx` props:

```ts
storeImage?: (file: File) => Promise<{ url: string; altText: string }>;
```

Pass it to `DOMDProvider` if the kernel supports a save/store image prop. If the kernel only uses global `storeImage`, inspect `editor-kernel-adapter.tsx` and adapt the correct prop. Do not add Document Mode image code in WorkspaceShell.

- [ ] **Step 6: Wire DocumentShell to document asset helper**

Modify `features/document/components/document-shell.tsx`:

```tsx
import { storeImageForDocument } from "@/common/lib/image-storage";
```

Pass to `EditorPane`:

```tsx
storeImage={(file) =>
    storeImageForDocument(file, { documentPath: state.realPath })
}
```

- [ ] **Step 7: Run verification**

Run:

```bash
cd src-tauri && cargo test save_document_image_asset
cd ..
npm run build
npm test
```

Expected: targeted asset tests pass, build passes, frontend tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/assets.rs src-tauri/src/assets_tests.rs src-tauri/src/lib.rs common/lib/image-storage.ts features/editor/components/editor-pane.tsx features/document/components/document-shell.tsx
git commit -m "Save document images beside markdown files"
```

---

### Task 7: Cross-Mode Dirty Warning And Workspace Compatibility

**Files:**
- Modify: `src-tauri/src/cli_server.rs` only if shared snapshot is reused; otherwise avoid.
- Modify: `src-tauri/src/lib.rs`
- Modify: `features/workspace/components/workspace-shell.tsx`
- Modify: `features/document/components/document-shell.tsx`
- Create or modify tests only around pure helper if extracted.

- [ ] **Step 1: Add a pure helper for dirty path detection**

If no suitable helper exists, create `features/workspace/lib/dirty-paths.ts`:

```ts
import type { WorkspaceState } from "./types";

export function dirtyWorkspacePaths(workspace: WorkspaceState) {
    return Object.values(workspace.tabs)
        .filter((tab) => tab.dirty)
        .map((tab) => tab.path);
}
```

Add `features/workspace/lib/dirty-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";
import { dirtyWorkspacePaths } from "./dirty-paths";

describe("dirtyWorkspacePaths", () => {
    it("returns dirty tab paths only", () => {
        let state = createWorkspaceState("/tmp/ws");
        state = workspaceReducer(state, {
            type: "tab/opened",
            tab: {
                tabId: "a",
                path: "/tmp/ws/A.md",
                title: "A.md",
                dirty: false,
                needsRenameOnFirstSave: false,
                markdown: "A",
            },
        });
        state = workspaceReducer(state, {
            type: "tab/contentChanged",
            tabId: "a",
            markdown: "changed",
        });

        expect(dirtyWorkspacePaths(state)).toEqual(["/tmp/ws/A.md"]);
    });
});
```

- [ ] **Step 2: Run helper test**

```bash
npx vitest run features/workspace/lib/dirty-paths.test.ts
```

Expected: fails until helper exists, then passes.

- [ ] **Step 3: Emit dirty workspace path snapshots to Rust or global event**

Preferred low-scope implementation:

- In `WorkspaceShell`, when workspace state changes, emit a Tauri event/command `workspace-dirty-paths-changed` with `{ paths }`.
- Rust stores current dirty paths in managed state keyed by real/canonical path.
- When creating a Document window, Rust includes `workspaceDirty: true` in session if same path is dirty.

If canonicalizing on frontend is awkward, send raw paths and canonicalize in Rust.

- [ ] **Step 4: Show one-time Document warning**

Modify `features/app/lib/app-session.ts` document session to include:

```ts
workspaceDirty?: boolean;
```

Modify `DocumentShell`:

```tsx
useEffect(() => {
    if (!session.workspaceDirty) return;
    void dialogs.alert({
        title: "工作区中有未保存版本",
        message: "这个文件已在工作区标签页中打开且有未保存修改。单文档窗口不会自动同步该内容。",
    });
}, [dialogs, session.workspaceDirty]);
```

- [ ] **Step 5: Verify Workspace Mode still opens Markdown inside tabs**

Run existing tests:

```bash
npx vitest run features/workspace/lib/workspace-reducer.test.ts
npm test
cd src-tauri && cargo test
```

Expected: all pass. Manually confirm no plan step changed FileTreePanel open behavior.

- [ ] **Step 6: Commit**

```bash
git add features/workspace/lib/dirty-paths.ts features/workspace/lib/dirty-paths.test.ts features/workspace/components/workspace-shell.tsx features/app/lib/app-session.ts features/document/components/document-shell.tsx src-tauri/src/lib.rs
git commit -m "Warn when document is dirty in workspace"
```

---

### Task 8: Docs, Full Verification, And macOS Packaging Check

**Files:**
- Modify: `README.zh-CN.md`
- Modify: `README.md`
- Modify: any user-facing release/build docs if needed.

- [ ] **Step 1: Update README.zh-CN.md positioning**

Change the opening to:

```md
**MDX 是一个本地优先 Markdown 应用，提供单文档编辑和文件夹工作区两种模式。**
```

Add a section:

```md
## 两种模式

- Document Mode：从 Finder 或系统“打开方式”打开单个 `.md` / `.markdown` 文件时进入。界面只包含 Markdown 编辑器和当前文档目录，不显示文件树、标签页或 LLM Wiki。
- Workspace Mode：直接启动 MDX、恢复最近工作区，或在应用内打开文件夹时进入。界面包含文件树、多标签、目录和可选 LLM Wiki 知识库能力。

Document Mode 不参与 `mdx-cli` 自动化，不恢复为最近工作区，也不支持 `.mdx`。
```

Update existing “功能/范围” bullets so they distinguish Document Mode and Workspace Mode.

- [ ] **Step 2: Update README.md consistently**

If it is a translation of README.zh-CN.md, update it with equivalent mode descriptions. If it is intentionally minimal, add a short “Modes” section with the same constraints.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm test
npm run build
cd src-tauri && cargo test
cd .. && npx tauri build
```

Expected:
- Vitest passes.
- Next build passes.
- Rust tests pass.
- Tauri app bundles successfully.

- [ ] **Step 4: Inspect macOS bundle file association**

Run after `npx tauri build`:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes' src-tauri/target/release/bundle/macos/MDX.app/Contents/Info.plist
```

Expected: output includes `md` and `markdown` extensions and Editor role.

- [ ] **Step 5: Manual smoke checklist**

Run or verify manually:

```bash
open src-tauri/target/release/bundle/macos/MDX.app
```

Expected: Workspace Mode opens/restores; no Document Mode.

Then create a temp Markdown file:

```bash
tmpfile="$(mktemp /tmp/mdx-doc-XXXXXX.md)"
printf '# Smoke\n' > "$tmpfile"
open -a src-tauri/target/release/bundle/macos/MDX.app "$tmpfile"
```

Expected:
- Document window opens.
- No file tree.
- No LLM Wiki tab.
- Outline shows `Smoke`.
- Cmd+S saves.

- [ ] **Step 6: Commit**

```bash
git add README.zh-CN.md README.md
git commit -m "Document MDX dual modes"
```

- [ ] **Step 7: Final push**

```bash
git status --short
git push origin main
```

Expected:
- `git status --short` is clean before push.
- Push updates `origin/main`.

---

## Required Final Verification Before Completion

Before claiming completion after executing this plan, run:

```bash
npm test
npm run build
cd src-tauri && cargo test
cd .. && npx tauri build
```

Report exact pass/fail counts from Vitest and Cargo, and list the generated app/DMG paths from `npx tauri build`.

## Self-Review

- Spec coverage:
  - Document Mode entry, no file tree/LLM Wiki, single window per file: Tasks 2, 3, 4.
  - Workspace Mode direct launch and unique main window: Tasks 2, 5.
  - macOS file association and open-file event: Tasks 2, 8.
  - Document save, dirty title, close guard, external modification conflict: Tasks 1, 4, 5.
  - Document image asset strategy: Task 6.
  - CLI remains Workspace-only: Tasks 2, 7 avoid CLI protocol changes.
  - README/product docs: Task 8.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency:
  - Rust `DocumentFileResult` and TS `DocumentFileResult` both use camelCase fields from serde.
  - `AppWindowSession` is the frontend equivalent of Rust window session command output.
  - `WorkspaceState` is not reused for Document Mode.
- Design drift:
  - The plan does not add Document multi-tab, autosave, realtime file watching, `.mdx`, or CLI support.
