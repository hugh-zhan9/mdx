# Markdown Syntax Plugin Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/Markdown语法插件化编辑器内核需求设计文档.md`

**Goal:** Replace the self-owned Markdown editor's centralized syntax handling with an internal syntax plugin kernel while preserving current editor behavior.

**Architecture:** Build a new explicit `createMdxEditorKernel(...)` instance API under `packages/mdx-editor/kernel/`. Syntax plugins contribute schema specs, parser handlers, serializers, NodeViews, ProseMirror plugins, clipboard handlers, and fixtures; the registry merges and dispatches them by phase and priority. First-phase independent syntax plugins are `html`, `fallback`, `footnote`, `code`, and `mermaid`, while remaining syntax is carried by `core`/`legacy` adapter plugins for syntax families outside this plan.

**Tech Stack:** TypeScript, React, ProseMirror, Vitest, Tauri/Next build pipeline.

## Global Constraints

- Markdown is the only persisted document truth.
- Unsupported Markdown must preserve original source through fallback blocks; no parser path may drop, silently normalize, or rewrite unsupported source.
- First phase is an internal plugin architecture; do not expose third-party plugin APIs.
- First phase does not provide user-facing syntax enable/disable settings.
- User-visible editor behavior must remain unchanged during this architecture migration.
- `mermaid` is an independent syntax plugin and must not reuse `code` fence parser implementation.
- Core parser/serializer/input rules/clipboard contributions are synchronous; async is allowed only in NodeView/render services.
- ProseMirror schema is built once at kernel creation. Plugins cannot dynamically add or remove schema nodes/marks at runtime.
- Fallback policy belongs to the kernel; `source_fallback` schema/NodeView/serializer belong to the fallback syntax plugin.
- Repo callers must migrate to the new kernel API; old public API functions are removed as the main route.
- Verification must include plugin-level tests, registry tests, comprehensive Markdown golden tests, app/editor integration tests, `npm test`, `npm run build`, and `npm run build:sidecars`.
- `ref/`, `rust_out/`, and `.omc/` are historical/reference inputs and must not be included in verification.

---

## Scope Check

The source design covers one subsystem: `packages/mdx-editor` and its direct editor integrations. It is large but coherent because parser, schema, serializer, NodeViews, editor plugins, and clipboard must share one registry contract to remove the current coupling. This plan keeps the work inside one implementation plan, but each task has its own test cycle and commit.

## Surface Inventory

- Public commands/API/routes/events/config:
  - Keep app commands and package scripts unchanged.
  - Replace old editor APIs with `createMdxEditorKernel(...)` and `defaultMarkdownSyntax()`.
- Exported functions/types/modules:
  - Remove main-route exports from `packages/mdx-editor/index.ts`: `parseMarkdown`, `serializeMarkdown`, `mdxEditorSchema`, `createMdxEditorPlugins`.
  - Remove direct React export `nodeViewPlaceholder` if no retained caller remains.
  - Keep React components exported through the new kernel-aware provider path.
- Runtime/generated artifacts and templates:
  - No generated package artifacts are intentionally changed.
  - Build output under `out/`, `src-tauri/target/`, and bundled apps are not committed.
- Installer/package/deployment surface:
  - `package.json` scripts remain unchanged.
  - Tauri configuration remains unchanged.
- Hooks/background jobs/automation:
  - No hook changes.
- Current product docs:
  - `docs/loopx/specs/editor.md` remains binding.
  - This plan does not update user-facing docs unless implementation discovers strict current docs naming removed APIs.
- Tests/governance checks:
  - Existing tests must move to kernel/plugin API.
  - Add registry, plugin, clipboard, and golden tests.
- Compatibility/migration paths:
  - Repo source migrates in the same feature branch.
  - Historical docs may mention old APIs; strict current source must not.

### Caller Proof Commands

Run before removal work and record retained callers in commit notes:

```bash
rg "parseMarkdown\\(|serializeMarkdown\\(|mdxEditorSchema|createMdxEditorPlugins|createMdxNodeViews|markdownInputRulesPlugin|createMarkdownClipboardPlugin|createSourceFallbackPlugin" packages features app scripts common docs/loopx/specs
```

Decision rule:

- Retained caller exists in `packages`, `features`, `app`, `scripts`, or `common` -> migrate it before deleting old API.
- Only historical files under `docs/loopx/design`, `docs/loopx/plans`, `.loopx`, or old release notes reference it -> do not count as retained current caller.
- No retained caller -> delete export or file in the cleanup task.

### Negative Assertions

Run in the final cleanup task:

```bash
! rg "from \"\\.\\/parser\\/parse-markdown\"|from \"\\.\\/serializer\\/serialize-markdown\"|from \"\\.\\/schema\\/schema\"|from \"\\.\\/plugins\\/editor-plugins\"" packages/mdx-editor/index.ts
! rg "createMdxEditorPlugins\\(|markdownInputRulesPlugin\\(|createMarkdownClipboardPlugin\\(|createSourceFallbackPlugin\\(" packages features app common scripts
! rg "mdxEditorSchema|parseMarkdown\\(|serializeMarkdown\\(" features app common scripts
npm pack --dry-run
```

Expected:

- The first three commands exit 1 with no matches.
- `npm pack --dry-run` exits 0 and lists package contents without build artifacts.

Historical paths allowed to mention old APIs: `.loopx/**`, `docs/loopx/design/**`, `docs/loopx/plans/**`.

## File Structure

Create:

- `packages/mdx-editor/kernel/types.ts` — public kernel and syntax contribution types.
- `packages/mdx-editor/kernel/registry.ts` — plugin normalization, schema merge, phase/priority sorting, conflict checks.
- `packages/mdx-editor/kernel/create-kernel.ts` — `createMdxEditorKernel`.
- `packages/mdx-editor/kernel/parse-context.ts` — source slices, `parseInline`, `parseBlocks`, fallback helpers.
- `packages/mdx-editor/kernel/schema.ts` — schema builder from plugin specs.
- `packages/mdx-editor/kernel/serializer.ts` — node/mark serializer registry.
- `packages/mdx-editor/kernel/clipboard.ts` — copy/paste registry entry points.
- `packages/mdx-editor/kernel/index.ts` — kernel exports.
- `packages/mdx-editor/kernel/registry.test.ts` — registry, schema conflict, phase/priority tests.
- `packages/mdx-editor/kernel/kernel.test.ts` — default kernel smoke tests.
- `packages/mdx-editor/syntax/default.ts` — `defaultMarkdownSyntax()`.
- `packages/mdx-editor/syntax/core/index.ts` — base/common syntax adapter for doc/text/paragraph/marks and remaining core behavior.
- `packages/mdx-editor/syntax/legacy/index.ts` — temporary adapter for not-yet-independent syntax.
- `packages/mdx-editor/syntax/html/index.ts`
- `packages/mdx-editor/syntax/html/html.test.ts`
- `packages/mdx-editor/syntax/fallback/index.ts`
- `packages/mdx-editor/syntax/fallback/fallback.test.ts`
- `packages/mdx-editor/syntax/footnote/index.ts`
- `packages/mdx-editor/syntax/footnote/footnote.test.ts`
- `packages/mdx-editor/syntax/code/index.ts`
- `packages/mdx-editor/syntax/code/code.test.ts`
- `packages/mdx-editor/syntax/mermaid/index.ts`
- `packages/mdx-editor/syntax/mermaid/mermaid.test.ts`
- `packages/mdx-editor/syntax/fixtures/markdown-syntax-support.fixture.ts`
- `packages/mdx-editor/syntax/golden-roundtrip.test.ts`

Modify:

- `packages/mdx-editor/index.ts` — export new kernel API and remove old public main-route API.
- `packages/mdx-editor/react/mdx-editor-provider.tsx` — accept/use explicit kernel instance.
- `packages/mdx-editor/react/index.ts` — export kernel-aware React types only.
- `features/editor/components/editor-kernel-adapter.tsx` — create and pass kernel with services.
- `features/editor/components/editor-pane.tsx` — pass image/code/mermaid services through adapter.
- Existing tests under `packages/mdx-editor/**`, `features/editor/**`, and `features/workspace/**` — migrate imports to kernel instance.
- Existing implementation files under `packages/mdx-editor/parser/`, `schema/`, `serializer/`, `plugins/`, `react/node-views.tsx` — either move behavior into syntax modules or mark as internal temporary helpers until final cleanup.

## Task 1: Kernel Types And Registry

**Files:**
- Create: `packages/mdx-editor/kernel/types.ts`
- Create: `packages/mdx-editor/kernel/registry.ts`
- Create: `packages/mdx-editor/kernel/schema.ts`
- Create: `packages/mdx-editor/kernel/index.ts`
- Test: `packages/mdx-editor/kernel/registry.test.ts`

**Interfaces:**
- Produces:
  - `SyntaxPlugin`
  - `SyntaxPhase`
  - `SyntaxPriority`
  - `createSyntaxRegistry(plugins: SyntaxPlugin[]): SyntaxRegistry`
  - `buildSchemaFromRegistry(registry: SyntaxRegistry): Schema`

