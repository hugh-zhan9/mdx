# Finish Audit

## Summary

- audit_id: 20260618T055611Z-self-owned-markdown-wysiwyg-kernel
- slug: self-owned-markdown-wysiwyg-kernel
- status: completed
- updated_at: 2026-06-18T06:18:09.219Z
- branch: main
- base branch: main
- worktree: /Users/zhangyukun/project/mdx

## Scanned Inputs

- slug=self-owned-markdown-wysiwyg-kernel
- worktree=/Users/zhangyukun/project/mdx
- branch=main
- base_branch=main
- head=17df82f
- change_window_source=baseline
- change_range=69eb098..HEAD
- committed_change_count=29
- changed_files_count=59
- uncommitted_change_count=1
- cwd=/Users/zhangyukun/project/mdx
- env.LOOPX_DEVELOPER=unknown

## Change Window

- source: baseline
- baseline_ref: 69eb098
- range: 69eb098..HEAD
- committed_change_count: 29

### Commits

- 17df82f603eef33ee9b75beb039d9f0a3929f667 feat: surface empty-editor placeholder state
- ca27768a1eabc6d50d6907f456980ef38b550021 feat: support semantic image nodes in editor runtime
- dd02ef7679aca91c4d99a9d56ccc10f574cb9e1c feat: render mdx editor through semantic runtime
- 036396a6f1c4e3dc29784782b8aa93c7bf71f1ae fix: wire mdx editor through prosemirror runtime
- 96aadabd5c59026f349b9eefe345523d960994c1 chore: remove closed markdown editor kernel
- 4103b0f2ac12a6e0011cb004f9cad5ac18d5f9e6 docs: document self-owned markdown editor kernel
- 6e9ad3a203c87471cb75708d498948c49dec9bcd test: preserve app editor behavior on self-owned kernel
- d451fc848561ce51d68ab7d19f0598136ad018b8 fix: narrow opaque markdown fallback boundaries
- 80edb1b3f1834f0da4e9a9f41b6ff8277dc5818b fix: guard opaque source-preservation reuse
- 3ee88de4b5018168b86cdf504142cd565c82dcc4 test: add markdown roundtrip fixture coverage
- 3f353097f42be8c886c0578eea5c4f58174e5ca6 fix: stabilize editor pane source mode
- 6fe42af7d4dd5344e3cc48dc15bb761011346b0c feat: add markdown source mode to editor pane
- ccd1f792778ef14d724e29e5c95632332bf2ff1e feat: migrate editor helpers to mdx dom contract
- f959213dad4230787268a877dd6dcf1a0d435aba fix: preserve editor bridge compatibility
- 3c9a36d0c97353e27f483b929e8ff40f0f3afed8 feat: route editor adapter through self-owned kernel
- 5ebf42f102a7c2a6f86a6338211226a0f7fba698 fix: stabilize react adapter commands
- 388cf5002c6e3cad63b1b9e0cc9eceb17bcd5457 fix: align react adapter contracts
- de67b287aab2e243c24fbf85d2a38e98982627c7 feat: add mdx editor react adapter
- 0ea9144e29174a8231853ec21c312a9e5cfbb132 fix: strengthen markdown command round-trips
- 418770a2c9d2db36d0615acb49be0ec2d1867c65 fix: escape markdown image alt text
- 67f814748b935965c5091a8bb56cd05c67c5adb3 fix: escape image urls in markdown commands
- 49d5cc3cdaa38c9a8809046a5cd3ed9e9c6b5cad feat: add editor commands and selection snapshots
- a2e4a575f3d5b42e88cd0a223e0cdd452fa27247 fix: align markdown escaping in parser and serializer
- 07fb7f425c8c48957c57a330fadc66c94054acdd fix: group adjacent link text in serializer
- d58fd5a84bcb78be1b60b665b929e77227cfe5c7 feat: serialize markdown with source preservation
- df7ae0e867c7cbd92bd1aedda2f9c3e43d4725ee fix: harden initial markdown parser contracts
- 95e3215d4c7f19e90cc36f8af92206aec52e173d feat: add initial markdown parser and schema
- 18f7b057841784640c8a03724af2414fc41829ba fix: typecheck mdx editor scaffold helpers
- bde92d2a62eed8552940c900ddbaac98d3b34423 feat: scaffold self-owned markdown editor package

