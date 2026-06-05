// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorMermaidPreviewLayer } from "./editor-mermaid-preview-layer";

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

    async function renderLayer(markdown: string) {
        await act(async () => {
            root.render(
                <EditorMermaidPreviewLayer
                    editorRoot={editorRoot}
                    markdown={markdown}
                />,
            );
        });
        await act(async () => {
            await vi.runAllTimersAsync();
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