- [ ] **Step 1: Write failing registry tests**

Create `packages/mdx-editor/kernel/registry.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import { createSyntaxRegistry } from "./registry";
import { buildSchemaFromRegistry } from "./schema";
import type { SyntaxPlugin } from "./types";

const basePlugin: SyntaxPlugin = {
    id: "base",
    nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        paragraph: {
            group: "block",
            content: "inline*",
            toDOM: () => ["p", 0],
            parseDOM: [{ tag: "p" }],
        },
    },
};

describe("syntax registry", () => {
    it("sorts parser contributions by phase then descending priority", () => {
        const registry = createSyntaxRegistry([
            {
                id: "low",
                blockParsers: [{ phase: "block", priority: 10, parse: () => ({ status: "notMatched" }) }],
            },
            {
                id: "high",
                blockParsers: [{ phase: "block", priority: 100, parse: () => ({ status: "notMatched" }) }],
            },
        ]);

        expect(registry.blockParsers.map((parser) => parser.pluginId)).toEqual([
            "high",
            "low",
        ]);
    });

    it("throws on duplicate plugin ids", () => {
        expect(() => createSyntaxRegistry([{ id: "x" }, { id: "x" }])).toThrow(
            "Duplicate syntax plugin id: x",
        );
    });

    it("throws on duplicate schema node names", () => {
        expect(() =>
            createSyntaxRegistry([
                { id: "a", nodes: { paragraph: { group: "block" } } },
                { id: "b", nodes: { paragraph: { group: "block" } } },
            ]),
        ).toThrow("Duplicate schema node: paragraph");
    });

    it("builds a ProseMirror schema from plugin node and mark specs", () => {
        const registry = createSyntaxRegistry([basePlugin]);
        const schema = buildSchemaFromRegistry(registry);

        expect(schema.nodes.doc).toBeDefined();
        expect(schema.nodes.paragraph).toBeDefined();
        expect(schema.text("hello").text).toBe("hello");
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/registry.test.ts
```

Expected: FAIL because `packages/mdx-editor/kernel/registry.ts` does not exist.

- [ ] **Step 3: Implement kernel type contracts**

Create `packages/mdx-editor/kernel/types.ts`:

```ts
import type { MarkSpec, Node as ProseMirrorNode, NodeSpec, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";

export type SyntaxPhase = "block" | "inline" | "fallback" | "clipboard";

export interface ParserNotMatched {
    status: "notMatched";
}

export interface ParserMatched {
    status: "matched";
    node: ProseMirrorNode;
    nextIndex: number;
}

export interface ParserFallback {
    status: "fallback";
    start: number;
    end: number;
    reason: string;
}

export type ParserResult = ParserMatched | ParserNotMatched | ParserFallback;

export interface BlockParserContribution {
    phase: SyntaxPhase;
    priority: number;
    parse: (context: MarkdownParseContext, index: number) => ParserResult;
}

export interface InlineParserContribution {
    phase: SyntaxPhase;
    priority: number;
    parse: (context: InlineParseContext, index: number) => ParserResult;
}

export interface MarkdownParseContext {
    readonly markdown: string;
    readonly schema: Schema;
    readonly sourceSlices: SourceSlice[];
    allocateSourceSlice(start: number, end: number): string;
    parseInline(text: string): ProseMirrorNode[];
    emitFallback(start: number, end: number, reason: string): ProseMirrorNode;
}

export interface InlineParseContext {
    readonly text: string;
    readonly schema: Schema;
}

export interface SerializerContribution {
    nodeSerializers?: Record<string, (node: ProseMirrorNode, context: SerializerContext) => string>;
    markSerializers?: Record<string, MarkSerializer>;
}

export interface MarkSerializer {
    open: string | ((attrs: Record<string, unknown>) => string);
    close: string | ((attrs: Record<string, unknown>) => string);
}

export interface SerializerContext {
    serializeNode(node: ProseMirrorNode): string;
    serializeInline(node: ProseMirrorNode): string;
}

export interface ClipboardContribution {
    toClipboardHtml?: Record<string, (node: ProseMirrorNode, context: ClipboardContext) => string>;
    parseClipboardHtml?: Array<(element: Element, context: ClipboardContext) => ProseMirrorNode[] | null>;
}

export interface ClipboardContext {
    readonly schema: Schema;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode): string;
}

export interface SyntaxPlugin {
    id: string;
    nodes?: Record<string, NodeSpec>;
    marks?: Record<string, MarkSpec>;
    blockParsers?: BlockParserContribution[];
    inlineParsers?: InlineParserContribution[];
    serializers?: SerializerContribution;
    nodeViews?: Record<string, NodeViewConstructor>;
    editorPlugins?: ((schema: Schema) => Plugin)[];
    clipboard?: ClipboardContribution;
}

export interface RegisteredBlockParser extends BlockParserContribution {
    pluginId: string;
}

export interface RegisteredInlineParser extends InlineParserContribution {
    pluginId: string;
}

export interface SyntaxRegistry {
    plugins: SyntaxPlugin[];
    nodes: Record<string, NodeSpec>;
    marks: Record<string, MarkSpec>;
    blockParsers: RegisteredBlockParser[];
    inlineParsers: RegisteredInlineParser[];
    serializers: SerializerContribution[];
    nodeViews: Record<string, NodeViewConstructor>;
    editorPlugins: ((schema: Schema) => Plugin)[];
    clipboard: ClipboardContribution[];
}
```

- [ ] **Step 4: Implement registry and schema builder**

Create `packages/mdx-editor/kernel/registry.ts`:

```ts
import type {
    RegisteredBlockParser,
    RegisteredInlineParser,
    SyntaxPlugin,
    SyntaxRegistry,
} from "./types";

export function createSyntaxRegistry(plugins: SyntaxPlugin[]): SyntaxRegistry {
    const seenPlugins = new Set<string>();
    const nodes: SyntaxRegistry["nodes"] = {};
    const marks: SyntaxRegistry["marks"] = {};
    const blockParsers: RegisteredBlockParser[] = [];
    const inlineParsers: RegisteredInlineParser[] = [];
    const serializers: SyntaxRegistry["serializers"] = [];
    const nodeViews: SyntaxRegistry["nodeViews"] = {};
    const editorPlugins: SyntaxRegistry["editorPlugins"] = [];
    const clipboard: SyntaxRegistry["clipboard"] = [];

    for (const plugin of plugins) {
        if (seenPlugins.has(plugin.id)) {
            throw new Error(`Duplicate syntax plugin id: ${plugin.id}`);
        }
        seenPlugins.add(plugin.id);

        for (const [name, spec] of Object.entries(plugin.nodes ?? {})) {
            if (nodes[name]) {
                throw new Error(`Duplicate schema node: ${name}`);
            }
            nodes[name] = spec;
        }

        for (const [name, spec] of Object.entries(plugin.marks ?? {})) {
            if (marks[name]) {
                throw new Error(`Duplicate schema mark: ${name}`);
            }
            marks[name] = spec;
        }

        blockParsers.push(
            ...(plugin.blockParsers ?? []).map((parser) => ({
                ...parser,
                pluginId: plugin.id,
            })),
        );
        inlineParsers.push(
            ...(plugin.inlineParsers ?? []).map((parser) => ({
                ...parser,
                pluginId: plugin.id,
            })),
        );

        if (plugin.serializers) {
            serializers.push(plugin.serializers);
        }
        Object.assign(nodeViews, plugin.nodeViews ?? {});
        editorPlugins.push(...(plugin.editorPlugins ?? []));
        if (plugin.clipboard) {
            clipboard.push(plugin.clipboard);
        }
    }

    blockParsers.sort(compareContributions);
    inlineParsers.sort(compareContributions);

    return {
        plugins,
        nodes,
        marks,
        blockParsers,
        inlineParsers,
        serializers,
        nodeViews,
        editorPlugins,
        clipboard,
    };
}

function compareContributions(
    a: { phase: string; priority: number },
    b: { phase: string; priority: number },
) {
    if (a.phase !== b.phase) {
        return a.phase.localeCompare(b.phase);
    }
    return b.priority - a.priority;
}
```

Create `packages/mdx-editor/kernel/schema.ts`:

```ts
import { Schema } from "prosemirror-model";
import type { SyntaxRegistry } from "./types";

export function buildSchemaFromRegistry(registry: SyntaxRegistry): Schema {
    return new Schema({
        nodes: registry.nodes,
        marks: registry.marks,
    });
}
```

Create `packages/mdx-editor/kernel/index.ts`:

```ts
export { createSyntaxRegistry } from "./registry";
export { buildSchemaFromRegistry } from "./schema";
export type {
    BlockParserContribution,
    ClipboardContribution,
    ClipboardContext,
    InlineParserContribution,
    MarkdownParseContext,
    ParserResult,
    SerializerContribution,
    SerializerContext,
    SyntaxPhase,
    SyntaxPlugin,
    SyntaxRegistry,
} from "./types";
```

