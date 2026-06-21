// @vitest-environment jsdom

import type { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
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
});
