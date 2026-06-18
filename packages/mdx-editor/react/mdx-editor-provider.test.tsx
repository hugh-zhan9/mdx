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
            <button
                type="button"
                data-testid="compound"
                onClick={() => {
                    editor.insertText(" world");
                    editor.insertImage(".assets/b.png", "Alt", "Title");
                }}
            />
            <button
                type="button"
                data-testid="snapshot"
                onClick={() => {
                    const snapshot = editor.getSelectionSnapshot();

                    document
                        .querySelector<HTMLDivElement>("[data-testid='snapshot-target']")
                        ?.setAttribute("data-selection", snapshot?.selected_text ?? "");
                }}
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

    it("renders parsed block structure through the editor view", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider initialMarkdown={"# Title\n\nBody.\n"}>
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const heading = host.querySelector("h1[data-mdx-node-type='heading']");
        const paragraph = host.querySelector("p[data-mdx-node-type='paragraph']");

        expect(heading?.textContent).toBe("Title");
        expect(paragraph?.textContent).toBe("Body.");
    });

    it("handles sequential mutations and snapshots in one callback", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="Hello"
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                    <div data-testid="snapshot-target" />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='compound']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(
            'Hello world![Alt](.assets/b.png "Title")',
        );

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='snapshot']")
                ?.click();
        });

        expect(
            host
                .querySelector<HTMLDivElement>("[data-testid='snapshot-target']")
                ?.getAttribute("data-selection"),
        ).toBe("");
    });
});