- [ ] **Step 5: Run registry tests**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/mdx-editor/kernel
git commit -m "feat(editor): add syntax kernel registry"
```

## Task 2: Kernel Instance API With Legacy Behavior Adapter

**Files:**
- Create: `packages/mdx-editor/kernel/create-kernel.ts`
- Create: `packages/mdx-editor/syntax/core/index.ts`
- Create: `packages/mdx-editor/syntax/legacy/index.ts`
- Create: `packages/mdx-editor/syntax/default.ts`
- Test: `packages/mdx-editor/kernel/kernel.test.ts`
- Modify: `packages/mdx-editor/kernel/index.ts`

**Interfaces:**
- Consumes: `createSyntaxRegistry`, `buildSchemaFromRegistry`.
- Produces:
  - `createMdxEditorKernel(options: MdxEditorKernelOptions): MdxEditorKernel`
  - `defaultMarkdownSyntax(): SyntaxPlugin[]`
  - `MdxEditorKernel`

- [ ] **Step 1: Write failing kernel API tests**

Create `packages/mdx-editor/kernel/kernel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "./create-kernel";
import { defaultMarkdownSyntax } from "../syntax/default";

describe("createMdxEditorKernel", () => {
    it("creates a schema and preserves basic markdown round-trip", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const parsed = kernel.parseMarkdown("# Title\n\nBody.\n");

        expect(kernel.schema.nodes.heading).toBeDefined();
        expect(parsed.doc.child(0).type.name).toBe("heading");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe("# Title\n\nBody.\n");
    });

    it("creates editor node views and plugins from registry contributions", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });

        expect(kernel.createNodeViews().source_fallback).toBeDefined();
        expect(kernel.createEditorPlugins().length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/kernel.test.ts
```

Expected: FAIL because `create-kernel.ts` and syntax modules do not exist.

- [ ] **Step 3: Parameterize the current parser, serializer, and editor plugin factory**

This step is a hard prerequisite before the React provider switches to `kernel.schema`. A ProseMirror document created by the old `mdxEditorSchema` must never be used with a separately constructed kernel schema, even when the node names and specs are identical.

Modify `packages/mdx-editor/parser/parse-markdown.ts`:

```ts
import type { Schema } from "prosemirror-model";
import type { ParsedMarkdownDocument, SourceSlice } from "../core/types";
import { mdxEditorSchema } from "../schema/schema";
import { parseMarkdownBlocks } from "./block-markdown";

export function parseMarkdown(
    markdown: string,
    schema: Schema = mdxEditorSchema,
): ParsedMarkdownDocument {
    const sourceSlices: SourceSlice[] = [];
    const nodes = parseMarkdownBlocks(markdown, sourceSlices, schema);
    const doc = schema.nodes.doc.create(
        null,
        nodes.length > 0
            ? nodes
            : [schema.nodes.paragraph.create({ sourceId: null })],
    );

    return {
        doc,
        originalMarkdown: markdown,
        sourceSlices,
        diagnostics: [],
    };
}
```

Modify `packages/mdx-editor/parser/block-markdown.ts`:

- Add `import type { Schema } from "prosemirror-model";`.
- Change `parseMarkdownBlocks(markdown, sourceSlices)` to `parseMarkdownBlocks(markdown, sourceSlices, schema: Schema = mdxEditorSchema)`.
- Replace every node or text allocation inside this module from the imported `mdxEditorSchema` singleton to the function-local `schema` parameter.
- Pass `schema` into every helper that creates nodes or calls another parser helper.
- Change every `parseInlineMarkdown(text)` call to `parseInlineMarkdown(text, schema)`.
- Keep `mdxEditorSchema` only as the default value for backward-compatible direct test imports.

Modify `packages/mdx-editor/parser/inline-markdown.ts`:

- Add `import type { Schema } from "prosemirror-model";`.
- Change `parseInlineMarkdown(text)` to `parseInlineMarkdown(text, schema: Schema = mdxEditorSchema)`.
- Replace every node, mark, and text allocation from the imported `mdxEditorSchema` singleton to the function-local `schema` parameter.
- Pass `schema` through recursive inline parsing calls:

```ts
parseInlineMarkdown(wikilink.rawLabel, schema)
parseInlineMarkdown(link.rawLabel, schema)
parseInlineMarkdown(strong.content, schema)
parseInlineMarkdown(strike.content, schema)
parseInlineMarkdown(emphasis.content, schema)
```

- Change helper signatures that allocate text or marks:

```ts
function pushMarkedText(
    schema: Schema,
    children: ProseMirrorNode[],
    pendingText: string,
    markedText: string,
    mark: Mark,
) {
    pushText(schema, children, pendingText);
    pushText(schema, children, markedText, [mark]);
}

function pushText(
    schema: Schema,
    children: ProseMirrorNode[],
    text: string,
    marks?: readonly Mark[],
) {
    if (text.length > 0) {
        children.push(schema.text(text, marks));
    }
}
```

Modify `packages/mdx-editor/serializer/serialize-markdown.ts`:

- Add an options object so source comparison reparses with the same kernel parser:

```ts
export interface SerializeMarkdownOptions {
    parseMarkdown?: (markdown: string) => ParsedMarkdownDocument;
}

export function serializeMarkdown(
    parsed: ParsedMarkdownDocument,
    options: SerializeMarkdownOptions = {},
): string {
    const parseForComparison = options.parseMarkdown ?? parseMarkdown;
    // Keep the current render loop and pass parseForComparison into nodeMatchesSource.
}
```

- Change `nodeMatchesSource(node, source)` to `nodeMatchesSource(node, source, parseForComparison)` and replace the internal `parseMarkdown(source.text)` call with `parseForComparison(source.text)`.

Modify `packages/mdx-editor/plugins/editor-keymap.ts`:

```ts
import type { Schema } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

export function markdownKeymap(
    schema: Schema = mdxEditorSchema,
): Record<string, Command> {
    const { list_item: listItem, task_item: taskItem } = schema.nodes;
    // Keep the current command map logic after this destructuring change.
}
```

Modify `packages/mdx-editor/plugins/editor-plugins.ts`:

```ts
import type { Schema } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

export interface MdxEditorPluginOptions {
    schema?: Schema;
    codeTokenizer?: CodeTokenizer;
}

export function createMdxEditorPlugins(options: MdxEditorPluginOptions = {}) {
    const schema = options.schema ?? mdxEditorSchema;
    return [
        history(),
        createSourceFallbackPlugin(),
        createCodeHighlightPlugin({ codeTokenizer: options.codeTokenizer }),
        markdownInputRulesPlugin(schema),
        createMarkdownClipboardPlugin({ schema }),
        createEditableLinkPlugin(),
        keymap(markdownKeymap(schema)),
        keymap(baseKeymap),
    ];
}
```

Modify `packages/mdx-editor/plugins/editor-clipboard.ts` for the Task 2 compatibility bridge:

```ts
import type { Schema } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

export interface MarkdownClipboardPluginOptions {
    schema?: Schema;
    parseMarkdown?: (markdown: string) => ParsedMarkdownDocument;
    serializeMarkdown?: (doc: ParsedMarkdownDocument) => string;
}

export function createMarkdownClipboardPlugin(
    options: MarkdownClipboardPluginOptions = {},
) {
    const schema = options.schema ?? mdxEditorSchema;
    const parse = options.parseMarkdown ?? ((markdown) => parseMarkdown(markdown, schema));
    const serialize = options.serializeMarkdown ?? serializeMarkdown;
    // use schema, parse, and serialize in sliceToMarkdown, markdownToClipboardHtml,
    // insertMarkdown, and HTML conversion paths instead of direct singletons.
}
```

This temporary clipboard shape is replaced by the full kernel clipboard pipeline in Task 7.

- [ ] **Step 4: Run parser parameterization tests**

Run:

```bash
npx vitest run packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/plugins/editor-keymap.test.ts packages/mdx-editor/plugins/editor-clipboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement default syntax adapters**

Create `packages/mdx-editor/syntax/core/index.ts`. Move the base schema node/mark specs from `packages/mdx-editor/schema/schema.ts` for:

- `doc`
- `text`
- `paragraph`
- marks `strong`, `emphasis`, `strike`, `inline_code`, `link`

The exported function must be:

```ts
import type { SyntaxPlugin } from "../../kernel";

export function coreMarkdownSyntax(): SyntaxPlugin {
    return {
        id: "core",
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
                parseDOM: [
                    {
                        tag: "p",
                        getAttrs: (dom) => ({
                            sourceId: (dom as HTMLElement).getAttribute("data-mdx-source-id"),
                        }),
                    },
                ],
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
                parseDOM: [{ tag: "code[data-mdx-node-type='inline_code']" }],
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
                    },
                    0,
                ],
                parseDOM: [
                    {
                        tag: "a[href]",
                        getAttrs: (dom) => ({
                            href: (dom as HTMLAnchorElement).getAttribute("href"),
                            title: (dom as HTMLAnchorElement).getAttribute("title"),
                        }),
                    },
                ],
            },
        },
    };
}
```

Create `packages/mdx-editor/syntax/legacy/index.ts`. It must initially adapt the current centralized behavior so the new kernel can be introduced without behavior changes:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { createMdxNodeViews } from "../../react/node-views";

const legacyNodeNames = [
    "image",
    "inline_html",
    "heading",
    "blockquote",
    "horizontal_rule",
    "bullet_list",
    "ordered_list",
    "list_item",
    "task_item",
    "code_block",
    "table",
    "table_row",
    "table_cell",
    "table_header",
    "footnote_ref",
    "footnote_definition",
    "math_inline",
    "math_block",
    "callout",
    "mermaid_block",
    "frontmatter",
    "html_block",
    "source_fallback",
] as const;

export function legacyMarkdownSyntax(): SyntaxPlugin {
    const nodes: SyntaxPlugin["nodes"] = {};
    for (const name of legacyNodeNames) {
        nodes[name] = mdxEditorSchema.nodes[name].spec;
    }

    return {
        id: "legacy",
        nodes,
        nodeViews: createMdxNodeViews(),
    };
}
```

Create `packages/mdx-editor/syntax/default.ts`:

```ts
import type { SyntaxPlugin } from "../kernel";
import { coreMarkdownSyntax } from "./core";
import { legacyMarkdownSyntax } from "./legacy";

export function defaultMarkdownSyntax(): SyntaxPlugin[] {
    return [coreMarkdownSyntax(), legacyMarkdownSyntax()];
}
```

- [ ] **Step 6: Implement kernel instance wrapper**

Create `packages/mdx-editor/kernel/create-kernel.ts`:

```ts
import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import type { CodeTokenizer } from "../plugins/editor-code-highlight";
import { createMdxEditorPlugins } from "../plugins/editor-plugins";
import { parseMarkdown as parseMarkdownWithSchema } from "../parser/parse-markdown";
import { serializeMarkdown as serializeParsedMarkdown } from "../serializer/serialize-markdown";
import type { ParsedMarkdownDocument } from "../core/types";
import { buildSchemaFromRegistry } from "./schema";
import { createSyntaxRegistry } from "./registry";
import type { SyntaxPlugin, SyntaxRegistry } from "./types";

export interface MdxEditorKernelServices {
    codeTokenizer?: CodeTokenizer;
    imageLoader?: (src: string) => Promise<string>;
}

export interface MdxEditorKernelOptions {
    syntax: SyntaxPlugin[];
    services?: MdxEditorKernelServices;
}

export interface MdxEditorKernel {
    schema: Schema;
    registry: SyntaxRegistry;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    createNodeViews(): Record<string, NodeViewConstructor>;
    createEditorPlugins(): Plugin[];
    clipboard: {
        serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    };
}

export function createMdxEditorKernel(options: MdxEditorKernelOptions): MdxEditorKernel {
    const registry = createSyntaxRegistry(options.syntax);
    const schema = buildSchemaFromRegistry(registry);

    const parseMarkdown = (markdown: string) => parseMarkdownWithSchema(markdown, schema);
    const serializeMarkdown = (doc: ProseMirrorNode | ParsedMarkdownDocument) =>
        serializeParsedMarkdown(isParsedDocument(doc) ? doc : emptyParsedDocument(doc), {
            parseMarkdown,
        });

    return {
        schema,
        registry,
        parseMarkdown,
        serializeMarkdown,
        createNodeViews: () => registry.nodeViews,
        createEditorPlugins: () =>
            createMdxEditorPlugins({
                schema,
                codeTokenizer: options.services?.codeTokenizer,
            }),
        clipboard: {
            serializeMarkdown,
        },
    };
}

function isParsedDocument(candidate: ProseMirrorNode | ParsedMarkdownDocument): candidate is ParsedMarkdownDocument {
    return "doc" in candidate && "sourceSlices" in candidate;
}

function emptyParsedDocument(doc: ProseMirrorNode): ParsedMarkdownDocument {
    return {
        doc,
        originalMarkdown: "",
        sourceSlices: [],
        diagnostics: [],
    };
}
```

Update `packages/mdx-editor/kernel/index.ts`:

```ts
export { createMdxEditorKernel } from "./create-kernel";
export type {
    MdxEditorKernel,
    MdxEditorKernelOptions,
    MdxEditorKernelServices,
} from "./create-kernel";
export { createSyntaxRegistry } from "./registry";
export { buildSchemaFromRegistry } from "./schema";
export type {
    BlockParserContribution,
    ClipboardContribution,
    ClipboardContext,
    InlineParserContribution,
    MarkdownParseContext,
    ParserResult,
    SerializerContribution,
    SerializerContext,
    SyntaxPhase,
    SyntaxPlugin,
    SyntaxRegistry,
} from "./types";
```

- [ ] **Step 7: Run kernel tests**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/registry.test.ts packages/mdx-editor/kernel/kernel.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add packages/mdx-editor/kernel packages/mdx-editor/syntax packages/mdx-editor/parser packages/mdx-editor/serializer packages/mdx-editor/plugins
git commit -m "feat(editor): introduce mdx editor kernel"
```

## Task 3: Kernel-Aware React Provider And Repo Caller Migration

**Files:**
- Modify: `packages/mdx-editor/react/mdx-editor-provider.tsx`
- Modify: `packages/mdx-editor/react/index.ts`
- Modify: `features/editor/components/editor-kernel-adapter.tsx`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify tests importing old APIs where needed.
- Test: `packages/mdx-editor/react/mdx-editor-provider.test.tsx`
- Test: `features/editor/components/editor-pane.test.tsx`

**Interfaces:**
- Consumes: `MdxEditorKernel`, `createMdxEditorKernel`, `defaultMarkdownSyntax`.
- Produces: `MdxEditorProviderProps.kernel?: MdxEditorKernel`.

- [ ] **Step 1: Write failing provider test for explicit kernel**

Add this test to `packages/mdx-editor/react/mdx-editor-provider.test.tsx`:

```tsx
it("uses an explicit kernel instance for parse, serialize, plugins, and node views", async () => {
    const onMarkdownChange = vi.fn();
    const kernel = createMdxEditorKernel({
        syntax: defaultMarkdownSyntax(),
    });

    await act(async () => {
        root.render(
            <MdxEditorProvider
                initialMarkdown={"# Kernel\n\nBody.\n"}
                kernel={kernel}
                onMarkdownChange={onMarkdownChange}
            >
                <MdxEditorView />
            </MdxEditorProvider>,
        );
    });

    expect(host.querySelector("[data-mdx-node-type='heading']")?.textContent).toBe(
        "Kernel",
    );
});
```

Add imports:

```ts
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx -t "explicit kernel"
```

Expected: FAIL because `MdxEditorProviderProps` has no `kernel`.

- [ ] **Step 3: Update provider to consume kernel**

Modify `packages/mdx-editor/react/mdx-editor-provider.tsx`:

- Add prop:

```ts
import type { MdxEditorKernel } from "../kernel";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";

export interface MdxEditorProviderProps {
    initialMarkdown: string;
    children: React.ReactNode;
    editable?: boolean;
    placeholder?: string;
    imageLoader?: (src: string) => Promise<string>;
    codeTokenizer?: CodeTokenizer;
    kernel?: MdxEditorKernel;
    onMarkdownChange?: (markdown: string) => void;
    onSelectionChange?: (selection: DocumentSelectionRange | null) => void;
}
```

- Build the runtime kernel with:

```ts
const runtimeKernel = useMemo(
    () =>
        kernel ??
        createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
            services: {
                codeTokenizer,
                imageLoader,
            },
        }),
    [codeTokenizer, imageLoader, kernel],
);
```

- Replace direct calls:
  - `parseMarkdown(...)` -> `runtimeKernel.parseMarkdown(...)`
  - `serializeMarkdown(...)` -> `runtimeKernel.serializeMarkdown(...)`
  - `mdxEditorSchema` -> `runtimeKernel.schema`
  - `createMdxNodeViews(...)` -> `runtimeKernel.createNodeViews()`
  - `createMdxEditorPlugins(...)` -> `runtimeKernel.createEditorPlugins()`

- [ ] **Step 4: Update editor adapter to create explicit kernel**

Modify `features/editor/components/editor-kernel-adapter.tsx`:

```tsx
import {
    createMdxEditorKernel,
    defaultMarkdownSyntax,
    MdxEditorProvider,
    MdxEditorView,
    type MdxEditorProviderProps,
} from "../../../packages/mdx-editor";
```

Inside `DOMDProvider`, create:

```tsx
const kernel = useMemo(
    () =>
        createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
            services: {
                imageLoader,
                codeTokenizer,
            },
        }),
    [codeTokenizer, imageLoader],
);
```

Pass `kernel={kernel}` to `MdxEditorProvider`.

- [ ] **Step 5: Run provider and editor tests**

Run:

```bash
npx vitest run packages/mdx-editor/react/mdx-editor-provider.test.tsx features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/mdx-editor/react/mdx-editor-provider.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx packages/mdx-editor/react/index.ts features/editor/components/editor-kernel-adapter.tsx features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx
git commit -m "feat(editor): route react provider through kernel"
```

## Task 4: Extract Fallback And HTML Syntax Plugins

**Files:**
- Create/Modify: `packages/mdx-editor/syntax/fallback/index.ts`
- Create: `packages/mdx-editor/syntax/fallback/fallback.test.ts`
- Create/Modify: `packages/mdx-editor/syntax/html/index.ts`
- Create: `packages/mdx-editor/syntax/html/html.test.ts`
- Modify: `packages/mdx-editor/syntax/default.ts`
- Modify: `packages/mdx-editor/syntax/legacy/index.ts`
- Modify: `packages/mdx-editor/kernel/create-kernel.ts`

**Interfaces:**
- Produces:
  - `fallbackSyntax(): SyntaxPlugin`
  - `htmlSyntax(): SyntaxPlugin`
- Moves ownership for `source_fallback`, `inline_html`, `html_block`.

- [ ] **Step 1: Write fallback plugin tests**

Create `packages/mdx-editor/syntax/fallback/fallback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "./index";

describe("fallback syntax", () => {
    it("owns source_fallback schema and serialization", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax()],
        });
        const node = kernel.schema.nodes.source_fallback.create({
            markdown: "<x>\n",
            reason: "unsupported",
            sourceId: "source-0",
        });
        const doc = kernel.schema.nodes.doc.create(null, [node]);

        expect(kernel.serializeMarkdown(doc)).toBe("<x>\n");
        expect(kernel.createNodeViews().source_fallback).toBeDefined();
    });
});
```

- [ ] **Step 2: Write HTML plugin tests**

Create `packages/mdx-editor/syntax/html/html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { htmlSyntax } from "./index";

describe("html syntax", () => {
    it("owns inline_html and html_block schema", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), htmlSyntax()],
        });

        expect(kernel.schema.nodes.inline_html).toBeDefined();
        expect(kernel.schema.nodes.html_block).toBeDefined();
        expect(kernel.createNodeViews().inline_html).toBeDefined();
        expect(kernel.createNodeViews().html_block).toBeDefined();
    });

    it("preserves details as html_block and div as source fallback through the default kernel", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), htmlSyntax()],
        });
        const details = kernel.parseMarkdown(
            "<details>\n  <summary>展开详情</summary>\n  <p>详情内容。</p>\n</details>\n",
        );

        expect(details.doc.child(0).type.name).toBe("html_block");
        expect(details.doc.child(0).attrs.tag).toBe("details");
    });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/fallback/fallback.test.ts packages/mdx-editor/syntax/html/html.test.ts
```

Expected: FAIL because `fallbackSyntax` and `htmlSyntax` do not exist.

- [ ] **Step 4: Implement fallback syntax**

Create `packages/mdx-editor/syntax/fallback/index.ts`:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { SourceFallbackNodeView } from "../../react/source-fallback-node-view";
import { createSourceFallbackNodeView } from "../../react/node-views";

export function fallbackSyntax(): SyntaxPlugin {
    return {
        id: "fallback",
        nodes: {
            source_fallback: mdxEditorSchema.nodes.source_fallback.spec,
        },
        serializers: {
            nodeSerializers: {
                source_fallback: (node) => String(node.attrs.markdown ?? ""),
            },
        },
        nodeViews: {
            source_fallback: createSourceFallbackNodeView,
        },
    };
}

export { SourceFallbackNodeView };
```

If `createSourceFallbackNodeView` is not exported from `react/node-views.tsx`, add the `export` keyword to the existing `createSourceFallbackNodeView` function declaration and do not change its parameters or body.

- [ ] **Step 5: Implement HTML syntax**

Create `packages/mdx-editor/syntax/html/index.ts`:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { InlineHtmlNodeView } from "../../react/inline-html-node-view";
import { HtmlBlockNodeView } from "../../react/html-block-node-view";
import { createHtmlBlockNodeView, createReactNodeView } from "../../react/node-views";

export function htmlSyntax(): SyntaxPlugin {
    return {
        id: "html",
        nodes: {
            inline_html: mdxEditorSchema.nodes.inline_html.spec,
            html_block: mdxEditorSchema.nodes.html_block.spec,
        },
        serializers: {
            nodeSerializers: {
                inline_html: (node) => String(node.attrs.html ?? node.textContent),
                html_block: (node) => String(node.attrs.html ?? node.textContent ?? ""),
            },
        },
        nodeViews: {
            inline_html: createReactNodeView(InlineHtmlNodeView, {
                className: "mdx-inline-html-node",
                domTag: "span",
                inline: true,
            }),
            html_block: createHtmlBlockNodeView,
        },
    };
}

export { HtmlBlockNodeView, InlineHtmlNodeView };
```

If `createReactNodeView` or `createHtmlBlockNodeView` are not exported from `react/node-views.tsx`, export them.

- [ ] **Step 6: Remove these nodes from legacy adapter and update default syntax**

Modify `packages/mdx-editor/syntax/legacy/index.ts` to remove:

- `inline_html`
- `html_block`
- `source_fallback`

Modify `packages/mdx-editor/syntax/default.ts`:

```ts
import type { SyntaxPlugin } from "../kernel";
import { coreMarkdownSyntax } from "./core";
import { fallbackSyntax } from "./fallback";
import { htmlSyntax } from "./html";
import { legacyMarkdownSyntax } from "./legacy";

export function defaultMarkdownSyntax(): SyntaxPlugin[] {
    return [
        coreMarkdownSyntax(),
        fallbackSyntax(),
        htmlSyntax(),
        legacyMarkdownSyntax(),
    ];
}
```

- [ ] **Step 7: Run syntax and existing behavior tests**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/fallback/fallback.test.ts packages/mdx-editor/syntax/html/html.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/react/node-views.test.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add packages/mdx-editor/syntax/fallback packages/mdx-editor/syntax/html packages/mdx-editor/syntax/default.ts packages/mdx-editor/syntax/legacy/index.ts packages/mdx-editor/react/node-views.tsx
git commit -m "feat(editor): extract html and fallback syntax"
```

## Task 5: Extract Footnote Syntax Plugin

**Files:**
- Create/Modify: `packages/mdx-editor/syntax/footnote/index.ts`
- Create: `packages/mdx-editor/syntax/footnote/footnote.test.ts`
- Modify: `packages/mdx-editor/syntax/default.ts`
- Modify: `packages/mdx-editor/syntax/legacy/index.ts`
- Modify: `packages/mdx-editor/parser/block-markdown.ts`
- Modify: `packages/mdx-editor/parser/inline-markdown.ts`

**Interfaces:**
- Produces `footnoteSyntax(): SyntaxPlugin`.
- Owns `footnote_ref`, `footnote_definition`, parser fixtures, serializer, NodeView.

- [ ] **Step 1: Write footnote syntax tests**

Create `packages/mdx-editor/syntax/footnote/footnote.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { footnoteSyntax } from "./index";

describe("footnote syntax", () => {
    it("parses footnote refs and multi-line definitions", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), footnoteSyntax()],
        });
        const parsed = kernel.parseMarkdown(
            [
                "A note[^long-note].",
                "",
                "[^long-note]: First line.",
                "    Second line.",
                "    Third line.",
                "",
            ].join("\n"),
        );

        expect(parsed.doc.child(0).child(1).type.name).toBe("footnote_ref");
        expect(parsed.doc.child(0).child(1).attrs.label).toBe("long-note");
        expect(parsed.doc.child(1).type.name).toBe("footnote_definition");
        expect(parsed.doc.child(1).childCount).toBe(3);
    });

    it("serializes footnote refs and definitions back to markdown", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), footnoteSyntax()],
        });
        const markdown = "A note[^n].\n\n[^n]: Body\n";

        expect(kernel.serializeMarkdown(kernel.parseMarkdown(markdown).doc)).toBe(markdown);
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/footnote/footnote.test.ts
```

Expected: FAIL because `footnoteSyntax` does not exist.

- [ ] **Step 3: Implement footnote syntax**

Create `packages/mdx-editor/syntax/footnote/index.ts`:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { FootnoteNodeView } from "../../react/footnote-node-view";
import { createReactNodeView } from "../../react/node-views";

export function footnoteSyntax(): SyntaxPlugin {
    return {
        id: "footnote",
        nodes: {
            footnote_ref: mdxEditorSchema.nodes.footnote_ref.spec,
            footnote_definition: mdxEditorSchema.nodes.footnote_definition.spec,
        },
        serializers: {
            nodeSerializers: {
                footnote_ref: (node) => `[^${escapeFootnoteLabel(String(node.attrs.label ?? ""))}]`,
                footnote_definition: (node, context) => serializeFootnoteDefinition(node, context),
            },
        },
        nodeViews: {
            footnote_definition: createReactNodeView(FootnoteNodeView, {
                contentDOMTag: "div",
                domTag: "section",
            }),
        },
    };
}

function serializeFootnoteDefinition(node: Parameters<NonNullable<SyntaxPlugin["serializers"]>["nodeSerializers"][string]>[0], context: Parameters<NonNullable<SyntaxPlugin["serializers"]>["nodeSerializers"][string]>[1]) {
    const label = String(node.attrs.label ?? "");
    const firstChild = node.firstChild;
    if (!firstChild) {
        return `[^${label}]:\n`;
    }
    const firstLine =
        firstChild.type.name === "paragraph"
            ? context.serializeInline(firstChild)
            : context.serializeNode(firstChild).replace(/\n$/, "");
    const lines = [`[^${label}]: ${firstLine}`];

    for (let index = 1; index < node.childCount; index += 1) {
        const childText = context.serializeNode(node.child(index)).replace(/\n$/, "");
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `    ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

