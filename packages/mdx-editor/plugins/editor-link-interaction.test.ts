// @vitest-environment jsdom

import type { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import { EditorView as ProseMirrorEditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { createEditableLinkPlugin } from "./editor-link-interaction";

describe("createEditableLinkPlugin", () => {
    it("prevents editor links from navigating so their text remains editable", () => {
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

    it("shows a hover editor that can update the link href", () => {
        const host = document.createElement("div");
        const linkMark = mdxEditorSchema.marks.link.create({
            href: "www.baidu.com",
        });
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("百度", [linkMark]),
            ]),
        ]);
        document.body.append(host);
        const view = new ProseMirrorEditorView(host, {
            state: EditorState.create({
                doc,
                schema: mdxEditorSchema,
                plugins: [createEditableLinkPlugin()],
            }),
            dispatchTransaction(transaction) {
                view.updateState(view.state.apply(transaction));
            },
        });

        const link = host.querySelector<HTMLAnchorElement>(
            'a[data-mdx-node-type="link"]',
        );
        expect(link).not.toBeNull();

        link?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        const input = document.querySelector<HTMLInputElement>(
            "input[data-mdx-link-editor-input]",
        );

        expect(input?.value).toBe("www.baidu.com");

        input!.value = "https://baidu.com";
        input!.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "Enter",
            }),
        );

        expect(
            view.state.doc.child(0).child(0).marks[0]?.attrs.href,
        ).toBe("https://baidu.com");

        view.destroy();
        host.remove();
        document.querySelector("[data-mdx-link-editor]")?.remove();
    });
});
