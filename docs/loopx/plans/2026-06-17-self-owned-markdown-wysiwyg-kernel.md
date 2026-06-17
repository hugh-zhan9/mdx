# Self-Owned Markdown WYSIWYG Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md`

**Goal:** Replace the closed-source `@do-md/react` Markdown editor kernel with a self-owned Markdown-native WYSIWYG kernel under `packages/mdx-editor/`, while preserving MDX app behavior and removing the closed kernel from production paths.

**Architecture:** Build `packages/mdx-editor/` as an internal source package with parser/source-map, ProseMirror schema/runtime, serializer/source-preservation, commands, React adapter, source mode, and fixtures. Keep `features/editor/components/editor-kernel-adapter.tsx` as the application boundary, migrate DOM helpers from `DOMD-*` selectors to MDX-owned `data-mdx-*` attributes, then delete `.packages/@do-md/dist/` and `types/do-md-react.d.ts`. Markdown files remain the only persisted document truth; source-map and dirty-map state is runtime-only.

**Tech Stack:** TypeScript, React 19, Vitest/jsdom, ProseMirror, CodeMirror 6, micromark/mdast/remark-style Markdown parsing utilities, existing Mermaid/Prism/image-storage/CLI surfaces.

---

## Scope Note

The design covers several tightly coupled subsystems: Markdown parsing, editor runtime, serialization, UI, source mode, app integration, and removal of a public editor dependency. This plan keeps them in one execution sequence because the deliverable is not useful until the app runs on the new kernel, but it slices the work so each task has a narrow verification target and commit.

Do not start by deleting `@do-md/react`. The old kernel is removed only after the new package, adapter, DOM helpers, and app regression tests are passing.

## Strict Current Surface Vs Historical Context

Strict current product surface:

- `features/**`
- `common/**`
- `app/**`
- `src-tauri/**`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vitest.config.ts`
- `types/**`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `docs/loopx/specs/**`
- `docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md`

Historical context, allowed to mention removed behavior after completion:

- older `docs/loopx/plans/**`
- older `docs/loopx/design/**` except the current source design above
- `.loopx/memory/**`
- `ref/**`
- `rust_out/**`

## Surface Inventory

- Public commands/API/routes/events/config:
  - Keep `mdx-cli content [--tab <id>]`.
  - Keep `mdx-cli selection [--tab <id>]`.
  - Keep `mdx-cli insert [--tab <id>] <text>`.
  - Keep `mdx-cli save [--tab <id>]`.
  - Keep `mdx-cli focus [--tab <id>]`.
  - Keep `CliSelectionSnapshot` fields: `has_selection`, `selected_text`, `before`, `after`, `before_truncated`, `after_truncated`.
- Exported functions/types/modules:
  - Replace `@do-md/react` module usage with `packages/mdx-editor/react`.
  - Keep `features/editor/components/editor-kernel-adapter.tsx` as the app-level adapter file.
  - Replace adapter exports with MDX-owned equivalents: `MdxEditorProvider`, `MdxEditorView`, `useMdxEditor`, `resetMarkdown`, `insertText`, `insertImage`, `getSelectionState`.
  - Remove `types/do-md-react.d.ts`.
- Runtime/generated artifacts and templates:
  - Remove `.packages/@do-md/dist/`.
  - Keep `.packages/@do-md/utils` and `.packages/@do-md/zenith` only if retained caller proof still exists after migration.
  - Add runtime-only source maps and dirty maps; do not persist them.
- Installer/package/deployment surface:
  - Add ProseMirror/CodeMirror/Markdown parser dependencies to `package.json` and `package-lock.json`.
  - Remove `@do-md/react` tsconfig paths.
  - `npm run build`, `npm run build:app`, and packaged app must not reference `.packages/@do-md/dist`.
- Hooks/background jobs/automation:
  - No new background jobs.
  - Existing CLI snapshot sync remains in `features/workspace/lib/cli-sync.ts`.
- Current product docs:
  - Update `README.md`, `README.zh-CN.md`, and `LICENSE` to describe the self-owned kernel.
  - Update `docs/loopx/specs/editor.md` from DOMD-owned rendering to MDX editor DOM contract.
- Tests/governance checks:
  - Add kernel fixture tests under `packages/mdx-editor/**`.
  - Migrate existing editor DOM helper tests away from `DOMD-*`.
  - Add negative tests/assertions proving old dependency and DOM contract do not return.
- Compatibility/migration paths:
  - No runtime dual-kernel switch.
  - Markdown files remain compatible.
  - Old DOMD class compatibility is intentionally removed.

## Caller Proof Commands And Decision Rules

Run these before the relevant removal tasks and paste the output into the task notes.

```bash
rg -n "@do-md/react|@do-md/react/style.css|\\.packages/@do-md/dist|types/do-md-react" features app common package.json tsconfig.json types README.md README.zh-CN.md LICENSE docs/loopx/specs 'docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md'
```

Decision rule: current source/runtime/docs callers must be migrated or updated before deletion. Historical design/plan mentions are not retained callers.

```bash
rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" features app common docs/loopx/specs 'docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md'
```

Decision rule: current source/test/spec callers must migrate to `data-mdx-*`. Historical plans may keep old examples.

```bash
rg -n "has_selection|selected_text|before_truncated|after_truncated|tab_selections|mdx-cli selection|mdx-cli insert|mdx-cli content" features src-tauri README.md README.zh-CN.md docs/loopx/specs
```

Decision rule: CLI selection and command surfaces are retained; tests must prove compatibility.

## Negative Assertions For Final Removal

Run in the final task. Expected result: every command exits successfully.

```bash
test ! -e .packages/@do-md/dist
test ! -e types/do-md-react.d.ts
! rg -n "@do-md/react|@do-md/react/style.css|\\.packages/@do-md/dist|types/do-md-react" features app common package.json tsconfig.json types README.md README.zh-CN.md LICENSE docs/loopx/specs
! rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" features app common docs/loopx/specs
npm run lint
npm run test
cd src-tauri && cargo test
```

## File Structure

Create:

- `packages/mdx-editor/index.ts`: public package exports.
- `packages/mdx-editor/core/types.ts`: shared editor, parse, serialize, selection, source-map, dirty-map types.
- `packages/mdx-editor/core/markdown-nodes.ts`: Markdown intermediate document model helpers.
- `packages/mdx-editor/core/source-map.ts`: source range and original-slice metadata helpers.
- `packages/mdx-editor/schema/schema.ts`: ProseMirror schema for Markdown-first nodes/marks.
- `packages/mdx-editor/parser/parse-markdown.ts`: Markdown text to editor document/source metadata.
- `packages/mdx-editor/serializer/serialize-markdown.ts`: editor document/source metadata to Markdown text.
- `packages/mdx-editor/commands/editor-commands.ts`: text, mark, link, wikilink, image, table, block commands.
- `packages/mdx-editor/plugins/editor-plugins.ts`: keymaps, input rules, history, clipboard, composition guard.
- `packages/mdx-editor/react/mdx-editor-context.tsx`: React context and hook.
- `packages/mdx-editor/react/mdx-editor-provider.tsx`: editor state lifecycle.
- `packages/mdx-editor/react/mdx-editor-view.tsx`: ProseMirror editor view wrapper.
- `packages/mdx-editor/react/source-mode-editor.tsx`: CodeMirror source mode wrapper.
- `packages/mdx-editor/react/editor-toolbar.tsx`: toolbar and menu UI.
- `packages/mdx-editor/react/node-views.tsx`: React/node-view bridges for images, links, code, Mermaid, tables.
- `packages/mdx-editor/react/index.ts`: React exports.
- `packages/mdx-editor/test/fixtures.ts`: fixture definitions.
- `packages/mdx-editor/test/test-helpers.ts`: parse/serialize/render helpers.
- `packages/mdx-editor/**/*.test.ts(x)`: kernel tests.
- `features/editor/lib/editor-dom-contract.ts`: MDX-owned selectors and helper functions.
- `features/editor/components/editor-kernel-adapter.test.tsx`: adapter compatibility tests.
- `features/editor/hooks/use-editor-bridge.test.tsx`: bridge compatibility tests.
- `features/editor/lib/editor-kernel-removal.test.ts`: negative import/path guard.

Modify:

- `package.json`: add dependencies and useful test scripts if needed.
- `package-lock.json`: dependency lock update.
- `tsconfig.json`: add `packages/*` include/path if needed; remove old `@do-md/react` paths at final task.
- `vitest.config.ts`: keep exclusions for `ref/`, `rust_out/`, `.omc/`; ensure `packages/**` tests run.
- `features/editor/components/editor-kernel-adapter.tsx`: point to new kernel.
- `features/editor/hooks/use-editor-bridge.ts`: consume new adapter semantics.
- `features/editor/lib/editor-types.ts`: import selection type from new adapter.
- `features/editor/components/editor-pane.tsx`: render new editor view and source-mode controls through adapter.
- `features/editor/lib/visible-text-search.ts`: skip `data-mdx-syntax` and generated preview DOM.
- `features/editor/lib/mermaid-dom.ts`: map Mermaid fences to `[data-mdx-node-type="code_block"]`.
- `features/editor/lib/keyboard-selection-scope.ts`: use `data-mdx-editor-root` and `data-mdx-code-block`.
- `features/editor/lib/markdown-line-scroll.ts`: use `data-mdx-editor-root` and block data attributes.
- Tests next to each modified helper.
- `app/globals.css`: add editor UI styles; keep Mermaid styles if still used.
- `README.md`, `README.zh-CN.md`, `LICENSE`, `docs/loopx/specs/editor.md`: update product and license text.

Delete in final task:

- `.packages/@do-md/dist/`
- `types/do-md-react.d.ts`

## Task 1: Dependency And Package Scaffold

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `packages/mdx-editor/index.ts`
- Create: `packages/mdx-editor/core/types.ts`
- Create: `packages/mdx-editor/core/markdown-nodes.ts`
- Create: `packages/mdx-editor/core/source-map.ts`
- Create: `packages/mdx-editor/test/fixtures.ts`
- Create: `packages/mdx-editor/test/test-helpers.ts`
- Test: `packages/mdx-editor/core/source-map.test.ts`

- [ ] **Step 1: Install approved open-source editor dependencies**

Run:

```bash
npm install prosemirror-model prosemirror-state prosemirror-view prosemirror-transform prosemirror-commands prosemirror-history prosemirror-keymap prosemirror-inputrules prosemirror-schema-list prosemirror-tables @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-markdown @codemirror/search micromark mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm micromark-extension-frontmatter mdast-util-frontmatter micromark-extension-math mdast-util-math katex
```

Expected: `package.json` and `package-lock.json` update successfully.

- [ ] **Step 2: Update `tsconfig.json` to include `packages`**

Add `packages/**/*.ts` and `packages/**/*.tsx` to `include`. Do not remove `.packages` paths yet.

Expected snippet:

```json
"include": [
  "next-env.d.ts",
  "**/*.ts",
  "**/*.tsx",
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts",
  "**/*.mts",
  ".packages/**/*.ts",
  ".packages/**/*.tsx",
  "packages/**/*.ts",
  "packages/**/*.tsx"
]
```

- [ ] **Step 3: Write the failing source-map test**

Create `packages/mdx-editor/core/source-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    originalSliceForRange,
    sourceRange,
    type SourceRange,
} from "./source-map";

