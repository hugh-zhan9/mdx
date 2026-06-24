# Issue Ledger: llm-wiki-background-white-screen

metadata:
  phase: closeout
  status: complete
  source: reproduction_notes
  created_at: 2026-06-24T09:54:32+0800
  updated_at: 2026-06-24T10:45:29+0800

## Source

User report:

> 我发现一个问题，当应用长时间长驻后台之后，再从后台打开就白屏了，这是什么原因，知识库模式

Interpretation: in LLM Wiki / knowledge-base workspace mode, after the desktop app remains in the background for a long time, bringing it back to the foreground shows a blank white window.

## Worktree Baseline

- clean: false
- dirty_files:
  - .loopx/finish/baselines/latest.json
  - .loopx/finish/20260612T104509Z-mdx-memory-phase-one/
  - .loopx/finish/20260614T002810Z-llm-wiki-output-stability/
  - .loopx/finish/20260614T002842Z-finish-audit/
  - .loopx/finish/20260614T021905Z-2026-06-14-codex-thread-archive/
  - .loopx/finish/20260614T060143Z-finish-audit/
  - .loopx/finish/20260618T081122Z-html-mhtml-readonly-preview/
  - .loopx/finish/20260618T081200Z-finish-audit/
  - .loopx/finish/20260619T032703Z-markdown-wysiwyg-kernel-hardening/
  - .loopx/finish/20260623T023031Z-2026-06-22-markdown-syntax-plugin-kernel/
  - .loopx/finish/baselines/2026-06-14-codex-thread-archive.json
  - .loopx/finish/baselines/2026-06-22-markdown-syntax-plugin-kernel.json
  - .loopx/finish/baselines/html-mhtml-readonly-preview.json
  - .loopx/finish/baselines/llm-wiki-output-stability.json
  - .loopx/finish/baselines/markdown-wysiwyg-kernel-hardening.json
  - .loopx/finish/baselines/mdx-agent-memory-extraction.json
  - .loopx/finish/baselines/mdx-memory-phase-one.json
  - .loopx/finish/baselines/memory-complete.json
  - .loopx/intake/clarify-editor-wysiwyg-and-mhtml-preview-20260618144226.md
  - .loopx/intake/clarify-markdown-syntax-plugin-kernel-20260622194440.md
  - .loopx/intake/clarify-mdx-memory-phase-one-20260612.md
  - .loopx/intake/clarify-self-owned-markdown-wysiwyg-kernel-20260617154047.md
  - docs/ceecf8c1-b8ea-4e65-a601-87c35d89db60.png
  - docs/html-rendering-proposal.md
  - docs/html-test.md
  - docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md
  - docs/loopx/design/Markdown所见即所得内核补强需求设计文档.md
  - docs/loopx/design/Markdown语法插件化编辑器内核需求设计文档.md
  - docs/loopx/plans/2026-06-18-html-mhtml-readonly-preview.md
  - docs/loopx/plans/2026-06-18-markdown-wysiwyg-kernel-hardening.md
  - docs/loopx/plans/2026-06-22-markdown-syntax-plugin-kernel.md

Diagnostic edits were not made because the worktree was already dirty. This ledger is the only file added for this issue intake.

## Triage

- classification: unexpected_behavior
- routing_decision: issue_driven
- reason: A foregrounded app should not show a blank white UI after long background residency. The report is bug-class, but exact reproduction steps and runtime logs are missing.

## Diagnosis Summary