function escapeFootnoteLabel(label: string) {
    return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export { FootnoteNodeView };
```

- [ ] **Step 4: Remove footnote nodes from legacy adapter and update default syntax**

Remove `footnote_ref` and `footnote_definition` from `legacyNodeNames`.

Add `footnoteSyntax()` to `defaultMarkdownSyntax()` after `fallbackSyntax()`.

- [ ] **Step 5: Move parser ownership without behavior change**

Move the existing footnote parsing helpers from:

- `packages/mdx-editor/parser/block-markdown.ts`
- `packages/mdx-editor/parser/inline-markdown.ts`

into `packages/mdx-editor/syntax/footnote/index.ts` or a helper `packages/mdx-editor/syntax/footnote/parse.ts`.

Keep the moved helpers internal to the plugin module. If tests need direct helper access, export the existing moved function declarations by adding the `export` keyword and preserve their parameter lists.

Then have the registry-backed parser call these plugin contributions. Preserve existing test expectations exactly.

- [ ] **Step 6: Run footnote and regression tests**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/footnote/footnote.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/react/mdx-editor-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add packages/mdx-editor/syntax/footnote packages/mdx-editor/syntax/default.ts packages/mdx-editor/syntax/legacy/index.ts packages/mdx-editor/parser/block-markdown.ts packages/mdx-editor/parser/inline-markdown.ts packages/mdx-editor/react/node-views.tsx
git commit -m "feat(editor): extract footnote syntax"
```

## Task 6: Extract Code And Mermaid Syntax Plugins

**Files:**
- Create/Modify: `packages/mdx-editor/syntax/code/index.ts`
- Create: `packages/mdx-editor/syntax/code/code.test.ts`
- Create/Modify: `packages/mdx-editor/syntax/mermaid/index.ts`
- Create: `packages/mdx-editor/syntax/mermaid/mermaid.test.ts`
- Modify: `packages/mdx-editor/syntax/default.ts`
- Modify: `packages/mdx-editor/syntax/legacy/index.ts`
- Modify: `packages/mdx-editor/parser/block-markdown.ts`
- Modify: `packages/mdx-editor/react/node-views.tsx`

**Interfaces:**
- Produces `codeSyntax()` and `mermaidSyntax()`.
- `mermaidSyntax` implements independent fence parsing and does not call code parser helpers.

- [ ] **Step 1: Write code syntax tests**

Create `packages/mdx-editor/syntax/code/code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { codeSyntax } from "./index";

describe("code syntax", () => {
    it("parses and serializes ordinary fenced code", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), codeSyntax()],
        });
        const markdown = "```ts\nconst value = 1;\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("code_block");
        expect(parsed.doc.child(0).attrs.language).toBe("ts");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
    });

    it("keeps markdown fenced code as code text", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), codeSyntax()],
        });
        const markdown = "```md\n# Not a heading\n[Link](https://x.test)\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("code_block");
        expect(parsed.doc.child(0).textContent).toContain("# Not a heading");
    });
});
```

- [ ] **Step 2: Write Mermaid independent syntax tests**

Create `packages/mdx-editor/syntax/mermaid/mermaid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "../fallback";
import { codeSyntax } from "../code";
import { mermaidSyntax } from "./index";

