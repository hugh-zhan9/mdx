// @vitest-environment jsdom

import { act } from "react";
import { EditorState, type Transaction } from "prosemirror-state";
import { DecorationSet, type EditorView, type NodeView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { createMdxNodeViews } from "./node-views";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

describe("createMdxNodeViews", () => {
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

        act(() => nodeView?.destroy?.());
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
        expect(nodeView.contentDOM?.tagName).toBe("CODE");

        if (input) {
            input.value = "python";
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].doc.child(0).attrs.language).toBe("python");
        expect(dispatched[0].doc.child(0).attrs.info).toBe("python");
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