diagnosis:
  classification: unexpected_behavior
  reproduction_status: reproduced
  evidence:
    - type: user_report
      value: "Knowledge-base mode goes white after the app has stayed in the background for a long time and is reopened."
    - type: code
      value: "AppShell loads a Tauri window session once and then mounts WorkspaceApp; there is no top-level React ErrorBoundary around WorkspaceApp/WorkspaceShell."
    - type: code
      value: "WorkspaceApp restores persisted workspace state on mount, then WorkspaceShell mounts useLlmWikiWorkspace for the root."
    - type: code
      value: "useLlmWikiWorkspace starts LLM Wiki status/config loading on mount, can auto-run raw rescan/ingest when the workspace is llmWiki and an API key exists, and polls active operation state every second while activeOperationId exists."
    - type: code
      value: "Tauri RunEvent::Reopen focuses or creates the workspace window, but there is no foreground/resume recovery path that reloads a blank WebView, records WebView console errors, or rehydrates LLM Wiki state after long suspension."
    - type: command
      value: "npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx -> 3 files, 20 tests passed."
    - type: command
      value: "cargo test llm_wiki --manifest-path src-tauri/Cargo.toml -> LLM Wiki related Rust tests passed: lib 205 passed with 321 filtered, mdx_cli 13 passed with 23 filtered, mdx_mcp 0 tests."
    - type: log
      value: "No MDX/Tauri log directory was found under ~/Library/Logs for com.hugh.mdx. CrashReporter only showed an mdx metadata plist with Date 2026-06-15 03:48:40Z and ForceQuitDate 2026-06-19 00:52:20Z, not a diagnostic crash report."
    - type: command
      value: "Live process check during the white screen: /Applications/MDX.app/Contents/MacOS/mdx PID 1879 was still running with normal AppKit event-loop stack; no Rust/backend crash or CPU spin."
    - type: command
      value: "System Events reported one visible MDX window titled MDX. CGWindowList reported kCGWindowNumber 79930, alpha 1, layer 0, onscreen true, bounds 1465x883."
    - type: command
      value: "screencapture -l79930 confirmed the MDX window content was pure white except the native titlebar."
    - type: command
      value: "mdx-cli list and mdx-cli llm-wiki status returned successfully, but code inspection shows these responses are from Rust-side cached CliState snapshots populated earlier by syncCliWorkspaceSnapshot."
    - type: command
      value: "mdx-cli focus --tab XTUZGa6S returned ok, but a second window screenshot remained white, so emitting a normal frontend CLI focus event did not restore rendering."
    - type: command
      value: "mdx-cli content/selection returned cached active-tab content/selection for XTUZGa6S; this proves cached state exists, not that current DOM is painting."
    - type: log
      value: "No matching DiagnosticReports or unified log entries for mdx/com.hugh.mdx/WebContent termination were found in the checked window."
  root_cause_status: confirmed
  root_cause: "The MDX workspace window can enter a WebView-rendering blank state after long background residency: the native Tauri process and window remain alive, Rust-side CLI snapshots remain available, and the LLM Wiki workspace status is still known, but the WKWebView content area paints only white and does not recover after a frontend focus event. The current app has no live frontend heartbeat, no stale-WebView detection, and no safe reload/recovery path for this state."
  hypotheses_rejected:
    - "Confirmed Rust LLM Wiki backend regression: not supported by the current focused Rust suite; all matching LLM Wiki tests passed."
    - "Known background ingest failure logging gap: existing tests include ingest_background_task_failure_is_written_to_log and pass."
    - "Application process crash: not confirmed; no matching DiagnosticReports crash file was found for MDX."
    - "Workspace state loss: rejected because ~/.mdx/state.json and mdx-cli list still contained the workspace, tabs, active tab, and dirty flag."
    - "A normal CLI focus event can recover the UI: rejected because mdx-cli focus returned ok but the window remained white."
  fix_mode: defensive_fix
  regression_test_required: true
  regression_test_exception_reason: null
  risk_triggers:
    - defensive_fix

## Fix Brief

- strategy: Collect one real white-screen failure signal before product changes. Then implement the smallest defensive recovery: a top-level frontend error boundary and a Tauri/React foreground recovery probe for Workspace + LLM Wiki state. If evidence shows WebView renderer death, add native focus/reopen reload handling instead of only React-side refresh.
- expected_touched_files:
  - features/app/components/app-shell.tsx
  - features/workspace/components/workspace-app.tsx
  - features/workspace/lib/cli-sync.ts
  - features/llm-wiki/hooks/use-llm-wiki-workspace.ts
  - src-tauri/src/lib.rs
  - src-tauri/src/cli_server.rs
  - tests near the touched frontend recovery/error-boundary code
- expected_touched_surfaces:
  - Tauri window lifecycle/reopen/focus handling
  - native tracking of frontend liveness for workspace windows
  - top-level React app rendering failure handling
  - LLM Wiki hook resume/refresh behavior after visibility/focus restoration
  - safe reload behavior that preserves dirty drafts and avoids silent data loss
