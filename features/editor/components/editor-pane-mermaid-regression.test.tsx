// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "./editor-pane";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const renderMermaidDiagram = vi.hoisted(() => vi.fn());

vi.mock("../../../packages/mdx-editor/react/mermaid-renderer", () => ({
    renderMermaidDiagram: (
        request: Parameters<typeof renderMermaidDiagram>[0],
    ) => renderMermaidDiagram(request),
}));

describe("editor pane mermaid rendering", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        renderMermaidDiagram.mockReset();
        renderMermaidDiagram.mockResolvedValue({
            ok: true,
            svg: "<svg><text>rendered flowchart</text></svg>",
        });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("does not create duplicate edit controls while scrolling mermaid blocks", async () => {
        const editorViewportRef = { current: null as HTMLDivElement | null };
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: [
                "# Title",
                "",
                "Before",
                "",
                "```mermaid",
                "graph TD",
                "  A --> B",
                "```",
                "",
                ...Array.from({ length: 40 }, (_, index) => `Paragraph ${index}`),
            ].join("\n"),
            baseFingerprint: "base",
        };

        await act(async () => {
            root.render(
                <EditorPane
                    rootPath={null}
                    tab={tab}
                    onMarkdownChange={vi.fn()}
                    editorViewportRef={editorViewportRef}
                />,
            );
        });
        await flushEffects();

        const mermaidSource = host.querySelector<HTMLTextAreaElement>(
            "textarea[aria-label='Mermaid source']",
        );
        const preview = host.querySelector("[data-mdx-mermaid-preview]");

        expect(mermaidSource?.value).toBe("graph TD\n  A --> B\n");
        expect(renderMermaidDiagram).toHaveBeenCalledWith(
            expect.objectContaining({
                code: "graph TD\n  A --> B\n",
                theme: "light",
            }),
        );
        expect(preview?.innerHTML).toContain("<svg");
        expect(preview?.textContent).toContain("rendered flowchart");
        expect(host.querySelector("pre[data-mdx-node-type='mermaid_block']")).toBeNull();
        expect(countEditButtons()).toBe(0);

        await act(async () => {
            for (let index = 0; index < 8; index += 1) {
                if (editorViewportRef.current) {
                    editorViewportRef.current.scrollTop = index * 120;
                    editorViewportRef.current.dispatchEvent(
                        new Event("scroll", { bubbles: true }),
                    );
                }
                await Promise.resolve();
            }
        });
        await flushEffects();

        expect(countEditButtons()).toBe(0);
    });

    function countEditButtons() {
        return Array.from(host.querySelectorAll("button")).filter(
            (button) => button.textContent?.trim() === "编辑",
        ).length;
    }
});

async function flushEffects() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}
