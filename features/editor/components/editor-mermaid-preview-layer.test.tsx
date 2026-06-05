// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorMermaidPreviewLayer } from "./editor-mermaid-preview-layer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const renderMermaidDiagram = vi.fn();

vi.mock("../lib/mermaid-renderer", () => ({
    renderMermaidDiagram: (
        request: Parameters<typeof renderMermaidDiagram>[0],
    ) => renderMermaidDiagram(request),
}));

describe("EditorMermaidPreviewLayer", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let editorRoot: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        renderMermaidDiagram.mockResolvedValue({
            ok: true,
            svg: "<svg><text>A</text></svg>",
        });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        editorRoot = document.createElement("div");
        editorRoot.className = "DOMD-Root";
        editorRoot.append(pre("graph TD\n  A --> B"));
        document.body.append(editorRoot);
    });

    afterEach(() => {
        act(() => root.unmount());
        editorRoot.remove();
        host.remove();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("hides mermaid source and inserts a preview block", async () => {
        await renderLayer("```mermaid\ngraph TD\n  A --> B\n```");

        expect(editorRoot.querySelector("pre")?.hidden).toBe(true);
        expect(
            editorRoot.querySelector("[data-mdx-mermaid-preview]"),
        ).not.toBeNull();
        expect(renderMermaidDiagram).toHaveBeenCalledWith(
            expect.objectContaining({
                code: "graph TD\n  A --> B",
                theme: expect.any(String),
            }),
        );
    });

    it("reveals source when the preview is clicked", async () => {
        await renderLayer("```mermaid\ngraph TD\n  A --> B\n```");

        const preview = editorRoot.querySelector<HTMLElement>(
            "[data-mdx-mermaid-preview]",
        );
        act(() => preview?.click());

        expect(editorRoot.querySelector("pre")?.hidden).toBe(false);
    });

    it("keeps invalid source visible and shows an error", async () => {
        renderMermaidDiagram.mockResolvedValue({
            ok: false,
            error: "Parse error",
        });

        await renderLayer("```mermaid\nnot mermaid\n```");

        expect(editorRoot.querySelector("pre")?.hidden).toBe(false);
        expect(editorRoot.textContent).toContain("Mermaid 语法无法渲染");
    });

    it("removes stale previews that are no longer next to the mapped source", async () => {
        const stalePreview = document.createElement("div");
        stalePreview.dataset.mdxMermaidPreview = "mermaid-0";
        editorRoot.prepend(stalePreview);

        await renderLayer("```mermaid\ngraph TD\n  A --> B\n```");

        const previews = editorRoot.querySelectorAll(
            "[data-mdx-mermaid-preview='mermaid-0']",
        );

        expect(previews).toHaveLength(1);
        expect(editorRoot.querySelector("pre")?.nextElementSibling).toBe(
            previews[0],
        );
    });

    it("ignores stale async render results after newer markdown renders", async () => {
        const firstRender = deferredRenderResult();
        const secondRender = deferredRenderResult();
        renderMermaidDiagram
            .mockImplementationOnce(() => firstRender.promise)
            .mockImplementationOnce(() => secondRender.promise);

        await renderLayerWithoutTimers("```mermaid\ngraph TD\n  A --> B\n```");
        await flushDebounceTimer();

        await renderLayerWithoutTimers("```mermaid\ngraph TD\n  A --> C\n```");
        await flushDebounceTimer();

        await act(async () => {
            secondRender.resolve({
                ok: true,
                svg: "<svg><text>new</text></svg>",
            });
            await Promise.resolve();
        });

        const preview = editorRoot.querySelector<HTMLElement>(
            "[data-mdx-mermaid-preview]",
        );
        expect(preview?.innerHTML).toContain("new");

        await act(async () => {
            firstRender.resolve({
                ok: true,
                svg: "<svg><text>old</text></svg>",
            });
            await Promise.resolve();
        });

        expect(preview?.innerHTML).toContain("new");
        expect(preview?.innerHTML).not.toContain("old");
    });

    it("restores source visibility when the mermaid mapping disappears", async () => {
        await renderLayer("```mermaid\ngraph TD\n  A --> B\n```");

        const source = editorRoot.querySelector("pre");
        expect(source?.hidden).toBe(true);

        await renderLayer("```text\ngraph TD\n  A --> B\n```");

        expect(source?.hidden).toBe(false);
        expect(source?.getAttribute("aria-hidden")).toBeNull();
        expect(source?.classList.contains("mdx-mermaid-source-hidden")).toBe(
            false,
        );
        expect(source?.classList.contains("mdx-mermaid-source-editing")).toBe(
            false,
        );
        expect(source?.classList.contains("mdx-mermaid-source-error")).toBe(
            false,
        );
    });

    it("does not restore visibility on unrelated hidden code blocks", async () => {
        const unrelated = pre("plain text");
        unrelated.hidden = true;
        unrelated.setAttribute("aria-hidden", "true");
        editorRoot.replaceChildren(unrelated);

        await renderLayer("```text\nplain text\n```");

        expect(unrelated.hidden).toBe(true);
        expect(unrelated.getAttribute("aria-hidden")).toBe("true");
    });

    it("does not show cached svg when mermaid source changes at the same index", async () => {
        await renderLayer("```mermaid\ngraph TD\n  A --> B\n```");

        const preview = editorRoot.querySelector<HTMLElement>(
            "[data-mdx-mermaid-preview]",
        );
        expect(preview?.innerHTML).toContain("A");

        const nextRender = deferredRenderResult();
        renderMermaidDiagram.mockImplementationOnce(() => nextRender.promise);

        await renderLayerWithoutTimers("```mermaid\ngraph TD\n  A --> C\n```");

        expect(preview?.innerHTML).not.toContain("A");

        await flushDebounceTimer();
        await act(async () => {
            nextRender.resolve({
                ok: true,
                svg: "<svg><text>B</text></svg>",
            });
            await Promise.resolve();
        });

        expect(preview?.innerHTML).toContain("B");
    });

    async function renderLayer(markdown: string) {
        await renderLayerWithoutTimers(markdown);
        await act(async () => {
            await vi.runAllTimersAsync();
        });
    }

    async function renderLayerWithoutTimers(markdown: string) {
        await act(async () => {
            root.render(
                <EditorMermaidPreviewLayer
                    editorRoot={editorRoot}
                    markdown={markdown}
                />,
            );
        });
    }

    async function flushDebounceTimer() {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
    }
});

function pre(text: string): HTMLPreElement {
    const element = document.createElement("pre");
    element.className = "DOMD-Pre";
    const code = document.createElement("code");
    code.className = "DOMD-PreCode";
    code.textContent = text;
    element.append(code);
    return element;
}

function deferredRenderResult() {
    let resolve: (value: { ok: true; svg: string }) => void = () => {};
    const promise = new Promise<{ ok: true; svg: string }>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}
