import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
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
});

function typeWithInputRules(text: string): EditorState {
    const plugin = markdownInputRulesPlugin();
    let state = EditorState.create({
        doc: mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(),
        ]),
        plugins: [plugin],
        schema: mdxEditorSchema,
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
