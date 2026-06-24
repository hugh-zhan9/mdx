# Markdown WYSIWYG Kernel Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/Markdown所见即所得内核补强需求设计文档.md`

**Goal:** Make the self-owned ProseMirror Markdown editor a real-time WYSIWYG editor for basic and advanced Markdown while preserving Markdown as the only persisted document truth and keeping app/CLI integration compatible.

**Architecture:** Expand `packages/mdx-editor/` across schema, parser, serializer, commands, plugins, clipboard, and node views. Remove the global source mode UI from `EditorPane`, keep block-level source fallback for unsupported or invalid regions, and keep the existing adapter/CLI surface stable.

**Tech Stack:** TypeScript, React 19, Vitest/jsdom, ProseMirror, micromark/mdast GFM/math utilities, KaTeX, Mermaid, existing MDX workspace/editor integration.

---

## Scope Check

The source design is one subsystem: the self-owned Markdown editor kernel plus its app integration boundary. It touches many files, but each task below produces a working, testable slice and keeps Markdown files as the only persisted state.

This plan does not include `HTML与MHTML只读渲染预览`; that is a separate design and should be planned/executed independently.

## Strict Current Surface Vs Historical Context

Strict current product surface:

- `packages/mdx-editor/**`
- `features/editor/**`
- `features/workspace/**` only where editor integration consumes Markdown state or CLI selection.
- `common/**` only where Prism/KaTeX/Mermaid helpers are consumed.
- `app/globals.css`
- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `docs/loopx/specs/**`
- `docs/loopx/design/Markdown所见即所得内核补强需求设计文档.md`
- `README.md`
- `README.zh-CN.md`

Historical context:

- `docs/loopx/plans/**` except this plan.
- Older `docs/loopx/design/**` except the source design.
- `.loopx/**`
- `ref/**`
- `rust_out/**`

Historical context may mention removed source mode or old DOMD behavior. Strict current surface must not present global source mode as a current product feature after this plan completes.

## Surface Inventory

- Public commands/API/routes/events/config:
  - Keep `mdx-cli content`, `mdx-cli selection`, `mdx-cli insert`, `mdx-cli save`, `mdx-cli focus`.
  - Keep `CliSelectionSnapshot` fields: `has_selection`, `selected_text`, `before`, `after`, `before_truncated`, `after_truncated`.
  - Remove the user-visible global source mode toggle from the editor surface.
- Exported functions/types/modules:
  - Keep `features/editor/components/editor-kernel-adapter.tsx` exports: `DOMDProvider`, `DOMD`, `useEditor`, `useEditorStoreApi`, `useRenderData`, `toMarkdown`, `resetMD`, `insertText`, `insertImage`, `getSelectionState`.
  - Extend `packages/mdx-editor` exports only for new internal editor tests/helpers; do not expose a new external package API.
  - Keep `SourceModeEditor` file only if retained by tests or an internal fallback task proves a caller; otherwise remove export and file.
- Runtime/generated artifacts and templates:
  - No persisted editor metadata. Source maps, dirty maps, parsed documents, render caches, and fallback block state stay in memory.
  - Markdown output must remain plain `.md/.markdown`.
- Installer/package/deployment surface:
  - `npm run build` and `npm run build:app` must pass.
  - Existing dependencies already include ProseMirror, micromark GFM/math, KaTeX, Mermaid. Add new dependency only if a task proves it is needed and license-compatible.
- Hooks/background jobs/automation:
  - No new background jobs.
  - Existing workspace save, recovery, file watcher, and CLI socket behavior are retained.
- Current product docs:
  - Update README only if it currently advertises global source mode or behavior that becomes false.
  - Keep `docs/loopx/specs/editor.md` aligned with `data-mdx-*` DOM contract.
- Tests/governance checks:
  - Add kernel parser/schema/serializer/plugin/node-view tests.
  - Add integration tests proving global source mode is absent.
  - Add negative tests proving unsupported Markdown becomes block-level source fallback instead of being dropped.
- Compatibility/migration paths:
  - Existing `.md/.markdown` files must continue opening and saving.
  - Existing CLI commands keep their protocol.
  - Unsupported/invalid Markdown migrates at runtime to source fallback blocks and serializes back without data loss.

## Caller Proof Commands And Decision Rules

Run before removal tasks and paste output into task notes.

```bash
rg -n "SourceModeEditor|source mode|源码|setMode\\(|mode === \"source\"|data-mdx-source-fallback" packages features app README.md README.zh-CN.md docs/loopx/specs
```

Decision rule: if `SourceModeEditor` is referenced only by `EditorPane` global mode UI and exports/tests, remove the global mode path and either delete `SourceModeEditor` or move its behavior into source fallback node view. If a retained current caller exists, name it and preserve only that internal fallback usage.

```bash
rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id|data-mdx-node-type|data-mdx-code-block|data-mdx-syntax" packages features app docs/loopx/specs
```

Decision rule: old DOMD classes must not appear in strict current surface. `data-mdx-*` contract must remain and new nodes must expose stable attributes used by find/replace, outline, line scroll, and Mermaid mapping.

```bash
rg -n "has_selection|selected_text|before_truncated|after_truncated|tab_selections|mdx-cli selection|mdx-cli insert|mdx-cli content" features src-tauri README.md README.zh-CN.md docs/loopx/specs
```

Decision rule: CLI selection/content/insert callers are retained. Do not change response field names or command semantics.

```bash
rg -n "source_fallback|opaque_block|frontmatter|callout|mermaid|math|footnote|task_item|table" packages/mdx-editor features/editor
```

Decision rule: after parser/schema tasks, unsupported editable raw content should use `source_fallback`; unchanged opaque preservation may remain for non-editable legacy fixtures only if a test proves it is still necessary.

## Negative Assertions For Final Removal

Run in the final task. Expected result: every command exits successfully.

```bash
! rg -n "SourceModeEditor|aria-label=\"编辑模式\"|所见即所得|源码" features/editor/components/editor-pane.tsx packages/mdx-editor/react/index.ts README.md README.zh-CN.md docs/loopx/specs
! rg -n "mode === \"source\"|setMode\\(\"source\"\\)|sourceDraft" features/editor/components/editor-pane.tsx
! rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" packages features app docs/loopx/specs
npm run lint
npm run test
npm run build
cd src-tauri && cargo test
```

## File Structure

Create:

- `packages/mdx-editor/parser/inline-markdown.ts`: inline tokenizer for marks, links, images, footnote refs, inline math, wikilinks.
- `packages/mdx-editor/parser/block-markdown.ts`: block tokenizer/parser for headings, paragraphs, lists, blockquotes, tables, callouts, fences, math, footnotes, fallback blocks.
- `packages/mdx-editor/serializer/inline-serializer.ts`: serializes inline nodes/marks.
- `packages/mdx-editor/serializer/block-serializer.ts`: serializes block nodes and source fallback.
- `packages/mdx-editor/plugins/editor-clipboard.ts`: clipboard serialization/parsing plugin.
- `packages/mdx-editor/plugins/editor-input-rules.ts`: Markdown input rules.
- `packages/mdx-editor/plugins/editor-keymap.ts`: editor keymap commands.
- `packages/mdx-editor/plugins/source-fallback-plugin.ts`: editable fallback block behavior.
- `packages/mdx-editor/react/table-node-view.tsx`: table node view controls.
- `packages/mdx-editor/react/task-list-node-view.tsx`: task checkbox behavior.
- `packages/mdx-editor/react/math-node-view.tsx`: inline/block math editing and render behavior.
- `packages/mdx-editor/react/mermaid-node-view.tsx`: Mermaid source/preview node view.
- `packages/mdx-editor/react/callout-node-view.tsx`: callout editing UI.
- `packages/mdx-editor/react/footnote-node-view.tsx`: footnote ref/definition editing UI.
- `packages/mdx-editor/react/source-fallback-node-view.tsx`: block-level raw Markdown fallback editor.
- `packages/mdx-editor/plugins/*.test.ts`: plugin tests.
- `packages/mdx-editor/react/*node-view.test.tsx`: node view tests.

