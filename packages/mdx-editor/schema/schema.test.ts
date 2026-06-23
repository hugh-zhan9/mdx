import { DOMParser, DOMSerializer } from "prosemirror-model";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { MDX_CODE_BLOCK_SELECTOR } from "../../../features/editor/lib/editor-dom-contract";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";

const editorSchema = createMdxEditorKernel({
    syntax: defaultMarkdownSyntax(),
}).schema;

describe("editorSchema DOM contract", () => {
    it("round-trips typed pre blocks through specific DOM parse rules", () => {
        const dom = new JSDOM(
            `<article><pre data-mdx-node-type="frontmatter" data-mdx-syntax="frontmatter" data-mdx-source-id="source-0"><code>title: Test
</code></pre><pre data-mdx-node-type="code_block" data-mdx-code-block="" data-mdx-language="mermaid" data-mdx-info="mermaid live" data-mdx-source-id="source-1"><code>graph TD
</code></pre><pre data-mdx-node-type="source_fallback" data-mdx-source-id="source-2" data-mdx-reason="unsupported" data-mdx-markdown=":::callout&#10;"><code>:::callout
</code></pre></article>`,
        );

        const parsed = DOMParser.fromSchema(editorSchema).parse(
            dom.window.document.querySelector("article")!,
            { preserveWhitespace: "full" },
        );

        expect(parsed.child(0).type.name).toBe("frontmatter");
        expect(parsed.child(0).attrs.sourceId).toBe("source-0");
        expect(parsed.child(0).textContent).toBe("title: Test\n");
        expect(parsed.child(1).type.name).toBe("code_block");
        expect(parsed.child(1).attrs).toEqual({
            language: "mermaid",
            info: "mermaid live",
            sourceId: "source-1",
        });
        expect(parsed.child(2).type.name).toBe("source_fallback");
        expect(parsed.child(2).attrs).toEqual({
            markdown: ":::callout\n",
            reason: "unsupported",
            sourceId: "source-2",
        });
    });
});

