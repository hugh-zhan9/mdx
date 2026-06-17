// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MdxEditorProvider, MdxEditorView, useMdxEditor } from "./index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
    const editor = useMdxEditor();

    return (
        <>
            <button
                type="button"
                data-testid="insert"
                onClick={() => editor.insertText(" world")}
            >
                {editor.currentMarkdown}
            </button>
            <button
                type="button"
                data-testid="insert-image"
                onClick={() =>
                    editor.insertImage(".assets/a.png", "Diagram", "Preview")
                }
            />
        </>
    );
}

describe("MdxEditorProvider", () => {
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
    });

    it("renders the editor root contract and emits Markdown changes", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="Hello"
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();
        expect(host.querySelector("[data-mdx-editor-view]")).not.toBeNull();

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='insert']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith("Hello world");

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='insert-image']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(
            'Hello world![Diagram](.assets/a.png "Preview")',
        );
    });
});