describe("mermaid syntax", () => {
    it("parses mermaid fences before ordinary code fences", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), mermaidSyntax(), codeSyntax()],
        });
        const markdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
        const parsed = kernel.parseMarkdown(markdown);

        expect(parsed.doc.child(0).type.name).toBe("mermaid_block");
        expect(parsed.doc.child(0).textContent).toBe("graph TD\n  A --> B\n");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
    });

    it("does not call code parser helpers for mermaid fences", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), mermaidSyntax()],
        });
        const parsed = kernel.parseMarkdown("```mermaid\ngraph TD\n```\n");

        expect(parsed.doc.child(0).type.name).toBe("mermaid_block");
    });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/code/code.test.ts packages/mdx-editor/syntax/mermaid/mermaid.test.ts
```

Expected: FAIL because `codeSyntax` and `mermaidSyntax` do not exist.

- [ ] **Step 4: Implement code syntax**

Create `packages/mdx-editor/syntax/code/index.ts`:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { createCodeBlockNodeView } from "../../react/node-views";

export function codeSyntax(): SyntaxPlugin {
    return {
        id: "code",
        nodes: {
            code_block: mdxEditorSchema.nodes.code_block.spec,
            frontmatter: mdxEditorSchema.nodes.frontmatter.spec,
        },
        serializers: {
            nodeSerializers: {
                code_block: (node) => `\`\`\`${String(node.attrs.info ?? node.attrs.language ?? "")}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`,
                frontmatter: (node) => `---\n${textBeforeClosingFence(node.textContent)}---\n`,
            },
        },
        nodeViews: {
            code_block: createCodeBlockNodeView,
        },
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}
```

Export `createCodeBlockNodeView` from `packages/mdx-editor/react/node-views.tsx`.

- [ ] **Step 5: Implement Mermaid syntax independently**

Create `packages/mdx-editor/syntax/mermaid/index.ts`:

```ts
import type { SyntaxPlugin } from "../../kernel";
import { mdxEditorSchema } from "../../schema/schema";
import { MermaidNodeView } from "../../react/mermaid-node-view";
import { createReactNodeView } from "../../react/node-views";