describe("editorSchema advanced markdown nodes", () => {
    it("creates list, task, blockquote, table, footnote, math, callout, mermaid, and source fallback nodes", () => {
        const paragraph = editorSchema.nodes.paragraph.create(
            null,
            editorSchema.text("Cell"),
        );
        const table = editorSchema.nodes.table.create(
            { alignments: ["left", "right"] },
            editorSchema.nodes.table_row.create(null, [
                editorSchema.nodes.table_header.create(null, editorSchema.text("A")),
                editorSchema.nodes.table_header.create(null, editorSchema.text("B")),
            ]),
        );

        expect(
            editorSchema.nodes.bullet_list.create(null, [
                editorSchema.nodes.task_item.create(
                    { checked: true },
                    editorSchema.nodes.paragraph.create(null, editorSchema.text("Done")),
                ),
            ]).type.name,
        ).toBe("bullet_list");
        expect(editorSchema.nodes.blockquote.create(null, paragraph).type.name).toBe(
            "blockquote",
        );
        expect(editorSchema.nodes.horizontal_rule.create().type.name).toBe(
            "horizontal_rule",
        );
        expect(table.attrs.alignments).toEqual(["left", "right"]);
        expect(
            editorSchema.nodes.footnote_ref.create({ label: "1" }).attrs.label,
        ).toBe("1");
        expect(
            editorSchema.nodes.footnote_definition.create({ label: "1" }, paragraph)
                .attrs.label,
        ).toBe("1");
        expect(
            editorSchema.nodes.math_inline.create({ latex: "x+1" }).attrs.latex,
        ).toBe("x+1");
        expect(
            editorSchema.nodes.inline_html.create({
                html: "<kbd>Command</kbd>",
                tag: "kbd",
                text: "Command",
            }).attrs.html,
        ).toBe("<kbd>Command</kbd>");
        expect(
            editorSchema.nodes.math_block.create(null, editorSchema.text("y=mx+b"))
                .textContent,
        ).toBe("y=mx+b");
        expect(
            editorSchema.nodes.callout.create(
                { kind: "NOTE", title: "Note" },
                paragraph,
            ).attrs.kind,
        ).toBe("NOTE");
        expect(
            editorSchema.nodes.mermaid_block.create(
                null,
                editorSchema.text("graph TD\nA-->B"),
            ).textContent,
        ).toContain("graph TD");
        expect(
            editorSchema.nodes.source_fallback.create(null, editorSchema.text("<x>"))
                .textContent,
        ).toBe("<x>");
    });

    it("renders stable data-mdx attributes for integration helpers", () => {
        const dom = editorSchema.nodes.heading
            .create({ level: 2 })
            .type.spec.toDOM?.(
                editorSchema.nodes.heading.create({ level: 2 }),
            );

        expect(dom).toBeDefined();
        expect(JSON.stringify(dom)).toContain("data-mdx-node-type");
    });

    it("renders data-mdx-node-type on advanced block editorSchema DOM without mermaid preview UI", () => {
        const paragraph = editorSchema.nodes.paragraph.create(
            null,
            editorSchema.text("Text"),
        );
        const listItem = editorSchema.nodes.list_item.create(null, paragraph);
        const taskItem = editorSchema.nodes.task_item.create(
            { checked: false },
            paragraph,
        );
        const tableHeader = editorSchema.nodes.table_header.create(
            null,
            editorSchema.text("A"),
        );
        const tableCell = editorSchema.nodes.table_cell.create(
            null,
            editorSchema.text("B"),
        );
        const tableRow = editorSchema.nodes.table_row.create(null, [
            tableHeader,
            tableCell,
        ]);
        const advancedBlocks = [
            editorSchema.nodes.blockquote.create(null, paragraph),
            editorSchema.nodes.horizontal_rule.create(),
            editorSchema.nodes.bullet_list.create(null, listItem),
            editorSchema.nodes.ordered_list.create({ order: 3 }, listItem),
            listItem,
            taskItem,
            editorSchema.nodes.table.create(null, tableRow),
            tableRow,
            tableCell,
            tableHeader,
            editorSchema.nodes.footnote_definition.create({ label: "a" }, paragraph),
            editorSchema.nodes.math_block.create(null, editorSchema.text("x=1")),
            editorSchema.nodes.callout.create({ kind: "TIP" }, paragraph),
            editorSchema.nodes.mermaid_block.create(
                null,
                editorSchema.text("graph TD\nA-->B"),
            ),
            editorSchema.nodes.source_fallback.create(null, editorSchema.text("<x>")),
        ];

        for (const node of advancedBlocks) {
            const dom = node.type.spec.toDOM?.(node);
            expect(JSON.stringify(dom)).toContain("data-mdx-node-type");
        }

        const mermaidDom = JSON.stringify(
            editorSchema.nodes.mermaid_block.spec.toDOM?.(
                editorSchema.nodes.mermaid_block.create(
                    null,
                    editorSchema.text("graph TD\nA-->B"),
                ),
            ),
        );
        expect(mermaidDom).not.toContain("data-mdx-mermaid-preview");
        expect(mermaidDom).not.toContain("mdx-mermaid-preview");
    });

    it("keeps mermaid blocks visible to the existing code block DOM selector", () => {
        const jsdom = new JSDOM("<article></article>");
        const document = jsdom.window.document;
        const article = document.querySelector("article")!;
        const serializer = DOMSerializer.fromSchema(editorSchema);
        const mermaid = editorSchema.nodes.mermaid_block.create(
            { info: "mermaid live", sourceId: "source-mermaid" },
            editorSchema.text("graph TD\nA-->B\n"),
        );
        const domNode = serializer.serializeNode(mermaid, { document });

        article.append(domNode);

        const pre = article.querySelector(MDX_CODE_BLOCK_SELECTOR);
        expect(pre).not.toBeNull();
        expect(pre?.getAttribute("data-mdx-node-type")).toBe("mermaid_block");
        expect(pre?.getAttribute("data-mdx-language")).toBe("mermaid");
        expect(pre?.getAttribute("data-mdx-info")).toBe("mermaid live");

        const parsed = DOMParser.fromSchema(editorSchema).parse(article, {
            preserveWhitespace: "full",
        });
        expect(parsed.child(0).type.name).toBe("mermaid_block");
        expect(parsed.child(0).attrs.info).toBe("mermaid live");
    });

    it("preserves advanced code block payloads through DOM serialization and parsing", () => {
        const jsdom = new JSDOM("<article></article>");
        const document = jsdom.window.document;
        const article = document.querySelector("article")!;
        const serializer = DOMSerializer.fromSchema(editorSchema);
        const blocks = [
            {
                expectedType: "math_block",
                expectedText: "y=mx+b\n",
                node: editorSchema.nodes.math_block.create(
                    { sourceId: "source-math" },
                    editorSchema.text("y=mx+b\n"),
                ),
            },
            {
                expectedType: "mermaid_block",
                expectedText: "graph TD\nA-->B\n",
                node: editorSchema.nodes.mermaid_block.create(
                    { info: "mermaid live", sourceId: "source-mermaid" },
                    editorSchema.text("graph TD\nA-->B\n"),
                ),
            },
            {
                expectedType: "source_fallback",
                expectedText: "<x>\n",
                node: editorSchema.nodes.source_fallback.create(
                    { reason: "unsupported", sourceId: "source-fallback" },
                    editorSchema.text("<x>\n"),
                ),
            },
        ];

        for (const block of blocks) {
            const domNode = serializer.serializeNode(block.node, { document });
            expect(domNode.textContent).toBe(block.expectedText);
            expect((domNode as HTMLElement).querySelector("code")?.textContent).toBe(
                block.expectedText,
            );
            article.append(domNode);
        }

        const parsed = DOMParser.fromSchema(editorSchema).parse(article, {
            preserveWhitespace: "full",
        });

        blocks.forEach((block, index) => {
            const parsedBlock = parsed.child(index);
            expect(parsedBlock.type.name).toBe(block.expectedType);
            expect(parsedBlock.textContent).toBe(block.expectedText);
        });
    });
});