### Changed Files

- D .packages/@do-md/dist/LICENSE
- D .packages/@do-md/dist/index.cjs
- D .packages/@do-md/dist/index.js
- D .packages/@do-md/dist/style.css
- M LICENSE
- M README.md
- M README.zh-CN.md
- M app/globals.css
- M docs/loopx/specs/editor.md
- A features/editor/components/editor-kernel-adapter.test.tsx
- M features/editor/components/editor-kernel-adapter.tsx
- M features/editor/components/editor-mermaid-preview-layer.test.tsx
- M features/editor/components/editor-mermaid-preview-layer.tsx
- M features/editor/components/editor-pane.test.tsx
- M features/editor/components/editor-pane.tsx
- A features/editor/hooks/use-editor-bridge.test.tsx
- M features/editor/hooks/use-editor-bridge.ts
- M features/editor/hooks/use-editor-find-replace.test.ts
- A features/editor/lib/editor-dom-contract.ts
- A features/editor/lib/editor-kernel-removal.test.ts
- M features/editor/lib/keyboard-selection-scope.test.ts
- M features/editor/lib/keyboard-selection-scope.ts
- M features/editor/lib/markdown-line-scroll.test.ts
- M features/editor/lib/markdown-line-scroll.ts
- M features/editor/lib/mermaid-dom.test.ts
- M features/editor/lib/mermaid-dom.ts
- M features/editor/lib/visible-text-search.test.ts
- M features/editor/lib/visible-text-search.ts
- M package-lock.json
- M package.json
- A packages/mdx-editor/commands/editor-commands.test.ts
- A packages/mdx-editor/commands/editor-commands.ts
- A packages/mdx-editor/core/markdown-nodes.ts
- A packages/mdx-editor/core/selection.test.ts
- A packages/mdx-editor/core/selection.ts
- A packages/mdx-editor/core/source-map.test.ts
- A packages/mdx-editor/core/source-map.ts
- A packages/mdx-editor/core/types.ts
- A packages/mdx-editor/index.ts
- A packages/mdx-editor/parser/parse-markdown.test.ts
- A packages/mdx-editor/parser/parse-markdown.ts
- A packages/mdx-editor/plugins/editor-plugins.ts
- A packages/mdx-editor/react/editor-toolbar.tsx
- A packages/mdx-editor/react/index.ts
- A packages/mdx-editor/react/mdx-editor-context.tsx
- A packages/mdx-editor/react/mdx-editor-provider.test.tsx
- A packages/mdx-editor/react/mdx-editor-provider.tsx
- A packages/mdx-editor/react/mdx-editor-view.tsx
- A packages/mdx-editor/react/node-views.tsx
- A packages/mdx-editor/react/source-mode-editor.tsx
- A packages/mdx-editor/schema/schema.test.ts
- A packages/mdx-editor/schema/schema.ts
- A packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
- A packages/mdx-editor/serializer/serialize-markdown.test.ts
- A packages/mdx-editor/serializer/serialize-markdown.ts
- A packages/mdx-editor/test/fixtures.ts
- A packages/mdx-editor/test/test-helpers.ts
- M tsconfig.json
- D types/do-md-react.d.ts

### Uncommitted Status

- M .loopx/finish/baselines/latest.json

### Source Artifacts

- none

### Diff Stat

