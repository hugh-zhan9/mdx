# Finish Audit

## Summary

- audit_id: 20260614T060143Z-mdx-agent-memory-extraction
- slug: mdx-agent-memory-extraction
- status: audited
- updated_at: 2026-06-14T06:03:25.257Z
- branch: main
- base branch: main
- worktree: /Users/zhangyukun/project/mdx

## Scanned Inputs

- slug=mdx-agent-memory-extraction
- worktree=/Users/zhangyukun/project/mdx
- branch=main
- base_branch=main
- head=fded800
- change_window_source=baseline
- change_range=f58ba43..HEAD
- committed_change_count=6
- changed_files_count=4
- uncommitted_change_count=12
- cwd=/Users/zhangyukun/project/mdx
- env.LOOPX_DEVELOPER=unknown

## Change Window

- source: baseline
- baseline_ref: f58ba43
- range: f58ba43..HEAD
- committed_change_count: 6

### Commits

- fded8007c49c295514db0c451a39b3cca59e783b fix: document memory inbox add workflow
- 33a6039c13cdf45edd3fcd36f51c8338c2dd4313 fix: align codex thread guidance with conversation view
- 66feb7ea49074dfe1eecbbcfc6ef0e6046d199f3 docs: describe agent-time memory extraction
- c9f1ecd55d428e4d495ca3cdc3bb644b2a03a8ff feat: expose memory inbox add over mcp
- 7f4d9edb18867da26d90357c64423835a021fa93 feat: guide mcp memory tools toward agent-time extraction
- 61a650cf3c3424d2d6b30fb10f784b2c1aef64a5 feat: make agent-time memory extraction explicit

### Changed Files

- M docs/memory-usage.md
- M src-tauri/src/bin/mdx_cli.rs
- M src-tauri/src/bin/mdx_mcp.rs
- M src-tauri/src/memory_agent_setup.rs

### Uncommitted Status

- M .loopx/finish/baselines/latest.json
- M features/workspace/hooks/use-workspace-bootstrap.ts
- M src-tauri/src/memory_capture.rs
- M src-tauri/src/memory_tests.rs
- M src-tauri/src/memory_thread.rs
- M src-tauri/src/state_store.rs
- M src-tauri/src/state_store_tests.rs
- ?? "docs/loopx/design/MDX\344\274\232\350\257\235\344\270\255\350\207\252\345\212\250Memory\346\217\220\345\217\226\351\234\200\346\261\202\350\256\276\350\256\241\346\226\207\346\241\243.md"
- ?? docs/loopx/plans/2026-06-12-memory-phase-one.md
- ?? docs/loopx/plans/2026-06-13-memory-complete.md
- ?? docs/loopx/plans/2026-06-14-llm-wiki-output-stability.md
- ?? docs/loopx/plans/2026-06-14-mdx-agent-memory-extraction.md

### Source Artifacts

- docs/loopx/plans/2026-06-14-mdx-agent-memory-extraction.md

### Diff Stat

- docs/memory-usage.md                |  16 +++-
- src-tauri/src/bin/mdx_cli.rs        |  68 ++++++++++++++++
- src-tauri/src/bin/mdx_mcp.rs        | 156 ++++++++++++++++++++++++++++++++++--
- src-tauri/src/memory_agent_setup.rs |  14 +++-
- 4 files changed, 241 insertions(+), 13 deletions(-)

## Extraction Candidates

- memory-local-review-change-window: Review the committed finish change window for local agent memory worth preserving.
  - kind: memory
  - scope: local
  - status: pending-review
  - target: .loopx/memory/entries/
  - reason: Committed code, docs, tests, or workflow files may encode a reusable decision, constraint, pitfall, or handoff that future agents should know.
  - evidence: change_window.source=baseline; change_window.range=f58ba43..HEAD; change_window.commit_count=6; commit: fix: document memory inbox add workflow; commit: fix: align codex thread guidance with conversation view; commit: docs: describe agent-time memory extraction; commit: feat: expose memory inbox add over mcp; commit: feat: guide mcp memory tools toward agent-time extraction; file: docs/memory-usage.md; file: src-tauri/src/bin/mdx_cli.rs; file: src-tauri/src/bin/mdx_mcp.rs; file: src-tauri/src/memory_agent_setup.rs
- memory-shared-review-change-window: Review the committed finish change window for git-tracked shared memory worth preserving across machines.
  - kind: memory
  - scope: shared
  - status: pending-review
  - target: docs/loopx/memory/
  - reason: A user may need lightweight project memory across multiple machines before it becomes stable enough to promote to a spec.
  - evidence: change_window.source=baseline; change_window.range=f58ba43..HEAD; change_window.commit_count=6; commit: fix: document memory inbox add workflow; commit: fix: align codex thread guidance with conversation view; commit: docs: describe agent-time memory extraction; commit: feat: expose memory inbox add over mcp; commit: feat: guide mcp memory tools toward agent-time extraction; file: docs/memory-usage.md; file: src-tauri/src/bin/mdx_cli.rs; file: src-tauri/src/bin/mdx_mcp.rs; file: src-tauri/src/memory_agent_setup.rs
- spec-review-change-window: Review the committed finish change window for a repo-tracked spec candidate.
  - kind: spec
  - status: pending-review
  - target: docs/loopx/specs/inbox.md
  - reason: Committed workflow, skill, runtime, documentation, or test changes may define a stable team rule that belongs in specs.
  - evidence: change_window.source=baseline; change_window.range=f58ba43..HEAD; change_window.commit_count=6; commit: fix: document memory inbox add workflow; commit: fix: align codex thread guidance with conversation view; commit: docs: describe agent-time memory extraction; commit: feat: expose memory inbox add over mcp; commit: feat: guide mcp memory tools toward agent-time extraction; file: docs/memory-usage.md; file: src-tauri/src/bin/mdx_cli.rs; file: src-tauri/src/bin/mdx_mcp.rs; file: src-tauri/src/memory_agent_setup.rs

## Accepted Candidates

- spec-review-change-window: Recorded the Agent-Time Extraction Contract for Memory integrations.
  - kind: spec
  - target: docs/loopx/specs/memory.md
  - evidence: change_window.range=f58ba43..HEAD; commit: feat: make agent-time memory extraction explicit; commit: feat: guide mcp memory tools toward agent-time extraction; commit: feat: expose memory inbox add over mcp; commit: fix: document memory inbox add workflow; file: docs/loopx/specs/memory.md

## Rejected Candidates

- memory-local-review-change-window: The durable learning is a stable Memory behavior contract and was promoted to docs/loopx/specs/memory.md; duplicating it as local memory would add low-signal redundancy.
- memory-shared-review-change-window: The durable learning is stable enough for the repo-tracked Memory spec; no separate shared memory note is needed.

## No Candidates Reason

- null

## Choice

- action: null
- status: null
- summary: null
- url: null

## Choice History

- none

## Next Steps

- Present finish options and record the user's completion choice with `finish-record`.
