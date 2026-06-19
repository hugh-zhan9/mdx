// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { MdxEditorProvider, MdxEditorView } from "./index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

describe("mdx editor browser behaviors", () => {
    it("renders selectable formatted content for native copy", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(
                    <MdxEditorProvider initialMarkdown={"# Title\n\nA **bold** link.\n"}>
                        <MdxEditorView />
                    </MdxEditorProvider>,
                );
            });

            const heading = host.querySelector("h1[data-mdx-node-type='heading']");
            const strong = host.querySelector("strong");

            expect(heading?.textContent).toBe("Title");
            expect(strong?.textContent).toBe("bold");
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
