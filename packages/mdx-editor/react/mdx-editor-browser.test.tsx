// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MdxEditorProvider, MdxEditorView } from "./index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const renderMermaidDiagram = vi.hoisted(() => vi.fn());

vi.mock("./mermaid-renderer", () => ({
    renderMermaidDiagram: (
        request: Parameters<typeof renderMermaidDiagram>[0],
    ) => renderMermaidDiagram(request),
}));

describe("mdx editor browser behaviors", () => {
    beforeEach(() => {
        renderMermaidDiagram.mockReset();
        renderMermaidDiagram.mockResolvedValue({
            ok: true,
            svg: "<svg><text>rendered mermaid</text></svg>",
        });
    });

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

    it("renders mermaid fences through the node view path", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(
                    <MdxEditorProvider
                        initialMarkdown={"```mermaid\ngraph TD\n  A --> B\n```\n"}
                    >
                        <MdxEditorView />
                    </MdxEditorProvider>,
                );
            });

            const source = host.querySelector<HTMLTextAreaElement>(
                "textarea[aria-label='Mermaid source']",
            );
            const preview = host.querySelector("[data-mdx-mermaid-preview]");

            expect(source?.value).toBe("graph TD\n  A --> B\n");
            expect(renderMermaidDiagram).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: "graph TD\n  A --> B\n",
                    theme: "light",
                }),
            );

            await act(async () => {
                await Promise.resolve();
            });

            expect(preview?.innerHTML).toContain("<svg");
            expect(preview?.textContent).toContain("rendered mermaid");
            expect(
                host.querySelector("pre[data-mdx-node-type='mermaid_block']"),
            ).toBeNull();
            expect(host.textContent).not.toContain("编辑");
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it("keeps math and footnote source controls hidden until editing", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(
                    <MdxEditorProvider
                        initialMarkdown={
                            [
                                "Inline $E = mc^2$ and a note[^note1].",
                                "",
                                "$$",
                                "\\int_0^1 x^2 dx = \\frac{1}{3}",
                                "$$",
                                "",
                                "[^note1]: Footnote body.",
                                "",
                            ].join("\n")
                        }
                    >
                        <MdxEditorView />
                    </MdxEditorProvider>,
                );
            });

            const footnoteDefinition = host.querySelector(
                "[data-mdx-node-type='footnote_definition']",
            );

            expect(host.querySelector(".katex")).not.toBeNull();
            expect(
                host.querySelector("textarea[aria-label='Math block']"),
            ).toBeNull();
            expect(
                host.querySelector("input[aria-label='Inline math']"),
            ).toBeNull();
            expect(
                host.querySelector("input[aria-label='Footnote label']"),
            ).toBeNull();
            expect(footnoteDefinition?.textContent).not.toContain("[^");

            await act(async () => {
                host
                    .querySelector<HTMLElement>(
                        "[data-mdx-node-type='math_block'] .mdx-math-preview",
                    )
                    ?.click();
            });

            expect(
                host.querySelector("textarea[aria-label='Math block']"),
            ).not.toBeNull();
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it("renders inline kbd and full source fallback markdown by default", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(
                    <MdxEditorProvider
                        initialMarkdown={
                            [
                                "Press <kbd>Command</kbd> + <kbd>Z</kbd>.",
                                "",
                                '<div class="custom-block">',
                                "  <p>Unsupported</p>",
                                "</div>",
                                "",
                            ].join("\n")
                        }
                    >
                        <MdxEditorView />
                    </MdxEditorProvider>,
                );
            });

            const keys = Array.from(host.querySelectorAll("kbd"));
            const fallback = host.querySelector(
                "[data-mdx-node-type='source_fallback']",
            );

            expect(keys.map((key) => key.textContent)).toEqual([
                "Command",
                "Z",
            ]);
            expect(
                host.querySelector("input[aria-label='Inline HTML source']"),
            ).toBeNull();

            await act(async () => {
                host
                    .querySelector<HTMLButtonElement>(
                        "button[aria-label='Edit inline HTML']",
                    )
                    ?.click();
            });

            expect(
                host.querySelector<HTMLInputElement>(
                    "input[aria-label='Inline HTML source']",
                )?.value,
            ).toBe("<kbd>Command</kbd>");
            expect(fallback?.querySelector(".custom-block")).not.toBeNull();
            expect(fallback?.textContent).toBe("\n  Unsupported\n\n");
            expect(
                host.querySelector("textarea[aria-label='Markdown source fallback']"),
            ).toBeNull();
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