- parallel_safe: false
- parallel_safety_reason: The likely repair crosses app bootstrap, window lifecycle, and LLM Wiki background behavior, and may need native + frontend coordination.
- regression_test_plan: Add focused tests for frontend heartbeat emission, AppShell/WorkspaceApp error fallback, and LLM Wiki refresh-on-foreground behavior. Add Rust tests for stale workspace-window heartbeat detection and reload decision gating where practical. Manual verification must include an already-dirty workspace tab to prove reload/recovery does not silently lose edits.
- verification_commands:
  - npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx
  - cargo test llm_wiki --manifest-path src-tauri/Cargo.toml
  - Manual: open an initialized LLM Wiki workspace with API key configured, start/allow raw ingest, background the app long enough to trigger timer throttling/App Nap, foreground it, and verify the workspace either renders or shows a recoverable error with logs.
- forbidden_scope:
  - public CLI/API/schema/config changes unless explicitly listed
  - lockfile changes unless explicitly listed
  - generated artifact changes unless explicitly listed
- diagnostic_patches:
  - none

## Response Draft

当前最可能不是知识库后端单个命令崩了，而是“长时间后台后恢复”的前端/窗口生命周期没有兜底：知识库模式会挂长任务、轮询和自动扫描，但应用恢复时没有专门刷新/重连，也没有顶层 React error boundary 或 WebView blank recovery。一旦 WebView renderer 被系统回收、Tauri invoke 恢复失败、或 React 渲染阶段抛异常，就可能直接表现为白屏。

现有知识库前端测试和 Rust LLM Wiki 测试都通过，本机也没有找到 MDX crash report，所以还需要一次白屏当时的 console/Tauri 日志或稳定复现步骤来确认根因。

## Handoff

- if status is `ready_for_fix`: `$fix .loopx/issues/issue-llm-wiki-background-white-screen-20260624T095432.md`

## Evidence Log