Modify:

- `packages/mdx-editor/core/types.ts`: add source metadata and parsed block/inline helper types.
- `packages/mdx-editor/core/markdown-nodes.ts`: add node kind names for new schema nodes.
- `packages/mdx-editor/schema/schema.ts`: add nodes/marks for lists, blockquotes, tables, task items, footnotes, math, callout, Mermaid, source fallback.
- `packages/mdx-editor/schema/schema.test.ts`: prove schema supports target nodes.
- `packages/mdx-editor/parser/parse-markdown.ts`: delegate to block/inline parser and create new schema nodes.
- `packages/mdx-editor/parser/parse-markdown.test.ts`: cover basic and advanced Markdown.
- `packages/mdx-editor/serializer/serialize-markdown.ts`: delegate to block/inline serializers and preserve source slices.
- `packages/mdx-editor/serializer/serialize-markdown.test.ts`: cover edited and unchanged output.
- `packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`: make advanced fixtures structural, not opaque.
- `packages/mdx-editor/commands/editor-commands.ts`: add structural commands.
- `packages/mdx-editor/commands/editor-commands.test.ts`: cover commands.
- `packages/mdx-editor/plugins/editor-plugins.ts`: register history, keymap, input rules, clipboard, source fallback.
- `packages/mdx-editor/react/node-views.tsx`: register node views.
- `packages/mdx-editor/react/mdx-editor-provider.tsx`: preserve parsed metadata while handling transactions.
- `packages/mdx-editor/react/mdx-editor-provider.test.tsx`: cover real-time editing and rendered structure.
- `packages/mdx-editor/react/index.ts`: remove `SourceModeEditor` export unless only fallback internals retain it.
- `features/editor/components/editor-pane.tsx`: remove global source mode UI and source draft state.
- `features/editor/components/editor-pane.test.tsx`: prove source mode toggle is absent.
- `features/editor/components/editor-kernel-adapter.test.tsx`: prove adapter compatibility.
- `features/editor/hooks/use-editor-bridge.test.tsx`: prove markdown updates still flow.
- `features/editor/lib/editor-dom-contract.ts`: add selectors for new `data-mdx-*` nodes if needed.
- `features/editor/lib/visible-text-search.test.ts`: prove generated Mermaid/math UI is excluded and editable text is included.
- `features/editor/lib/markdown-line-scroll.test.ts`: prove headings and structural blocks remain scrollable.
- `app/globals.css`: add minimal node view styles.
- `README.md`, `README.zh-CN.md`, `docs/loopx/specs/editor.md`: update only if they mention removed global source mode or incomplete DOM contract.

## Task 1: Schema Surface For Target Markdown Nodes

**Files:**

- Modify: `packages/mdx-editor/schema/schema.ts`
- Modify: `packages/mdx-editor/schema/schema.test.ts`
- Modify: `packages/mdx-editor/core/markdown-nodes.ts`
- Modify: `packages/mdx-editor/core/types.ts`

- [ ] **Step 1: Write failing schema tests**

Append these tests to `packages/mdx-editor/schema/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "./schema";

describe("mdxEditorSchema advanced markdown nodes", () => {
    it("creates list, task, blockquote, table, footnote, math, callout, mermaid, and source fallback nodes", () => {
        const schema = mdxEditorSchema;
        const paragraph = schema.nodes.paragraph.create(null, schema.text("Cell"));
        const table = schema.nodes.table.create(
            { alignments: ["left", "right"] },
            schema.nodes.table_row.create(null, [
                schema.nodes.table_header.create(null, schema.text("A")),
                schema.nodes.table_header.create(null, schema.text("B")),
            ]),
        );

        expect(schema.nodes.bullet_list.create(null, [
            schema.nodes.task_item.create({ checked: true }, schema.nodes.paragraph.create(null, schema.text("Done"))),
        ]).type.name).toBe("bullet_list");
        expect(schema.nodes.blockquote.create(null, paragraph).type.name).toBe("blockquote");
        expect(table.attrs.alignments).toEqual(["left", "right"]);
        expect(schema.nodes.footnote_ref.create({ label: "1" }).attrs.label).toBe("1");
        expect(schema.nodes.footnote_definition.create({ label: "1" }, paragraph).attrs.label).toBe("1");
        expect(schema.nodes.math_inline.create({ latex: "x+1" }).attrs.latex).toBe("x+1");
        expect(schema.nodes.math_block.create({ latex: "y=mx+b" }).attrs.latex).toBe("y=mx+b");
        expect(schema.nodes.callout.create({ kind: "NOTE", title: "Note" }, paragraph).attrs.kind).toBe("NOTE");
        expect(schema.nodes.mermaid_block.create({ code: "graph TD\\nA-->B" }).attrs.code).toContain("graph TD");
        expect(schema.nodes.source_fallback.create({ markdown: "<x>" }).attrs.markdown).toBe("<x>");
    });

    it("renders stable data-mdx attributes for integration helpers", () => {
        const dom = mdxEditorSchema.nodes.heading.create({ level: 2 }).type.spec.toDOM?.(
            mdxEditorSchema.nodes.heading.create({ level: 2 }),
        );

        expect(dom).toBeDefined();
        expect(JSON.stringify(dom)).toContain("data-mdx-node-type");
    });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/schema/schema.test.ts
```

Expected: FAIL with errors that nodes such as `bullet_list`, `table`, or `source_fallback` are undefined.

- [ ] **Step 3: Extend markdown node kind metadata**

Update `packages/mdx-editor/core/markdown-nodes.ts` so `MarkdownNodeKind` includes these exact values:

```ts
    | "list_item"
    | "table_row"
    | "table_cell"
    | "table_header"
    | "footnote_ref"
    | "footnote_definition"
    | "math_inline"
    | "math_block"
    | "mermaid_block"
    | "source_fallback";
```

Update `packages/mdx-editor/core/types.ts` with runtime-only source metadata:

```ts
export interface SourcePreservationMetadata {
    sourceId: string | null;
    originalSyntax?: string;
    dirty?: boolean;
}
```

- [ ] **Step 4: Add schema nodes and attrs**

Modify `packages/mdx-editor/schema/schema.ts`:

- Keep existing node names and attrs.
- Add `blockquote`, `bullet_list`, `ordered_list`, `list_item`, `task_item`, `table`, `table_row`, `table_cell`, `table_header`, `footnote_ref`, `footnote_definition`, `math_inline`, `math_block`, `callout`, `mermaid_block`, `source_fallback`.
- Every block node must expose `data-mdx-node-type`.
- Mermaid preview UI must not be emitted by schema `toDOM`; it belongs in node views.

Use this node contract:

```ts
source_fallback: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: {
        markdown: { default: "" },
        reason: { default: "unsupported" },
        sourceId: { default: null },
    },
    toDOM: (node) => [
        "pre",
        {
            "data-mdx-node-type": "source_fallback",
            "data-mdx-source-id": node.attrs.sourceId ?? undefined,
            "data-mdx-reason": node.attrs.reason || undefined,
        },
        ["code", node.attrs.markdown],
    ],
}
```