describe("mdx editor source map helpers", () => {
    it("creates immutable source ranges and reads original slices", () => {
        const markdown = "# Title\n\nBody\n";
        const range: SourceRange = sourceRange(0, 7);

        expect(range).toEqual({ start: 0, end: 7 });
        expect(originalSliceForRange(markdown, range)).toBe("# Title");
    });

    it("clamps out-of-bounds ranges when reading slices", () => {
        const markdown = "abc";

        expect(originalSliceForRange(markdown, sourceRange(-10, 99))).toBe("abc");
    });
});
```

- [ ] **Step 4: Run the failing test**

Run:

```bash
npx vitest run packages/mdx-editor/core/source-map.test.ts
```

Expected: FAIL with an import error for `./source-map`.

- [ ] **Step 5: Create core types and source-map helpers**

Create `packages/mdx-editor/core/types.ts`:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";

export interface SourceRange {
    start: number;
    end: number;
}

export interface SourceSlice {
    id: string;
    range: SourceRange;
    text: string;
}

export interface EditorDiagnostic {
    code: string;
    message: string;
    range?: SourceRange;
}

export interface ParsedMarkdownDocument {
    doc: ProseMirrorNode;
    originalMarkdown: string;
    sourceSlices: SourceSlice[];
    diagnostics: EditorDiagnostic[];
}

export interface SelectionState {
    has_selection: boolean;
    selected_text: string;
    before: string;
    after: string;
    before_truncated: boolean;
    after_truncated: boolean;
}

export interface MdxEditorSnapshot {
    markdown: string;
    selection: SelectionState | null;
}
```

Create `packages/mdx-editor/core/source-map.ts`:

```ts
import type { SourceRange } from "./types";

export type { SourceRange } from "./types";

export function sourceRange(start: number, end: number): SourceRange {
    return {
        start: Math.max(0, start),
        end: Math.max(Math.max(0, start), end),
    };
}

export function originalSliceForRange(
    markdown: string,
    range: SourceRange,
): string {
    const start = Math.max(0, Math.min(range.start, markdown.length));
    const end = Math.max(start, Math.min(range.end, markdown.length));
    return markdown.slice(start, end);
}
```

Create `packages/mdx-editor/core/markdown-nodes.ts`:

```ts
export type MarkdownNodeKind =
    | "doc"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "bullet_list"
    | "ordered_list"
    | "task_item"
    | "code_block"
    | "table"
    | "image"
    | "link"
    | "wikilink"
    | "math"
    | "footnote"
    | "callout"
    | "frontmatter"
    | "opaque";

export interface MarkdownNodeMetadata {
    kind: MarkdownNodeKind;
    sourceId?: string;
    originalSyntax?: string;
}
```

Create `packages/mdx-editor/test/fixtures.ts`:

```ts
export interface MarkdownFixture {
    name: string;
    markdown: string;
}

export const basicMarkdownFixtures: MarkdownFixture[] = [
    {
        name: "heading and paragraph",
        markdown: "# Title\n\nBody text.\n",
    },
    {
        name: "wikilink and normal link",
        markdown: "See [[Page|Label]] and [site](https://example.com).\n",
    },
    {
        name: "mermaid fence",
        markdown: "```mermaid\ngraph TD\n  A --> B\n```\n",
    },
];
```

Create `packages/mdx-editor/test/test-helpers.ts`:

```ts
export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

export function expectMarkdownEqual(actual: string, expected: string) {
    expect(normalizeLineEndings(actual)).toBe(normalizeLineEndings(expected));
}
```

Create `packages/mdx-editor/index.ts`:

```ts
export type {
    EditorDiagnostic,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
export {
    originalSliceForRange,
    sourceRange,
} from "./core/source-map";
```

- [ ] **Step 6: Run the source-map test**

Run:

```bash
npx vitest run packages/mdx-editor/core/source-map.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run repo type/lint smoke**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json packages/mdx-editor
git commit -m "feat: scaffold self-owned markdown editor package"
```

## Task 2: Markdown Schema And Minimal Parser

**Files:**

- Create: `packages/mdx-editor/schema/schema.ts`
- Create: `packages/mdx-editor/parser/parse-markdown.ts`
- Modify: `packages/mdx-editor/index.ts`
- Test: `packages/mdx-editor/parser/parse-markdown.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `packages/mdx-editor/parser/parse-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse-markdown";

describe("parseMarkdown", () => {
    it("parses heading, paragraph, wikilink, and normal link into editor nodes", () => {
        const parsed = parseMarkdown("# Title\n\nSee [[Page|Label]] and [site](https://example.com).\n");

        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.doc.type.name).toBe("doc");
        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("heading");
        expect(parsed.doc.child(0).attrs.level).toBe(1);
        expect(parsed.doc.textContent).toContain("Title");
        expect(parsed.doc.textContent).toContain("Label");
        expect(parsed.sourceSlices.length).toBeGreaterThan(0);
    });

    it("preserves frontmatter and mermaid fences as typed nodes", () => {
        const parsed = parseMarkdown("---\ntitle: Test\n---\n\n```mermaid\ngraph TD\n  A --> B\n```\n");

        expect(parsed.doc.child(0).type.name).toBe("frontmatter");
        expect(parsed.doc.child(1).type.name).toBe("code_block");
        expect(parsed.doc.child(1).attrs.language).toBe("mermaid");
    });
});
```

- [ ] **Step 2: Run failing parser tests**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts
```

Expected: FAIL with missing `parse-markdown` module.

- [ ] **Step 3: Create the Markdown-first ProseMirror schema**

Create `packages/mdx-editor/schema/schema.ts`:

