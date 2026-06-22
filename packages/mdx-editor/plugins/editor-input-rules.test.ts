import { describe, expect, it } from "vitest";
import type { Schema } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
import { mdxEditorSchema } from "../schema/schema";
import {
    markdownInputRules,
    markdownInputRulesPlugin,
} from "./editor-input-rules";

describe("markdown input rules", () => {
    it("includes common Markdown block patterns", () => {
        const patterns = markdownInputRules().map((rule) =>
            (rule as { match: RegExp }).match.toString(),
        );

        expect(patterns.some((pattern) => pattern.includes("#{1,6}"))).toBe(
            true,
        );
        expect(patterns.some((pattern) => pattern.includes("\\[ \\]"))).toBe(
            true,
        );
        expect(patterns.some((pattern) => pattern.includes(">"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("```"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("\\|"))).toBe(true);
        expect(patterns.some((pattern) => pattern.includes("[-*_]"))).toBe(
            true,
        );
    });

    it("converts typed Markdown task syntax into a task item", () => {
        const state = typeWithInputRules("- [ ] ");
        const list = state.doc.child(0);
        const item = list.child(0);

        expect(list.type.name).toBe("bullet_list");
        expect(item.type.name).toBe("task_item");
        expect(item.attrs.checked).toBe(false);
        expect(item.child(0).textContent).toBe("");
    });

    it("converts typed pipe table syntax into a table", () => {
        const state = typeWithInputRules("| A | B | ");
        const table = state.doc.child(0);

        expect(table.type.name).toBe("table");
        expect(table.childCount).toBe(2);
        expect(table.child(0).child(0).type.name).toBe("table_header");
        expect(table.child(0).child(0).textContent).toBe("A");
        expect(table.child(0).child(1).textContent).toBe("B");
        expect(table.child(1).child(0).type.name).toBe("table_cell");
    });

    it("converts typed triple backticks into a code block", () => {
        const state = typeWithInputRules("```");
        const codeBlock = state.doc.child(0);

        expect(codeBlock.type.name).toBe("code_block");
        expect(codeBlock.textContent).toBe("");
    });

    it("converts typed indented triple backticks into a code block", () => {
        const state = typeWithInputRules("   ```");
        const codeBlock = state.doc.child(0);

        expect(codeBlock.type.name).toBe("code_block");
        expect(codeBlock.textContent).toBe("");
    });

    it("converts typed thematic break syntax into a horizontal rule", () => {
        const state = typeWithInputRules("---");

        expect(state.doc.child(0).type.name).toBe("horizontal_rule");
        expect(state.doc.child(1).type.name).toBe("paragraph");
    });

    it("converts typed inline markdown links into link marks", () => {
        const state = typeWithInputRules("[百度](www.baidu.com)");
        const paragraph = state.doc.child(0);
        const link = paragraph.child(0).marks[0];

        expect(paragraph.textContent).toBe("百度");
        expect(link.type.name).toBe("link");
        expect(link.attrs.href).toBe("www.baidu.com");
    });

    it("converts typed empty-label links into visible link marks", () => {
        const state = typeWithInputRules("[](www.baidu.com)");
        const paragraph = state.doc.child(0);
        const link = paragraph.child(0).marks[0];

        expect(paragraph.textContent).toBe("www.baidu.com");
        expect(link.type.name).toBe("link");
        expect(link.attrs.href).toBe("www.baidu.com");
    });

    it("keeps empty markdown image syntax editable as text", () => {
        const state = typeWithInputRules("![]()");

        expect(state.doc.child(0).textContent).toBe("![]()");
        expect(state.doc.child(0).child(0).type.name).toBe("text");
    });

    it("converts typed empty-alt images into image nodes with visible fallback text", () => {
        const state = typeWithInputRules("![](www.baidu.com)");
        const image = state.doc.child(0).child(0);

        expect(image.type.name).toBe("image");
        expect(image.attrs.src).toBe("www.baidu.com");
        expect(image.attrs.alt).toBe("www.baidu.com");
    });

    it("uses the active kernel schema when inline markdown input rules create link marks", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const state = typeWithInputRules("[kernel](example.com)", kernel.schema);
        const link = state.doc.child(0).child(0).marks[0];

        expect(kernel.schema).not.toBe(mdxEditorSchema);
        expect(link.type).toBe(kernel.schema.marks.link);
        expect(link.type).not.toBe(mdxEditorSchema.marks.link);
    });
});

function typeWithInputRules(
    text: string,
    schema: Schema = mdxEditorSchema,
): EditorState {
    const plugin = markdownInputRulesPlugin(schema);
    let state = EditorState.create({
        doc: schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(),
        ]),
        plugins: [plugin],
        schema,
    });
    const view = {
        get state() {
            return state;
        },
        dispatch(transaction: Transaction) {
            state = state.apply(transaction);
        },
        composing: false,
    } as EditorView;

    for (const character of text) {
        const handled = plugin.props.handleTextInput?.(
            view,
            state.selection.from,
            state.selection.to,
            character,
        );

        if (!handled) {
            state = state.apply(
                state.tr.insertText(
                    character,
                    state.selection.from,
                    state.selection.to,
                ),
            );
        }
    }

    return state;
}
