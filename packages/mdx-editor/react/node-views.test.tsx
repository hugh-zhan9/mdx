// @vitest-environment jsdom

import { act } from "react";
import { EditorState, NodeSelection, type Transaction } from "prosemirror-state";
import { DecorationSet, type EditorView, type NodeView } from "prosemirror-view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { createMdxNodeViews } from "./node-views";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const renderMermaidDiagram = vi.hoisted(() => vi.fn());

vi.mock("./mermaid-renderer", () => ({
    renderMermaidDiagram: (
        request: Parameters<typeof renderMermaidDiagram>[0],
    ) => renderMermaidDiagram(request),
}));

describe("createMdxNodeViews", () => {
    beforeEach(() => {
        renderMermaidDiagram.mockReset();
        renderMermaidDiagram.mockResolvedValue({
            ok: true,
            svg: "<svg><text>rendered diagram</text></svg>",
        });
    });

    it("registers node views for advanced Markdown structures", () => {
        const keys = Object.keys(
            createMdxNodeViews({ imageLoader: undefined }),
        ).sort();

        expect(keys).toEqual(
            expect.arrayContaining([
                "callout",
                "code_block",
                "footnote_definition",
                "image",
                "inline_html",
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

    it("renders mermaid blocks through a node view instead of a source pre", async () => {
        const schema = mdxEditorSchema;
        const mermaid = schema.nodes.mermaid_block.create(
            { info: "mermaid", sourceId: "source-1" },
            schema.text("graph TD\n  A --> B\n"),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, mermaid), (tr) => {
            dispatched.push(tr);
        });
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().mermaid_block(
                mermaid,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        const textarea = nodeView?.dom.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Mermaid source']",
        );
        const preview = nodeView?.dom.querySelector<HTMLElement>(
            "[data-mdx-mermaid-preview='source-1']",
        );

        expect(nodeView?.dom.tagName).toBe("DIV");
        expect(nodeView?.dom.getAttribute("data-mdx-node-type")).toBe(
            "mermaid_block",
        );
        expect(nodeView?.dom.querySelector("pre[data-mdx-code-block]")).toBeNull();
        expect(textarea?.value).toBe("graph TD\n  A --> B\n");
        expect(renderMermaidDiagram).toHaveBeenCalledWith(
            expect.objectContaining({
                code: "graph TD\n  A --> B\n",
                theme: "light",
            }),
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(preview?.innerHTML).toContain("<svg");
        expect(preview?.textContent).toContain("rendered diagram");

        act(() => {
            if (!textarea) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(textarea, "graph TD\n  A --> C\n");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).textContent).toBe(
            "graph TD\n  A --> C\n",
        );

        act(() => nodeView?.destroy?.());
    });

    it("renders failed image nodes as markdown fallback text", () => {
        const image = mdxEditorSchema.nodes.image.create({
            src: "www.baidu.com",
            alt: "www.baidu.com",
        });
        const view = createView(mdxEditorSchema.nodes.doc.create(null, image));
        const nodeView = createMdxNodeViews().image(
            image,
            view,
            () => 0,
            [],
            DecorationSet.empty,
        );

        nodeView.dom
            .querySelector("img")
            ?.dispatchEvent(new Event("error"));

        expect(nodeView.dom.getAttribute("data-mdx-image-error")).toBe("true");
        expect(nodeView.dom.textContent).toBe(
            "![www.baidu.com](www.baidu.com)",
        );

        nodeView.destroy?.();
    });

    it("selects image nodes on mouse down and exposes markdown source while selected", () => {
        const image = mdxEditorSchema.nodes.image.create({
            src: ".assets/example.png",
            alt: "本地图片示例",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [image]),
        ]);
        const dispatched: Transaction[] = [];
        const view = createView(doc, (tr) => {
            dispatched.push(tr);
        });
        const nodeView = createMdxNodeViews().image(
            image,
            view,
            () => 1,
            [],
            DecorationSet.empty,
        );
        const event = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        const selectedText = document.createTextNode("previous selection");
        const selectedHost = document.createElement("div");
        const range = document.createRange();
        selectedHost.append(selectedText);
        document.body.append(selectedHost);
        range.setStart(selectedText, 0);
        range.setEnd(selectedText, selectedText.textContent.length);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        nodeView.dom.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(window.getSelection()?.rangeCount).toBe(0);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].selection).toBeInstanceOf(NodeSelection);
        expect((dispatched[0].selection as NodeSelection).node.type.name).toBe(
            "image",
        );

        nodeView.selectNode?.();

        expect(nodeView.dom.getAttribute("data-mdx-image-selected")).toBe("true");
        expect(nodeView.dom.getAttribute("data-mdx-image-markdown")).toBe(
            "![本地图片示例](.assets/example.png)",
        );
        expect(nodeView.dom.querySelector("img")?.draggable).toBe(false);
        expect(
            nodeView.dom.querySelector<HTMLTextAreaElement>(
                "textarea[aria-label='Markdown image source']",
            )?.hidden,
        ).toBe(false);
        expect(nodeView.dom.textContent).toBe(
            "![本地图片示例](.assets/example.png)",
        );

        selectedHost.remove();
        nodeView.destroy?.();
    });

    it("commits edited markdown image source back to image attrs", () => {
        const image = mdxEditorSchema.nodes.image.create({
            src: ".assets/old.png",
            alt: "Old",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [image]),
        ]);
        const dispatched: Transaction[] = [];
        const view = createView(doc, (tr) => {
            dispatched.push(tr);
        });
        const nodeView = createMdxNodeViews().image(
            image,
            view,
            () => 1,
            [],
            DecorationSet.empty,
        );

        nodeView.selectNode?.();
        const source = nodeView.dom.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Markdown image source']",
        );

        expect(source).not.toBeNull();
        expect(source?.value).toBe("![Old](.assets/old.png)");

        if (source) {
            source.value = "![New alt](.assets/new.png)";
            source.dispatchEvent(new Event("input", { bubbles: true }));
            source.dispatchEvent(new Event("blur", { bubbles: false }));
        }

        expect(dispatched).toHaveLength(1);
        const editedImage = dispatched[0].doc.resolve(1).nodeAfter;
        expect(editedImage?.attrs).toMatchObject({
            alt: "New alt",
            src: ".assets/new.png",
        });

        nodeView.destroy?.();
    });

    it("creates inline math with an inline span wrapper", () => {
        const node = mdxEditorSchema.nodes.math_inline.create({
            latex: "x + y",
        });
        const view = createView(mdxEditorSchema.nodes.doc.create());
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().math_inline(
                node,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        expect(nodeView?.dom.tagName).toBe("SPAN");
        expect(nodeView?.dom.getAttribute("data-mdx-node-type")).toBe(
            "math_inline",
        );
        expect(nodeView?.dom.classList.contains("mdx-math-inline")).toBe(true);
        expect(
            nodeView?.dom.querySelector("input[aria-label='Inline math']"),
        ).toBeNull();

        act(() => nodeView?.destroy?.());
    });

    it("shows math source controls only while editing", () => {
        const schema = mdxEditorSchema;
        const mathBlock = schema.nodes.math_block.create(
            { sourceId: "source-1" },
            schema.text("\\int_0^1 x^2 dx = \\frac{1}{3}"),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, mathBlock), (tr) => {
            dispatched.push(tr);
        });
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().math_block(
                mathBlock,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        expect(nodeView?.dom.querySelector(".katex")).not.toBeNull();
        expect(
            nodeView?.dom.querySelector("textarea[aria-label='Math block']"),
        ).toBeNull();

        act(() => {
            nodeView?.dom
                .querySelector<HTMLElement>(".mdx-math-preview")
                ?.click();
        });

        const textarea = nodeView?.dom.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Math block']",
        );

        expect(textarea?.value).toBe("\\int_0^1 x^2 dx = \\frac{1}{3}");

        act(() => {
            if (!textarea) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(textarea, "x^2");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).textContent).toBe("x^2");

        act(() => nodeView?.destroy?.());
    });

    it("shows footnote label source only while editing the label", () => {
        const schema = mdxEditorSchema;
        const footnote = schema.nodes.footnote_definition.create(
            { label: "note1", sourceId: "source-1" },
            schema.nodes.paragraph.create(null, schema.text("Footnote body.")),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, footnote), (tr) => {
            dispatched.push(tr);
        });
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().footnote_definition(
                footnote,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        expect(nodeView?.dom.textContent).not.toContain("[^");
        expect(
            nodeView?.dom.querySelector("input[aria-label='Footnote label']"),
        ).toBeNull();
        expect(
            nodeView?.dom.querySelector<HTMLButtonElement>(
                "button[aria-label='Edit footnote label']",
            )?.textContent,
        ).toBe("note1");

        act(() => {
            nodeView?.dom
                .querySelector<HTMLButtonElement>(
                    "button[aria-label='Edit footnote label']",
                )
                ?.click();
        });

        const input = nodeView?.dom.querySelector<HTMLInputElement>(
            "input[aria-label='Footnote label']",
        );

        expect(nodeView?.dom.textContent).toContain("[^");
        expect(input?.value).toBe("note1");

        act(() => {
            if (!input) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(input, "note2");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).attrs.label).toBe("note2");

        act(() => nodeView?.destroy?.());
    });

    it("renders source fallback html before editing and preserves source during editing", () => {
        const schema = mdxEditorSchema;
        const fallback = schema.nodes.source_fallback.create(
            {
                markdown:
                    '<div class="custom-block">\n  <p>Unsupported</p>\n</div>\n',
                reason: "unsupported",
                sourceId: "source-1",
            },
            schema.text('<div class="custom-block">\n  <p>Unsupported</p>\n</div>\n'),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, fallback), (tr) => {
            dispatched.push(tr);
        });
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().source_fallback(
                fallback,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        expect(nodeView?.dom.querySelector(".custom-block")).not.toBeNull();
        expect(nodeView?.dom.textContent).toBe("\n  Unsupported\n\n");
        expect(
            nodeView?.dom.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).toBeNull();

        act(() => {
            nodeView?.dom
                .querySelector<HTMLElement>(
                    "[role='button'][aria-label='Edit source fallback']",
                )
                ?.dispatchEvent(
                    new MouseEvent("mousedown", {
                        bubbles: true,
                        cancelable: true,
                    }),
                );
        });

        const textarea = nodeView?.dom.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Markdown source fallback']",
        );

        expect(textarea?.value).toBe(
            '<div class="custom-block">\n  <p>Unsupported</p>\n</div>\n',
        );

        act(() => {
            if (!textarea) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(textarea, "<details>Changed</details>\n");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).attrs.markdown).toBe(
            "<details>Changed</details>\n",
        );

        act(() => nodeView?.destroy?.());
    });

    it("stops editor event handling inside source fallback previews", () => {
        const schema = mdxEditorSchema;
        const fallback = schema.nodes.source_fallback.create({
            markdown: "<p>Unsupported</p>\n",
            reason: "unsupported",
            sourceId: "source-1",
        });
        const view = createView(schema.nodes.doc.create(null, fallback));
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().source_fallback(
                fallback,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        const preview = nodeView?.dom.querySelector<HTMLElement>(
            "[role='button'][aria-label='Edit source fallback']",
        );

        expect(preview).not.toBeNull();

        const event = new MouseEvent("mousedown", { bubbles: true });
        Object.defineProperty(event, "target", { value: preview });

        expect(nodeView?.stopEvent?.(event)).toBe(true);

        const textEvent = new MouseEvent("mousedown", { bubbles: true });
        const textTarget = preview?.querySelector("p")?.firstChild;
        if (!textTarget) {
            throw new Error("Expected rendered fallback text target.");
        }
        Object.defineProperty(textEvent, "target", { value: textTarget });

        expect(nodeView?.stopEvent?.(textEvent)).toBe(true);

        const clickEvent = new MouseEvent("click", { bubbles: true });
        Object.defineProperty(clickEvent, "target", { value: textTarget });

        expect(nodeView?.stopEvent?.(clickEvent)).toBe(false);

        act(() => nodeView?.destroy?.());
    });

    it("sanitizes rendered source fallback html preview", () => {
        const schema = mdxEditorSchema;
        const fallback = schema.nodes.source_fallback.create({
            markdown:
                '<div onclick="evil()"><script>evil()</script><a href="javascript:evil()">Safe</a></div>\n',
            reason: "unsupported",
            sourceId: "source-1",
        });
        const view = createView(schema.nodes.doc.create(null, fallback));
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().source_fallback(
                fallback,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });
        const preview = nodeView!.dom.querySelector<HTMLElement>(
            "[role='button'][aria-label='Edit source fallback']",
        );

        expect(preview).not.toBeNull();
        expect(preview!.querySelector("script")).toBeNull();
        expect(preview!.querySelector("div")?.getAttribute("onclick")).toBeNull();
        expect(preview!.querySelector("a")?.getAttribute("href")).toBeNull();
        expect(preview?.textContent?.trim()).toBe("Safe");

        act(() => nodeView?.destroy?.());
    });

    it("lets rendered details summary toggle while details content enters source editing", () => {
        const schema = mdxEditorSchema;
        const fallback = schema.nodes.source_fallback.create({
            markdown:
                "<details>\n  <summary>展开详情</summary>\n  <p>详情内容。</p>\n</details>\n",
            reason: "unsupported",
            sourceId: "source-1",
        });
        const view = createView(schema.nodes.doc.create(null, fallback));
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().source_fallback(
                fallback,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        const details = nodeView?.dom.querySelector<HTMLDetailsElement>("details");
        const summary = nodeView?.dom.querySelector<HTMLElement>("summary");
        const paragraph = nodeView?.dom.querySelector<HTMLElement>("p");

        expect(details).not.toBeNull();
        expect(summary?.textContent).toBe("展开详情");
        expect(paragraph?.textContent).toBe("详情内容。");

        act(() => {
            summary?.dispatchEvent(
                new MouseEvent("mousedown", {
                    bubbles: true,
                    cancelable: true,
                }),
            );
        });

        expect(
            nodeView?.dom.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).toBeNull();

        act(() => {
            summary?.firstChild?.dispatchEvent(
                new MouseEvent("mousedown", {
                    bubbles: true,
                    cancelable: true,
                }),
            );
        });

        expect(
            nodeView?.dom.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).toBeNull();

        act(() => {
            summary?.click();
        });

        expect(details?.open).toBe(true);

        act(() => {
            paragraph?.dispatchEvent(
                new MouseEvent("mousedown", {
                    bubbles: true,
                    cancelable: true,
                }),
            );
        });

        expect(
            nodeView?.dom.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).not.toBeNull();

        act(() => nodeView?.destroy?.());
    });

    it("edits inline html as raw source instead of only text content", () => {
        const schema = mdxEditorSchema;
        const inlineHtml = schema.nodes.inline_html.create({
            html: "<kbd>Command</kbd>",
            tag: "kbd",
            text: "Command",
        });
        const dispatched: Transaction[] = [];
        const view = createView(
            schema.nodes.doc.create(
                null,
                schema.nodes.paragraph.create(null, [
                    schema.text("Press "),
                    inlineHtml,
                ]),
            ),
            (tr) => {
                dispatched.push(tr);
            },
        );
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().inline_html(
                inlineHtml,
                view,
                () => 7,
                [],
                DecorationSet.empty,
            );
        });

        expect(nodeView?.dom.querySelector("kbd")?.textContent).toBe("Command");
        expect(
            nodeView?.dom.querySelector("input[aria-label='Inline HTML source']"),
        ).toBeNull();

        act(() => {
            nodeView?.dom
                .querySelector<HTMLButtonElement>(
                    "button[aria-label='Edit inline HTML']",
                )
                ?.click();
        });

        const input = nodeView?.dom.querySelector<HTMLInputElement>(
            "input[aria-label='Inline HTML source']",
        );

        expect(input?.value).toBe("<kbd>Command</kbd>");

        act(() => {
            if (!input) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(input, '<kbd class="shortcut">Cmd</kbd>');
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).child(1).attrs.html).toBe(
            '<kbd class="shortcut">Cmd</kbd>',
        );

        act(() => nodeView?.destroy?.());
    });

    it("mounts table rows into a single valid tbody contentDOM", () => {
        const schema = mdxEditorSchema;
        const table = schema.nodes.table.create(null, [
            schema.nodes.table_row.create(null, [
                schema.nodes.table_header.create(null, schema.text("A")),
                schema.nodes.table_header.create(null, schema.text("B")),
            ]),
            schema.nodes.table_row.create(null, [
                schema.nodes.table_cell.create(null, schema.text("1")),
                schema.nodes.table_cell.create(null, schema.text("2")),
            ]),
        ]);
        const view = createView(schema.nodes.doc.create(null, table));
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().table(
                table,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        const renderedTable = nodeView?.dom.querySelector("table");

        expect(nodeView?.dom.classList.contains("mdx-table-wrapper")).toBe(true);
        expect(nodeView?.contentDOM?.tagName).toBe("TBODY");
        expect(renderedTable?.firstElementChild).toBe(nodeView?.contentDOM);
        expect(renderedTable?.querySelector("tbody tbody")).toBeNull();
        expect(nodeView?.dom.textContent).not.toContain("Add row");
        expect(nodeView?.dom.textContent).not.toContain("Add column");
        expect(
            nodeView?.dom.querySelector("button[aria-label='Add row']"),
        ).not.toBeNull();
        expect(
            nodeView?.dom.querySelector("button[aria-label='Add column']"),
        ).not.toBeNull();
        expect(
            nodeView?.dom.querySelector("button[aria-label='Delete row']"),
        ).not.toBeNull();
        expect(
            nodeView?.dom.querySelector("button[aria-label='Delete column']"),
        ).not.toBeNull();

        act(() => nodeView?.destroy?.());
    });

    it("deletes the last table row and column from controls", () => {
        const schema = mdxEditorSchema;
        const table = schema.nodes.table.create(
            { alignments: ["left", "right"] },
            [
                schema.nodes.table_row.create(null, [
                    schema.nodes.table_header.create(null, schema.text("A")),
                    schema.nodes.table_header.create(null, schema.text("B")),
                ]),
                schema.nodes.table_row.create(null, [
                    schema.nodes.table_cell.create(null, schema.text("1")),
                    schema.nodes.table_cell.create(null, schema.text("2")),
                ]),
            ],
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, table), (tr) => {
            dispatched.push(tr);
        });
        const nodeView = createMdxNodeViews().table(
            table,
            view,
            () => 0,
            [],
            DecorationSet.empty,
        );

        nodeView.dom
            .querySelector<HTMLButtonElement>("button[aria-label='Delete row']")
            ?.click();

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).childCount).toBe(1);

        const nextTable = dispatched[0].doc.child(0);
        const nextView = createView(dispatched[0].doc, (tr) => {
            dispatched.push(tr);
        });
        const nextNodeView = createMdxNodeViews().table(
            nextTable,
            nextView,
            () => 0,
            [],
            DecorationSet.empty,
        );

        nextNodeView.dom
            .querySelector<HTMLButtonElement>("button[aria-label='Delete column']")
            ?.click();

        expect(dispatched).toHaveLength(2);
        expect(dispatched[1].doc.child(0).child(0).childCount).toBe(1);
        expect(dispatched[1].doc.child(0).attrs.alignments).toEqual(["left"]);

        nodeView.destroy?.();
        nextNodeView.destroy?.();
    });

    it("disables table delete controls at the minimum dimensions", () => {
        const schema = mdxEditorSchema;
        const table = schema.nodes.table.create(null, [
            schema.nodes.table_row.create(null, [
                schema.nodes.table_cell.create(null, schema.text("Only")),
            ]),
        ]);
        const view = createView(schema.nodes.doc.create(null, table));
        const nodeView = createMdxNodeViews().table(
            table,
            view,
            () => 0,
            [],
            DecorationSet.empty,
        );

        expect(
            nodeView.dom.querySelector<HTMLButtonElement>(
                "button[aria-label='Delete row']",
            )?.disabled,
        ).toBe(true);
        expect(
            nodeView.dom.querySelector<HTMLButtonElement>(
                "button[aria-label='Delete column']",
            )?.disabled,
        ).toBe(true);

        nodeView.destroy?.();
    });

    it("dispatches setNodeMarkup-equivalent attr updates from controls", () => {
        const schema = mdxEditorSchema;
        const callout = schema.nodes.callout.create(
            { kind: "NOTE" },
            schema.nodes.paragraph.create(null, schema.text("Body")),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, callout), (tr) => {
            dispatched.push(tr);
        });
        let nodeView: NodeView | undefined;

        act(() => {
            nodeView = createMdxNodeViews().callout(
                callout,
                view,
                () => 0,
                [],
                DecorationSet.empty,
            );
        });

        const select = nodeView?.dom.querySelector<HTMLSelectElement>(
            "select[aria-label='Callout type']",
        );

        expect(nodeView?.dom.querySelector(".mdx-callout-header")?.textContent).toContain(
            "NOTE",
        );
        expect(nodeView?.dom.textContent).not.toContain("[!NOTE]");

        act(() => {
            if (!select) {
                return;
            }

            select.value = "WARNING";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).attrs.kind).toBe("WARNING");

        act(() => nodeView?.destroy?.());
    });

    it("updates code block language from its language control", () => {
        const schema = mdxEditorSchema;
        const codeBlock = schema.nodes.code_block.create(
            { language: "ts", info: "ts", sourceId: null },
            schema.text("const value = 1;\n"),
        );
        const dispatched: Transaction[] = [];
        const view = createView(schema.nodes.doc.create(null, codeBlock), (tr) => {
            dispatched.push(tr);
        });
        const nodeView = createMdxNodeViews().code_block(
            codeBlock,
            view,
            () => 0,
            [],
            DecorationSet.empty,
        );
        const input = nodeView.dom.querySelector<HTMLInputElement>(
            "input[aria-label='Code block language']",
        );

        expect(input?.value).toBe("ts");
        expect(input?.size).toBe(5);
        expect(nodeView.contentDOM?.tagName).toBe("CODE");

        if (input) {
            input.value = "python";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).attrs.language).toBe("python");
        expect(dispatched[0].doc.child(0).attrs.info).toBe("python");
        expect(input?.size).toBe(7);
    });
});

function createView(
    doc: EditorState["doc"],
    dispatch: (transaction: Transaction) => void = () => {},
) {
    return {
        dispatch,
        state: EditorState.create({ doc }),
    } as EditorView;
}
