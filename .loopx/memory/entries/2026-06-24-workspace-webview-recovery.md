# Workspace WebView Recovery Guard

Workspace stale-WebView recovery is allowed to auto-reload only when the cached workspace snapshot has a root path and no dirty tabs.

If any cached tab is dirty, native recovery must skip `window.reload()` and preserve user data over automatic blank-screen recovery. The frontend draft autosave path is delayed and cannot be assumed durable when the renderer is stale.

Evidence:

- `.loopx/issues/issue-llm-wiki-background-white-screen-20260624T095432.md`
- `src-tauri/src/cli_server.rs`
- `src-tauri/src/lib.rs`
- final review finding on dirty-draft reload safety