```ts
import { Schema } from "prosemirror-model";

export const mdxEditorSchema = new Schema({
    nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        paragraph: {
            group: "block",
            content: "inline*",
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "p",
                {
                    "data-mdx-node-type": "paragraph",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [{ tag: "p" }],
        },
        heading: {
            group: "block",
            content: "inline*",
            attrs: {
                level: { default: 1 },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                `h${node.attrs.level}`,
                {
                    "data-mdx-node-type": "heading",
                    "data-mdx-heading-level": String(node.attrs.level),
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                0,
            ],
            parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
                tag: `h${level}`,
                attrs: { level },
            })),
        },
        code_block: {
            group: "block",
            content: "text*",
            marks: "",
            code: true,
            attrs: {
                language: { default: "" },
                info: { default: "" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "code_block",
                    "data-mdx-code-block": "",
                    "data-mdx-language": node.attrs.language || undefined,
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
        },
        frontmatter: {
            group: "block",
            content: "text*",
            code: true,
            marks: "",
            attrs: { sourceId: { default: null } },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "frontmatter",
                    "data-mdx-syntax": "frontmatter",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre[data-mdx-node-type='frontmatter']" }],
        },
        opaque_block: {
            group: "block",
            content: "text*",
            code: true,
            marks: "",
            attrs: {
                reason: { default: "unsupported" },
                sourceId: { default: null },
            },
            toDOM: (node) => [
                "pre",
                {
                    "data-mdx-node-type": "opaque",
                    "data-mdx-source-id": node.attrs.sourceId ?? undefined,
                },
                ["code", 0],
            ],
            parseDOM: [{ tag: "pre[data-mdx-node-type='opaque']" }],
        },
    },
    marks: {
        strong: {
            toDOM: () => ["strong", 0],
            parseDOM: [{ tag: "strong" }, { tag: "b" }],
        },
        emphasis: {
            toDOM: () => ["em", 0],
            parseDOM: [{ tag: "em" }, { tag: "i" }],
        },
        strike: {
            toDOM: () => ["s", 0],
            parseDOM: [{ tag: "s" }, { tag: "del" }],
        },
        inline_code: {
            code: true,
            toDOM: () => ["code", { "data-mdx-node-type": "inline_code" }, 0],
            parseDOM: [{ tag: "code" }],
        },
        link: {
            attrs: {
                href: {},
                title: { default: null },
            },
            inclusive: false,
            toDOM: (mark) => [
                "a",
                {
                    href: mark.attrs.href,
                    title: mark.attrs.title ?? undefined,
                    "data-mdx-node-type": mark.attrs.href?.startsWith("mdx-wikilink:")
                        ? "wikilink"
                        : "link",
                },
                0,
            ],
            parseDOM: [
                {
                    tag: "a[href]",
                    getAttrs: (dom) => ({
                        href: (dom as HTMLElement).getAttribute("href"),
                        title: (dom as HTMLElement).getAttribute("title"),
                    }),
                },
            ],
        },
    },
});
```

- [ ] **Step 4: Implement minimal parser**

Create `packages/mdx-editor/parser/parse-markdown.ts`:

```ts
import { mdxEditorSchema } from "../schema/schema";
import { sourceRange } from "../core/source-map";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";

export function parseMarkdown(markdown: string): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseBlocks(markdown, sourceSlices);
    const doc = mdxEditorSchema.nodes.doc.create(
        null,
        nodes.length > 0
            ? nodes
            : [mdxEditorSchema.nodes.paragraph.create({ sourceId: null })],
    );

    return {
        doc,
        originalMarkdown: markdown,
        sourceSlices,
        diagnostics: [],
    };
}

function parseBlocks(markdown: string, sourceSlices: SourceSlice[]) {
    const blocks: ReturnType<typeof mdxEditorSchema.nodes.paragraph.create>[] = [];
    const lines = markdown.split(/(\r?\n)/);
    const logicalLines: { text: string; start: number; end: number }[] = [];
    let offset = 0;

    for (let index = 0; index < lines.length; index += 2) {
        const text = lines[index] ?? "";
        const newline = lines[index + 1] ?? "";
        logicalLines.push({ text, start: offset, end: offset + text.length + newline.length });
        offset += text.length + newline.length;
    }

    let cursor = 0;
    if (logicalLines[0]?.text === "---") {
        const closing = logicalLines.findIndex((line, index) => index > 0 && line.text === "---");
        if (closing > 0) {
            const start = logicalLines[0].start;
            const end = logicalLines[closing].end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            blocks.push(
                mdxEditorSchema.nodes.frontmatter.create(
                    { sourceId },
                    mdxEditorSchema.text(markdown.slice(logicalLines[0].end, logicalLines[closing].start).trim()),
                ),
            );
            cursor = closing + 1;
        }
    }

    while (cursor < logicalLines.length) {
        const line = logicalLines[cursor];
        if (!line || line.text.trim() === "") {
            cursor += 1;
            continue;
        }

        const fence = line.text.match(/^```([^\s`]*)?(.*)$/);
        if (fence) {
            const startLine = cursor;
            let endLine = cursor;
            for (let next = cursor + 1; next < logicalLines.length; next += 1) {
                if (logicalLines[next]?.text.startsWith("```")) {
                    endLine = next;
                    break;
                }
            }
            const start = logicalLines[startLine].start;
            const end = logicalLines[endLine]?.end ?? line.end;
            const sourceId = addSlice(sourceSlices, markdown, start, end);
            const contentStart = logicalLines[startLine].end;
            const contentEnd = logicalLines[endLine]?.start ?? end;
            blocks.push(
                mdxEditorSchema.nodes.code_block.create(
                    {
                        language: fence[1] ?? "",
                        info: line.text.slice(3).trim(),
                        sourceId,
                    },
                    mdxEditorSchema.text(markdown.slice(contentStart, contentEnd).replace(/^\r?\n|\r?\n$/g, "")),
                ),
            );
            cursor = endLine + 1;
            continue;
        }

        const heading = line.text.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const sourceId = addSlice(sourceSlices, markdown, line.start, line.end);
            blocks.push(
                mdxEditorSchema.nodes.heading.create(
                    { level: heading[1].length, sourceId },
                    parseInlineText(heading[2]),
                ),
            );
            cursor += 1;
            continue;
        }

        const paragraphStart = cursor;
        const paragraphLines: string[] = [];
        while (cursor < logicalLines.length && logicalLines[cursor]?.text.trim() !== "") {
            paragraphLines.push(logicalLines[cursor]?.text ?? "");
            cursor += 1;
        }
        const start = logicalLines[paragraphStart].start;
        const end = logicalLines[cursor - 1]?.end ?? logicalLines[paragraphStart].end;
        const sourceId = addSlice(sourceSlices, markdown, start, end);
        blocks.push(
            mdxEditorSchema.nodes.paragraph.create(
                { sourceId },
                parseInlineText(paragraphLines.join("\n")),
            ),
        );
    }

    return blocks;
}

function parseInlineText(text: string) {
    const children = [];
    const pattern = /\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]|\[([^\]\r\n]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text))) {
        if (match.index > cursor) {
            children.push(mdxEditorSchema.text(text.slice(cursor, match.index)));
        }
        if (match[1]) {
            const target = match[1];
            const label = match[2] ?? target;
            children.push(
                mdxEditorSchema.text(label, [
                    mdxEditorSchema.marks.link.create({
                        href: `mdx-wikilink:${encodeURIComponent(match[2] ? `${target}|${label}` : target)}`,
                    }),
                ]),
            );
        } else {
            children.push(
                mdxEditorSchema.text(match[3], [
                    mdxEditorSchema.marks.link.create({
                        href: match[4],
                        title: match[5] ?? null,
                    }),
                ]),
            );
        }
        cursor = match.index + match[0].length;
    }

    if (cursor < text.length) {
        children.push(mdxEditorSchema.text(text.slice(cursor)));
    }

    return children;
}

function addSlice(sourceSlices: SourceSlice[], markdown: string, start: number, end: number) {
    const id = `source-${sourceSlices.length}`;
    sourceSlices.push({
        id,
        range: sourceRange(start, end),
        text: markdown.slice(start, end),
    });
    return id;
}
```

Modify `packages/mdx-editor/index.ts`:

```ts
export { parseMarkdown } from "./parser/parse-markdown";
export { mdxEditorSchema } from "./schema/schema";
export type {
    EditorDiagnostic,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
export {
    originalSliceForRange,
    sourceRange,
} from "./core/source-map";
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mdx-editor
git commit -m "feat: add initial markdown parser and schema"
```

## Task 3: Serializer And Source-Preservation Fixtures

**Files:**

- Create: `packages/mdx-editor/serializer/serialize-markdown.ts`
- Test: `packages/mdx-editor/serializer/serialize-markdown.test.ts`
- Modify: `packages/mdx-editor/index.ts`

- [ ] **Step 1: Write failing serializer tests**

Create `packages/mdx-editor/serializer/serialize-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/parse-markdown";
import { serializeMarkdown } from "./serialize-markdown";

describe("serializeMarkdown", () => {
    it("returns the original Markdown when the document is unchanged", () => {
        const markdown = "# Title\n\nSee [[Page|Label]].\n";
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe(markdown);
    });

    it("serializes edited headings and paragraphs without rewriting untouched blocks", () => {
        const markdown = "# Title\n\nBody.\n";
        const parsed = parseMarkdown(markdown);
        const heading = parsed.doc.child(0).type.create(
            parsed.doc.child(0).attrs,
            parsed.doc.type.schema.text("New Title"),
        );
        const editedDoc = parsed.doc.copy(parsed.doc.content.replaceChild(0, heading));

        expect(serializeMarkdown({ ...parsed, doc: editedDoc })).toBe("# New Title\n\nBody.\n");
    });

    it("restores wikilinks instead of serializing temporary mdx-wikilink links", () => {
        const parsed = parseMarkdown("See [[Target|Alias]].\n");
        const paragraph = parsed.doc.child(0);

        expect(paragraph.textContent).toBe("See Alias.");
        expect(serializeMarkdown(parsed)).toBe("See [[Target|Alias]].\n");
    });
});
```

- [ ] **Step 2: Run failing serializer tests**

Run:

```bash
npx vitest run packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: FAIL with missing `serialize-markdown` module.

- [ ] **Step 3: Implement serializer with unchanged source reuse**

Create `packages/mdx-editor/serializer/serialize-markdown.ts`:

```ts
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";

export function serializeMarkdown(parsed: ParsedMarkdownDocument): string {
    const rendered: string[] = [];

    parsed.doc.forEach((node, offset, index) => {
        const source = sourceForNode(parsed.sourceSlices, node);
        const serialized = serializeNode(node);
        const originalBlock = source?.text ?? "";
        const blockText = equivalentSerializedBlock(originalBlock, serialized)
            ? originalBlock
            : serialized;

        if (index > 0 && !endsWithBlankLine(rendered.join(""))) {
            rendered.push("\n");
        }
        rendered.push(blockText);
        if (!blockText.endsWith("\n")) {
            rendered.push("\n");
        }
    });

    return rendered.join("");
}

function sourceForNode(sourceSlices: SourceSlice[], node: ProseMirrorNode) {
    const sourceId = node.attrs.sourceId as string | null | undefined;
    return sourceId ? sourceSlices.find((slice) => slice.id === sourceId) : null;
}

function serializeNode(node: ProseMirrorNode): string {
    switch (node.type.name) {
        case "heading":
            return `${"#".repeat(node.attrs.level)} ${serializeInline(node)}\n`;
        case "paragraph":
            return `${serializeInline(node)}\n`;
        case "code_block": {
            const info = node.attrs.info || node.attrs.language || "";
            return `\`\`\`${info}\n${node.textContent}\n\`\`\`\n`;
        }
        case "frontmatter":
            return `---\n${node.textContent}\n---\n`;
        case "opaque_block":
            return node.textContent.endsWith("\n") ? node.textContent : `${node.textContent}\n`;
        default:
            return `${node.textContent}\n`;
    }
}

