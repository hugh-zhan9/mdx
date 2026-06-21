// @vitest-environment jsdom

import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
