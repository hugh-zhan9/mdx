# Editor Integration Notes

## Authority And Migration State

The approved target contract for Markdown editing is:

- canonical requirements: `.loopx/intake/2026-08-12-milkdown-editor-migration/requirements.md`;
- accepted direction: `docs/loopx/design/2026-08-12-milkdown-editor-migration/设计提案.md`;
- planning-ready detailed design: `docs/loopx/design/2026-08-12-milkdown-editor-migration/需求设计文档.md`.

That design is implemented. The contract below describes the product as it ships, not a target to migrate toward.

The self-owned kernel and the hybrid DOM/Canvas host are gone: `HybridEditorHost`, the `createMdxEditorKernel`/`defaultMarkdownSyntax` composition, the ProseMirror-side layout normalizers, the custom caret/selection/hit-test path, and the implementation-private DOM classes were all deleted rather than deprecated, so there is no old path to fall back to and none to deepen a dependency on. The interactive WASM entry points are no longer named in the layout bridge's typed contract either — the built artifact still exports them, but nothing outside the editor package can reach them.

Publishing-only consumers continue to use the layout/font/PDF code, through the read-only preview port described below.

## Target Markdown Editor Contract

Milkdown/ProseMirror DOM view is the sole WYSIWYG Markdown editor in Workspace Mode and Document Mode. Standard DOM/ProseMirror behavior owns input, IME/composition, caret, selection, history, clipboard, and drag selection. A global CodeMirror source mode is the other surface of the same document session; it is not a second content copy or a second dirty/save state machine.

The user reaches source mode with ⌘⇧M, and returns the same way. The binding is the only entry: there is no toolbar and the mode is deliberately not persisted, so a surface with no keystroke bound to it is one only tests can open. It is ⌘⇧M rather than ⌘/ because the source surface binds ⌘/ itself, to comment toggling; one key has to mean "switch" on both surfaces to bring the user back, so spending ⌘/ here would spend it there too. A refused switch — source that cannot be built into a visual document — leaves the user in source with their content, dirty state and drafts intact, and reports a diagnostic rather than changing surface.

Product and workspace code must integrate through the MDX-owned `MarkdownEditorAdapter` contract. Cross-module selections use Markdown UTF-16 source offsets. Milkdown context, ProseMirror positions and plugin keys, CodeMirror views, third-party theme classes, and implementation-private DOM must not cross that boundary.

Markdown remains the only persisted content and the only content exchanged with file state, CLI integrations, and publishing. ProseMirror documents, CodeMirror state, source maps, and layout snapshots are derived session state.

## Markdown Syntax And Source Preservation

Structured syntax plugins own their parser, schema, serializer, NodeView, clipboard behavior, and focused tests. The first-release contract includes frontmatter, footnotes, wikilinks, Mermaid, math, and callouts. Safe HTML is edited in an explicit source block and rendered only through a sanitized inert preview.

If syntax cannot be represented safely, the editor must preserve it in a visible source fallback instead of deleting or guessing how to normalize it. An unedited fallback serializes its original source slice byte-for-byte. Unknown syntax that can be represented by this fallback is not a fatal visual-parse error.

Mermaid fence source remains authoritative. Mermaid and HTML preview DOM are non-serializing chrome and do not count as duplicate find results. Mermaid uses strict security; clipboard HTML is sanitized before syntax metadata can be rehydrated.

The editor must not depend on deprecated `@milkdown/plugin-math@7.5.9`. Math support is an MDX-owned Milkdown plugin using maintained public APIs and the existing math rendering capability.

### What the preservation layer claims

Membership is a rule, not a list: **any construct whose unedited round-trip does not reproduce its original bytes belongs to the preservation layer.** Stating it this way makes the set checkable — a corpus round-trip test fails on any divergence — rather than a list someone has to remember to extend.

A preserved slice is invalidated only by an edit inside itself, at which point it is re-classified. Changes to neighbouring content never invalidate it, because its bytes do not depend on its neighbours.

Reference-style links are preserved, not structured. `definition`, `linkReference` and `imageReference` keep their original bytes and are edited through source mode rather than as WYSIWYG structure. Inlining `[ref][1]` into `[ref](url)` and deleting an unreferenced definition are both content loss, not formatting: a definition may exist for a section the author has not written yet. Excluding Milkdown's inline-link plugin without providing for these nodes throws on the first reference link, so the two changes land together.

### Line endings

A document whose line endings are uniformly CRLF keeps them. The translation happens once, at the serializer boundary, and never inside preserved slices or code block content — an earlier attempt that rewrote line endings across the whole document accumulated carriage returns inside fenced code on every edit.

A document with mixed line endings is normalized to LF with a diagnostic. Mixed endings are already an anomaly; trying to preserve them produces a result no one intended.