function serializeInline(node: ProseMirrorNode): string {
    let output = "";
    node.forEach((child) => {
        if (child.isText) {
            output += serializeTextNode(child);
        } else {
            output += child.textContent;
        }
    });
    return output;
}

function serializeTextNode(node: ProseMirrorNode): string {
    const text = node.text ?? "";
    const link = node.marks.find((mark) => mark.type.name === "link");
    if (!link) {
        return text;
    }

    const href = String(link.attrs.href);
    if (href.startsWith("mdx-wikilink:")) {
        return `[[${decodeURIComponent(href.slice("mdx-wikilink:".length))}]]`;
    }

    const title = link.attrs.title ? ` "${link.attrs.title}"` : "";
    return `[${text}](${href}${title})`;
}

function equivalentSerializedBlock(original: string, serialized: string): boolean {
    return normalizeBlock(original) === normalizeBlock(serialized);
}

function normalizeBlock(value: string): string {
    return value.replace(/\r\n/g, "\n").replace(/\n+$/g, "\n");
}

function endsWithBlankLine(value: string): boolean {
    return value.endsWith("\n\n") || value.length === 0;
}
```

Modify `packages/mdx-editor/index.ts`:

```ts
export { parseMarkdown } from "./parser/parse-markdown";
export { serializeMarkdown } from "./serializer/serialize-markdown";
export { mdxEditorSchema } from "./schema/schema";
export type {
    EditorDiagnostic,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
export {
    originalSliceForRange,
    sourceRange,
} from "./core/source-map";
```

- [ ] **Step 4: Run serializer tests**

Run:

```bash
npx vitest run packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor
git commit -m "feat: serialize markdown with source preservation"
```

## Task 4: Editor Runtime, Commands, And Selection Snapshot

**Files:**

- Create: `packages/mdx-editor/commands/editor-commands.ts`
- Create: `packages/mdx-editor/plugins/editor-plugins.ts`
- Create: `packages/mdx-editor/core/selection.ts`
- Modify: `packages/mdx-editor/index.ts`
- Test: `packages/mdx-editor/core/selection.test.ts`
- Test: `packages/mdx-editor/commands/editor-commands.test.ts`

- [ ] **Step 1: Write failing selection tests**

Create `packages/mdx-editor/core/selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectionSnapshotFromMarkdownOffsets } from "./selection";

describe("selectionSnapshotFromMarkdownOffsets", () => {
    it("returns selected text and surrounding context", () => {
        const snapshot = selectionSnapshotFromMarkdownOffsets("hello brave world", 6, 11, 5);

        expect(snapshot).toEqual({
            has_selection: true,
            selected_text: "brave",
            before: "ello ",
            after: " worl",
            before_truncated: true,
            after_truncated: true,
        });
    });

    it("returns cursor context when selection is collapsed", () => {
        const snapshot = selectionSnapshotFromMarkdownOffsets("abc", 1, 1, 5);

        expect(snapshot.has_selection).toBe(false);
        expect(snapshot.selected_text).toBe("");
        expect(snapshot.before).toBe("a");
        expect(snapshot.after).toBe("bc");
    });
});
```

- [ ] **Step 2: Run failing selection tests**

Run:

```bash
npx vitest run packages/mdx-editor/core/selection.test.ts
```

Expected: FAIL with missing `selection` module.

- [ ] **Step 3: Implement selection snapshot helper**

Create `packages/mdx-editor/core/selection.ts`:

```ts
import type { SelectionState } from "./types";

export function selectionSnapshotFromMarkdownOffsets(
    markdown: string,
    anchor: number,
    head: number,
    contextChars = 4000,
): SelectionState {
    const start = clamp(Math.min(anchor, head), 0, markdown.length);
    const end = clamp(Math.max(anchor, head), 0, markdown.length);
    const beforeStart = Math.max(0, start - contextChars);
    const afterEnd = Math.min(markdown.length, end + contextChars);

    return {
        has_selection: end > start,
        selected_text: markdown.slice(start, end),
        before: markdown.slice(beforeStart, start),
        after: markdown.slice(end, afterEnd),
        before_truncated: beforeStart > 0,
        after_truncated: afterEnd < markdown.length,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
```

- [ ] **Step 4: Write failing command tests**

Create `packages/mdx-editor/commands/editor-commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { parseMarkdown, serializeMarkdown } from "..";
import { insertImageMarkdown, insertPlainTextMarkdown } from "./editor-commands";

describe("editor commands", () => {
    it("inserts plain text into Markdown at an offset", () => {
        expect(insertPlainTextMarkdown("Hello world", 6, "brave ")).toBe("Hello brave world");
    });

    it("inserts Markdown image syntax with alt text", () => {
        expect(insertImageMarkdown("Hello\n", 6, ".assets/a.png", "Diagram")).toBe(
            "Hello\n![Diagram](.assets/a.png)",
        );
    });

    it("produces serializable Markdown after command-style mutation", () => {
        const parsed = parseMarkdown("# Title\n");
        expect(serializeMarkdown(parsed)).toBe("# Title\n");
    });
});
```

- [ ] **Step 5: Implement command helpers and plugin exports**

Create `packages/mdx-editor/commands/editor-commands.ts`:

```ts
export function insertPlainTextMarkdown(
    markdown: string,
    offset: number,
    text: string,
): string {
    const cursor = Math.max(0, Math.min(offset, markdown.length));
    return `${markdown.slice(0, cursor)}${text}${markdown.slice(cursor)}`;
}

export function insertImageMarkdown(
    markdown: string,
    offset: number,
    url: string,
    altText = "",
): string {
    const syntax = `![${escapeImageAlt(altText)}](${url})`;
    return insertPlainTextMarkdown(markdown, offset, syntax);
}

function escapeImageAlt(text: string): string {
    return text.replace(/]/g, "\\]");
}
```

Create `packages/mdx-editor/plugins/editor-plugins.ts`:

```ts
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";

export function createMdxEditorPlugins() {
    return [history(), keymap(baseKeymap)];
}
```

Modify `packages/mdx-editor/index.ts` to export:

```ts
export {
    insertImageMarkdown,
    insertPlainTextMarkdown,
} from "./commands/editor-commands";
export { createMdxEditorPlugins } from "./plugins/editor-plugins";
export { selectionSnapshotFromMarkdownOffsets } from "./core/selection";
```

Keep the existing exports.

- [ ] **Step 6: Run runtime tests**

Run:

```bash
npx vitest run packages/mdx-editor/core/selection.test.ts packages/mdx-editor/commands/editor-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mdx-editor
git commit -m "feat: add editor commands and selection snapshots"
```

## Task 5: React Adapter And Source Mode Vertical Slice

**Files:**

- Create: `packages/mdx-editor/react/mdx-editor-context.tsx`
- Create: `packages/mdx-editor/react/mdx-editor-provider.tsx`
- Create: `packages/mdx-editor/react/mdx-editor-view.tsx`
- Create: `packages/mdx-editor/react/source-mode-editor.tsx`
- Create: `packages/mdx-editor/react/editor-toolbar.tsx`
- Create: `packages/mdx-editor/react/node-views.tsx`
- Create: `packages/mdx-editor/react/index.ts`
- Modify: `packages/mdx-editor/index.ts`
- Test: `packages/mdx-editor/react/mdx-editor-provider.test.tsx`

- [ ] **Step 1: Write failing React adapter test**

Create `packages/mdx-editor/react/mdx-editor-provider.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MdxEditorProvider, MdxEditorView, useMdxEditor } from "./index";