- [ ] **Step 5: Run schema tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/schema/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mdx-editor/schema/schema.ts packages/mdx-editor/schema/schema.test.ts packages/mdx-editor/core/markdown-nodes.ts packages/mdx-editor/core/types.ts
git commit -m "feat(editor): add markdown schema surface"
```

## Task 2: Inline Markdown Parsing And Serialization

**Files:**

- Create: `packages/mdx-editor/parser/inline-markdown.ts`
- Create: `packages/mdx-editor/serializer/inline-serializer.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.test.ts`

- [ ] **Step 1: Write failing inline parser tests**

Append to `packages/mdx-editor/parser/parse-markdown.test.ts`:

```ts
it("parses inline markdown marks, footnote refs, and math into structured nodes", () => {
    const parsed = parseMarkdown("A **bold** *em* ~~gone~~ `code` $x+1$ [^note].\\n");
    const paragraph = parsed.doc.child(0);

    expect(paragraph.child(1).text).toBe("bold");
    expect(paragraph.child(1).marks[0]?.type.name).toBe("strong");
    expect(paragraph.child(3).marks[0]?.type.name).toBe("emphasis");
    expect(paragraph.child(5).marks[0]?.type.name).toBe("strike");
    expect(paragraph.child(7).marks[0]?.type.name).toBe("inline_code");
    expect(paragraph.child(9).type.name).toBe("math_inline");
    expect(paragraph.child(9).attrs.latex).toBe("x+1");
    expect(paragraph.child(11).type.name).toBe("footnote_ref");
    expect(paragraph.child(11).attrs.label).toBe("note");
});
```

- [ ] **Step 2: Write failing inline serializer tests**

Append to `packages/mdx-editor/serializer/serialize-markdown.test.ts`:

```ts
it("serializes inline marks, math, and footnote refs", () => {
    const schema = mdxEditorSchema;
    const doc = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
            schema.text("A "),
            schema.text("bold", [schema.marks.strong.create()]),
            schema.text(" "),
            schema.text("em", [schema.marks.emphasis.create()]),
            schema.text(" "),
            schema.text("gone", [schema.marks.strike.create()]),
            schema.text(" "),
            schema.text("code", [schema.marks.inline_code.create()]),
            schema.text(" "),
            schema.nodes.math_inline.create({ latex: "x+1" }),
            schema.text(" "),
            schema.nodes.footnote_ref.create({ label: "note" }),
        ]),
    ]);

    expect(serializeMarkdown(emptyParsedDocument(doc))).toBe("A **bold** *em* ~~gone~~ `code` $x+1$ [^note]\\n");
});
```

- [ ] **Step 3: Run targeted tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: FAIL because inline marks/math/footnote refs are parsed as plain text or serializer does not know new inline nodes.

- [ ] **Step 4: Create inline parser module**

Create `packages/mdx-editor/parser/inline-markdown.ts` exporting:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

export function parseInlineMarkdown(text: string): ProseMirrorNode[] {
    // Implement a single left-to-right tokenizer that recognizes, in order:
    // image, wikilink, normal link, footnote ref, inline math, inline code,
    // strong, strike, emphasis, escaped char, plain text.
    // It must preserve unsupported delimiters as plain text.
}
```

Implementation requirements:

- `**bold**` creates text with `strong`.
- `*em*` creates text with `emphasis`.
- `~~gone~~` creates text with `strike`.
- `` `code` `` creates text with `inline_code`.
- `$x+1$` creates `math_inline` node with `latex: "x+1"`.
- `[^note]` creates `footnote_ref` node.
- Existing image/link/wikilink parsing behavior stays compatible.
- Escaped delimiters remain literal text.

- [ ] **Step 5: Wire inline parser into block parser**

Replace the local inline parsing in `packages/mdx-editor/parser/parse-markdown.ts` with `parseInlineMarkdown`. Delete duplicated local helpers only after tests prove behavior remains covered.

- [ ] **Step 6: Create inline serializer module**

Create `packages/mdx-editor/serializer/inline-serializer.ts` exporting:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";

export function serializeInlineContent(node: ProseMirrorNode): string {
    // Serialize text marks, image nodes, math_inline, footnote_ref, links, and wikilinks.
}
```

Implementation requirements:

- Preserve existing link, wikilink, and image behavior from `serialize-markdown.ts`.
- Serialize mark nesting deterministically.
- Escape plain text brackets/backslashes as current serializer does.
- Serialize `math_inline` as `$${latex}$` in string construction terms: output must look like `$x+1$`.
- Serialize `footnote_ref` as `[^label]`.

- [ ] **Step 7: Wire inline serializer into markdown serializer**

Update `packages/mdx-editor/serializer/serialize-markdown.ts` to call `serializeInlineContent` for paragraph/heading/list/cell/callout content.

- [ ] **Step 8: Run targeted tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/mdx-editor/parser/inline-markdown.ts packages/mdx-editor/serializer/inline-serializer.ts packages/mdx-editor/parser/parse-markdown.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
git commit -m "feat(editor): parse and serialize inline markdown"
```

## Task 3: Block Markdown Parser For Basic Structures

**Files:**

- Create: `packages/mdx-editor/parser/block-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/block-serializer.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.test.ts`

- [ ] **Step 1: Write failing basic block tests**

Append to `packages/mdx-editor/parser/parse-markdown.test.ts`:

```ts
it("parses lists, ordered lists, blockquotes, and fenced code as structured blocks", () => {
    const parsed = parseMarkdown([
        "# Title",
        "",
        "- One",
        "- Two",
        "",
        "1. First",
        "2. Second",
        "",
        "> Quote",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
    ].join("\\n"));

    expect(parsed.doc.child(0).type.name).toBe("heading");
    expect(parsed.doc.child(1).type.name).toBe("bullet_list");
    expect(parsed.doc.child(1).child(0).type.name).toBe("list_item");
    expect(parsed.doc.child(2).type.name).toBe("ordered_list");
    expect(parsed.doc.child(2).attrs.order).toBe(1);
    expect(parsed.doc.child(3).type.name).toBe("blockquote");
    expect(parsed.doc.child(4).type.name).toBe("code_block");
    expect(parsed.doc.child(4).attrs.language).toBe("ts");
});
```

Append to `packages/mdx-editor/serializer/serialize-markdown.test.ts`:

```ts
it("serializes basic block structures", () => {
    const markdown = "- One\\n- Two\\n\\n1. First\\n2. Second\\n\\n> Quote\\n";
    const parsed = parseMarkdown(markdown);

    expect(serializeMarkdown(parsed)).toBe(markdown);
});
```

- [ ] **Step 2: Run parser/serializer tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: FAIL because lists and blockquotes are not structured.

- [ ] **Step 3: Create block parser module**

Create `packages/mdx-editor/parser/block-markdown.ts` exporting:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { SourceSlice } from "../core/types";

export function parseMarkdownBlocks(
    markdown: string,
    sourceSlices: SourceSlice[],
): ProseMirrorNode[] {
    // Parse line-oriented Markdown into schema nodes.
}
```

Implementation requirements:

- Preserve current frontmatter, heading, paragraph, image/link inline behavior.
- Parse contiguous `- ` or `* ` lines as `bullet_list`.
- Parse contiguous `1. ` style lines as `ordered_list` with `order` from first marker.
- Parse task markers in Task 4; plain list items use `list_item`.
- Parse contiguous `> ` lines as `blockquote` containing paragraphs.
- Parse fenced backtick code blocks as `code_block` with `language`, `info`, `sourceId`.
- Use `parseInlineMarkdown` for inline content.

- [ ] **Step 4: Wire block parser into parseMarkdown**

Update `packages/mdx-editor/parser/parse-markdown.ts` to call `parseMarkdownBlocks`. Keep `addSlice` or move it into `block-markdown.ts`; tests must still assert stable `source-0`, `source-1` IDs.

- [ ] **Step 5: Create block serializer module**

Create `packages/mdx-editor/serializer/block-serializer.ts` exporting:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";

export function serializeBlockNode(node: ProseMirrorNode): string {
    // Serialize one block-level node to Markdown with trailing newline.
}
```

