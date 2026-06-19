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
                data-testid="insert-x"
                onClick={() => editor.insertText("X")}
            />
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
        expect(
            host.querySelector("img[data-mdx-node-type='image']")?.getAttribute("alt"),
        ).toBe("Diagram");
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

    it("emits markdown when ProseMirror document changes through editable content", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"# Title\n\nBody\n"}
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const paragraph = host.querySelector("p[data-mdx-node-type='paragraph']");

        expect(paragraph).not.toBeNull();

        await act(async () => {
            paragraph!.textContent = "Changed";
            paragraph!.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: "Changed",
                }),
            );
        });

        expect(onMarkdownChange).toHaveBeenCalled();
        expect(onMarkdownChange.mock.calls.at(-1)?.[0]).toContain("Changed");
    });

    it("renders editable source fallback blocks and serializes textarea edits", async () => {
        const markdown = "<div>\nUnsupported\n</div>\n";
        const editedMarkdown = "<section>Changed</section>\n";
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={markdown}
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const fallback = host.querySelector<HTMLDivElement>(
            "[data-mdx-node-type='source_fallback']",
        );
        const textarea = host.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Markdown source fallback']",
        );

        expect(fallback).not.toBeNull();
        expect(textarea?.value).toBe(markdown);

        await act(async () => {
            if (!textarea) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(textarea, editedMarkdown);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(editedMarkdown);
        expect(textarea?.value).toBe(editedMarkdown);
    });

    it("keeps selection offsets aligned after source fallback text length changes", async () => {
        const markdown = "<div>\nfallback\n</div>\n";
        const editedMarkdown = "<section>\nmuch longer fallback\n</section>\n";
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={markdown}
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        const textarea = host.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Markdown source fallback']",
        );

        await act(async () => {
            if (!textarea) {
                return;
            }

            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;

            valueSetter?.call(textarea, editedMarkdown);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='insert-x']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(`${editedMarkdown}X`);
    });

    it("hydrates rendered image nodes through imageLoader", async () => {
        const imageLoader = vi.fn(async (src: string) => `resolved:${src}`);

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Diagram](.assets/a.png)\n'}
                    imageLoader={imageLoader}
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(imageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(image?.getAttribute("src")).toBe("resolved:.assets/a.png");
        expect(image?.getAttribute("alt")).toBe("Diagram");
    });

    it("exposes placeholder state on an empty editor root", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown=""
                    placeholder="Start writing"
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const editorRoot = host.querySelector("[data-mdx-editor-root]");

        expect(editorRoot?.getAttribute("data-mdx-placeholder")).toBe(
            "Start writing",
        );
        expect(editorRoot?.getAttribute("data-mdx-empty")).toBe("true");
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