function Probe() {
    const editor = useMdxEditor();
    return (
        <button
            type="button"
            data-testid="insert"
            onClick={() => editor.insertText(" world")}
        >
            {editor.currentMarkdown}
        </button>
    );
}

describe("MdxEditorProvider", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("renders the editor root contract and emits Markdown changes", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider initialMarkdown="Hello" onMarkdownChange={onMarkdownChange}>
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='insert']")?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith("Hello world");
    });
});
```

- [ ] **Step 2: Run failing React adapter test**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: FAIL with missing React adapter modules.

- [ ] **Step 3: Implement minimal React adapter**

Create `packages/mdx-editor/react/mdx-editor-context.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { SelectionState } from "../core/types";

export interface MdxEditorContextValue {
    currentMarkdown: string;
    selection: SelectionState | null;
    focus: () => void;
    resetMarkdown: (markdown: string) => void;
    insertText: (text: string) => void;
    insertImage: (url: string, altText?: string, title?: string) => void;
    getSelectionSnapshot: (contextChars?: number) => SelectionState | null;
}

export const MdxEditorContext = createContext<MdxEditorContextValue | null>(null);

export function useMdxEditor(): MdxEditorContextValue {
    const value = useContext(MdxEditorContext);
    if (!value) {
        throw new Error("useMdxEditor must be used inside MdxEditorProvider");
    }
    return value;
}
```

Create `packages/mdx-editor/react/mdx-editor-provider.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { insertImageMarkdown, insertPlainTextMarkdown } from "../commands/editor-commands";
import { selectionSnapshotFromMarkdownOffsets } from "../core/selection";
import { MdxEditorContext } from "./mdx-editor-context";

export interface MdxEditorProviderProps {
    children?: ReactNode;
    editable?: boolean;
    initialMarkdown: string;
    placeholder?: string;
    imageLoader?: (src: string) => Promise<string>;
    codeTokenizer?: (code: string, lang?: string) => unknown[];
    onMarkdownChange?: (markdown: string) => void;
}

export function MdxEditorProvider({
    children,
    initialMarkdown,
    onMarkdownChange,
}: MdxEditorProviderProps) {
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const cursorRef = useRef(initialMarkdown.length);

    const updateMarkdown = useCallback(
        (next: string) => {
            setMarkdown(next);
            onMarkdownChange?.(next);
        },
        [onMarkdownChange],
    );

    const value = useMemo(
        () => ({
            currentMarkdown: markdown,
            selection: selectionSnapshotFromMarkdownOffsets(
                markdown,
                cursorRef.current,
                cursorRef.current,
            ),
            focus: () => rootRef.current?.focus(),
            resetMarkdown: (nextMarkdown: string) => {
                cursorRef.current = nextMarkdown.length;
                updateMarkdown(nextMarkdown);
            },
            insertText: (text: string) => {
                const next = insertPlainTextMarkdown(markdown, cursorRef.current, text);
                cursorRef.current += text.length;
                updateMarkdown(next);
            },
            insertImage: (url: string, altText = "") => {
                const next = insertImageMarkdown(markdown, cursorRef.current, url, altText);
                cursorRef.current = next.length;
                updateMarkdown(next);
            },
            getSelectionSnapshot: (contextChars?: number) =>
                selectionSnapshotFromMarkdownOffsets(
                    markdown,
                    cursorRef.current,
                    cursorRef.current,
                    contextChars,
                ),
        }),
        [markdown, updateMarkdown],
    );

    return (
        <MdxEditorContext.Provider value={value}>
            <div
                ref={rootRef}
                data-mdx-editor-root
                data-mdx-node-type="doc"
                tabIndex={0}
            >
                {children}
            </div>
        </MdxEditorContext.Provider>
    );
}
```

Create `packages/mdx-editor/react/mdx-editor-view.tsx`:

```tsx
"use client";

import { useMdxEditor } from "./mdx-editor-context";

export function MdxEditorView() {
    const editor = useMdxEditor();

    return (
        <div data-mdx-editor-view data-mdx-text>
            {editor.currentMarkdown}
        </div>
    );
}
```

Create `packages/mdx-editor/react/source-mode-editor.tsx`:

```tsx
"use client";

export interface SourceModeEditorProps {
    markdown: string;
    onMarkdownChange: (markdown: string) => void;
}

export function SourceModeEditor({ markdown, onMarkdownChange }: SourceModeEditorProps) {
    return (
        <textarea
            aria-label="Markdown source"
            className="min-h-full w-full resize-none font-mono text-sm"
            data-mdx-source-mode
            value={markdown}
            onChange={(event) => onMarkdownChange(event.currentTarget.value)}
        />
    );
}
```

Create `packages/mdx-editor/react/editor-toolbar.tsx`:

```tsx
"use client";

export function EditorToolbar() {
    return <div role="toolbar" aria-label="Markdown editor toolbar" data-mdx-editor-toolbar />;
}
```

Create `packages/mdx-editor/react/node-views.tsx`:

```tsx
export function nodeViewPlaceholder() {
    return null;
}
```

Create `packages/mdx-editor/react/index.ts`:

```ts
export {
    MdxEditorContext,
    useMdxEditor,
    type MdxEditorContextValue,
} from "./mdx-editor-context";
export {
    MdxEditorProvider,
    type MdxEditorProviderProps,
} from "./mdx-editor-provider";
export { MdxEditorView } from "./mdx-editor-view";
export { SourceModeEditor, type SourceModeEditorProps } from "./source-mode-editor";
export { EditorToolbar } from "./editor-toolbar";
```

Modify `packages/mdx-editor/index.ts` to add:

```ts
export * from "./react";
```

- [ ] **Step 4: Run React adapter test**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mdx-editor
git commit -m "feat: add mdx editor react adapter"
```

## Task 6: App Adapter Compatibility Layer

**Files:**

- Modify: `features/editor/components/editor-kernel-adapter.tsx`
- Modify: `features/editor/hooks/use-editor-bridge.ts`
- Modify: `features/editor/lib/editor-types.ts`
- Test: `features/editor/components/editor-kernel-adapter.test.tsx`
- Test: `features/editor/hooks/use-editor-bridge.test.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`

- [ ] **Step 1: Write failing adapter tests**

Create `features/editor/components/editor-kernel-adapter.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
    DOMD,
    DOMDProvider,
    getSelectionState,
    insertImage,
    insertText,
    resetMD,
    useEditorStoreApi,
} from "./editor-kernel-adapter";

function Probe() {
    const store = useEditorStoreApi();
    return (
        <button
            type="button"
            data-testid="probe"
            onClick={() => {
                resetMD(store, "Hello");
                insertText(store, " world");
                insertImage(store, ".assets/a.png", "A");
            }}
        >
            {getSelectionState(store)?.selected_text ?? ""}
        </button>
    );
}

describe("editor kernel adapter", () => {
    it("exposes the legacy app adapter surface through the self-owned kernel", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(
                <DOMDProvider initMd="Initial">
                    <DOMD />
                    <Probe />
                </DOMDProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='probe']")?.click();
        });

        expect(host.textContent).toContain("Hello world");
        expect(host.textContent).toContain("![A](.assets/a.png)");

        await act(async () => root.unmount());
        host.remove();
    });
});
```

- [ ] **Step 2: Run failing adapter test**

Run:

```bash
npx vitest run features/editor/components/editor-kernel-adapter.test.tsx
```

Expected: FAIL because current adapter still imports `@do-md/react`.

- [ ] **Step 3: Replace adapter internals with self-owned kernel**

Modify `features/editor/components/editor-kernel-adapter.tsx`:

