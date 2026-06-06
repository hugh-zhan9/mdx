# Wikilink Log Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `[[...]]` wikilinks like normal links while keeping saved Markdown unchanged, and make llm-wiki log updates visible in open documents.

**Architecture:** Add an editor-side Markdown adapter that converts wikilinks to temporary `mdx-wikilink:` Markdown links before passing content to the closed editor kernel, then converts them back when reading Markdown out. Add a CLI file-updated event for `log.md` writes and a frontend helper that reloads a clean open tab from disk.

**Tech Stack:** Next.js, React, Vitest, Tauri Rust commands, existing workspace reducer and CLI event wiring.

---

### Task 1: Wikilink Editor Adapter

**Files:**
- Create: `features/editor/lib/wikilink-markdown.ts`
- Test: `features/editor/lib/wikilink-markdown.test.ts`
- Modify: `features/editor/hooks/use-editor-bridge.ts`

- [ ] Write failing Vitest tests for `renderWikilinksForEditor` and `restoreWikilinksFromEditor`.
- [ ] Run `npx vitest run features/editor/lib/wikilink-markdown.test.ts` and confirm the module is missing.
- [ ] Implement the adapter: transform wikilinks outside inline code and fenced code blocks to `[label](mdx-wikilink:encoded-target)`, and restore those temporary links back to `[[target]]`.
- [ ] Hook the adapter into `useEditorBridge`: transform inbound `markdown` before `resetMD`, and restore outbound `toMarkdown(renderData)` before dirty/CLI sync.
- [ ] Run the focused Vitest file and existing editor pane tests.

### Task 2: LLM Wiki Log Visibility

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/cli_server.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`
- Modify: `features/workspace/lib/types.ts`
- Create: `features/workspace/lib/cli-file-updated.ts`
- Test: `features/workspace/lib/cli-file-updated.test.ts`
- Modify: `features/workspace/components/workspace-shell.tsx`

- [ ] Write failing Rust test proving `llm_wiki_search` appends `- search ...` to `log.md`.
- [ ] Write failing Vitest test proving a clean open `log.md` tab is refreshed from disk when a CLI file-updated event arrives, while dirty tabs are not overwritten.
- [ ] Add `append_log_entry(&root, ...)` to `llm_wiki_search`.
- [ ] Add a `cli-file-updated` event payload and emit it after CLI query/search succeeds for `log.md`.
- [ ] Add frontend event handling that reloads a matching clean tab from disk and dispatches `tab/saved`.
- [ ] Run focused Rust and Vitest tests.

### Task 3: Verification

**Files:**
- No additional files.

- [ ] Run `npm run test -- features/editor/lib/wikilink-markdown.test.ts features/workspace/lib/cli-file-updated.test.ts`.
- [ ] Run `npm run test`.
- [ ] Run `cd src-tauri && cargo test`.
- [ ] Run `npm run build`.
