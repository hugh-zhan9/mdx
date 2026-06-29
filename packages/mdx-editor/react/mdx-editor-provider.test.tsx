// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMdxEditorKernel } from "../kernel";
import { defaultMarkdownSyntax } from "../syntax/default";
import { MdxEditorProvider, useMdxEditor } from "./index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function EditorRootFixture() {
    const editor = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        editor.registerRoot(rootRef.current);

        return () => {
            editor.registerRoot(null);
        };
    }, [editor]);

    return <div ref={rootRef} data-mdx-editor-root tabIndex={0} />;
}

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
                        anchor: 23,
                        head: 23,
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
            <button
                type="button"
                data-testid="reset-image-source"
                onClick={() => editor.resetMarkdown('![Diagram](.assets/b.png)\n')}
            />
            <button
                type="button"
                data-testid="set-selection-start"
                onClick={() => editor.setSelectionRange({ anchor: 1, head: 1 })}
            />
            <button
                type="button"
                data-testid="layout-revision"
                data-layout-revision={editor.getLayoutSource()?.revision ?? ""}
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
                    <EditorRootFixture />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();

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
                    <EditorRootFixture />
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

    it("uses an explicit kernel instance for parse, serialize, plugins, and node views", async () => {
        const onMarkdownChange = vi.fn();
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"# Kernel\n\nBody.\n"}
                    kernel={kernel}
                    onMarkdownChange={onMarkdownChange}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        expect(host.querySelector("[data-mdx-node-type='heading']")?.textContent).toBe(
            "Kernel",
        );
    });

    it("uses explicit kernel image services without a provider imageLoader prop", async () => {
        const imageLoader = vi.fn(async (src: string) => `kernel:${src}`);
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
            services: {
                imageLoader,
            },
        });

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Kernel](.assets/a.png)\n'}
                    kernel={kernel}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(imageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(image?.getAttribute("src")).toBe("kernel:.assets/a.png");
        expect(image?.getAttribute("alt")).toBe("Kernel");
    });

    it("uses the explicit kernel image service instead of the provider prop", async () => {
        const kernelImageLoader = vi.fn(async (src: string) => `kernel:${src}`);
        const propImageLoader = vi.fn(async (src: string) => `prop:${src}`);
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
            services: {
                imageLoader: kernelImageLoader,
            },
        });

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Kernel](.assets/a.png)\n'}
                    imageLoader={propImageLoader}
                    kernel={kernel}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(kernelImageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(propImageLoader).not.toHaveBeenCalled();
        expect(image?.getAttribute("src")).toBe("kernel:.assets/a.png");
    });

    it("renders fenced code blocks through the editor view", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={
                        "```ts\nconst value = 1;\n```\n\n```inline sample```\n"
                    }
                >
                    <EditorRootFixture />
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
                    <EditorRootFixture />
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

    it("renders footnote refs and multi-line footnote definitions without source markers", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={
                        [
                            "A note[^long-note].",
                            "",
                            "[^long-note]: First line.",
                            "    Second line.",
                            "    Third line.",
                            "",
                        ].join("\n")
                    }
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        const footnoteRef = host.querySelector(
            "[data-mdx-node-type='footnote_ref']",
        );
        const footnoteDefinition = host.querySelector(
            "[data-mdx-node-type='footnote_definition']",
        );

        expect(footnoteRef?.tagName).toBe("SUP");
        expect(footnoteRef?.textContent).toBe("long-note");
        expect(footnoteRef?.textContent).not.toContain("[^");
        expect(footnoteDefinition?.textContent).not.toContain("[^long-note]:");
        expect(footnoteDefinition?.textContent).toContain("First line.");
        expect(footnoteDefinition?.textContent).toContain("Second line.");
        expect(footnoteDefinition?.textContent).toContain("Third line.");
    });

    it("inserts text at the ProseMirror cursor instead of visible-text markdown offsets", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={"A $x$ B\n"}
                    onMarkdownChange={onMarkdownChange}
                >
                    <EditorRootFixture />
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

    it("inserts images at pinned document selection positions after links", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="[百度](http://baidu.com)"
                    onMarkdownChange={onMarkdownChange}
                >
                    <EditorRootFixture />
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
            "[百度](http://baidu.com)![Mid](.assets/mid.png)",
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
                    <EditorRootFixture />
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
                    <EditorRootFixture />
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
                    <EditorRootFixture />
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
                    <EditorRootFixture />
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
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        const fallback = host.querySelector<HTMLDivElement>(
            "[data-mdx-node-type='source_fallback']",
        );

        expect(fallback).not.toBeNull();
        expect(
            host.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).toBeNull();
        expect(fallback?.querySelector("div")?.textContent).toContain(
            "Unsupported",
        );

        await act(async () => {
            host
                .querySelector<HTMLElement>(
                    "[role='button'][aria-label='Edit source fallback']",
                )
                ?.click();
        });

        const textarea = host.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Markdown source fallback']",
        );

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

    it("renders adjacent source fallback html blocks without leaking closing tags", async () => {
        const markdown = [
            '<div class="custom-block">',
            "  <p>One</p>",
            "</div>",
            "",
            '<div class="custom-block">',
            "  <p>Two</p>",
            "</div>",
            "",
        ].join("\n");

        await act(async () => {
            root.render(
                <MdxEditorProvider initialMarkdown={markdown}>
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        const fallbacks = Array.from(
            host.querySelectorAll<HTMLElement>(
                "[data-mdx-node-type='source_fallback']",
            ),
        );

        expect(fallbacks).toHaveLength(2);
        expect(
            fallbacks.map((fallback) =>
                fallback.querySelector(".custom-block")?.textContent?.trim(),
            ),
        ).toEqual(["One", "Two"]);
        expect(
            fallbacks.some((fallback) => fallback.textContent?.includes("</div>")),
        ).toBe(false);
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
                    <EditorRootFixture />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {
            host
                .querySelector<HTMLElement>(
                    "[role='button'][aria-label='Edit source fallback']",
                )
                ?.click();
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
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(imageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(image?.getAttribute("src")).toBe("resolved:.assets/a.png");
        expect(image?.getAttribute("alt")).toBe("Diagram");
    });

    it("hydrates images after imageLoader appears on a later render", async () => {
        const imageLoader = vi.fn(async (src: string) => `resolved:${src}`);

        await act(async () => {
            root.render(
                <MdxEditorProvider initialMarkdown={'![Diagram](.assets/a.png)\n'}>
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        const initialImage = host.querySelector("img[data-mdx-node-type='image']");

        expect(initialImage?.getAttribute("src")).toBe(".assets/a.png");
        expect(initialImage?.hasAttribute("data-mdx-resolved-src")).toBe(false);

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Diagram](.assets/a.png)\n'}
                    imageLoader={imageLoader}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const hydratedImage = host.querySelector("img[data-mdx-node-type='image']");

        expect(hydratedImage).toBe(initialImage);
        expect(imageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(hydratedImage?.getAttribute("src")).toBe("resolved:.assets/a.png");
        expect(hydratedImage?.getAttribute("data-mdx-resolved-src")).toBe(
            ".assets/a.png",
        );
    });

    it("clears stale image hydration source when markdown image source changes", async () => {
        const imageLoader = vi.fn(async (src: string) => `resolved:${src}`);

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Diagram](.assets/a.png)\n'}
                    imageLoader={imageLoader}
                >
                    <EditorRootFixture />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        expect(imageLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(
            host.querySelector("img[data-mdx-node-type='image']")?.getAttribute(
                "data-mdx-resolved-src",
            ),
        ).toBe(".assets/a.png");

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='reset-image-source']")
                ?.click();
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(imageLoader).toHaveBeenCalledWith(".assets/b.png");
        expect(imageLoader).not.toHaveBeenCalledWith("resolved:.assets/a.png");
        expect(image?.getAttribute("src")).toBe("resolved:.assets/b.png");
        expect(image?.getAttribute("data-mdx-resolved-src")).toBe(
            ".assets/b.png",
        );
    });

    it("rehydrates images from the markdown source when imageLoader changes", async () => {
        const firstLoader = vi.fn(async (src: string) => `A:${src}`);
        const secondLoader = vi.fn(async (src: string) => `B:${src}`);

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Diagram](.assets/a.png)\n'}
                    imageLoader={firstLoader}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        expect(firstLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(
            host.querySelector("img[data-mdx-node-type='image']")?.getAttribute("src"),
        ).toBe("A:.assets/a.png");

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown={'![Diagram](.assets/a.png)\n'}
                    imageLoader={secondLoader}
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        await act(async () => {});

        const image = host.querySelector("img[data-mdx-node-type='image']");

        expect(secondLoader).toHaveBeenCalledWith(".assets/a.png");
        expect(secondLoader).not.toHaveBeenCalledWith("A:.assets/a.png");
        expect(image?.getAttribute("src")).toBe("B:.assets/a.png");
        expect(image?.getAttribute("data-mdx-resolved-src")).toBe(
            ".assets/a.png",
        );
    });

    it("exposes placeholder state on an empty editor root", async () => {
        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown=""
                    placeholder="Start writing"
                >
                    <EditorRootFixture />
                </MdxEditorProvider>,
            );
        });

        const editorRoot = host.querySelector("[data-mdx-editor-root]");

        expect(editorRoot?.getAttribute("data-mdx-placeholder")).toBe(
            "Start writing",
        );
        expect(editorRoot?.getAttribute("data-mdx-empty")).toBe("true");
    });

    it("keeps selection-only transactions out of markdown and layout updates", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="Hello"
                    onMarkdownChange={onMarkdownChange}
                >
                    <EditorRootFixture />
                    <Probe />
                </MdxEditorProvider>,
            );
        });

        const revisionBefore = host
            .querySelector<HTMLButtonElement>("[data-testid='layout-revision']")
            ?.getAttribute("data-layout-revision");

        await act(async () => {
            host
                .querySelector<HTMLButtonElement>("[data-testid='set-selection-start']")
                ?.click();
        });

        expect(onMarkdownChange).not.toHaveBeenCalled();
        expect(
            host
                .querySelector<HTMLButtonElement>("[data-testid='layout-revision']")
                ?.getAttribute("data-layout-revision"),
        ).toBe(revisionBefore);
    });

    it("handles sequential mutations and snapshots in one callback", async () => {
        const onMarkdownChange = vi.fn();

        await act(async () => {
            root.render(
                <MdxEditorProvider
                    initialMarkdown="Hello"
                    onMarkdownChange={onMarkdownChange}
                >
                    <EditorRootFixture />
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