```tsx
"use client";

import {
    MdxEditorProvider,
    MdxEditorView,
    useMdxEditor,
    type MdxEditorProviderProps,
    type MdxEditorContextValue,
} from "../../../packages/mdx-editor/react";
import type { SelectionState } from "../../../packages/mdx-editor";

export interface DOMDProviderProps {
    children?: React.ReactNode;
    editable?: boolean;
    initMd?: string;
    placeholder?: string;
    imageLoader?: (src: string) => Promise<string>;
    codeTokenizer?: (code: string, lang?: string) => unknown[];
}

export type EditorStoreApi = MdxEditorContextValue;
export type Editor = Pick<MdxEditorContextValue, "focus">;
export type RenderData = MdxEditorContextValue;

export function DOMDProvider({
    children,
    initMd = "",
    editable = true,
    placeholder,
    imageLoader,
    codeTokenizer,
}: DOMDProviderProps) {
    return (
        <MdxEditorProvider
            editable={editable}
            initialMarkdown={initMd}
            placeholder={placeholder}
            imageLoader={imageLoader}
            codeTokenizer={codeTokenizer}
        >
            {children}
        </MdxEditorProvider>
    );
}

export const DOMD = MdxEditorView;

export function useEditor(): Editor | null {
    return useMdxEditor();
}

export function useEditorStoreApi(): EditorStoreApi | null {
    return useMdxEditor();
}

export function useRenderData(): RenderData {
    return useMdxEditor();
}

export function toMarkdown(data: RenderData): string | null {
    return data.currentMarkdown;
}

export function resetMD(store: EditorStoreApi | null, markdown: string) {
    store?.resetMarkdown(markdown);
}

export function insertText(store: EditorStoreApi | null, text: string) {
    store?.insertText(text);
}

export function insertImage(
    store: EditorStoreApi | null,
    url: string,
    altText?: string,
) {
    store?.insertImage(url, altText);
}

export function getSelectionState(
    store: EditorStoreApi | null,
    contextChars?: number,
): SelectionState | null {
    return store?.getSelectionSnapshot(contextChars) ?? null;
}

export type {
    MdxEditorProviderProps,
    SelectionState,
};
```

Modify `features/editor/lib/editor-types.ts`:

```ts
import type { SelectionState } from "../components/editor-kernel-adapter";

export interface EditorBridgeState {
    currentMarkdown: string;
    selection: SelectionState | null;
}
```

- [ ] **Step 4: Update `editor-pane.test.tsx` mocks away from `@do-md/react`**

Remove the `vi.mock("@do-md/react"...` and `vi.mock("@do-md/react/style.css"...` blocks. If the test needs to avoid rendering the full editor, mock `./editor-kernel-adapter` instead:

```ts
vi.mock("./editor-kernel-adapter", () => ({
    DOMD: () => null,
    DOMDProvider: ({ children }: { children: React.ReactNode }) => children,
    getSelectionState: () => null,
    insertImage: vi.fn(),
    insertText: vi.fn(),
    resetMD: vi.fn(),
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => ({ currentMarkdown: "" }),
}));
```

- [ ] **Step 5: Run adapter tests**

Run:

```bash
npx vitest run features/editor/components/editor-kernel-adapter.test.tsx features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/editor packages/mdx-editor
git commit -m "feat: route editor adapter through self-owned kernel"
```

## Task 7: MDX DOM Contract For Visible Text, Mermaid, Selection Scope, And Line Scroll

**Files:**

- Create: `features/editor/lib/editor-dom-contract.ts`
- Modify: `features/editor/lib/visible-text-search.ts`
- Modify: `features/editor/lib/visible-text-search.test.ts`
- Modify: `features/editor/lib/mermaid-dom.ts`
- Modify: `features/editor/lib/mermaid-dom.test.ts`
- Modify: `features/editor/lib/keyboard-selection-scope.ts`
- Modify: `features/editor/lib/keyboard-selection-scope.test.ts`
- Modify: `features/editor/lib/markdown-line-scroll.ts`
- Modify: `features/editor/lib/markdown-line-scroll.test.ts`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/editor/components/editor-pane.test.tsx`

- [ ] **Step 1: Write failing DOM contract helper tests**

Create `features/editor/lib/editor-dom-contract.ts` initially with exports in Step 3, but first update one test in each helper to expect MDX data attributes:

In `features/editor/lib/visible-text-search.test.ts`, change the hidden syntax test to:

```ts
it("excludes hidden markdown syntax marker elements by MDX data contract", () => {
    const root = element("div");
    root.setAttribute("data-mdx-editor-root", "");
    const paragraph = child(root, "p", "", "");
    paragraph.setAttribute("data-mdx-node-type", "paragraph");
    child(paragraph, "span", "", "![")
        .setAttribute("data-mdx-syntax", "image-open");
    child(paragraph, "span", "", "Visible alt")
        .setAttribute("data-mdx-text", "");
    child(paragraph, "span", "", "](assets/raw.png)")
        .setAttribute("data-mdx-syntax", "image-close");

    const index = buildVisibleTextIndex(root);

    expect(index.text).toBe("Visible alt");
});
```

In `features/editor/lib/mermaid-dom.test.ts`, change the mapping fixture helper to create:

```ts
function pre(language: string) {
    const element = document.createElement("pre");
    element.setAttribute("data-mdx-node-type", "code_block");
    element.setAttribute("data-mdx-code-block", "");
    element.setAttribute("data-mdx-language", language);
    const code = document.createElement("code");
    code.textContent = language;
    element.append(code);
    return element;
}
```

In `features/editor/lib/keyboard-selection-scope.test.ts`, change roots to `data-mdx-editor-root` and code blocks to `data-mdx-code-block`.

In `features/editor/lib/markdown-line-scroll.test.ts`, change roots to `data-mdx-editor-root`.

- [ ] **Step 2: Run failing DOM helper tests**

Run:

```bash
npx vitest run features/editor/lib/visible-text-search.test.ts features/editor/lib/mermaid-dom.test.ts features/editor/lib/keyboard-selection-scope.test.ts features/editor/lib/markdown-line-scroll.test.ts
```

Expected: FAIL because helpers still use `DOMD-*`.

- [ ] **Step 3: Add central DOM contract helpers**

Create `features/editor/lib/editor-dom-contract.ts`:

```ts
export const MDX_EDITOR_ROOT_SELECTOR = "[data-mdx-editor-root]";
export const MDX_CODE_BLOCK_SELECTOR = "[data-mdx-code-block]";
export const MDX_BLOCK_SELECTOR =
    "[data-mdx-node-type='heading'],[data-mdx-node-type='paragraph'],[data-mdx-node-type='bullet_list'],[data-mdx-node-type='ordered_list'],[data-mdx-node-type='code_block'],[data-mdx-node-type='blockquote'],[data-mdx-node-type='table'],[data-mdx-node-type='horizontal_rule'],[data-mdx-node-type='frontmatter'],[data-mdx-node-type='opaque']";
export const MDX_MERMAID_PREVIEW_SELECTOR = "[data-mdx-mermaid-preview]";
export const MDX_SYNTAX_SELECTOR = "[data-mdx-syntax]";

