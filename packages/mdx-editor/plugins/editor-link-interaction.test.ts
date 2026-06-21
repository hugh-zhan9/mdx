// @vitest-environment jsdom

import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { EditorView as ProseMirrorEditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { createEditableLinkPlugin } from "./editor-link-interaction";

describe("createEditableLinkPlugin", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prevents plain editor link clicks from navigating so their text remains editable", () => {
        const plugin = createEditableLinkPlugin();
        const editorRoot = document.createElement("div");
        const link = document.createElement("a");
        const preventDefault = vi.fn();

        link.href = "www.baidu.com";
        link.dataset.mdxNodeType = "link";
        link.textContent = "百度";
        editorRoot.append(link);

        const handled = plugin.props.handleDOMEvents?.click?.(
            { dom: editorRoot } as EditorView,
            {
                target: link,
                preventDefault,
            } as unknown as MouseEvent,
        );

        expect(handled).toBe(false);
        expect(preventDefault).toHaveBeenCalledOnce();
    });

    it("opens editor links with a command click", () => {
        const plugin = createEditableLinkPlugin();
        const editorRoot = document.createElement("div");
        const link = document.createElement("a");
        const preventDefault = vi.fn();
        const open = vi.spyOn(window, "open").mockImplementation(() => null);

        link.href = "www.baidu.com";
        link.setAttribute("href", "www.baidu.com");
        link.dataset.mdxNodeType = "link";
        link.textContent = "百度";
        editorRoot.append(link);

        const handled = plugin.props.handleDOMEvents?.click?.(
            { dom: editorRoot } as EditorView,
            {
                metaKey: true,
                target: link,
                preventDefault,
            } as unknown as MouseEvent,
        );

        expect(handled).toBe(true);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(open).toHaveBeenCalledWith(
            "https://www.baidu.com",
            "_blank",
            "noopener",
        );
    });

    it("does not show a hover popup for editor links", () => {
        const plugin = createEditableLinkPlugin();

        expect(plugin.props.handleDOMEvents?.mouseover).toBeUndefined();
    });

    it("expands a selected link into editable markdown text and restores it after leaving", () => {
        const host = document.createElement("div");
        const linkMark = mdxEditorSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("百度", [linkMark]),
                mdxEditorSchema.text(" tail"),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            plugins: [createEditableLinkPlugin()],
        });
        let state = initialState.apply(
            initialState.tr.setSelection(
                TextSelection.create(initialState.doc, 2),
            ),
        );

        document.body.append(host);
        const view = new ProseMirrorEditorView(host, {
            state,
            dispatchTransaction(transaction) {
                state = state.apply(transaction);
                view.updateState(state);
            },
        });

        expect(state.doc.child(0).textContent).toBe(
            "[百度](www.baidu.com) tail",
        );
        expect(state.doc.child(0).child(0).marks).toHaveLength(0);
        expect(host.querySelector("[data-mdx-editing-link='true']")).not.toBeNull();

        view.dispatch(
            state.tr.insertText(
                "http://",
                6,
                6,
            ),
        );

        expect(state.doc.child(0).textContent).toBe(
            "[百度](http://www.baidu.com) tail",
        );

        view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, 31)),
        );

        const paragraph = state.doc.child(0);
        expect(paragraph.textContent).toBe("百度 tail");
        expect(paragraph.child(0).marks[0]?.attrs.href).toBe(
            "http://www.baidu.com",
        );

        view.destroy();
        host.remove();
    });

    it("restores an expanded markdown link before handling Enter", () => {
        const host = document.createElement("div");
        const linkMark = mdxEditorSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("百度", [linkMark]),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            plugins: [createEditableLinkPlugin()],
        });
        let state = initialState.apply(
            initialState.tr.setSelection(
                TextSelection.create(initialState.doc, 2),
            ),
        );

        document.body.append(host);
        const view = new ProseMirrorEditorView(host, {
            state,
            dispatchTransaction(transaction) {
                state = state.apply(transaction);
                view.updateState(state);
            },
        });

        expect(state.doc.child(0).textContent).toBe("[百度](www.baidu.com)");

        view.someProp("handleDOMEvents", (handlers) =>
            handlers.keydown?.(
                view,
                new KeyboardEvent("keydown", {
                    key: "Enter",
                }),
            ),
        );

        expect(state.doc.child(0).textContent).toBe("百度");
        expect(state.doc.child(0).child(0).marks[0]?.attrs.href).toBe(
            "www.baidu.com",
        );

        view.destroy();
        host.remove();
    });

    it("keeps edited markdown as plain text when the link syntax is no longer valid", () => {
        const host = document.createElement("div");
        const linkMark = mdxEditorSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("百度", [linkMark]),
                mdxEditorSchema.text(" tail"),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            plugins: [createEditableLinkPlugin()],
        });
        let state = initialState.apply(
            initialState.tr.setSelection(
                TextSelection.create(initialState.doc, 2),
            ),
        );

        document.body.append(host);
        const view = new ProseMirrorEditorView(host, {
            state,
            dispatchTransaction(transaction) {
                state = state.apply(transaction);
                view.updateState(state);
            },
        });

        view.dispatch(state.tr.delete(1, 2));
        view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, 20)),
        );

        expect(state.doc.child(0).textContent).toBe("百度](www.baidu.com) tail");
        expect(
            state.doc.child(0).child(0).marks.some(
                (mark) => mark.type.name === "link",
            ),
        ).toBe(false);

        view.destroy();
        host.remove();
    });

    it("restores an expanded markdown link when the editor loses focus", () => {
        const host = document.createElement("div");
        const linkMark = mdxEditorSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("百度", [linkMark]),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            plugins: [createEditableLinkPlugin()],
        });
        let state = initialState.apply(
            initialState.tr.setSelection(
                TextSelection.create(initialState.doc, 2),
            ),
        );

        document.body.append(host);
        const view = new ProseMirrorEditorView(host, {
            state,
            dispatchTransaction(transaction) {
                state = state.apply(transaction);
                view.updateState(state);
            },
        });

        expect(state.doc.child(0).textContent).toBe("[百度](www.baidu.com)");

        view.someProp("handleDOMEvents", (handlers) =>
            handlers.blur?.(view, new FocusEvent("blur")),
        );

        expect(state.doc.child(0).textContent).toBe("百度");
        expect(state.doc.child(0).child(0).marks[0]?.attrs.href).toBe(
            "www.baidu.com",
        );

        view.destroy();
        host.remove();
    });
});
