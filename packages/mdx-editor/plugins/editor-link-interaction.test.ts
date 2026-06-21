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

    it("shows an inline markdown href editor only when the cursor is inside a link", () => {
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

        const input = host.querySelector<HTMLInputElement>(
            "input[data-mdx-link-href-input]",
        );
        expect(input?.value).toBe("www.baidu.com");
        expect(host.textContent).toContain("[百度](");
        expect(
            view.someProp("handleDOMEvents", (handlers) =>
                handlers.mousedown?.(
                    view,
                    {
                        target: input,
                    } as unknown as MouseEvent,
                ),
            ),
        ).toBe(true);

        input!.value = "https://baidu.com";
        input!.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "Enter",
            }),
        );

        expect(state.doc.child(0).child(0).marks[0]?.attrs.href).toBe(
            "https://baidu.com",
        );

        view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, 6)),
        );
        expect(
            host.querySelector("input[data-mdx-link-href-input]"),
        ).toBeNull();

        view.destroy();
        host.remove();
    });
});