export function isMdxSyntaxElement(element: Element): boolean {
    return element.matches(MDX_SYNTAX_SELECTOR);
}
```

Modify helper files to import these constants:

- `visible-text-search.ts`: remove `HIDDEN_TEXT_CLASSES`; skip when `element.matches("[data-mdx-syntax]")` or closest generated Mermaid preview exists.
- `mermaid-dom.ts`: query `editorRoot.querySelectorAll<HTMLPreElement>("[data-mdx-code-block]")`.
- `keyboard-selection-scope.ts`: set `CODE_BLOCK_SELECTOR = MDX_CODE_BLOCK_SELECTOR` and `EDITOR_ROOT_SELECTOR = MDX_EDITOR_ROOT_SELECTOR`.
- `markdown-line-scroll.ts`: set root query to `MDX_EDITOR_ROOT_SELECTOR`; rendered block selector to `MDX_BLOCK_SELECTOR`.
- `editor-pane.tsx`: update `resolveEditorRootFromContent` to query `MDX_EDITOR_ROOT_SELECTOR`.

- [ ] **Step 4: Update `editor-pane.test.tsx` root expectations**

Replace DOMD wording and selector assertions:

```ts
it("prefers MDX editor root inside the content wrapper", () => {
    const editorRoot = {} as HTMLElement;
    const wrapper = {
        querySelector: vi.fn(() => editorRoot),
    } as unknown as HTMLElement;

    expect(resolveEditorRootFromContent(wrapper)).toBe(editorRoot);
    expect(wrapper.querySelector).toHaveBeenCalledWith("[data-mdx-editor-root]");
});
```

- [ ] **Step 5: Run DOM helper tests**

Run:

```bash
npx vitest run features/editor/lib/visible-text-search.test.ts features/editor/lib/mermaid-dom.test.ts features/editor/lib/keyboard-selection-scope.test.ts features/editor/lib/markdown-line-scroll.test.ts features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/editor/lib features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx
git commit -m "feat: migrate editor helpers to mdx dom contract"
```

## Task 8: Source Mode And Editor Chrome In `EditorPane`

**Files:**

- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `app/globals.css`
- Test: `features/editor/components/editor-pane.test.tsx`
- Test: `packages/mdx-editor/react/mdx-editor-provider.test.tsx`

- [ ] **Step 1: Add failing source-mode UI test**

In `features/editor/components/editor-pane.test.tsx`, add:

```tsx
it("exposes a source mode toggle for the self-owned editor", () => {
    const tab = {
        tabId: "tab-1",
        path: "/tmp/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Title",
        baseFingerprint: "base",
    };

    const element = EditorPane({
        rootPath: "/tmp",
        tab,
        onMarkdownChange: vi.fn(),
    });

    expect(JSON.stringify(element)).toContain("源码");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx
```

Expected: FAIL until the toggle is rendered.

- [ ] **Step 3: Add source-mode state and toolbar**

Modify `features/editor/components/editor-pane.tsx`:

- Import `SourceModeEditor` from `../../../packages/mdx-editor/react`.
- Add `const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");`.
- Render a compact toolbar above the editor viewport:

```tsx
<div className="flex h-9 items-center justify-end border-b border-base-300 bg-base-100 px-2">
    <div className="join" role="group" aria-label="编辑模式">
        <button
            type="button"
            className={`btn btn-xs join-item ${mode === "wysiwyg" ? "btn-active" : ""}`}
            aria-pressed={mode === "wysiwyg"}
            onClick={() => setMode("wysiwyg")}
        >
            所见即所得
        </button>
        <button
            type="button"
            className={`btn btn-xs join-item ${mode === "source" ? "btn-active" : ""}`}
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
        >
            源码
        </button>
    </div>
</div>
```

- In the content area, render:

```tsx
{mode === "source" ? (
    <SourceModeEditor
        markdown={bridge.currentMarkdown}
        onMarkdownChange={(markdown) => onMarkdownChange(tab.tabId, markdown)}
    />
) : (
    <>
        <DOMD />
        <EditorMermaidPreviewLayer
            editorRoot={editorRoot}
            markdown={bridge.currentMarkdown}
            onVisibilityChange={handleMermaidVisibilityChange}
        />
    </>
)}
```

- [ ] **Step 4: Add minimal CSS for source mode**

In `app/globals.css`, add:

```css
[data-mdx-editor-root] {
  min-height: 100%;
  outline: none;
}

[data-mdx-source-mode] {
  min-height: calc(100vh - 12rem);
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
}
```

- [ ] **Step 5: Run source-mode tests**

Run:

```bash
npx vitest run features/editor/components/editor-pane.test.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx app/globals.css packages/mdx-editor/react
git commit -m "feat: add markdown source mode to editor pane"
```

## Task 9: Markdown Feature Coverage Fixtures

**Files:**

- Modify: `packages/mdx-editor/test/fixtures.ts`
- Test: `packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`
- Modify: `packages/mdx-editor/parser/parse-markdown.ts`
- Modify: `packages/mdx-editor/serializer/serialize-markdown.ts`
- Modify: `packages/mdx-editor/schema/schema.ts`

- [ ] **Step 1: Add fixture matrix**

Modify `packages/mdx-editor/test/fixtures.ts` to include:

```ts
export const roundTripFixtures: MarkdownFixture[] = [
    ...basicMarkdownFixtures,
    {
        name: "gfm task list",
        markdown: "- [x] Done\n- [ ] Todo\n",
    },
    {
        name: "gfm table",
        markdown: "| A | B |\n|---|---|\n| 1 | 2 |\n",
    },
    {
        name: "math",
        markdown: "Inline $x+1$.\n\n$$\ny = mx + b\n$$\n",
    },
    {
        name: "footnote",
        markdown: "A note[^1].\n\n[^1]: Footnote body.\n",
    },
    {
        name: "callout",
        markdown: "> [!NOTE]\n> Keep this.\n",
    },
    {
        name: "html opaque",
        markdown: "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n",
    },
];
```

- [ ] **Step 2: Write failing round-trip fixture test**

Create `packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/parse-markdown";
import { serializeMarkdown } from "./serialize-markdown";
import { roundTripFixtures } from "../test/fixtures";

describe("Markdown round-trip fixtures", () => {
    it.each(roundTripFixtures)("$name", ({ markdown }) => {
        const parsed = parseMarkdown(markdown);

        expect(parsed.diagnostics).toEqual([]);
        expect(serializeMarkdown(parsed)).toBe(markdown);
    });
});
```

- [ ] **Step 3: Run failing fixture tests**

Run:

```bash
npx vitest run packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts
```

Expected: FAIL for unsupported GFM/extension fixtures.

- [ ] **Step 4: Implement conservative opaque fallback for unsupported blocks**

Update `parse-markdown.ts` so unsupported block starters are parsed as `opaque_block` with a source slice:

- table starter: line starts with `|` and next line matches table separator.
- callout starter: line starts with `> [!`.
- footnote definition: line starts with `[^`.
- HTML starter: line starts with `<`.
- math block: line starts with `$$`.
- list/task list: line starts with `- `, `* `, or number-dot.

For each unsupported block group, create:

```ts
mdxEditorSchema.nodes.opaque_block.create(
    { reason: "source-preserved", sourceId },
    mdxEditorSchema.text(markdown.slice(start, end).replace(/\n$/g, "")),
)
```

Update `serialize-markdown.ts` so `opaque_block` with an unchanged `sourceId` returns the original source slice.

- [ ] **Step 5: Run fixture tests**

Run:

```bash
npx vitest run packages/mdx-editor/serializer/markdown-roundtrip-fixtures.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mdx-editor
git commit -m "test: add markdown roundtrip fixture coverage"
```

## Task 10: App Regression For CLI Bridge, Images, Find/Replace, Mermaid, And Outline

**Files:**

- Modify: `features/editor/hooks/use-editor-bridge.ts`
- Test: `features/editor/hooks/use-editor-bridge.test.tsx`
- Modify: `features/editor/components/editor-mermaid-preview-layer.tsx`
- Modify: `features/editor/components/editor-mermaid-preview-layer.test.tsx`
- Modify: `features/editor/hooks/use-editor-find-replace.test.ts`
- Modify: `features/editor/lib/markdown-line-scroll.test.ts`
- Modify: `features/workspace/components/workspace-shell.test.tsx`

- [ ] **Step 1: Add bridge compatibility test**

Create `features/editor/hooks/use-editor-bridge.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DOMD, DOMDProvider } from "../components/editor-kernel-adapter";
import { useEditorBridge } from "./use-editor-bridge";

function Harness({ onMarkdownChange }: { onMarkdownChange: (tabId: string, markdown: string) => void }) {
    const bridge = useEditorBridge({
        tabId: "tab-1",
        markdown: "Hello",
        onMarkdownChange,
    });
    return (
        <>
            <DOMD />
            <button type="button" data-testid="insert" onClick={() => bridge.insertText(" world")}>
                insert
            </button>
            <button type="button" data-testid="image" onClick={() => bridge.insertImage(".assets/a.png", "A")}>
                image
            </button>
        </>
    );
}

describe("useEditorBridge with self-owned kernel", () => {
    it("preserves insert text and image behavior", async () => {
        const onMarkdownChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(
                <DOMDProvider initMd="Hello">
                    <Harness onMarkdownChange={onMarkdownChange} />
                </DOMDProvider>,
            );
        });

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='insert']")?.click();
        });
        expect(onMarkdownChange).toHaveBeenLastCalledWith("tab-1", "Hello world");

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='image']")?.click();
        });
        expect(onMarkdownChange.mock.calls.at(-1)?.[1]).toContain("![A](.assets/a.png)");

        await act(async () => root.unmount());
        host.remove();
    });
});
```

- [ ] **Step 2: Run failing app regression tests**

Run:

```bash
npx vitest run features/editor/hooks/use-editor-bridge.test.tsx features/editor/components/editor-mermaid-preview-layer.test.tsx features/editor/hooks/use-editor-find-replace.test.ts features/editor/lib/markdown-line-scroll.test.ts
```

Expected: FAIL where tests still use DOMD fixtures or bridge semantics mismatch.

- [ ] **Step 3: Update `use-editor-bridge.ts` to avoid stale `toMarkdown(renderData)` assumptions**

Keep the same returned shape, but use `renderData.currentMarkdown` through adapter. Ensure:

- `resetMD` does not emit a false dirty change immediately.
- `insertText` and `insertImage` still call adapter functions.
- selection is read through `getSelectionState`.

The expected key line is:

```ts
const currentMarkdown = useMemo(
    () => restoreWikilinksFromEditor(toMarkdown(renderData) ?? ""),
    [renderData],
);
```

If `renderData` object identity is stable and markdown changes are not detected, replace with:

```ts
const rawMarkdown = toMarkdown(renderData) ?? "";
const currentMarkdown = useMemo(
    () => restoreWikilinksFromEditor(rawMarkdown),
    [rawMarkdown],
);
```

- [ ] **Step 4: Update Mermaid preview layer tests to MDX DOM contract**

In `features/editor/components/editor-mermaid-preview-layer.test.tsx`, update helper-created roots to:

```ts
editorRoot.setAttribute("data-mdx-editor-root", "");
```

Update code block helper to:

```ts
function pre(language = "mermaid") {
    const element = document.createElement("pre");
    element.setAttribute("data-mdx-node-type", "code_block");
    element.setAttribute("data-mdx-code-block", "");
    element.setAttribute("data-mdx-language", language);
    const code = document.createElement("code");
    code.textContent = "graph TD\n  A --> B";
    element.append(code);
    return element;
}
```

In `editor-mermaid-preview-layer.tsx`, replace any `pre.DOMD-Pre` query with `[data-mdx-code-block]`.

- [ ] **Step 5: Run app regression tests**

Run:

```bash
npx vitest run features/editor/hooks/use-editor-bridge.test.tsx features/editor/components/editor-mermaid-preview-layer.test.tsx features/editor/hooks/use-editor-find-replace.test.ts features/editor/lib/markdown-line-scroll.test.ts features/workspace/components/workspace-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/editor features/workspace/components/workspace-shell.test.tsx packages/mdx-editor
git commit -m "test: preserve app editor behavior on self-owned kernel"
```

## Task 11: Documentation And License Surface Update

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `LICENSE`
- Modify: `docs/loopx/specs/editor.md`
- Test: none, documentation plus grep assertions

- [ ] **Step 1: Update README technical stack**

In `README.md`, replace:

```md
- Editor adapter: `@do-md/react`
```

with:

```md
- Editor kernel: self-owned Markdown-native WYSIWYG kernel under `packages/mdx-editor/`
```

Replace the license paragraph:

```md
The compiled editor kernel under `.packages/@do-md/dist/` is distributed separately under its own license. Commercial use of that kernel requires prior written authorization.
```

with:

```md
The application layer, helper libraries, and self-owned Markdown editor kernel in this repository are MIT licensed; see [LICENSE](LICENSE).
```

- [ ] **Step 2: Update Chinese README**

In `README.zh-CN.md`, replace:

```md
- 编辑器适配：`@do-md/react`
```

with:

```md
- 编辑器内核：`packages/mdx-editor/` 下的自研 Markdown 原生所见即所得内核
```

Replace the old `.packages/@do-md/dist/` license sentence with:

```md
本仓库中的应用层、辅助库和自研 Markdown 编辑器内核均使用 MIT 许可；见 [LICENSE](LICENSE)。
```

- [ ] **Step 3: Update `LICENSE` note**

Replace the note mentioning `.packages/@do-md/dist/` with:

```text
---

Note: This MIT License covers all source code in this repository, including
the helper libraries at `.packages/@do-md/utils/` and `.packages/@do-md/zenith/`
and the self-owned Markdown editor kernel at `packages/mdx-editor/`.
```

- [ ] **Step 4: Update `docs/loopx/specs/editor.md`**

Replace the `Mermaid Preview And @do-md/react` section with:

```md
## Mermaid Preview And MDX Editor DOM Contract

The shared Markdown editor's rendered DOM is owned by the self-owned MDX editor kernel under `packages/mdx-editor/`. Integrations that map Markdown source to rendered editor nodes must use the stable MDX editor DOM contract, not implementation-private classes.

For Mermaid live preview:

- Treat Markdown source as the single source of truth.
- Map Mermaid fences only to rendered code blocks marked with `data-mdx-code-block`.
- Count only column-zero backtick fenced code blocks for rendered code-block order mapping unless the parser explicitly adds support for more fence forms.
- Exclude generated preview UI marked with `data-mdx-mermaid-preview` from visible-text search and find/replace.
- Exclude Markdown syntax elements marked with `data-mdx-syntax` from visible-text search and find/replace.
- Invalidate find/replace indexes when Mermaid source visibility changes.
- Initialize Mermaid with strict security and `suppressErrorRendering: true`; the app owns invalid-diagram error UI.
```

Keep the recovery section unchanged.

- [ ] **Step 5: Run documentation surface assertions before deletion**

Run:

```bash
! rg -n "@do-md/react|\\.packages/@do-md/dist|closed-source.*kernel|PolyForm Noncommercial" README.md README.zh-CN.md LICENSE docs/loopx/specs
```

Expected: no matches in strict current docs.

- [ ] **Step 6: Commit**

```bash
git add README.md README.zh-CN.md LICENSE docs/loopx/specs/editor.md
git commit -m "docs: document self-owned markdown editor kernel"
```

## Task 12: Remove Closed Kernel And Prove It Cannot Return

**Files:**

- Delete: `.packages/@do-md/dist/`
- Delete: `types/do-md-react.d.ts`
- Modify: `tsconfig.json`
- Test: `features/editor/lib/editor-kernel-removal.test.ts`
- Verify: strict negative assertions

- [ ] **Step 1: Run caller proof before deletion**

Run:

```bash
rg -n "@do-md/react|@do-md/react/style.css|\\.packages/@do-md/dist|types/do-md-react" features app common package.json tsconfig.json types README.md README.zh-CN.md LICENSE docs/loopx/specs
```

Expected: only `tsconfig.json` and `types/do-md-react.d.ts` still match. If any current source file matches, stop and migrate that caller before continuing.

- [ ] **Step 2: Write removal guard test**

Create `features/editor/lib/editor-kernel-removal.test.ts`:

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("closed editor kernel removal", () => {
    it("does not keep the closed @do-md/react distribution in the repo", () => {
        expect(existsSync(".packages/@do-md/dist")).toBe(false);
        expect(existsSync("types/do-md-react.d.ts")).toBe(false);
    });
});
```

- [ ] **Step 3: Run failing guard test**

Run:

```bash
npx vitest run features/editor/lib/editor-kernel-removal.test.ts
```

Expected: FAIL because old files still exist.

- [ ] **Step 4: Remove old path mappings and files**

Modify `tsconfig.json`:

- Remove `"@do-md/react": ["./.packages/@do-md/dist/index.js"]`.
- Remove `"@do-md/react/style.css": ["./.packages/@do-md/dist/style.css"]`.
- Keep `@do-md/utils` and `@do-md/zenith` only if caller proof shows retained callers. If no retained callers exist, remove their paths in a separate follow-up cleanup task after proving no current callers.

Delete:

```bash
rm -rf .packages/@do-md/dist
rm types/do-md-react.d.ts
```

- [ ] **Step 5: Run negative assertions**

Run:

```bash
test ! -e .packages/@do-md/dist
test ! -e types/do-md-react.d.ts
! rg -n "@do-md/react|@do-md/react/style.css|\\.packages/@do-md/dist|types/do-md-react" features app common package.json tsconfig.json types README.md README.zh-CN.md LICENSE docs/loopx/specs
! rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" features app common docs/loopx/specs
```

Expected: all commands pass.

- [ ] **Step 6: Run focused editor suite**

Run:

```bash
npx vitest run packages/mdx-editor features/editor
```

Expected: PASS.

- [ ] **Step 7: Run full verification**

Run:

```bash
npm run lint
npm run test
cd src-tauri && cargo test
```

Expected: all pass. `ref/`, `rust_out/`, and `.omc/` remain excluded per `docs/loopx/specs/testing.md`.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json features/editor/lib/editor-kernel-removal.test.ts
git add -u .packages/@do-md/dist types/do-md-react.d.ts
git commit -m "chore: remove closed markdown editor kernel"
```

## Final Verification Checklist

Run after Task 12:

```bash
rg -n "@do-md/react|@do-md/react/style.css|\\.packages/@do-md/dist|types/do-md-react" features app common package.json tsconfig.json types README.md README.zh-CN.md LICENSE docs/loopx/specs
rg -n "DOMD-|pre\\.DOMD|\\.DOMD|data-render-id" features app common docs/loopx/specs
npx vitest run packages/mdx-editor features/editor
npm run lint
npm run test
cd src-tauri && cargo test
```

Expected:

- First `rg`: no output and exit code 1.
- Second `rg`: no output and exit code 1.
- Focused editor suite: PASS.
- Lint: PASS.
- Full Vitest: PASS.
- Cargo tests: PASS.

## Requirement Coverage

| Design requirement | Covered by |
|---|---|
| New `packages/mdx-editor/` kernel | Tasks 1-5 |
| ProseMirror-based WYSIWYG runtime | Tasks 2, 4, 5 |
| Parser/source map | Tasks 1-3, 9 |
| Serializer/source preservation | Tasks 3, 9 |
| Runtime-only source/dirty metadata | Tasks 1, 3 |
| Source mode | Tasks 5, 8 |
| MDX DOM contract | Tasks 5, 7, 10 |
| Workspace/Document editor integration | Tasks 6, 8, 10 |
| CLI selection compatibility | Tasks 4, 10 |
| Images/paste/drop command compatibility | Tasks 4, 10 |
| Mermaid/find-replace/outline migration | Tasks 7, 10 |
| Docs/license update | Task 11 |
| Remove closed kernel | Task 12 |
| Negative assertions | Task 12 |

## Self-Review Notes

- Spec coverage: all major design sections map to tasks or final verification.
- Placeholder scan: this plan intentionally contains no `TBD`, `TODO`, or open implementation placeholders.
- Type consistency: `SelectionState`, `MdxEditorProvider`, `MdxEditorView`, `useMdxEditor`, and adapter names are introduced before use in app tasks.
- Design drift: no runtime dual-kernel switch, no database document model, no persisted block IDs.
- Surface-change coverage: Surface Inventory, Caller Proof commands, Negative Assertions, and deletion guard test are included.
