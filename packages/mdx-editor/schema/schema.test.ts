import { DOMParser, DOMSerializer } from "prosemirror-model";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { MDX_CODE_BLOCK_SELECTOR } from "../../../features/editor/lib/editor-dom-contract";
import { mdxEditorSchema } from "./schema";

describe("mdxEditorSchema DOM contract", () => {
    it("round-trips typed pre blocks through specific DOM parse rules", () => {
        const dom = new JSDOM(
            `<article><pre data-mdx-node-type="frontmatter" data-mdx-syntax="frontmatter" data-mdx-source-id="source-0"><code>title: Test
</code></pre><pre data-mdx-node-type="code_block" data-mdx-code-block="" data-mdx-language="mermaid" data-mdx-info="mermaid live" data-mdx-source-id="source-1"><code>graph TD
</code></pre><pre data-mdx-node-type="opaque" data-mdx-source-id="source-2" data-mdx-reason="unsupported"><code>:::callout
</code></pre></article>`,
        );

        const parsed = DOMParser.fromSchema(mdxEditorSchema).parse(
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
        expect(parsed.child(2).type.name).toBe("opaque_block");
        expect(parsed.child(2).attrs).toEqual({
            reason: "unsupported",
            sourceId: "source-2",
        });
    });
});

describe("mdxEditorSchema advanced markdown nodes", () => {
    it("creates list, task, blockquote, table, footnote, math, callout, mermaid, and source fallback nodes", () => {
        const schema = mdxEditorSchema;
        const paragraph = schema.nodes.paragraph.create(
            null,
            schema.text("Cell"),
        );
        const table = schema.nodes.table.create(
            { alignments: ["left", "right"] },
            schema.nodes.table_row.create(null, [
                schema.nodes.table_header.create(null, schema.text("A")),
                schema.nodes.table_header.create(null, schema.text("B")),
            ]),
        );

        expect(
            schema.nodes.bullet_list.create(null, [
                schema.nodes.task_item.create(
                    { checked: true },
                    schema.nodes.paragraph.create(null, schema.text("Done")),
                ),
            ]).type.name,
        ).toBe("bullet_list");
        expect(schema.nodes.blockquote.create(null, paragraph).type.name).toBe(
            "blockquote",
        );
        expect(schema.nodes.horizontal_rule.create().type.name).toBe(
            "horizontal_rule",
        );
        expect(table.attrs.alignments).toEqual(["left", "right"]);
        expect(
            schema.nodes.footnote_ref.create({ label: "1" }).attrs.label,
        ).toBe("1");
        expect(
            schema.nodes.footnote_definition.create({ label: "1" }, paragraph)
                .attrs.label,
        ).toBe("1");
        expect(
            schema.nodes.math_inline.create({ latex: "x+1" }).attrs.latex,
        ).toBe("x+1");
        expect(
            schema.nodes.math_block.create(null, schema.text("y=mx+b"))
                .textContent,
        ).toBe("y=mx+b");
        expect(
            schema.nodes.callout.create(
                { kind: "NOTE", title: "Note" },
                paragraph,
            ).attrs.kind,
        ).toBe("NOTE");
        expect(
            schema.nodes.mermaid_block.create(
                null,
                schema.text("graph TD\nA-->B"),
            ).textContent,
        ).toContain("graph TD");
        expect(
            schema.nodes.source_fallback.create(null, schema.text("<x>"))
                .textContent,
        ).toBe("<x>");
    });

    it("renders stable data-mdx attributes for integration helpers", () => {
        const dom = mdxEditorSchema.nodes.heading
            .create({ level: 2 })
            .type.spec.toDOM?.(
                mdxEditorSchema.nodes.heading.create({ level: 2 }),
            );

        expect(dom).toBeDefined();
        expect(JSON.stringify(dom)).toContain("data-mdx-node-type");
    });

    it("renders data-mdx-node-type on advanced block schema DOM without mermaid preview UI", () => {
        const schema = mdxEditorSchema;
        const paragraph = schema.nodes.paragraph.create(
            null,
            schema.text("Text"),
        );
        const listItem = schema.nodes.list_item.create(null, paragraph);
        const taskItem = schema.nodes.task_item.create(
            { checked: false },
            paragraph,
        );
        const tableHeader = schema.nodes.table_header.create(
            null,
            schema.text("A"),
        );
        const tableCell = schema.nodes.table_cell.create(
            null,
            schema.text("B"),
        );
        const tableRow = schema.nodes.table_row.create(null, [
            tableHeader,
            tableCell,
        ]);
        const advancedBlocks = [
            schema.nodes.blockquote.create(null, paragraph),
            schema.nodes.horizontal_rule.create(),
            schema.nodes.bullet_list.create(null, listItem),
            schema.nodes.ordered_list.create({ order: 3 }, listItem),
            listItem,
            taskItem,
            schema.nodes.table.create(null, tableRow),
            tableRow,
            tableCell,
            tableHeader,
            schema.nodes.footnote_definition.create({ label: "a" }, paragraph),
            schema.nodes.math_block.create(null, schema.text("x=1")),
            schema.nodes.callout.create({ kind: "TIP" }, paragraph),
            schema.nodes.mermaid_block.create(
                null,
                schema.text("graph TD\nA-->B"),
            ),
            schema.nodes.source_fallback.create(null, schema.text("<x>")),
        ];

        for (const node of advancedBlocks) {
            const dom = node.type.spec.toDOM?.(node);
            expect(JSON.stringify(dom)).toContain("data-mdx-node-type");
        }

        const mermaidDom = JSON.stringify(
            schema.nodes.mermaid_block.spec.toDOM?.(
                schema.nodes.mermaid_block.create(
                    null,
                    schema.text("graph TD\nA-->B"),
                ),
            ),
        );
        expect(mermaidDom).not.toContain("data-mdx-mermaid-preview");
        expect(mermaidDom).not.toContain("mdx-mermaid-preview");
    });

    it("keeps mermaid blocks visible to the existing code block DOM selector", () => {
        const schema = mdxEditorSchema;
        const jsdom = new JSDOM("<article></article>");
        const document = jsdom.window.document;
        const article = document.querySelector("article")!;
        const serializer = DOMSerializer.fromSchema(schema);
        const mermaid = schema.nodes.mermaid_block.create(
            { info: "mermaid live", sourceId: "source-mermaid" },
            schema.text("graph TD\nA-->B\n"),
        );
        const domNode = serializer.serializeNode(mermaid, { document });

        article.append(domNode);

        const pre = article.querySelector(MDX_CODE_BLOCK_SELECTOR);
        expect(pre).not.toBeNull();
        expect(pre?.getAttribute("data-mdx-node-type")).toBe("mermaid_block");
        expect(pre?.getAttribute("data-mdx-language")).toBe("mermaid");
        expect(pre?.getAttribute("data-mdx-info")).toBe("mermaid live");

        const parsed = DOMParser.fromSchema(schema).parse(article, {
            preserveWhitespace: "full",
        });
        expect(parsed.child(0).type.name).toBe("mermaid_block");
        expect(parsed.child(0).attrs.info).toBe("mermaid live");
    });

    it("preserves advanced code block payloads through DOM serialization and parsing", () => {
        const schema = mdxEditorSchema;
        const jsdom = new JSDOM("<article></article>");
        const document = jsdom.window.document;
        const article = document.querySelector("article")!;
        const serializer = DOMSerializer.fromSchema(schema);
        const blocks = [
            {
                expectedType: "math_block",
                expectedText: "y=mx+b\n",
                node: schema.nodes.math_block.create(
                    { sourceId: "source-math" },
                    schema.text("y=mx+b\n"),
                ),
            },
            {
                expectedType: "mermaid_block",
                expectedText: "graph TD\nA-->B\n",
                node: schema.nodes.mermaid_block.create(
                    { info: "mermaid live", sourceId: "source-mermaid" },
                    schema.text("graph TD\nA-->B\n"),
                ),
            },
            {
                expectedType: "source_fallback",
                expectedText: "<x>\n",
                node: schema.nodes.source_fallback.create(
                    { reason: "unsupported", sourceId: "source-fallback" },
                    schema.text("<x>\n"),
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

        const parsed = DOMParser.fromSchema(schema).parse(article, {
            preserveWhitespace: "full",
        });

        blocks.forEach((block, index) => {
            const parsedBlock = parsed.child(index);
            expect(parsedBlock.type.name).toBe(block.expectedType);
            expect(parsedBlock.textContent).toBe(block.expectedText);
        });
    });
});
