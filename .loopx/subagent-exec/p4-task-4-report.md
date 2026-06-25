# P4 Task 4 Report

## Scope

- Task: Switch product entry points to the hybrid host while keeping legacy view for comparison
- Brief: `/Users/zhangyukun/project/mdx/.loopx/subagent-exec/p4-task-4-brief.md`
- Baseline: `24fce341f0adfc8bf16a2ece96d0a9582edd1d2c`
- Branch: `main`

## Files Changed

- `features/editor/components/editor-pane.tsx`
- `features/editor/components/editor-pane.test.tsx`
- `features/workspace/components/editor-stage.test.tsx`

## Red Phase

Command:

```bash
npm test -- features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
```

Observed failure after updating the test contract first:

```text
FAIL  features/editor/components/editor-pane.test.tsx > editor pane image paste > wraps markdown content in the reading shell
AssertionError: expected null not to be null
```

The failure was the expected proof that `EditorPane` had not yet mounted the visible hybrid host.

## Implementation

### `features/editor/components/editor-pane.tsx`

- Imported `HybridEditorHost` and `LayoutSnapshot`.
- Added a local `EMPTY_LAYOUT_SNAPSHOT` placeholder because the current `useEditorBridge` baseline does not expose `layoutSnapshot` yet.
- Replaced the visible `DOMD` surface inside the editor column with:
  - visible `HybridEditorHost`
  - hidden legacy fixture wrapper marked by `data-legacy-editor-fixture`
- Kept the existing `DOMDProvider`, event capture wiring, selection/search hooks, and mermaid overlay integration intact.

### `features/editor/components/editor-pane.test.tsx`

- Mocked `HybridEditorHost`.
- Updated the shell assertion to require:
  - visible hybrid host mount
  - hidden legacy DOMD fixture mount
- Switched event-target lookups used by paste/find navigation tests to the stable `[data-mdx-editor-column]` wrapper rather than the old direct DOMD parent assumption.

### `features/workspace/components/editor-stage.test.tsx`

- Added the markdown routing regression requested by the brief to confirm markdown tabs still route through the editor entrypoint.

## Entry Point Assessment

- `features/workspace/components/editor-stage.tsx` already routes markdown tabs through `EditorPane`; no code change was required.
- `features/document/components/document-shell.tsx` already mounts markdown documents through the same `EditorPane` path; no code change was required.

This matches the task goal while staying within the narrow ownership and minimizing risk to save/draft/recovery behavior.

## Verification

1. Focused red test:

```bash
npm test -- features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
```

- Result: failed once, because the visible hybrid host had not been implemented yet.

2. Focused green verification:

```bash
npm test -- features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx features/document/components/document-shell.test.tsx
```

- Result: `3 passed`, `22 passed`

3. Lint on touched entrypoint files:

```bash
npm run lint -- features/editor/components/editor-pane.tsx features/workspace/components/editor-stage.tsx features/document/components/document-shell.tsx
```

- Result: pass

## Requirements Coverage

| Requirement | Status | Notes |
| --- | --- | --- |
| Visible product markdown entrypoints route through hybrid host | Covered | `EditorPane` now mounts `HybridEditorHost` as the visible body |
| Legacy view remains as hidden comparison fixture | Covered | `DOMD` preserved under `data-legacy-editor-fixture` |
| Workspace markdown entrypoint remains on shared editor path | Covered | existing `EditorStage -> EditorPane` path retained, test extended |
| Document markdown entrypoint remains on shared editor path | Covered | existing `DocumentShell -> EditorPane` path retained |

## Architecture Lens Notes

- Support lens: `architecture-designer`
- Decision: keep the entrypoint switch isolated to `EditorPane`, because both workspace and document flows already converge there.
- Tradeoff: the visible host currently uses an empty snapshot placeholder until downstream work exposes real layout snapshots from the editor bridge. This preserves the surface contract now without widening scope into shared bridge internals that this task does not own.

## Concerns

- `useEditorBridge` in the current baseline does not yet provide `layoutSnapshot`, so the visible hybrid host is mounted with `EMPTY_LAYOUT_SNAPSHOT`.
- The hidden legacy fixture remains necessary for existing DOM-driven behaviors and regression comparison until the later mirror/selection tasks replace those dependencies.
