import { describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { undo } from "prosemirror-history";
import { parseMarkdown, serializeMarkdown } from "..";
import { mdxEditorSchema } from "../schema/schema";
import { createMdxEditorPlugins } from "../plugins/editor-plugins";
import {
    insertImageMarkdown,
    insertImageNode,
    insertPlainTextMarkdown,
    insertTableMarkdown,
    MAX_TABLE_DIMENSION,
    setHeadingBlock,
    toggleStrongMark,
    toggleTaskItemChecked,
} from "./editor-commands";

describe("editor commands", () => {
    it("inserts plain text into Markdown at an offset", () => {
        expect(insertPlainTextMarkdown("Hello world", 6, "brave ")).toBe(
            "Hello brave world",
        );
    });

    it("inserts Markdown image syntax with alt text", () => {
        expect(insertImageMarkdown("Hello\n", 6, ".assets/a.png", "Diagram")).toBe(
            "Hello\n![Diagram](.assets/a.png)",
        );
    });

    it("escapes parentheses in image URLs", () => {
        expect(insertImageMarkdown("", 0, ".assets/a)b.png", "Diagram")).toBe(
            "![Diagram](.assets/a\\)b.png)",
        );
    });

    it("escapes brackets in image alt text", () => {
        expect(insertImageMarkdown("", 0, ".assets/a.png", "Diagram [draft]")).toBe(
            "![Diagram \\[draft\\]](.assets/a.png)",
        );
    });

    it("round-trips inserted image markdown without source-slice reuse", () => {
        const markdown = insertImageMarkdown(
            "",
            0,
            ".assets/a)b.png",
            String.raw`Diagram \ draft`,
        );
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown({ ...parsed, sourceSlices: [] })).toBe(
            `${markdown}\n`,
        );
    });

    it("inserts image nodes at document positions after editable link text", () => {
        const markdown = "[百度](http://baidu.com)";
        let state = EditorState.create({
            doc: mdxEditorSchema.nodes.doc.create(null, [
                mdxEditorSchema.nodes.paragraph.create(null, [
                    mdxEditorSchema.text(markdown),
                ]),
            ]),
            plugins: createMdxEditorPlugins(),
            schema: mdxEditorSchema,
        });

        expect(
            insertImageNode(".assets/a.png", "A", undefined, {
                anchor: markdown.length + 1,
                head: markdown.length + 1,
            })(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(true);
        expect(
            serializeMarkdown({
                diagnostics: [],
                doc: state.doc,
                originalMarkdown: markdown,
                sourceSlices: [],
            }),
        ).toBe("[百度](http://baidu.com)![A](.assets/a.png)\n");
    });

    it("makes inserted image nodes undoable", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("Hello"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            plugins: createMdxEditorPlugins(),
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 6),
        });

        expect(
            insertImageNode(".assets/a.png", "A")(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(true);
        expect(state.doc.textContent).toBe("Hello");
        expect(state.doc.firstChild?.childCount).toBe(2);

        expect(
            undo(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(true);
        expect(state.doc.firstChild?.childCount).toBe(1);
        expect(state.doc.textContent).toBe("Hello");
    });

    it("produces serializable Markdown after command-style mutation", () => {
        const markdown = insertPlainTextMarkdown("# Title\n", 8, "Body.\n");
        const parsed = parseMarkdown(markdown);

        expect(serializeMarkdown(parsed)).toBe("# Title\nBody.\n");
    });

    it("toggles strong marks through a ProseMirror command", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("bold"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            plugins: createMdxEditorPlugins(),
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1, 5),
        });

        expect(
            toggleStrongMark(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(true);
        expect(state.doc.child(0).child(0).marks[0]?.type.name).toBe("strong");
    });

    it("sets the current block to a heading level 2", () => {
        let state = EditorState.create({
            doc: mdxEditorSchema.nodes.doc.create(null, [
                mdxEditorSchema.nodes.paragraph.create(null, [
                    mdxEditorSchema.text("Title"),
                ]),
            ]),
            plugins: createMdxEditorPlugins(),
            schema: mdxEditorSchema,
        });

        expect(
            setHeadingBlock(2)(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(true);
        expect(state.doc.child(0).type.name).toBe("heading");
        expect(state.doc.child(0).attrs.level).toBe(2);
    });

    it("inserts Markdown table syntax", () => {
        expect(insertTableMarkdown(2, 2)).toBe(
            "|  |  |\n|---|---|\n|  |  |\n|  |  |\n",
        );
    });

    it("clamps huge Markdown table dimensions", () => {
        const markdown = insertTableMarkdown(1e12, 1e12);
        const lines = markdown.trimEnd().split("\n");

        expect(lines).toHaveLength(MAX_TABLE_DIMENSION + 2);
        expect(lines[0].match(/\|/g)?.length).toBe(MAX_TABLE_DIMENSION + 1);
    });

    it("does not toggle a task item from a broad unrelated selection", () => {
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("Intro"),
            ]),
            mdxEditorSchema.nodes.bullet_list.create(null, [
                mdxEditorSchema.nodes.task_item.create(
                    { checked: false },
                    mdxEditorSchema.nodes.paragraph.create(null, [
                        mdxEditorSchema.text("Task"),
                    ]),
                ),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            plugins: createMdxEditorPlugins(),
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1, taskTextPosition(doc)),
        });

        expect(
            toggleTaskItemChecked(state, (transaction) => {
                state = state.apply(transaction);
            }),
        ).toBe(false);
        expect(
            state.doc.child(1).child(0).attrs.checked,
        ).toBe(false);
    });
});

function taskTextPosition(doc: ProseMirrorNode): number {
    let position = 1;

    doc.descendants((node, pos) => {
        if (node.isText && node.text === "Task") {
            position = pos + 1;
            return false;
        }

        return true;
    });

    return position;
}