- 2026-06-24T09:54:32+0800 `git status --porcelain` -> worktree dirty; diagnostic product edits prohibited.
- 2026-06-24T09:54:32+0800 read issue skill -> use local ledger workflow, no product code changes.
- 2026-06-24T09:54:32+0800 `rg --files` and project manifest scan -> Tauri + Next app with LLM Wiki Rust backend and React workspace frontend.
- 2026-06-24T09:54:32+0800 inspected `features/app/components/app-shell.tsx` -> session loaded once; no top-level error boundary.
- 2026-06-24T09:54:32+0800 inspected `features/workspace/hooks/use-workspace-bootstrap.ts` -> persisted workspace restored on mount; no explicit long-background resume path.
- 2026-06-24T09:54:32+0800 inspected `features/llm-wiki/hooks/use-llm-wiki-workspace.ts` -> LLM Wiki status/config load on mount, auto raw rescan/ingest, active operation polling via interval.
- 2026-06-24T09:54:32+0800 inspected `src-tauri/src/lib.rs` and `src-tauri/src/window_sessions.rs` -> Reopen focuses/creates workspace window; Destroyed cleans registries; no observed WebView blank/crash recovery.
- 2026-06-24T09:54:32+0800 `npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx` -> passed, 20 tests.
- 2026-06-24T09:54:32+0800 `cargo test llm_wiki --manifest-path src-tauri/Cargo.toml` -> passed, 205 lib tests and 13 mdx_cli tests in the filtered run.
- 2026-06-24T09:54:32+0800 searched `~/Library/Logs`, `~/Library/Application Support`, CrashReporter metadata -> no MDX diagnostic crash report found; only CrashReporter plist metadata with a prior force-quit date.
- 2026-06-24T10:03:01+0800 user reported the app was currently white-screened -> live diagnosis started.
- 2026-06-24T10:03:01+0800 `ps` -> MDX PID 1879 still running from 2026-06-23 10:32:51; main process did not crash.
- 2026-06-24T10:03:01+0800 `sample 1879 3` -> main thread waiting in normal AppKit event loop; CLI server thread accepting on socket; Tokio workers parked; no deadlock/CPU spin evidence.
- 2026-06-24T10:03:01+0800 `osascript`/System Events -> one visible MDX window exists; title MDX; content tree empty.
- 2026-06-24T10:03:01+0800 Swift `CGWindowListCopyWindowInfo` -> MDX window id 79930, onscreen true, alpha 1, memory usage 2368, bounds 1465x883.
- 2026-06-24T10:03:01+0800 `screencapture -l79930` -> MDX window image is a white content area with only the native titlebar.
- 2026-06-24T10:03:01+0800 `mdx-cli list` -> returned cached workspace snapshot for `/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox`; active tab `XTUZGa6S`; one dirty workspace tab.
- 2026-06-24T10:03:01+0800 `mdx-cli llm-wiki status` -> returned `llm_wiki_mode=llmWiki`.
- 2026-06-24T10:03:01+0800 inspected `features/workspace/lib/cli-sync.ts` and `src-tauri/src/cli_server.rs` -> CLI list/content/selection are served from Rust-side cached snapshots, so successful CLI reads do not prove the current DOM is alive.
- 2026-06-24T10:03:01+0800 `mdx-cli focus --tab XTUZGa6S` -> returned ok; follow-up screenshot remained white.
- 2026-06-24T10:03:01+0800 searched DiagnosticReports and unified log -> no matching MDX/WebContent crash/termination entry found.
- 2026-06-24T10:13:32+0800 user authorized stashing unrelated local documents/finish/intake artifacts so `$fix` can run with only the target issue ledger dirty.
- 2026-06-24T10:13:32+0800 updated risk triggers after live reproduction and narrowed scope: removed `no_repro` and `scope_unclear`, retained `defensive_fix`.
- 2026-06-24T10:25:24+0800 implemented workspace frontend heartbeat, native stale-WebView reload gating, AppShell render error boundary, and LLM Wiki foreground refresh.
- 2026-06-24T10:25:24+0800 `npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx` -> passed, 3 files / 21 tests.
- 2026-06-24T10:25:24+0800 `npm test -- --run features/workspace/lib/cli-sync.test.ts features/app/components/app-shell.test.tsx` -> passed, 2 files / 4 tests.
- 2026-06-24T10:25:24+0800 `cargo test llm_wiki --manifest-path src-tauri/Cargo.toml` -> passed, lib 205 tests and mdx_cli 13 tests in filtered run; warning: existing unused `workspace_search_sync`.
- 2026-06-24T10:25:24+0800 `npx eslint features/app/components/app-shell.tsx features/app/components/app-shell.test.tsx features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/workspace/components/workspace-app.tsx features/workspace/lib/cli-sync.ts features/workspace/lib/cli-sync.test.ts features/workspace/lib/types.ts` -> passed.
- 2026-06-24T10:25:24+0800 `npm run build` -> passed, Next production build and TypeScript completed successfully.
- 2026-06-24T10:25:24+0800 `git diff --check` -> passed.
- 2026-06-24T10:45:29+0800 final-review found one Important issue: native stale-WebView reload was not proven safe for dirty tabs because frontend draft autosave is delayed.
- 2026-06-24T10:45:29+0800 fixed final-review issue by making `reserve_frontend_recovery` skip auto-reload when the cached workspace snapshot has any dirty tab, preferring data preservation over automatic recovery.
- 2026-06-24T10:45:29+0800 `cargo test frontend_recovery --manifest-path src-tauri/Cargo.toml` -> passed, 4 tests.
- 2026-06-24T10:45:29+0800 `cargo test llm_wiki --manifest-path src-tauri/Cargo.toml` -> passed, lib 205 tests and mdx_cli 13 tests in filtered run; warning: existing unused `workspace_search_sync`.
- 2026-06-24T10:45:29+0800 `npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx features/workspace/lib/cli-sync.test.ts features/app/components/app-shell.test.tsx` -> passed, 5 files / 25 tests.
- 2026-06-24T10:45:29+0800 `npx eslint features/app/components/app-shell.tsx features/app/components/app-shell.test.tsx features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/workspace/components/workspace-app.tsx features/workspace/lib/cli-sync.ts features/workspace/lib/cli-sync.test.ts features/workspace/lib/types.ts` -> passed.
- 2026-06-24T10:45:29+0800 `npm run build` -> passed.
- 2026-06-24T10:45:29+0800 final-review recheck confirmed dirty-draft reload finding resolved; no remaining blockers before finish.

