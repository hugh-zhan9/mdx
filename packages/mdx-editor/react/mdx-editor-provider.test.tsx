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
                data-testid="insert-image-at-offset"
                onClick={() =>
                    editor.insertImage(".assets/mid.png", "Mid", undefined, {
                        anchor: 6,
                        head: 6,
                    })
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
                <MdxEditorProvider initialMarkdown={"# Title\n\n---\n\nBody.\n"}>
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const heading = host.querySelector("h1[data-mdx-node-type='heading']");
        const horizontalRule = host.querySelector(
            "hr[data-mdx-node-type='horizontal_rule']",
        );
        const paragraph = host.querySelector("p[data-mdx-node-type='paragraph']");

        expect(heading?.textContent).toBe("Title");
        expect(horizontalRule).not.toBeNull();
        expect(paragraph?.textContent).toBe("Body.");
    });

    it("renders fenced code blocks through the editor view", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={
                        "```ts\nconst value = 1;\n```\n\n```inline sample```\n"
                    }
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const codeBlocks = host.querySelectorAll(
            "pre[data-mdx-node-type='code_block']",
        );

        expect(codeBlocks[0]?.getAttribute("data-mdx-language")).toBe("ts");
        expect(codeBlocks[0]?.textContent).toBe("const value = 1;\n");
        expect(codeBlocks[1]?.textContent).toBe("inline sample\n");
    });

    it("renders code tokenizer output as inline token spans", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"```ts\nconst value = 1;\n```\n"}
                    codeTokenizer={() => [
                        { type: "keyword", content: "const" },
                        " value = ",
                        { type: "number", content: "1" },
                        ";\n",
                    ]}
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const codeBlock = host.querySelector(
            "pre[data-mdx-node-type='code_block']",
        );
        const keyword = codeBlock?.querySelector("[data-mdx-token-type='keyword']");
        const number = codeBlock?.querySelector("[data-mdx-token-type='number']");

        expect(keyword?.textContent).toBe("const");
        expect(keyword?.classList.contains("token")).toBe(true);
        expect(keyword?.classList.contains("keyword")).toBe(true);
        expect(number?.textContent).toBe("1");
    });

    it("inserts text at the ProseMirror cursor instead of visible-text markdown offsets", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"A $x$ B\n"}
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='insert-x']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith("A $x$ BX\n");
    });

    it("inserts images at pinned markdown selection offsets", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="Hello world"
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>(
                    "[data-testid='insert-image-at-offset']",
                )
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(
            "Hello ![Mid](.assets/mid.png)world",
        );
    });

    it("inserts text after footnote refs without corrupting the label", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"A [^n] B\n"}
                    onMarkdownChange={onMarkdownChange}
                >
                    <MdxEditorView />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='insert-x']")
                ?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith("A [^n] BX\n");
    });

    it("does not recreate the editor view when callback props change identity", async () => {
        const onMarkdownChange = vi.fn();

        function Harness() {
            return (
                <MdxEditorProvider
                    initialMarkdown={"Body\n"}
                    imageLoader={async (src) => `resolved:${src}`}
                    onMarkdownChange={(markdown) => onMarkdownChange(markdown)}
                >
                    <MdxEditorView />
                </MdxEditorProvider>
            );
        }

        await act(async () => {
            root.render(<Harness />);
        });

        const firstParagraph = host.querySelector(
            "p[data-mdx-node-type='paragraph']",
        );

        await act(async () => {
            root.render(<Harness />);
        });

        expect(host.querySelector("p[data-mdx-node-type='paragraph']")).toBe(
            firstParagraph,
        );
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

    it("renders escaped table pipe cells as structured table text", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"| A | B |\n|---|---|\n| A \\| B | C |\n"}
                >
                    <MdxEditorView />
                </MdxEditorProvider>,
            );
        });

        const table = host.querySelector("[data-mdx-node-type='table']");
        const firstBodyCell = table?.querySelectorAll("td")[0];

        expect(table).not.toBeNull();
        expect(firstBodyCell?.textContent).toBe("A | B");
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
