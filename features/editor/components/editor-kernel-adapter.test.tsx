// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
    DOMD,
    DOMDProvider,
    useEditor,
    useEditorStoreApi,
    useRenderData,
    insertImage,
    insertText,
    resetMD,
    toMarkdown,
    getSelectionState,
} from "./editor-kernel-adapter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
    const editor = useEditor();
    const editorStore = useEditorStoreApi();
    const renderData = useRenderData();

    return (
        <button
            type="button"
            data-testid="probe"
            onClick={() => {
                resetMD(editorStore, "Hello");
                insertText(editorStore, " world");
                insertImage(editorStore, ".assets/a.png", "A");
                window.__probeSelection =
                    getSelectionState(editorStore)?.selected_text ?? "";
                editor?.focus();
            }}
        >
            {toMarkdown(renderData) ?? ""}
        </button>
    );
}

describe("editor kernel adapter", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        delete window.__probeSelection;
    });

    it("renders the editor root contract through the legacy adapter surface", async () => {
        await act(async () => {
            root.render(
                <DOMDProvider editable initMd="Hello">
                    <Probe />
                    <DOMD />
                </DOMDProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='probe']")?.click();
        });

        expect(host.textContent).toContain("Hello world");
        expect(host.textContent).toContain("![A](.assets/a.png)");
        expect(
            host.querySelector("img[data-mdx-node-type='image']")?.getAttribute("alt"),
        ).toBe("A");
    });
});

declare global {
    interface Window {
        __probeSelection?: string;
    }
}
