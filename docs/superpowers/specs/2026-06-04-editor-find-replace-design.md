# Editor Find/Replace Design

## Goal

Add current-document find/replace to the MDX editor.

The first version supports:

- `Command+F`: open the editor Find Bar and focus the find input.
- `Command+R`: open the Find Bar, expand replace controls, and focus the find/replace flow.
- Find previous / next.
- Replace current match.
- Replace all matches.
- Plain-text matching only.
- Default case-insensitive matching with an `Aa` toggle for case-sensitive matching.

The feature applies to editable Markdown documents in both Workspace Mode tabs and Document Mode windows.

## Non-Goals

- No workspace-wide search.
- No regex search.
- No Markdown source-text search.
- No matching inside Markdown syntax that is hidden from the WYSIWYG editor, including image paths and link URLs.
- No search support for non-editor previews such as PDF, image, HTML, or plain text preview tabs.
- No changes to save behavior; existing editor dirty-state and save flows continue to own persistence.

## User Semantics

Find/replace operates on text the user can see in the editor.

Included:

- Paragraph text.
- Headings.
- List item text.
- Table text when editable and visible through the editor DOM.
- Code block text.
- Visible inline text such as link labels.

Excluded:

- Markdown marker syntax.
- Hidden DOMD markdown symbols.
- Link href URLs.
- Image asset paths.
- Image binary content.
- Any hidden text used only by the editor kernel for rendering/editing.

If an image exposes a visible editable caption or alt label in the editor DOM, it may be searched as visible text. Hidden image source paths must not be searched or replaced.

## UI

Use an editor-top inline Find Bar. It is rendered inside `EditorPane`, above the DOMD editor viewport, so it affects only the editor area and does not compete with the file tree, LLM Wiki panel, or outline.

Collapsed find mode:

- Find input.
- Match count, such as `3/12`.
- Previous and next icon buttons.
- `Aa` toggle.
- Replace toggle.
- Close button.

Expanded replace mode:

- Replace input.
- Replace current button.
- Replace all button.

Keyboard behavior:

- `Command+F` opens the bar and focuses the find input.
- `Command+R` opens the bar, expands replace mode, and focuses the find input unless it is already populated; if the find input is active and populated, tabbing to replacement should be natural.
- `Enter` in the find input moves to next match.
- `Shift+Enter` in the find input moves to previous match.
- `Escape` closes the bar and returns focus to the editor.

The bar should use compact, work-focused controls consistent with existing MDX editor chrome. Use icons for previous, next, close, and case toggle where practical, with accessible labels.

## Architecture

Add a small find/replace layer around the existing editor kernel. Do not expand the public `@do-md/react` type surface beyond what the app actually calls.

Proposed units:

- `features/editor/lib/visible-text-search.ts`
  - Builds an index from visible editor DOM text nodes.
  - Finds plain-text matches with optional case sensitivity.
  - Maps matches back to DOM `Range` boundaries.
  - Excludes hidden DOMD syntax markers and non-visible nodes.

- `features/editor/hooks/use-editor-find-replace.ts`
  - Owns Find Bar state: open/closed, replace expanded, query, replacement, case sensitivity, current match index.
  - Rebuilds matches when query, case sensitivity, editor markdown, or visible DOM changes.
  - Selects and scrolls the active match.
  - Performs replace current and replace all.

- `features/editor/components/editor-find-bar.tsx`
  - Renders controls and keyboard behavior for the inline bar.
  - Calls hook actions; it does not inspect DOM directly.

- `features/editor/components/editor-pane.tsx`
  - Hosts the Find Bar above `DOMD`.
  - Provides a ref to the editor root/viewport for indexing.
  - Captures `Command+F` and `Command+R` only when the active tab is an editable Markdown editor.

Document Mode already uses `EditorPane`, so the same component-level integration covers both modes.

## Data Flow

1. User presses `Command+F` or `Command+R`.
2. `EditorPane` opens the Find Bar.
3. The hook indexes visible text nodes under the DOMD editor root.
4. The hook computes matches from the query.
5. Next/previous selects the matching DOM `Range` and scrolls it into view.
6. Replace current selects the active match and calls the existing editor insertion path with the replacement text.
7. Replace all applies replacements from the end of the visible-text match list toward the start, so earlier replacements do not invalidate later DOM offsets.
8. Existing editor bridge observes the editor mutation, converts to Markdown, and dispatches normal dirty-state updates.

## Replacement Rules

Replace current:

- Requires an active match.
- Re-selects the active match immediately before replacement.
- Calls the editor kernel insertion method through the existing adapter path.
- Rebuilds the match list after replacement.

Replace all:

- Requires a non-empty query.
- Uses the current case-sensitivity setting.
- Applies replacements only to currently indexed visible matches.
- Runs from last match to first match to reduce offset drift.
- Rebuilds the match list after completion.
- If a match can no longer be located because the document changed, skip that match and continue; do not attempt source-level fallback replacement.

Do not write directly to Markdown source for replacements. Source-level rewriting would reintroduce hidden path/URL mutation risks that this feature is explicitly avoiding.

## Error Handling

- Empty query shows no matches and disables replace actions.
- No matches shows `0/0` or an equivalent empty state and keeps navigation disabled.
- If the active match cannot be selected, rebuild matches and reset to the first available match.
- If replace current cannot apply through the editor kernel, leave document content unchanged and keep the bar open.
- Replace all should not silently fall back to Markdown source rewriting.

## Testing

Unit tests for `visible-text-search`:

- Finds visible paragraph text.
- Finds visible code block text.
- Honors case-insensitive default matching.
- Honors case-sensitive matching when enabled.
- Excludes hidden DOMD syntax marker elements.
- Excludes non-visible nodes.
- Maps matches spanning text nodes when reasonable, or explicitly documents and tests the chosen boundary behavior if first version only supports single-node matches.

Hook/component tests:

- `Command+F` opens the Find Bar.
- `Command+R` opens and expands replace mode.
- Enter / Shift+Enter navigate matches.
- Replace current calls the editor insertion path for the selected visible match.
- Replace all applies all visible matches and does not operate on hidden image/link paths.

Regression tests:

- Link label text is searchable; href text is not.
- Code block content participates in search and replace.
- Image path is not replaced by replace all.

Manual verification:

- Workspace Mode Markdown tab supports find/replace.
- Document Mode Markdown window supports find/replace.
- PDF/image/plain text previews do not show the editor Find Bar.

## Open Constraints

The editor kernel is a closed-source black-box distribution. The implementation should prefer public adapter methods already used by MDX. If a replacement operation cannot be performed reliably through DOM selection plus the existing insert path, the implementation should stop at replace-current support and report the blocker before adding source-level fallback behavior.

