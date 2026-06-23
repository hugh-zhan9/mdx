// @vitest-environment jsdom

import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { EditorView as ProseMirrorEditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
import { createEditableLinkPlugin } from "./editor-link-interaction";

const defaultSchema = createMdxEditorKernel({
    syntax: defaultMarkdownSyntax(),
}).schema;

function createLinkPluginForKernel() {
    return createEditableLinkPlugin(defaultSchema);
}

describe("createEditableLinkPlugin", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prevents plain editor link clicks from navigating so their text remains editable", () => {
        const plugin = createLinkPluginForKernel();
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
        const plugin = createLinkPluginForKernel();
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
        const plugin = createLinkPluginForKernel();

        expect(plugin.props.handleDOMEvents?.mouseover).toBeUndefined();
    });

    it("expands a selected link into editable markdown text and restores it after leaving", () => {
        const host = document.createElement("div");
        const linkMark = defaultSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = defaultSchema.nodes.doc.create(null, [
            defaultSchema.nodes.paragraph.create(null, [
                defaultSchema.text("百度", [linkMark]),
                defaultSchema.text(" tail"),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: defaultSchema,
            plugins: [createLinkPluginForKernel()],
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
        const linkMark = defaultSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = defaultSchema.nodes.doc.create(null, [
            defaultSchema.nodes.paragraph.create(null, [
                defaultSchema.text("百度", [linkMark]),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: defaultSchema,
            plugins: [createLinkPluginForKernel()],
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

    it("restores edited markdown links with the active kernel schema", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const host = document.createElement("div");
        const linkMark = kernel.schema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = kernel.schema.nodes.doc.create(null, [
            kernel.schema.nodes.paragraph.create(null, [
                kernel.schema.text("kernel", [linkMark]),
                kernel.schema.text(" tail"),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: kernel.schema,
            plugins: kernel.createEditorPlugins(),
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

        view.dispatch(
            state.tr.insertText(
                "http://",
                10,
                10,
            ),
        );
        view.dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)));

        const restoredLink = state.doc.child(0).child(0).marks[0];
        expect(kernel.schema).not.toBe(defaultSchema);
        expect(restoredLink.type).toBe(kernel.schema.marks.link);
        expect(restoredLink.type).not.toBe(defaultSchema.marks.link);
        expect(restoredLink.attrs.href).toBe("http://www.baidu.com");

        view.destroy();
        host.remove();
    });

    it("keeps edited markdown as plain text when the link syntax is no longer valid", () => {
        const host = document.createElement("div");
        const linkMark = defaultSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = defaultSchema.nodes.doc.create(null, [
            defaultSchema.nodes.paragraph.create(null, [
                defaultSchema.text("百度", [linkMark]),
                defaultSchema.text(" tail"),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: defaultSchema,
            plugins: [createLinkPluginForKernel()],
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
        const linkMark = defaultSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = defaultSchema.nodes.doc.create(null, [
            defaultSchema.nodes.paragraph.create(null, [
                defaultSchema.text("百度", [linkMark]),
            ]),
        ]);
        const initialState = EditorState.create({
            doc,
            schema: defaultSchema,
            plugins: [createLinkPluginForKernel()],
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