### Escaping belongs to the author

An escape is content, not formatting. The serializer neither adds one the author did not write nor removes one they did: `\[` written in the source comes back as `\[`, and `[` written in the source comes back as `[`. What each then means on reopen is whatever CommonMark says it means — a bracket that matches a definition renders as a link because that is the rule, and one that does not stays text.

This replaces the question of deciding, per character, whether an escape is *needed*. That question has no local answer: every `[…]` is a valid link label, so whether a bracket is inert depends on the whole document's definitions, and a document can gain a definition later. Reproducing what the author wrote sidesteps it entirely and is stable under any later edit.

The mechanism is the same one Milkdown already uses to keep an emphasis marker as written: an mdast node carries its source position, so the original bytes at that position say whether a character was escaped. Applying it to escapes generally is what stops `array[0]` becoming `array\[0]` and `snake_case` becoming `snake\_case` — both are text the author never touched being rewritten by a save.

Text typed or pasted in the visual surface has no source to preserve; the characters the user put in are the characters written out. A user who types `[foo]` where a matching definition exists gets a link on reopen, because that is what those characters mean.

Escaping such text instead would be a one-way ratchet. A typed `array[0]` saved as `array\[0]` comes back on the next open as an authored `\[`, and provenance would then preserve that backslash forever — the writer's guess becomes the author's text. Pasted plain text already loses block structure (`## Heading` arrives as a paragraph), so a paste that produces syntax is consistent with how paste behaves rather than a new surprise.

## Session, Recovery, And External Change Safety

Workspace/Document session state owns Markdown, dirty, drafts, watcher reload decisions, conflicts, and the last-clean disk fingerprint. The editor adapter cannot read or write files, clear dirty, delete drafts, or decide whether an external version wins.

- A clean document may accept an external reload and update its clean baseline.
- A dirty document receiving an external change keeps the user's content and enters the existing conflict/diff flow.
- A recovery draft survives clean reload and is deleted only after save success or explicit discard.
- Saves carry the last-clean fingerprint; backend rejection preserves in-memory content and recovery data.
- A discard flow that requires draft cleanup stops if cleanup fails.

WYSIWYG/source switching never clears dirty, drafts, or conflicts. If source cannot be converted safely to WYSIWYG, the canonical source remains editable and saveable in CodeMirror, the last stable visual state is not written back, and the user receives a source-range diagnostic.

## Feature Integration Contract

Outline, wikilinks, find/replace, images, and CLI focus/selection/insert use the stable editor adapter and Markdown source coordinates. They do not scan rendered DOM or retain ProseMirror/CodeMirror positions.

Delayed text/image commands pin document identity, revision, and selection at receipt. Intervening local transactions may map that selection forward. A clean reload, restore, conflict resolution, closed tab, or other untrustworthy replacement rejects the command instead of inserting at the current caret.

The public CLI command names, flags, payloads, stdout/stderr behavior, JSON output, and exit codes remain unchanged by the editor migration.

Wikilink activation reports both halves of what the syntax layer parsed — the target and the alias, the alias being null when the link has none. The parser already has both; dropping one at the boundary leaves a caller unable to name the link the way the document does.

Find searches document semantic text, and both surfaces return the same matches for the same query. Content held in node attributes — link destinations, image alt text and sources, inline math source — is not searched, because a match must be revealable: those have no text position on the visual surface, and reporting a match the user cannot navigate to is worse than reporting none. One canonical coordinate space is exposed, and a match the adapter cannot place is dropped with a diagnostic rather than returned at a guessed offset.

## Publishing Boundary

Rust/WASM layout, font, and PDF code consumes an immutable Markdown document revision for read-only preview or PDF generation. It must not participate in interactive input, caret, selection, or hit-test and has no capability to mutate Markdown, dirty, selection, drafts, or conflicts.

Screen editing and publishing share content semantics, not line boxes or pixel geometry. Preview/PDF failure is isolated from editing and saving; there is no runtime fallback to the old hybrid editor or to a browser-print path reported as native export success.

## Dependency, License, And Rollback

MDX remains React + Tauri. ColaMD's Electron IPC, watcher, dirty/reload state, and overall `editor.ts` are not application dependencies. Milkdown packages stay on one supported, lockfile-pinned version line.

ColaMD is a behavior and composition reference at commit `4c986a4e0920cf0598fb2a47cec2966fc5340c77`. Any substantively copied independent plugin code must record its upstream path and commit and retain the ColaMD MIT notice in distributed artifacts.

Production exposes one Milkdown editor entry. Development-only fixtures are allowed but do not create a user-level editor switch. Rollback uses an application-version rollback or Git revert; Markdown requires no migration or reverse migration.