## Execution Reports

- status: fixed
- actual_changed_files:
  - features/app/components/app-shell.tsx
  - features/app/components/app-shell.test.tsx
  - features/llm-wiki/hooks/use-llm-wiki-workspace.ts
  - features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx
  - features/workspace/components/workspace-app.tsx
  - features/workspace/lib/cli-sync.ts
  - features/workspace/lib/cli-sync.test.ts
  - features/workspace/lib/types.ts
  - src-tauri/src/cli_server.rs
  - src-tauri/src/lib.rs
  - .loopx/issues/issue-llm-wiki-background-white-screen-20260624T095432.md
- verification:
  - command: npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx
    result: pass
  - command: npm test -- --run features/workspace/lib/cli-sync.test.ts features/app/components/app-shell.test.tsx
    result: pass
  - command: cargo test llm_wiki --manifest-path src-tauri/Cargo.toml
    result: pass
  - command: npx eslint features/app/components/app-shell.tsx features/app/components/app-shell.test.tsx features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/workspace/components/workspace-app.tsx features/workspace/lib/cli-sync.ts features/workspace/lib/cli-sync.test.ts features/workspace/lib/types.ts
    result: pass
  - command: npm run build
    result: pass
  - command: git diff --check
    result: pass
- notes: Added a workspace-root heartbeat from the React workspace shell, Rust-side stale heartbeat detection with reload throttling on focus/reopen, an AppShell render error boundary, and LLM Wiki foreground status refresh. The native recovery only applies to workspace windows with a known workspace root and reserves one reload per throttle interval to avoid reload loops.

## Reviews

- local_review:
  - status: clean
  - findings:
    - none
- whole_diff_review:
  - status: findings_addressed
  - findings:
    - Important: native stale-WebView reload could reload dirty workspaces without proving latest edits were durably saved. Addressed by skipping recovery reload when any cached workspace tab is dirty.
- final_review:
  - status: findings_addressed
  - findings:
    - Important dirty-draft reload safety issue resolved; reviewer recheck found no remaining blockers.
- fix_review_decisions:
  - Preserved dirty workspace data over automatic blank-WebView recovery by blocking native recovery reload whenever cached workspace tabs include dirty=true.

## Verification

- final_commands:
  - command: npm test -- --run features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/llm-wiki/lib/auto-processing.test.ts features/llm-wiki/components/llm-wiki-panel.test.tsx
    result: pass
  - command: npm test -- --run features/workspace/lib/cli-sync.test.ts features/app/components/app-shell.test.tsx
    result: pass
  - command: cargo test llm_wiki --manifest-path src-tauri/Cargo.toml
    result: pass
  - command: npx eslint features/app/components/app-shell.tsx features/app/components/app-shell.test.tsx features/llm-wiki/hooks/use-llm-wiki-workspace.ts features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx features/workspace/components/workspace-app.tsx features/workspace/lib/cli-sync.ts features/workspace/lib/cli-sync.test.ts features/workspace/lib/types.ts
    result: pass
  - command: npm run build
    result: pass
  - command: cargo test frontend_recovery --manifest-path src-tauri/Cargo.toml
    result: pass
  - command: Manual: open initialized LLM Wiki workspace with API key configured, start/allow raw ingest, background long enough to trigger timer throttling/App Nap, foreground, verify workspace renders or recoverable error with logs.
    result: not_run
- regression_test_result: Automated regression coverage added for heartbeat payload/root detection, AppShell fallback/reset behavior, LLM Wiki foreground refresh, Rust stale heartbeat recovery gating, and dirty-tab no-reload gating.
- evidence: Automated tests, lint, production build, focused recovery tests, and Rust filtered suite passed. The long-background App Nap manual scenario was not run because it requires an installed build and an extended OS scheduling wait.

## Closeout