Implementation requirements:

- `bullet_list` serializes each item as `- ${inline}`.
- `ordered_list` serializes as incrementing `N. ${inline}` starting at `attrs.order`.
- `blockquote` prefixes inner paragraph lines with `> `.
- `code_block`, `frontmatter`, `heading`, `paragraph`, `image`, link behavior remain compatible.

- [ ] **Step 6: Wire block serializer into serializeMarkdown**

Update `packages/mdx-editor/serializer/serialize-markdown.ts` to use `serializeBlockNode` for changed nodes and source preservation for unchanged nodes.

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mdx-editor/parser/block-markdown.ts packages/mdx-editor/parser/parse-markdown.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/block-serializer.ts packages/mdx-editor/serializer/serialize-markdown.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
git commit -m "feat(editor): parse basic markdown blocks"
```

## Task 4: Advanced Block Parser And Serializer

**Files:**

- Modify: `packages/mdx-editor/parser/block-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/block-serializer.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`
- Modify: `packages/mdx-editor/test/fixtures.ts`

- [ ] **Step 1: Rewrite advanced fixture expectations**

Update `packages/mdx-editor/test/fixtures.ts` so advanced fixture names stay the same, but tests no longer expect task list, table, callout, math, and footnote to be `opaque_block`.

In `packages/mdx-editor/parser/parse-markdown.test.ts`, replace the test named `"parses unsupported block features as source-preserved opaque blocks"` with:

```ts
it("parses advanced markdown blocks as structured nodes", () => {
    const cases = [
        { name: "gfm task list", expected: ["bullet_list"] },
        { name: "gfm table", expected: ["table"] },
        { name: "callout", expected: ["callout"] },
        { name: "math", expected: ["paragraph", "math_block"] },
        { name: "footnote", expected: ["paragraph", "footnote_definition"] },
        { name: "mermaid fence", expected: ["mermaid_block"] },
    ];

    for (const testCase of cases) {
        const fixture = roundTripFixtures.find((candidate) => candidate.name === testCase.name);
        expect(fixture, testCase.name).toBeDefined();
        const parsed = parseMarkdown(fixture!.markdown);

        expect(Array.from({ length: parsed.doc.childCount }, (_, index) => parsed.doc.child(index).type.name)).toEqual(testCase.expected);
    }
});
```

- [ ] **Step 2: Add serializer expectations for advanced blocks**

Append to `packages/mdx-editor/serializer/serialize-markdown.test.ts`:

```ts
it("round-trips structured advanced markdown blocks", () => {
    for (const name of ["gfm task list", "gfm table", "math", "footnote", "callout", "mermaid fence"]) {
        const fixture = roundTripFixtures.find((candidate) => candidate.name === name);
        expect(fixture, name).toBeDefined();
        const parsed = parseMarkdown(fixture!.markdown);

        expect(serializeMarkdown(parsed)).toBe(fixture!.markdown);
    }
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: FAIL because advanced blocks are still opaque or missing.

- [ ] **Step 4: Implement task list parsing and serialization**

Update `parseMarkdownBlocks`:

- `- [x] Done` creates `bullet_list > task_item(checked: true) > paragraph("Done")`.
- `- [ ] Todo` creates `task_item(checked: false)`.

Update `serializeBlockNode`:

- `task_item` serializes as `- [x] ${text}` or `- [ ] ${text}`.

- [ ] **Step 5: Implement GFM table parsing and serialization**

Implementation requirements:

- Recognize header row, delimiter row, and body rows.
- Alignment markers:
  - `:---` -> `"left"`
  - `---:` -> `"right"`
  - `:---:` -> `"center"`
  - `---` -> `null`
- Create `table > table_row > table_header/table_cell`.
- Serializer emits stable pipe table:

```md
| A | B |
|---|---|
| 1 | 2 |
```

- [ ] **Step 6: Implement callout parsing and serialization**

Implementation requirements:

- Recognize first line `> [!NOTE]` or `> [!NOTE] Title`.
- Create `callout` attrs `{ kind: "NOTE", title: "Title" }`.
- Content lines strip leading `> ` and parse as paragraph content.
- Serializer emits `> [!NOTE]` plus optional title and quoted content lines.

- [ ] **Step 7: Implement math block and footnote parsing/serialization**

Implementation requirements:

- `$$\n...\n$$` creates `math_block({ latex })`.
- `[^label]: body` creates `footnote_definition({ label })`.
- Footnote definition body may be a paragraph in this implementation; indented multi-block bodies should become source fallback if not safely parsed.

- [ ] **Step 8: Implement Mermaid block specialization**

Implementation requirements:

- Fenced code whose first info token is `mermaid` creates `mermaid_block({ code, info })`.
- Serializer emits a backtick fence with original `info` or `mermaid`.
- Non-Mermaid fences remain `code_block`.

- [ ] **Step 9: Run advanced tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/mdx-editor/parser/block-markdown.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/block-serializer.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts packages/mdx-editor/test/fixtures.ts
git commit -m "feat(editor): parse advanced markdown blocks"
```

## Task 5: Source Fallback Blocks For Unsupported Markdown

**Files:**

- Create: `packages/mdx-editor/react/source-fallback-node-view.tsx`
- Create: `packages/mdx-editor/plugins/source-fallback-plugin.ts`
- Modify: `packages/mdx-editor/parser/block-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.test.ts`
- Modify: `packages/mdx-editor/serializer/block-serializer.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.test.ts`
- Modify: `packages/mdx-editor/react/node-views.tsx`

- [ ] **Step 1: Write fallback parser and serializer tests**

Append to `packages/mdx-editor/parser/parse-markdown.test.ts`:

```ts
it("uses source_fallback for unsupported html without dropping content", () => {
    const markdown = "<div data-x=\\"1\\">\\n  <span>HTML</span>\\n</div>\\n";
    const parsed = parseMarkdown(markdown);

    expect(parsed.doc.childCount).toBe(1);
    expect(parsed.doc.child(0).type.name).toBe("source_fallback");
    expect(parsed.doc.child(0).attrs.markdown).toBe(markdown);
    expect(parsed.doc.child(0).attrs.reason).toBe("unsupported");
});
```

Append to `packages/mdx-editor/serializer/serialize-markdown.test.ts`:

```ts
it("serializes source fallback markdown exactly", () => {
    const markdown = "<div>Unsupported</div>\\n";
    const doc = mdxEditorSchema.nodes.doc.create(null, [
        mdxEditorSchema.nodes.source_fallback.create({ markdown, reason: "unsupported" }),
    ]);

    expect(serializeMarkdown(emptyParsedDocument(doc))).toBe(markdown);
});
```

- [ ] **Step 2: Run fallback tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: FAIL because current code uses `opaque_block` or serializer lacks `source_fallback`.

- [ ] **Step 3: Parse unsupported regions as source_fallback**

Update `packages/mdx-editor/parser/block-markdown.ts`:

- HTML block, malformed table, unsupported multi-line footnote body, and unknown block syntaxes create `source_fallback`.
- `source_fallback.attrs.markdown` must include the exact original source slice including trailing newline when present.

- [ ] **Step 4: Serialize source_fallback exactly**

Update `packages/mdx-editor/serializer/block-serializer.ts`:

```ts
case "source_fallback":
    return String(node.attrs.markdown ?? "");
```

Ensure `serializeMarkdown` does not append extra blank lines around fallback when source preservation already supplies correct spacing.

- [ ] **Step 5: Add source fallback node view**

Create `packages/mdx-editor/react/source-fallback-node-view.tsx`:

```tsx
"use client";

import type { NodeViewProps } from "./node-views";

export function SourceFallbackNodeView({ node, updateAttrs }: NodeViewProps) {
    return (
        <div data-mdx-node-type="source_fallback" className="mdx-source-fallback">
            <textarea
                aria-label="Markdown source fallback"
                value={String(node.attrs.markdown ?? "")}
                onChange={(event) => updateAttrs({ markdown: event.currentTarget.value })}
            />
        </div>
    );
}
```

If `NodeViewProps` does not exist yet, define it in `packages/mdx-editor/react/node-views.tsx` in Task 8. For this task, create the file and export the component; wiring can be minimal until Task 8.

- [ ] **Step 6: Run fallback tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mdx-editor/react/source-fallback-node-view.tsx packages/mdx-editor/plugins/source-fallback-plugin.ts packages/mdx-editor/parser/block-markdown.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/block-serializer.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/react/node-views.tsx
git commit -m "feat(editor): preserve unsupported markdown as source fallback"
```

## Task 6: Editor Commands, Input Rules, And Keymap

**Files:**

- Create: `packages/mdx-editor/plugins/editor-input-rules.ts`
- Create: `packages/mdx-editor/plugins/editor-keymap.ts`
- Modify: `packages/mdx-editor/commands/editor-commands.ts`
- Modify: `packages/mdx-editor/commands/editor-commands.test.ts`
- Modify: `packages/mdx-editor/plugins/editor-plugins.ts`
- Create: `packages/mdx-editor/plugins/editor-input-rules.test.ts`

- [ ] **Step 1: Write command tests**

Append to `packages/mdx-editor/commands/editor-commands.test.ts`:

```ts
import { EditorState, TextSelection } from "prosemirror-state";
import { toggleStrongMark, setHeadingBlock, insertTableMarkdown } from "./editor-commands";
import { mdxEditorSchema } from "../schema/schema";
import { createMdxEditorPlugins } from "../plugins/editor-plugins";
import { serializeMarkdown } from "../serializer/serialize-markdown";

it("toggles strong mark through a ProseMirror command", () => {
    const doc = mdxEditorSchema.nodes.doc.create(null, [
        mdxEditorSchema.nodes.paragraph.create(null, mdxEditorSchema.text("bold")),
    ]);
    let state = EditorState.create({ schema: mdxEditorSchema, doc, plugins: createMdxEditorPlugins() });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
    let nextState = state;

    const handled = toggleStrongMark(state, (tr) => {
        nextState = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.child(0).child(0).marks[0]?.type.name).toBe("strong");
});

it("sets the current block to a heading", () => {
    const doc = mdxEditorSchema.nodes.doc.create(null, [
        mdxEditorSchema.nodes.paragraph.create(null, mdxEditorSchema.text("Title")),
    ]);
    let state = EditorState.create({ schema: mdxEditorSchema, doc, plugins: createMdxEditorPlugins() });
    let nextState = state;

    expect(setHeadingBlock(2)(state, (tr) => { nextState = state.apply(tr); })).toBe(true);
    expect(nextState.doc.child(0).type.name).toBe("heading");
    expect(nextState.doc.child(0).attrs.level).toBe(2);
});

it("inserts a markdown table template", () => {
    const markdown = insertTableMarkdown(2, 2);

    expect(markdown).toBe("|  |  |\\n|---|---|\\n|  |  |\\n|  |  |\\n");
});
```

- [ ] **Step 2: Write input rule tests**

Create `packages/mdx-editor/plugins/editor-input-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markdownInputRules } from "./editor-input-rules";

describe("markdownInputRules", () => {
    it("registers rules for headings, lists, tasks, blockquotes, fences, and tables", () => {
        const rules = markdownInputRules();
        const patterns = rules.map((rule) => String(rule.match));

        expect(patterns.some((pattern) => pattern.includes("#{1,6}"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("\\\\[ \\\\]"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes(">"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("```"))).toBe(true);
    });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/commands/editor-commands.test.ts packages/mdx-editor/plugins/editor-input-rules.test.ts