export function mermaidSyntax(): SyntaxPlugin {
    return {
        id: "mermaid",
        nodes: {
            mermaid_block: mdxEditorSchema.nodes.mermaid_block.spec,
        },
        serializers: {
            nodeSerializers: {
                mermaid_block: (node) => `\`\`\`${String(node.attrs.info ?? "mermaid")}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`,
            },
        },
        nodeViews: {
            mermaid_block: createReactNodeView(MermaidNodeView, {
                textBacked: true,
            }),
        },
    };
}

function textBeforeClosingFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

export { MermaidNodeView };
```

- [ ] **Step 6: Remove code/mermaid nodes from legacy and update default syntax**

Remove `code_block`, `frontmatter`, and `mermaid_block` from `legacyNodeNames`.

Update `defaultMarkdownSyntax()` order:

```ts
return [
    coreMarkdownSyntax(),
    fallbackSyntax(),
    htmlSyntax(),
    footnoteSyntax(),
    mermaidSyntax(),
    codeSyntax(),
    legacyMarkdownSyntax(),
];
```

- [ ] **Step 7: Move fence parsing ownership**

Move fence parser logic out of centralized `parseMarkdownBlocks` into code and mermaid syntax parser contributions:

- `mermaidSyntax` parses only `mermaid` fences.
- `codeSyntax` parses all other backtick fences and frontmatter.
- Keep `mermaid` independent: do not import code parser helpers into `packages/mdx-editor/syntax/mermaid/**`.
- Put shared fixture data, not shared parser code, in `packages/mdx-editor/syntax/fixtures/fence-fixtures.ts`.

- [ ] **Step 8: Run syntax and regression tests**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/code/code.test.ts packages/mdx-editor/syntax/mermaid/mermaid.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/react/node-views.test.tsx common/lib/prism.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add packages/mdx-editor/syntax/code packages/mdx-editor/syntax/mermaid packages/mdx-editor/syntax/default.ts packages/mdx-editor/syntax/legacy/index.ts packages/mdx-editor/parser/block-markdown.ts packages/mdx-editor/react/node-views.tsx
git commit -m "feat(editor): extract code and mermaid syntax"
```

## Task 7: Clipboard Plugin Pipeline

**Files:**
- Create/Modify: `packages/mdx-editor/kernel/clipboard.ts`
- Modify: `packages/mdx-editor/plugins/editor-clipboard.ts`
- Add tests: `packages/mdx-editor/kernel/clipboard.test.ts`
- Modify plugin syntax modules to add clipboard contributions.

**Interfaces:**
- Consumes: syntax `clipboard` contributions.
- Produces: kernel-backed clipboard serialization and paste parsing.

- [ ] **Step 1: Write clipboard registry tests**

Create `packages/mdx-editor/kernel/clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "./create-kernel";
import { defaultMarkdownSyntax } from "../syntax/default";

describe("kernel clipboard", () => {
    it("serializes source fallback to markdown through plugin serializer", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const fallback = kernel.schema.nodes.source_fallback.create({
            markdown: "<div>Raw</div>\n",
            reason: "unsupported",
            sourceId: "source-0",
        });
        const doc = kernel.schema.nodes.doc.create(null, [fallback]);

        expect(kernel.clipboard.serializeMarkdown(doc)).toBe("<div>Raw</div>\n");
    });

    it("sanitizes pasted script html into safe text or fallback", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.clipboard.parseHtml("<script>alert(1)</script><p>Safe</p>");

        expect(kernel.serializeMarkdown(parsed.doc)).toContain("Safe");
        expect(kernel.serializeMarkdown(parsed.doc)).not.toContain("script");
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/clipboard.test.ts
```

Expected: FAIL because `kernel.clipboard.parseHtml` does not exist.

- [ ] **Step 3: Implement clipboard registry**

Create `packages/mdx-editor/kernel/clipboard.ts`:

```ts
import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { ParsedMarkdownDocument } from "../core/types";
import type { ClipboardContext, SyntaxRegistry } from "./types";

export interface KernelClipboard {
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    serializeHtml(doc: ProseMirrorNode): string;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    parseHtml(html: string): ParsedMarkdownDocument;
}

export function createKernelClipboard(options: {
    schema: Schema;
    registry: SyntaxRegistry;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
}): KernelClipboard {
    const context: ClipboardContext = {
        schema: options.schema,
        parseMarkdown: options.parseMarkdown,
        serializeMarkdown: (doc) => options.serializeMarkdown(doc),
    };

    return {
        serializeMarkdown: options.serializeMarkdown,
        serializeHtml: (doc) => serializeHtmlNode(doc, options.registry, context),
        parseMarkdown: options.parseMarkdown,
        parseHtml: (html) => {
            const document = new DOMParser().parseFromString(sanitizeClipboardHtml(html), "text/html");
            const text = document.body.textContent ?? "";
            return options.parseMarkdown(text.length > 0 ? `${text}\n` : "");
        },
    };
}

function serializeHtmlNode(
    node: ProseMirrorNode,
    registry: SyntaxRegistry,
    context: ClipboardContext,
): string {
    for (const contribution of registry.clipboard) {
        const renderer = contribution.toClipboardHtml?.[node.type.name];
        if (renderer) {
            return renderer(node, context);
        }
    }

    if (node.isText) {
        return escapeHtml(node.text ?? "");
    }

    let children = "";
    node.forEach((child) => {
        children += serializeHtmlNode(child, registry, context);
    });
    return children;
}

function sanitizeClipboardHtml(html: string) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function escapeHtml(text: string) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
```

Update `create-kernel.ts` to use `createKernelClipboard` and expose `parseHtml` / `serializeHtml`.

- [ ] **Step 4: Route existing ProseMirror clipboard plugin through kernel**

Modify `packages/mdx-editor/plugins/editor-clipboard.ts` to export a factory that accepts `KernelClipboard`:

```ts
import type { KernelClipboard } from "../kernel/clipboard";

export function createMarkdownClipboardPlugin(clipboard?: KernelClipboard) {
    // Keep existing behavior when clipboard is absent during migration.
    // When present, use clipboard.serializeMarkdown/serializeHtml/parseMarkdown/parseHtml.
}
```

Then modify `create-kernel.ts` so `kernel.createEditorPlugins()` passes `kernel.clipboard` into the clipboard plugin path.

- [ ] **Step 5: Add clipboard contributions to migrated syntax plugins**

For each independent plugin, add `clipboard.toClipboardHtml`:

- `fallback`: escape and preserve fallback source.
- `html`: render sanitized inline/block HTML.
- `footnote`: render `footnote_ref` as `<sup>` and definition as `<section>`.
- `code`: render `<pre><code>`.
- `mermaid`: render code-like HTML plus preview-safe marker.

- [ ] **Step 6: Run clipboard tests**

Run:

```bash
npx vitest run packages/mdx-editor/kernel/clipboard.test.ts packages/mdx-editor/plugins/editor-clipboard.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add packages/mdx-editor/kernel/clipboard.ts packages/mdx-editor/kernel/clipboard.test.ts packages/mdx-editor/plugins/editor-clipboard.ts packages/mdx-editor/syntax
git commit -m "feat(editor): route clipboard through syntax plugins"
```

## Task 8: Delete Old Public API Main Route And Migrate Tests

**Files:**
- Modify: `packages/mdx-editor/index.ts`
- Modify: `packages/mdx-editor/react/index.ts`
- Modify tests under `packages/mdx-editor/**`, `features/editor/**`, `features/workspace/**`, `features/document/**` that import old APIs.
- Delete or make internal-only exports if no current caller remains.

**Interfaces:**
- Consumes: `createMdxEditorKernel`, `defaultMarkdownSyntax`.
- Produces public exports:
  - `createMdxEditorKernel`
  - `defaultMarkdownSyntax`
  - `MdxEditorKernel` types
  - React editor components.

- [ ] **Step 1: Run caller proof**

Run:

```bash
rg "parseMarkdown\\(|serializeMarkdown\\(|mdxEditorSchema|createMdxEditorPlugins|createMdxNodeViews|markdownInputRulesPlugin|createMarkdownClipboardPlugin|createSourceFallbackPlugin" packages features app scripts common docs/loopx/specs
```

Expected: matches in current source/tests. Use this output as the migration checklist.

- [ ] **Step 2: Migrate test helpers to kernel**

For every test that currently imports `mdxEditorSchema`, add:

```ts
import { createMdxEditorKernel, defaultMarkdownSyntax } from "../kernel-path";

const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
const schema = kernel.schema;
```

For parser/serializer tests, replace:

```ts
const parsed = parseMarkdown(markdown);
expect(serializeMarkdown(parsed)).toBe(markdown);
```

with:

```ts
const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
const parsed = kernel.parseMarkdown(markdown);
expect(kernel.serializeMarkdown(parsed.doc)).toBe(markdown);
```

- [ ] **Step 3: Update public package exports**

Modify `packages/mdx-editor/index.ts` to export only new main-route APIs and supported React/command/core types:

```ts
export {
    createMdxEditorKernel,
    type MdxEditorKernel,
    type MdxEditorKernelOptions,
    type MdxEditorKernelServices,
} from "./kernel";
export { defaultMarkdownSyntax } from "./syntax/default";
export {
    insertImageNode,
    insertImageMarkdown,
    insertPlainTextMarkdown,
} from "./commands/editor-commands";
export { selectionSnapshotFromMarkdownOffsets } from "./core/selection";
export * from "./react";
export type {
    EditorDiagnostic,
    DocumentSelectionRange,
    MarkdownSelectionOffsets,
    MdxEditorSnapshot,
    ParsedMarkdownDocument,
    SelectionState,
    SourceRange,
    SourceSlice,
} from "./core/types";
export type {
    MarkdownNodeKind,
    MarkdownNodeMetadata,
} from "./core/markdown-nodes";
export { originalSliceForRange, sourceRange } from "./core/source-map";
```

Do not export `parseMarkdown`, `serializeMarkdown`, `mdxEditorSchema`, or `createMdxEditorPlugins` from `packages/mdx-editor/index.ts`.

- [ ] **Step 4: Run negative assertions**

Run:

```bash
! rg "from \"\\.\\/parser\\/parse-markdown\"|from \"\\.\\/serializer\\/serialize-markdown\"|from \"\\.\\/schema\\/schema\"|from \"\\.\\/plugins\\/editor-plugins\"" packages/mdx-editor/index.ts
! rg "createMdxEditorPlugins\\(|markdownInputRulesPlugin\\(|createMarkdownClipboardPlugin\\(|createSourceFallbackPlugin\\(" packages features app common scripts
! rg "mdxEditorSchema|parseMarkdown\\(|serializeMarkdown\\(" features app common scripts
```

Expected: all commands exit 0 because `! rg` inverts no-match exit 1 to success.

- [ ] **Step 5: Run migrated test suite subset**

Run:

```bash
npx vitest run packages/mdx-editor/commands/editor-commands.test.ts packages/mdx-editor/schema/schema.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/react/node-views.test.tsx packages/mdx-editor/react/mdx-editor-provider.test.tsx features/editor/components/editor-pane.test.tsx features/workspace/components/editor-stage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add packages/mdx-editor/index.ts packages/mdx-editor/react/index.ts packages/mdx-editor/kernel packages/mdx-editor/parser packages/mdx-editor/plugins packages/mdx-editor/react packages/mdx-editor/schema packages/mdx-editor/serializer packages/mdx-editor/syntax features/editor features/workspace
git commit -m "refactor(editor): migrate callers to kernel api"
```

## Task 9: Golden Fixtures And Comprehensive Regression Coverage

**Files:**
- Create: `packages/mdx-editor/syntax/fixtures/markdown-syntax-support.fixture.ts`
- Create: `packages/mdx-editor/syntax/golden-roundtrip.test.ts`
- Modify: plugin tests if gaps are found.

**Interfaces:**
- Consumes: `createMdxEditorKernel`, `defaultMarkdownSyntax`.
- Produces comprehensive golden behavior coverage.

- [ ] **Step 1: Add comprehensive fixture**

Create `packages/mdx-editor/syntax/fixtures/markdown-syntax-support.fixture.ts`:

```ts
export const markdownSyntaxSupportFixture = [
    "# Markdown 语法支持检查",
    "",
    "## 12. 代码",
    "",
    "```md",
    "# 这里不应该变成标题",
    "[百度](http://baidu.com)",
    "![图片](.assets/a.png)",
    "> [!WARNING]",
    "```",
    "",
    "````js",
    "```js",
    "console.log(\"nested fence\");",
    "```",
    "````",
    "",
    "## 15. 脚注",
    "",
    "这里有一个脚注引用[^note1]，还有另一个脚注引用[^long-note]。",
    "",
    "[^note1]: 这是第一个脚注定义。",
    "",
    "[^long-note]: 这是一个较长的脚注定义。",
    "    第二行是缩进续行。",
    "    第三行仍然属于脚注。",
    "",
    "## 17. Mermaid",
    "",
    "```mermaid",
    "graph TD",
    "  A[开始] --> B{是否支持 Mermaid?}",
    "```",
    "",
    "## 19. HTML 与不支持块",
    "",
    "行内 HTML：这是 <kbd>Command</kbd> + <kbd>Z</kbd>。",
    "",
    "<div class=\"custom-block\">",
    "  <p>这是一个 HTML 块。如果编辑器不支持结构化编辑，应作为 fallback/source block 保真。</p>",
    "</div>",
    "",
    "<details>",
    "  <summary>展开详情</summary>",
    "  <p>详情内容。</p>",
    "</details>",
    "",
].join(\"\\n\");
```

- [ ] **Step 2: Add golden round-trip tests**

Create `packages/mdx-editor/syntax/golden-roundtrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "./default";
import { markdownSyntaxSupportFixture } from "./fixtures/markdown-syntax-support.fixture";

describe("default syntax golden round trip", () => {
    it("parses key syntax nodes without cross-syntax regressions", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const parsed = kernel.parseMarkdown(markdownSyntaxSupportFixture);
        const nodeNames: string[] = [];
        parsed.doc.descendants((node) => {
            nodeNames.push(node.type.name);
            return true;
        });

        expect(nodeNames).toContain("code_block");
        expect(nodeNames).toContain("footnote_ref");
        expect(nodeNames).toContain("footnote_definition");
        expect(nodeNames).toContain("mermaid_block");
        expect(nodeNames).toContain("inline_html");
        expect(nodeNames).toContain("source_fallback");
        expect(nodeNames).toContain("html_block");
    });

    it("serializes the comprehensive fixture without dropping protected source", () => {
        const kernel = createMdxEditorKernel({ syntax: defaultMarkdownSyntax() });
        const serialized = kernel.serializeMarkdown(
            kernel.parseMarkdown(markdownSyntaxSupportFixture).doc,
        );

        expect(serialized).toContain("# 这里不应该变成标题");
        expect(serialized).toContain("[^long-note]:");
        expect(serialized).toContain("```mermaid");
        expect(serialized).toContain("<div class=\"custom-block\">");
        expect(serialized).toContain("<details>");
    });
});
```

- [ ] **Step 3: Run golden tests**

Run:

```bash
npx vitest run packages/mdx-editor/syntax/golden-roundtrip.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 9**

```bash
git add packages/mdx-editor/syntax/fixtures packages/mdx-editor/syntax/golden-roundtrip.test.ts
git commit -m "test(editor): add syntax plugin golden coverage"
```

## Task 10: Full Verification, Package Surface, And Cleanup

**Files:**
- Modify/delete any obsolete internal files proven unused by caller proof:
  - `packages/mdx-editor/parser/parse-markdown.ts`
  - `packages/mdx-editor/schema/schema.ts`
  - `packages/mdx-editor/serializer/serialize-markdown.ts`
  - `packages/mdx-editor/plugins/editor-plugins.ts`
  - only if no current source imports remain.
- Modify docs only if strict current docs reference old API.

**Interfaces:**
- Consumes all previous task outputs.
- Produces verified, package-ready kernel migration.

- [ ] **Step 1: Run caller proof again**

Run:

```bash
rg "parseMarkdown\\(|serializeMarkdown\\(|mdxEditorSchema|createMdxEditorPlugins|createMdxNodeViews|markdownInputRulesPlugin|createMarkdownClipboardPlugin|createSourceFallbackPlugin" packages features app scripts common docs/loopx/specs
```

Expected: no matches in strict current source for removed public APIs. Matches inside syntax plugin internals are allowed only if they are internal helper names not exported from `packages/mdx-editor/index.ts`; rename helpers if the output is ambiguous.

- [ ] **Step 2: Delete obsolete public-route files only when no retained caller exists**

For each candidate file, run exact proof before deleting:

```bash
rg "parser/parse-markdown|schema/schema|serializer/serialize-markdown|plugins/editor-plugins" packages features app scripts common
```

Decision:

- If no retained caller remains, delete the obsolete file.
- If a syntax plugin still imports a helper from the file, move that helper into the syntax plugin first, then rerun proof.

- [ ] **Step 3: Run negative assertions**

Run:

```bash
! rg "from \"\\.\\/parser\\/parse-markdown\"|from \"\\.\\/serializer\\/serialize-markdown\"|from \"\\.\\/schema\\/schema\"|from \"\\.\\/plugins\\/editor-plugins\"" packages/mdx-editor/index.ts
! rg "createMdxEditorPlugins\\(|markdownInputRulesPlugin\\(|createMarkdownClipboardPlugin\\(|createSourceFallbackPlugin\\(" packages features app common scripts
! rg "mdxEditorSchema|parseMarkdown\\(|serializeMarkdown\\(" features app common scripts
npm pack --dry-run
```

Expected:

- The three `! rg` commands succeed with no output.
- `npm pack --dry-run` exits 0 and does not list `out/`, `src-tauri/target/`, `.loopx/`, or `docs/loopx/plans/` as package runtime surface unless already included before this feature.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: PASS. If unrelated existing failures appear, capture failing test names and run all editor-specific tests below before deciding whether to fix or document them.

- [ ] **Step 5: Run editor-specific tests**

Run:

```bash
npx vitest run common/lib/prism.test.ts packages/mdx-editor/kernel/registry.test.ts packages/mdx-editor/kernel/kernel.test.ts packages/mdx-editor/kernel/clipboard.test.ts packages/mdx-editor/syntax/golden-roundtrip.test.ts packages/mdx-editor/parser/parse-markdown.test.ts packages/mdx-editor/serializer/serialize-markdown.test.ts packages/mdx-editor/react/mdx-editor-provider.test.tsx packages/mdx-editor/react/node-views.test.tsx packages/mdx-editor/plugins/editor-clipboard.test.ts features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run build checks**

Run:

```bash
npm run build
npm run build:sidecars
```

Expected:

- `npm run build` exits 0 after Next TypeScript checks.
- `npm run build:sidecars` exits 0 and writes `src-tauri/binaries/mdx-cli-aarch64-apple-darwin` and `src-tauri/binaries/mdx-mcp-aarch64-apple-darwin`.

- [ ] **Step 7: Try full Tauri bundle if local environment allows**

Run:

```bash
npm run build:app
```

Expected:

- PASS if local dmg tooling is available.
- If it fails only at `bundle_dmg.sh` after Next build and Rust release compilation pass, record the exact failure in the task notes and do not treat it as code failure unless the error references TypeScript, Rust compilation, missing app resources, or missing sidecars.

- [ ] **Step 8: Commit Task 10**

```bash
git add packages/mdx-editor features/editor features/workspace features/document app common package.json package-lock.json docs/loopx/plans/2026-06-22-markdown-syntax-plugin-kernel.md
git commit -m "refactor(editor): remove legacy markdown editor surfaces"
```

## Self-Review Checklist

- Spec coverage:
  - Kernel API: Tasks 1-3.
  - Syntax plugin lifecycle: Tasks 1, 4-7.
  - Explicit priority/phase registry: Task 1.
  - Fallback invariant: Tasks 4 and 10.
  - Independent `html/fallback/footnote/code/mermaid`: Tasks 4-6.
  - Mermaid independent from code parser: Task 6.
  - Complete clipboard pluginization: Task 7.
  - Breaking public API migration: Tasks 3, 8, 10.
  - Strong verification: Tasks 9-10.
- Placeholder scan: no task contains unresolved placeholder markers or unspecified tests.
- Type consistency:
  - `SyntaxPlugin`, `SyntaxRegistry`, `MdxEditorKernel`, and `KernelClipboard` are introduced before tasks consume them.
- Design drift:
  - No user-facing plugin disable UI.
  - No third-party plugin API.
  - No async parser/serializer.
- Surface-change coverage:
  - Surface Inventory, Caller Proof commands, Negative Assertions, and package check are included.

## Execution Handoff

Plan complete and saved to `docs/loopx/plans/2026-06-22-markdown-syntax-plugin-kernel.md`.

Two execution options:

1. Subagent Exec (recommended) - dispatch a fresh subagent per task, use one combined task reviewer per task, then final-review
2. Inline Execution - execute tasks in this session using exec, batch execution with checkpoints

Which approach?