- status: complete
- response_draft: "已修复长时间后台后回前台白屏缺少恢复路径的问题：workspace 前端现在会上报渲染心跳，原生层会在 focus/reopen 后延迟检查 stale heartbeat 并节流 reload；如果 cached workspace 里还有 dirty tab，则跳过自动 reload，优先避免未保存编辑丢失；AppShell 增加了渲染错误边界；LLM Wiki 面板回前台会刷新状态。自动验证、lint 和生产构建均已通过。发布前仍建议用安装包做一次长后台/App Nap 手工验证。"
- finish_handoff: `$finish`

## Final Review Report

### Requirements Coverage Matrix

| # | Requirement / Acceptance Criteria | Implemented In | Test Coverage | Status |
|---|----------------------------------|----------------|---------------|--------|
| R1 | Detect/recover workspace WebView blank state after long background foregrounding | `src-tauri/src/lib.rs` focus/reopen recovery scheduling and reload path | `cargo test frontend_recovery`; `cargo test llm_wiki` | covered |
| R2 | Add top-level frontend error boundary | `features/app/components/app-shell.tsx` | `features/app/components/app-shell.test.tsx` | covered |
| R3 | Track frontend liveness for workspace windows | `features/workspace/components/workspace-app.tsx`; `features/workspace/lib/cli-sync.ts`; `src-tauri/src/cli_server.rs` | `features/workspace/lib/cli-sync.test.ts`; Rust recovery tests | covered |
| R4 | Native focus/reopen reload handling when frontend is stale | `src-tauri/src/lib.rs`; `src-tauri/src/cli_server.rs` | Rust stale/missing/fresh/dirty gating tests | covered with native App Nap manual validation not run |
| R5 | LLM Wiki state refresh after foreground restoration | `features/llm-wiki/hooks/use-llm-wiki-workspace.ts` | `features/llm-wiki/hooks/use-llm-wiki-workspace.test.tsx` | covered |
| R6 | Avoid silent data loss / reload loops | Dirty-tab recovery skip in `src-tauri/src/cli_server.rs`; reload throttle in `src-tauri/src/lib.rs` | `frontend_recovery_is_not_reserved_when_workspace_has_dirty_tabs`; duplicate reservation test | covered |
| R7 | No public CLI/API/schema/config/lockfile/generated change | Diff inspection | `git diff --check`; `npm run build`; no lockfile/config/schema changes | covered |

### Support Lens Risk Scan

| Support lens | Trigger | Extra checks required | Result |
|---|---|---|---|
| architecture-designer | Window lifecycle and failure-mode recovery | Failure modes, reload loop throttle, data-loss risk, observability, module boundaries | Passed after dirty-tab reload gate; App Nap manual runtime remains not run |

### Runtime Validation Results

| Scenario | Expected | Actual | Pass? |
|---|---|---|---|
| Next dev server starts | App route served without build/runtime startup error | `npm run dev` started on `http://localhost:3000` | yes |
| App route responds | `/` returns HTML | `curl -I http://localhost:3000` returned `200 OK`; GET returned MDX HTML | yes |
| Production build | TypeScript and Next build succeed | `npm run build` passed | yes |
| Installed Tauri long-background/App Nap recovery | Workspace renders or safe recoverable state after long background wait | Not run; requires installed build and extended OS scheduling wait | not run |

### Code Review Findings

- Important finding: native recovery reload was not proven safe for dirty tabs. Fixed by blocking recovery reservation when any cached tab is dirty.
- Recheck: reviewer confirmed the finding resolved; no remaining blockers before finish.

### Regression Assessment

- Public interface changes: only additive internal Tauri invoke command and internal TypeScript helper/type; no public CLI protocol change.
- Configuration changes: none.
- Schema/data changes: none.
- Dependency changes: none.
- Behavioral changes: workspace heartbeat and focus/reopen stale recovery are intentional; dirty workspaces now skip auto-reload to preserve unsaved edits.

### Overall Assessment

- Ready for finish? Yes.
- Coverage: 7/7 requirements covered, with installed long-background manual validation still deferred.
- Runtime: Partially validated via dev server, production build, unit tests, and Rust tests; full native App Nap scenario not run.
- Regression: Clean after dirty-tab recovery gate.
- Blocking issues: none.