- .packages/@do-md/dist/LICENSE                      |  131 --
- .packages/@do-md/dist/index.cjs                    |    1 -
- .packages/@do-md/dist/index.js                     |   15 -
- .packages/@do-md/dist/style.css                    |    1 -
- LICENSE                                            |    7 +-
- README.md                                          |    6 +-
- README.zh-CN.md                                    |    6 +-
- app/globals.css                                    |   26 +
- docs/loopx/specs/editor.md                         |   12 +-
- .../components/editor-kernel-adapter.test.tsx      |   89 ++
- .../editor/components/editor-kernel-adapter.tsx    |  188 ++-
- .../editor-mermaid-preview-layer.test.tsx          |   19 +-
- .../components/editor-mermaid-preview-layer.tsx    |    3 +-
- features/editor/components/editor-pane.test.tsx    |  108 +-
- features/editor/components/editor-pane.tsx         |   72 +-
- features/editor/hooks/use-editor-bridge.test.tsx   |   84 +
- features/editor/hooks/use-editor-bridge.ts         |    5 +-
- .../editor/hooks/use-editor-find-replace.test.ts   |   25 +-
- features/editor/lib/editor-dom-contract.ts         |   10 +
- features/editor/lib/editor-kernel-removal.test.ts  |   12 +
- .../editor/lib/keyboard-selection-scope.test.ts    |   70 +-
- features/editor/lib/keyboard-selection-scope.ts    |    9 +-
- features/editor/lib/markdown-line-scroll.test.ts   |   20 +-
- features/editor/lib/markdown-line-scroll.ts        |   14 +-
- features/editor/lib/mermaid-dom.test.ts            |   13 +-
- features/editor/lib/mermaid-dom.ts                 |    3 +-
- features/editor/lib/visible-text-search.test.ts    |  146 +-
- features/editor/lib/visible-text-search.ts         |   25 +-
- package-lock.json                                  | 1609 +++++++++++++++++++-
- package.json                                       |   24 +
- .../mdx-editor/commands/editor-commands.test.ts    |   50 +
- packages/mdx-editor/commands/editor-commands.ts    |   33 +
- packages/mdx-editor/core/markdown-nodes.ts         |   24 +
- packages/mdx-editor/core/selection.test.ts         |   31 +
- packages/mdx-editor/core/selection.ts              |   26 +
- packages/mdx-editor/core/source-map.test.ts        |   22 +
- packages/mdx-editor/core/source-map.ts             |   19 +
- packages/mdx-editor/core/types.ts                  |   39 +
- packages/mdx-editor/index.ts                       |   23 +
- packages/mdx-editor/parser/parse-markdown.test.ts  |  157 ++
- packages/mdx-editor/parser/parse-markdown.ts       |  601 ++++++++
- packages/mdx-editor/plugins/editor-plugins.ts      |    7 +
- packages/mdx-editor/react/editor-toolbar.tsx       |   11 +
- packages/mdx-editor/react/index.ts                 |   16 +
- packages/mdx-editor/react/mdx-editor-context.tsx   |   32 +
- .../mdx-editor/react/mdx-editor-provider.test.tsx  |  205 +++
- packages/mdx-editor/react/mdx-editor-provider.tsx  |  311 ++++
- packages/mdx-editor/react/mdx-editor-view.tsx      |   28 +
- packages/mdx-editor/react/node-views.tsx           |   35 +
- packages/mdx-editor/react/source-mode-editor.tsx   |   21 +
- packages/mdx-editor/schema/schema.test.ts          |   35 +
- packages/mdx-editor/schema/schema.ts               |  238 +++
- .../serializer/markdown-roundtrip-fixtures.test.ts |   13 +
- .../serializer/serialize-markdown.test.ts          |  243 +++
- .../mdx-editor/serializer/serialize-markdown.ts    |  474 ++++++
- packages/mdx-editor/test/fixtures.ts               |   47 +
- packages/mdx-editor/test/test-helpers.ts           |    9 +
- tsconfig.json                                      |    6 +-
- types/do-md-react.d.ts                             |   70 -
- 59 files changed, 5111 insertions(+), 468 deletions(-)

## Extraction Candidates

