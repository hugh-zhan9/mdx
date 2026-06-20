import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { mdxEditorSchema } from "../schema/schema";
import { markdownKeymap } from "./editor-keymap";

describe("markdown keymap", () => {
    it("starts a paragraph after pressing Enter at the end of a heading", () => {
        const title = "Spring Cloud中有用到哪些组件";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.heading.create(
                { level: 2 },
                mdxEditorSchema.text(title),
            ),
        ]);
        const state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1 + title.length),
        });

        const nextState = runCommand(markdownKeymap().Enter, state);

        expect(nextState.doc.childCount).toBe(2);
        expect(nextState.doc.child(0).type.name).toBe("heading");
        expect(nextState.doc.child(0).attrs.level).toBe(2);
        expect(nextState.doc.child(0).textContent).toBe(title);
        expect(nextState.doc.child(1).type.name).toBe("paragraph");
        expect(nextState.selection.$from.parent.type.name).toBe("paragraph");
    });

    it("removes code block styling when pressing Backspace at its start", () => {
        const code = "const value = 1;";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.code_block.create(
                { language: "ts", info: "ts" },
                mdxEditorSchema.text(code),
            ),
        ]);
        const state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1),
        });

        const nextState = runCommand(markdownKeymap().Backspace, state);

        expect(nextState.doc.childCount).toBe(1);
        expect(nextState.doc.child(0).type.name).toBe("paragraph");
        expect(nextState.doc.child(0).textContent).toBe(code);
        expect(nextState.selection.$from.parent.type.name).toBe("paragraph");
    });

    it("removes heading styling when pressing Backspace at its start", () => {
        const title = "qBittorrent + PostgreSQL + Bark 操作文档";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.heading.create(
                { level: 2 },
                mdxEditorSchema.text(title),
            ),
        ]);
        const state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1),
        });

        const nextState = runCommand(markdownKeymap().Backspace, state);

        expect(nextState.doc.childCount).toBe(1);
        expect(nextState.doc.child(0).type.name).toBe("paragraph");
        expect(nextState.doc.child(0).textContent).toBe(title);
        expect(nextState.selection.$from.parent.type.name).toBe("paragraph");
    });

    it("removes heading styling when pressing Delete at its start", () => {
        const title = "qBittorrent + PostgreSQL + Bark 操作文档";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.heading.create(
                { level: 2 },
                mdxEditorSchema.text(title),
            ),
        ]);
        const state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1),
        });

        const nextState = runCommand(markdownKeymap().Delete, state);

        expect(nextState.doc.childCount).toBe(1);
        expect(nextState.doc.child(0).type.name).toBe("paragraph");
        expect(nextState.doc.child(0).textContent).toBe(title);
        expect(nextState.selection.$from.parent.type.name).toBe("paragraph");
    });
});

function runCommand(command: Command | undefined, state: EditorState) {
    expect(command).toBeDefined();

    let nextState = state;
    const handled = command?.(
        state,
        (transaction: Transaction) => {
            nextState = nextState.apply(transaction);
        },
        {} as EditorView,
    );

    expect(handled).toBe(true);
    return nextState;
}