```

Expected: FAIL because command/input-rule exports do not exist.

- [ ] **Step 4: Implement commands**

Update `packages/mdx-editor/commands/editor-commands.ts` to export:

- `toggleStrongMark`
- `toggleEmphasisMark`
- `toggleStrikeMark`
- `toggleInlineCodeMark`
- `setHeadingBlock(level: 1 | 2 | 3 | 4 | 5 | 6)`
- `insertTableMarkdown(rows: number, columns: number)`
- `insertMermaidMarkdown(code?: string)`
- `insertMathBlockMarkdown(latex?: string)`
- `toggleTaskItemChecked`

Use ProseMirror commands from `prosemirror-commands`, `prosemirror-schema-list`, and transaction transforms where possible. Do not hand-roll direct DOM edits.

- [ ] **Step 5: Implement input rules and keymap modules**

Create `packages/mdx-editor/plugins/editor-input-rules.ts`:

```ts
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import type { InputRule } from "prosemirror-inputrules";
import { mdxEditorSchema } from "../schema/schema";

export function markdownInputRules(): InputRule[] {
    return [
        textblockTypeInputRule(/^(#{1,6})\\s$/, mdxEditorSchema.nodes.heading, (match) => ({ level: match[1].length })),
        wrappingInputRule(/^\\s*([-+*])\\s$/, mdxEditorSchema.nodes.bullet_list),
        wrappingInputRule(/^\\s*(\\d+)\\.\\s$/, mdxEditorSchema.nodes.ordered_list, (match) => ({ order: Number(match[1]) })),
        wrappingInputRule(/^\\s*[-+*]\\s\\[ \\]\\s$/, mdxEditorSchema.nodes.bullet_list),
        wrappingInputRule(/^>\\s$/, mdxEditorSchema.nodes.blockquote),
    ];
}

export function markdownInputRulesPlugin() {
    return inputRules({ rules: markdownInputRules() });
}
```

Create `packages/mdx-editor/plugins/editor-keymap.ts` with `Mod-b`, `Mod-i`, `Mod-Shift-x`, undo/redo, and list Enter/Backspace defaults.

- [ ] **Step 6: Register plugins**

Update `packages/mdx-editor/plugins/editor-plugins.ts`:

```ts
export function createMdxEditorPlugins() {
    return [
        history(),
        markdownInputRulesPlugin(),
        keymap(markdownKeymap()),
        keymap(baseKeymap),
    ];
}
```

- [ ] **Step 7: Run command/plugin tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/commands/editor-commands.test.ts packages/mdx-editor/plugins/editor-input-rules.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mdx-editor/plugins/editor-input-rules.ts packages/mdx-editor/plugins/editor-keymap.ts packages/mdx-editor/commands/editor-commands.ts packages/mdx-editor/commands/editor-commands.test.ts packages/mdx-editor/plugins/editor-plugins.ts packages/mdx-editor/plugins/editor-input-rules.test.ts
git commit -m "feat(editor): add markdown commands and input rules"
```

## Task 7: Clipboard Plugin

**Files:**

- Create: `packages/mdx-editor/plugins/editor-clipboard.ts`
- Create: `packages/mdx-editor/plugins/editor-clipboard.test.ts`
- Modify: `packages/mdx-editor/plugins/editor-plugins.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.ts`

- [ ] **Step 1: Write clipboard unit tests**

Create `packages/mdx-editor/plugins/editor-clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markdownToClipboardHtml, clipboardTextToMarkdown } from "./editor-clipboard";

describe("editor clipboard helpers", () => {
    it("converts markdown fragments to rich clipboard html", () => {
        const html = markdownToClipboardHtml("# Title\\n\\nA **bold** [link](https://example.com).\\n");

        expect(html).toContain("<h1");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain('href="https://example.com"');
    });

    it("keeps pasted plain text as markdown text", () => {
        expect(clipboardTextToMarkdown("plain\\ntext")).toBe("plain\\ntext");
    });

    it("strips script tags from pasted html before markdown conversion", () => {
        const markdown = clipboardTextToMarkdown("Safe", "<p>Safe</p><script>alert(1)</script>");

        expect(markdown).toContain("Safe");
        expect(markdown).not.toContain("script");
    });
});
```

- [ ] **Step 2: Run clipboard tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/plugins/editor-clipboard.test.ts
```

Expected: FAIL because `editor-clipboard.ts` does not exist.

- [ ] **Step 3: Implement clipboard helpers and plugin**

Create `packages/mdx-editor/plugins/editor-clipboard.ts` exporting:

- `MARKDOWN_CLIPBOARD_MIME = "application/x-mdx-markdown"`
- `markdownToClipboardHtml(markdown: string): string`
- `clipboardTextToMarkdown(text: string, html?: string): string`
- `createMarkdownClipboardPlugin()`

Implementation requirements:

- `markdownToClipboardHtml` may parse Markdown with `parseMarkdown` and render a minimal HTML string using node names.
- Strip `<script>`, event handler attrs, and `javascript:` URLs from pasted HTML before conversion.
- `createMarkdownClipboardPlugin` must set clipboard text/plain and text/html for copy/cut where possible, and parse internal markdown MIME first on paste.
- If ProseMirror clipboard hooks are too limited for a unit test, keep pure helpers covered here and wire browser behavior in Task 12.

- [ ] **Step 4: Register clipboard plugin**

Update `packages/mdx-editor/plugins/editor-plugins.ts` to include `createMarkdownClipboardPlugin()` before keymaps.

- [ ] **Step 5: Run clipboard tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/plugins/editor-clipboard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mdx-editor/plugins/editor-clipboard.ts packages/mdx-editor/plugins/editor-clipboard.test.ts packages/mdx-editor/plugins/editor-plugins.ts packages/mdx-editor/serializer/serialize-markdown.ts packages/mdx-editor/parser/parse-markdown.ts
git commit -m "feat(editor): add markdown clipboard pipeline"
```

## Task 8: React Node Views For Advanced Structures

**Files:**

- Modify: `packages/mdx-editor/react/node-views.tsx`
- Create: `packages/mdx-editor/react/table-node-view.tsx`
- Create: `packages/mdx-editor/react/task-list-node-view.tsx`
- Create: `packages/mdx-editor/react/math-node-view.tsx`
- Create: `packages/mdx-editor/react/mermaid-node-view.tsx`
- Create: `packages/mdx-editor/react/callout-node-view.tsx`
- Create: `packages/mdx-editor/react/footnote-node-view.tsx`
- Modify: `packages/mdx-editor/react/source-fallback-node-view.tsx`
- Create: `packages/mdx-editor/react/node-views.test.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write node view registration tests**

Create `packages/mdx-editor/react/node-views.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createMdxNodeViews } from "./node-views";
import { mdxEditorSchema } from "../schema/schema";

describe("createMdxNodeViews", () => {
    it("registers advanced markdown node views", () => {
        const nodeViews = createMdxNodeViews({ imageLoader: undefined });

        expect(Object.keys(nodeViews).sort()).toEqual(
            expect.arrayContaining([
                "callout",
                "footnote_definition",
                "math_block",
                "math_inline",
                "mermaid_block",
                "source_fallback",
                "table",
                "task_item",
            ]),
        );
        expect(mdxEditorSchema.nodes.mermaid_block).toBeDefined();
    });
});
```

- [ ] **Step 2: Run node view tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/react/node-views.test.tsx
```

Expected: FAIL because `createMdxNodeViews` does not register advanced views.

- [ ] **Step 3: Define shared NodeViewProps and adapter**

Update `packages/mdx-editor/react/node-views.tsx`:

```tsx
export interface NodeViewProps {
    node: import("prosemirror-model").Node;
    updateAttrs: (attrs: Record<string, unknown>) => void;
}

export interface MdxNodeViewOptions {
    imageLoader?: (src: string) => Promise<string>;
}

export function createMdxNodeViews(options: MdxNodeViewOptions = {}) {
    // Return ProseMirror NodeViewConstructor map.
}
```

Implementation requirement: use a small DOM-backed node view wrapper for React components. It must dispatch `setNodeMarkup(getPos(), undefined, { ...node.attrs, ...attrs })` when `updateAttrs` is called.

- [ ] **Step 4: Implement table and task views**

Create:

- `table-node-view.tsx`: renders `<table data-mdx-node-type="table">` with simple add-row/add-column buttons and cell content DOM managed by ProseMirror.
- `task-list-node-view.tsx`: renders checkbox; `onChange` calls `updateAttrs({ checked })`; task label content remains editable.

- [ ] **Step 5: Implement math and Mermaid views**

Create:

- `math-node-view.tsx`: renders preview with KaTeX if valid; renders `<textarea>` when focused/editing; updates `latex`.
- `mermaid-node-view.tsx`: renders source textarea and preview container with `data-mdx-mermaid-preview`; updates `code`; invalid diagrams show MDX-owned error UI.

Mermaid view must not execute arbitrary script and must use existing strict Mermaid renderer conventions.

- [ ] **Step 6: Implement callout, footnote, and source fallback views**

Create:

- `callout-node-view.tsx`: editable title/type controls and content area.
- `footnote-node-view.tsx`: editable label and definition content.
- `source-fallback-node-view.tsx`: textarea-backed raw Markdown block.

- [ ] **Step 7: Register views**

Update `createMdxNodeViews` to return constructors for:

```ts
table, task_item, math_inline, math_block, mermaid_block, callout, footnote_definition, source_fallback
```

Update `MdxEditorProvider` or `createEditorState` to pass node views to `new EditorView`.

- [ ] **Step 8: Add minimal styles**

Append to `app/globals.css`:

```css
.mdx-source-fallback textarea,
.mdx-mermaid-node textarea,
.mdx-math-node textarea {
    width: 100%;
    min-height: 6rem;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

- [ ] **Step 9: Run node view tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/react/node-views.test.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/mdx-editor/react/node-views.tsx packages/mdx-editor/react/table-node-view.tsx packages/mdx-editor/react/task-list-node-view.tsx packages/mdx-editor/react/math-node-view.tsx packages/mdx-editor/react/mermaid-node-view.tsx packages/mdx-editor/react/callout-node-view.tsx packages/mdx-editor/react/footnote-node-view.tsx packages/mdx-editor/react/source-fallback-node-view.tsx packages/mdx-editor/react/node-views.test.tsx app/globals.css
git commit -m "feat(editor): add advanced markdown node views"
```

## Task 9: Provider Real-Time Editing And Metadata Preservation

**Files:**

- Modify: `packages/mdx-editor/react/mdx-editor-provider.tsx`
- Modify: `packages/mdx-editor/react/mdx-editor-provider.test.tsx`
- Modify: `packages/mdx-editor/core/types.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.ts`

- [ ] **Step 1: Write provider real-time editing tests**

Append to `packages/mdx-editor/react/mdx-editor-provider.test.tsx`:

```tsx
it("emits markdown when ProseMirror document changes through editable content", async () => {
    const onMarkdownChange = vi.fn();

    await act(async () => {
        root.render(
            <MdxEditorProvider initialMarkdown={"# Title\\n\\nBody\\n"} onMarkdownChange={onMarkdownChange}>
                <MdxEditorView />
            </MdxEditorProvider>,
        );
    });

    const paragraph = host.querySelector("p[data-mdx-node-type='paragraph']");
    expect(paragraph).not.toBeNull();

    paragraph!.textContent = "Changed";
    paragraph!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Changed" }));

    await act(async () => {});

    expect(onMarkdownChange).toHaveBeenCalled();
    expect(onMarkdownChange.mock.calls.at(-1)?.[0]).toContain("Changed");
});
```

- [ ] **Step 2: Run provider tests and verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: FAIL if transaction/DOM event does not emit changed Markdown or metadata is reset incorrectly.

- [ ] **Step 3: Preserve parsed metadata across transactions**

Update `ParsedMarkdownDocument` in `packages/mdx-editor/core/types.ts` if needed:

```ts
export interface ParsedMarkdownDocument {
    doc: ProseMirrorNode;
    originalMarkdown: string;
    sourceSlices: SourceSlice[];
    diagnostics: EditorDiagnostic[];
}
```

Keep this shape, but in `MdxEditorProvider` stop reparsing the whole serialized Markdown after every transaction unless required. Maintain:

- `parsedRef.current.originalMarkdown`
- `parsedRef.current.sourceSlices`
- updated `doc`

Use `serializeMarkdown({ ...parsedRef.current, doc: nextState.doc })`.

- [ ] **Step 4: Reparse only on resetMarkdown**

In `rebuildEditorFromMarkdown`, keep full parse/reset behavior because incoming Markdown may be from disk or app state. In transaction dispatch, do not discard source metadata for unchanged blocks.

- [ ] **Step 5: Run provider tests and verify pass**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mdx-editor/react/mdx-editor-provider.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx packages/mdx-editor/core/types.ts packages/mdx-editor/serializer/serialize-markdown.ts
git commit -m "fix(editor): emit realtime markdown from wysiwyg edits"
```

## Task 10: Remove Global Source Mode From EditorPane

**Files:**

- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`
- Modify: `packages/mdx-editor/react/index.ts`
- Optional Delete: `packages/mdx-editor/react/source-mode-editor.tsx`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Run caller proof**

Run:

```bash
rg -n "SourceModeEditor|source mode|源码|setMode\\(|mode === \"source\"|sourceDraft" packages features app README.md README.zh-CN.md docs/loopx/specs
```

Expected: current retained callers are `EditorPane` and exports/tests. Paste output into task notes.

- [ ] **Step 2: Write failing absence test**

Append to `features/editor/components/editor-pane.test.tsx`:

```tsx
it("does not render a global source mode switch", () => {
    render(
        <EditorPane
            rootPath="/tmp/ws"
            tab={{ tabId: "tab-1", path: "/tmp/ws/Note.md", title: "Note.md", markdown: "# Title\\n", dirty: false }}
            onMarkdownChange={vi.fn()}
            onPendingCliCommandHandled={vi.fn()}
        />,
    );

    expect(screen.queryByRole("group", { name: "编辑模式" })).toBeNull();
    expect(screen.queryByRole("button", { name: "源码" })).toBeNull();
});
```

If this test file uses a custom render helper or mocked adapter, adapt imports to the existing style in the file.

- [ ] **Step 3: Run test and verify failure**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx
```

Expected: FAIL because the global mode switch is still rendered.

- [ ] **Step 4: Remove source mode state and UI**

Update `features/editor/components/editor-pane.tsx`:

- Remove `SourceModeEditor` import.
- Remove `mode`, `setMode`, `sourceDraft`, `sourceMarkdown`.
- Remove the top toolbar containing `aria-label="编辑模式"`.
- Remove branches checking `mode === "source"`.
- Always render `<DOMD />` plus `EditorMermaidPreviewLayer` until Mermaid is fully node-view backed.
- Keep find/replace shortcuts, paste/drop image handling, wikilink click handling, CLI command handling.

- [ ] **Step 5: Remove public source mode export if no current caller remains**

Run:

```bash
rg -n "SourceModeEditor|source-mode-editor" packages features app README.md README.zh-CN.md docs/loopx/specs
```

If only `packages/mdx-editor/react/index.ts` exports it and no strict current caller remains:

- Remove export from `packages/mdx-editor/react/index.ts`.
- Delete `packages/mdx-editor/react/source-mode-editor.tsx`.

If a fallback node view imports it, keep the file internal and remove public export only.

- [ ] **Step 6: Run absence tests and source mode negative command**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx
! rg -n "SourceModeEditor|aria-label=\"编辑模式\"|mode === \"source\"|sourceDraft" features/editor/components/editor-pane.tsx packages/mdx-editor/react/index.ts
```

Expected: Vitest PASS and `rg` command returns no matches.

- [ ] **Step 7: Commit**

```bash
git add features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx packages/mdx-editor/react/index.ts packages/mdx-editor/react/source-mode-editor.tsx README.md README.zh-CN.md
git commit -m "feat(editor): remove global source mode"
```

## Task 11: App Adapter, DOM Contract, Find/Replace, Outline, CLI Compatibility

**Files:**

- Modify: `features/editor/components/editor-kernel-adapter.test.tsx`
- Modify: `features/editor/hooks/use-editor-bridge.test.tsx`
- Modify: `features/editor/lib/editor-dom-contract.ts`
- Modify: `features/editor/lib/visible-text-search.test.ts`
- Modify: `features/editor/lib/markdown-line-scroll.test.ts`
- Modify: `features/editor/lib/mermaid-dom.test.ts`
- Modify: `packages/mdx-editor/react/mdx-editor-provider.test.tsx`

- [ ] **Step 1: Write adapter compatibility tests**

Append to `features/editor/components/editor-kernel-adapter.test.tsx`:

```tsx
it("keeps adapter markdown and selection APIs compatible with advanced nodes", async () => {
    const markdown = "| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n- [x] Done\\n";

    render(
        <DOMDProvider initMd={markdown}>
            <DOMD />
            <AdapterProbe />
        </DOMDProvider>,
    );

    expect(screen.getByTestId("current-markdown").textContent).toContain("| A | B |");
    expect(document.querySelector("[data-mdx-node-type='table']")).not.toBeNull();
    expect(document.querySelector("[data-mdx-node-type='task_item']")).not.toBeNull();
});
```

If `AdapterProbe` does not exist, add it in the test file:

```tsx
function AdapterProbe() {
    const data = useRenderData();
    return <div data-testid="current-markdown">{data.currentMarkdown}</div>;
}
```

- [ ] **Step 2: Add DOM contract selectors**

Update `features/editor/lib/editor-dom-contract.ts` so block selectors include:

```ts
[data-mdx-node-type='blockquote'],
[data-mdx-node-type='bullet_list'],
[data-mdx-node-type='ordered_list'],
[data-mdx-node-type='task_item'],
[data-mdx-node-type='table'],
[data-mdx-node-type='callout'],
[data-mdx-node-type='mermaid_block'],
[data-mdx-node-type='math_block'],
[data-mdx-node-type='source_fallback']
```

- [ ] **Step 3: Update visible text tests**

Append to `features/editor/lib/visible-text-search.test.ts`:

```ts
it("searches editable advanced markdown text but excludes generated previews", () => {
    const root = document.createElement("div");
    root.setAttribute("data-mdx-editor-root", "");
    const callout = document.createElement("div");
    callout.setAttribute("data-mdx-node-type", "callout");
    callout.textContent = "User visible note";
    const preview = document.createElement("div");
    preview.setAttribute("data-mdx-mermaid-preview", "mermaid-1");
    preview.textContent = "Generated diagram label";
    root.append(callout, preview);

    const text = collectVisibleText(root).text;

    expect(text).toContain("User visible note");
    expect(text).not.toContain("Generated diagram label");
});
```

Use the actual helper exported by `visible-text-search.ts`; if it is not `collectVisibleText`, use the current exported function name.

- [ ] **Step 4: Run integration helper tests and verify failure/pass state**

Run:

```bash
npx vitest run features/editor/components/editor-kernel-adapter.test.tsx features/editor/hooks/use-editor-bridge.test.tsx features/editor/lib/visible-text-search.test.ts features/editor/lib/markdown-line-scroll.test.ts features/editor/lib/mermaid-dom.test.ts
```

Expected: initial failure until selectors and adapter behavior are updated; final run in Step 6 must pass.

- [ ] **Step 5: Fix integration helpers**

Update helper implementations to rely only on `data-mdx-*` selectors. Keep CLI selection snapshot shape unchanged:

```ts
{
    has_selection,
    selected_text,
    before,
    after,
    before_truncated,
    after_truncated,
}
```

Do not add fields to CLI responses.

- [ ] **Step 6: Run integration helper tests and verify pass**

Run:

```bash
npx vitest run features/editor/components/editor-kernel-adapter.test.tsx features/editor/hooks/use-editor-bridge.test.tsx features/editor/lib/visible-text-search.test.ts features/editor/lib/markdown-line-scroll.test.ts features/editor/lib/mermaid-dom.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/editor/components/editor-kernel-adapter.test.tsx features/editor/hooks/use-editor-bridge.test.tsx features/editor/lib/editor-dom-contract.ts features/editor/lib/visible-text-search.test.ts features/editor/lib/markdown-line-scroll.test.ts features/editor/lib/mermaid-dom.test.ts packages/mdx-editor/react/mdx-editor-provider.test.tsx
git commit -m "test(editor): preserve app integration contract"
```

## Task 12: Browser-Level Clipboard And IME Verification Harness

**Files:**

- Modify: `package.json`
- Create: `packages/mdx-editor/react/mdx-editor-browser.test.tsx`
- Optional Create: `scripts/verify-editor-browser.mjs`

- [ ] **Step 1: Decide whether Playwright is already available**

Run:

```bash
npm ls playwright @playwright/test
```

Expected: either installed dependency output or `empty`. If not installed, prefer a small jsdom/browser-adjacent Vitest test first; add Playwright only if clipboard APIs cannot be covered.

- [ ] **Step 2: Add browser-like clipboard tests**

Create `packages/mdx-editor/react/mdx-editor-browser.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MdxEditorProvider, MdxEditorView } from "./index";

describe("mdx editor browser behaviors", () => {
    it("renders selectable formatted content for native copy", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(
                <MdxEditorProvider initialMarkdown={"# Title\\n\\nA **bold** link.\\n"}>
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const heading = host.querySelector("h1[data-mdx-node-type='heading']");
        const strong = host.querySelector("strong");

        expect(heading?.textContent).toBe("Title");
        expect(strong?.textContent).toBe("bold");

        act(() => root.unmount());
        host.remove();
    });
});
```

- [ ] **Step 3: Run browser-like test**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-browser.test.tsx
```

Expected: PASS after earlier tasks; if it fails because formatted DOM is missing, fix schema/node views before continuing.

- [ ] **Step 4: Add manual verification script if Playwright is not used**

Create `scripts/verify-editor-browser.mjs` with exact manual checklist output:

```js
console.log([
  "Manual editor verification:",
  "1. Run npm run dev and open the app.",
  "2. Open a Markdown file with headings, bold text, table, task list, math, Mermaid, callout, and footnote.",
  "3. Edit each structure in WYSIWYG; confirm dirty state and save.",
  "4. Select content and press Cmd+C; paste into TextEdit/plain text and a rich text target.",
  "5. Type Chinese text with IME into a paragraph, table cell, and callout.",
  "6. Confirm no global Source/源码 mode toggle is visible.",
].join(\"\\n\"));
```

Add package script:

```json
"verify:editor:manual": "node scripts/verify-editor-browser.mjs"
```

- [ ] **Step 5: Run manual verification script**

Run:

```bash
npm run verify:editor:manual
```

Expected: checklist prints with six numbered items.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/mdx-editor/react/mdx-editor-browser.test.tsx scripts/verify-editor-browser.mjs
git commit -m "test(editor): add browser behavior verification"
```

## Task 13: Final Regression And Governance

**Files:**

- Modify: `docs/loopx/specs/editor.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: tests only if final assertions show stale current-surface behavior.

- [ ] **Step 1: Update current product docs**

Read:

```bash
rg -n "源码|source mode|SourceModeEditor|WYSIWYG|所见即所得|Markdown-native|data-mdx" README.md README.zh-CN.md docs/loopx/specs/editor.md
```

Update only current product text that is stale:

- README may say the editor is Markdown-native WYSIWYG.
- Do not advertise global source mode.
- `docs/loopx/specs/editor.md` should mention source fallback blocks as the unsupported Markdown safety mechanism.

- [ ] **Step 2: Run negative assertions**

Run:

```bash
! rg -n "SourceModeEditor|aria-label=\"编辑模式\"|所见即所得|源码" features/editor/components/editor-pane.tsx packages/mdx-editor/react/index.ts README.md README.zh-CN.md docs/loopx/specs
! rg -n "mode === \"source\"|setMode\\(\"source\"\\)|sourceDraft" features/editor/components/editor-pane.tsx
! rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" packages features app docs/loopx/specs
```

Expected: all commands exit successfully with no matches.

- [ ] **Step 3: Run focused editor test suite**

Run:

```bash
npx vitest run packages/mdx-editor features/editor
```

Expected: PASS.

- [ ] **Step 4: Run full frontend verification**

Run:

```bash
npm run lint
npm run test
npm run build
```

Expected: all commands PASS. `npm run build` may print ordinary framework output but must exit 0.

- [ ] **Step 5: Run Rust verification**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 6: Run packaged build smoke check**

Run:

```bash
npm run build:app
```

Expected: PASS and output includes bundle paths under `src-tauri/target/release/bundle/`.

- [ ] **Step 7: Commit final docs and verification updates**

```bash
git add docs/loopx/specs/editor.md README.md README.zh-CN.md
git commit -m "docs(editor): document hardened wysiwyg behavior"
```

If no docs changed, skip this commit and note "No current product docs were stale."

## Deferred With Rationale

| Item | Rationale | Required Return Path |
|---|---|---|
| Mermaid visual graph editor | Source design explicitly excludes visual Mermaid editor. | New clarify/spec |
| Full formula editor/tool palette | Source design explicitly excludes full formula editor. | New clarify/spec |
| Global source mode | User rejected global source mode; block fallback covers safety. | New clarify/spec |
| Private JSON document storage | Violates Markdown as only persisted truth. | New clarify/spec |
| HTML/MHTML preview | Separate design and separate plan. | `docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md` |

## Self-Review Checklist

- Spec coverage:
  - Real-time WYSIWYG editing: Tasks 6, 8, 9, 12.
  - Copy/paste: Tasks 7 and 12.
  - Basic Markdown: Tasks 1, 2, 3, 6.
  - Advanced Markdown: Tasks 1, 4, 8.
  - Mermaid/math structured editing without visual editors: Tasks 4 and 8.
  - Remove global source mode: Task 10 and final negative assertions.
  - Block-level source fallback: Task 5.
  - App/CLI compatibility: Task 11 and final regression.
  - Markdown-only persistence: Tasks 3, 4, 5, 9, 13.
- Placeholder scan:
  - No task contains banned placeholder wording.
  - Every task names exact files, commands, and expected outputs.
- Type consistency:
  - New node names are consistent across schema/parser/serializer/node views.
  - Adapter API remains existing names.
- Design drift:
  - The plan does not add global source mode, visual Mermaid editor, full formula editor, private JSON storage, or HTML/MHTML behavior.
- Surface-change coverage:
  - Includes Surface Inventory, Caller Proof commands, Negative Assertions, and package/build checks.

## Execution Handoff

Plan complete and saved to `docs/loopx/plans/2026-06-18-markdown-wysiwyg-kernel-hardening.md`.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