- memory-local-review-change-window: Review the committed finish change window for local agent memory worth preserving.
  - kind: memory
  - scope: local
  - status: rejected
  - target: .loopx/memory/entries/
  - reason: Committed code, docs, tests, or workflow files may encode a reusable decision, constraint, pitfall, or handoff that future agents should know.
  - evidence: change_window.source=baseline; change_window.range=69eb098..HEAD; change_window.commit_count=29; commit: feat: surface empty-editor placeholder state; commit: feat: support semantic image nodes in editor runtime; commit: feat: render mdx editor through semantic runtime; commit: fix: wire mdx editor through prosemirror runtime; commit: chore: remove closed markdown editor kernel; file: .packages/@do-md/dist/LICENSE; file: .packages/@do-md/dist/index.cjs; file: .packages/@do-md/dist/index.js; file: .packages/@do-md/dist/style.css; file: LICENSE
- memory-shared-review-change-window: Review the committed finish change window for git-tracked shared memory worth preserving across machines.
  - kind: memory
  - scope: shared
  - status: rejected
  - target: docs/loopx/memory/
  - reason: A user may need lightweight project memory across multiple machines before it becomes stable enough to promote to a spec.
  - evidence: change_window.source=baseline; change_window.range=69eb098..HEAD; change_window.commit_count=29; commit: feat: surface empty-editor placeholder state; commit: feat: support semantic image nodes in editor runtime; commit: feat: render mdx editor through semantic runtime; commit: fix: wire mdx editor through prosemirror runtime; commit: chore: remove closed markdown editor kernel; file: .packages/@do-md/dist/LICENSE; file: .packages/@do-md/dist/index.cjs; file: .packages/@do-md/dist/index.js; file: .packages/@do-md/dist/style.css; file: LICENSE
- spec-review-change-window: Review the committed finish change window for a repo-tracked spec candidate.
  - kind: spec
  - status: accepted
  - target: docs/loopx/specs/inbox.md
  - reason: Committed workflow, skill, runtime, documentation, or test changes may define a stable team rule that belongs in specs.
  - evidence: change_window.source=baseline; change_window.range=69eb098..HEAD; change_window.commit_count=29; commit: feat: surface empty-editor placeholder state; commit: feat: support semantic image nodes in editor runtime; commit: feat: render mdx editor through semantic runtime; commit: fix: wire mdx editor through prosemirror runtime; commit: chore: remove closed markdown editor kernel; file: .packages/@do-md/dist/LICENSE; file: .packages/@do-md/dist/index.cjs; file: .packages/@do-md/dist/index.js; file: .packages/@do-md/dist/style.css; file: LICENSE

## Accepted Candidates

- spec-review-change-window: The editor spec now defines the self-owned MDX editor DOM contract: Markdown remains source of truth, integrations use data-mdx-* attributes, and old DOMD/private kernel selectors are not part of the contract.
  - evidence: change_window.range=69eb098..HEAD; commit: docs: document self-owned markdown editor kernel; file: docs/loopx/specs/editor.md; verification: negative assertions passed for @do-md/react and DOMD selectors
  - target: docs/loopx/specs/editor.md
  - status: accepted

## Rejected Candidates

- memory-local-review-change-window: No machine-local handoff, pitfall, or transient decision needs preservation; the reusable behavior is already captured as a repo-tracked editor spec contract.
  - rejection_reason: No machine-local handoff, pitfall, or transient decision needs preservation; the reusable behavior is already captured as a repo-tracked editor spec contract.
  - target: .loopx/memory/entries/
  - status: rejected
- memory-shared-review-change-window: No lightweight cross-machine memory is needed because the durable editor kernel and DOM-contract rules are stable enough for docs/loopx/specs/editor.md.
  - rejection_reason: No lightweight cross-machine memory is needed because the durable editor kernel and DOM-contract rules are stable enough for docs/loopx/specs/editor.md.
  - target: docs/loopx/memory/
  - status: rejected

## No Candidates Reason

- Spec candidate accepted in docs/loopx/specs/editor.md; local and shared memory candidates rejected as duplicate/low-signal.

## Choice

- action: pr
- status: done
- summary: Committed and pushed the current main branch to origin/main per user request; no PR was created.
- url: null

## Choice History

- none

## Next Steps

- Agent review the audit evidence and decide whether the finish state can advance.
- Record the final audit decision once the audit is complete.
