// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HybridEditorHost } from "../../../packages/mdx-editor/react/hybrid-editor-host";
import { buildVisibleTextIndex, findVisibleTextMatches } from "../lib/visible-text-search";
import { EditorPane, snapshotFromMarkdown } from "./editor-pane";

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
        await waitFor(() => {
            expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
            expect(host.querySelector("[data-mdx-mermaid-preview]")).not.toBeNull();
        });

        const preview = host.querySelector("[data-mdx-mermaid-preview]");
        const hybridRoot = host.querySelector("[data-hybrid-editor-host]");
        const hybridIndex = buildVisibleTextIndex(hybridRoot!);

        expect(hybridRoot?.textContent).toContain("graph TD");
        expect(hybridRoot?.textContent).toContain("A --> B");
        expect(
            findVisibleTextMatches(hybridIndex, "graph TD", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
        expect(preview).not.toBeNull();
        expect(preview?.textContent).toContain("rendered flowchart");
        expect(host.querySelector("[data-mirror-block-id='block-2']")).not.toBeNull();
        expect(host.querySelector("[data-mirror-block-id='block-2']")?.textContent).toContain(
            "graph TD",
        );
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
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    });

    it(
        "keeps mermaid, image, and fallback source semantics intact in the hybrid host path",
        async () => {
        const markdown = [
            "# Title",
            "",
            "```mermaid",
            "graph TD",
            "  Start --> Stop",
            "```",
            "",
            '![Diagram](.assets/flow.png "Preview")',
            "",
            '<div data-x="1">',
            "  <span>Keep div fallback</span>",
            "</div>",
            "",
            '<section data-kind="unsupported">',
            "  <p>Keep fallback</p>",
            "</section>",
            "",
        ].join("\n");
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown,
            baseFingerprint: "base",
        };

        await act(async () => {
            root.render(
                <HybridEditorHost snapshot={snapshotFromMarkdown(tab.markdown)} />,
            );
        });
        await flushEffects();
        await waitFor(() => {
            expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
            expect(host.querySelector("[data-mdx-mermaid-preview]")).not.toBeNull();
        });

        const hybridRoot = host.querySelector("[data-hybrid-editor-host]");
        const hybridIndex = buildVisibleTextIndex(hybridRoot!);

        expect(hybridRoot?.textContent).toContain("graph TD");
        expect(hybridRoot?.textContent).toContain("Start --> Stop");
        expect(
            findVisibleTextMatches(hybridIndex, "Start --> Stop", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
        expect(host.querySelector("[data-mdx-mermaid-preview]")).not.toBeNull();
        expect(host.querySelector("[data-mirror-block-id='block-1']")?.textContent).toContain(
            "graph TD",
        );

        const image = host.querySelector<HTMLImageElement>(
            "img[data-mdx-node-type='image']",
        );
        expect(image?.getAttribute("src")).toBe(".assets/flow.png");
        expect(image?.getAttribute("alt")).toBe("Diagram");
        expect(image?.getAttribute("title")).toBe("Preview");

        const fallback = host.querySelector<HTMLElement>(
            "[data-mdx-node-type='source_fallback']",
        );
        expect(fallback?.querySelector("div[data-x='1']")).not.toBeNull();
        const fallbackBlocks = Array.from(
            host.querySelectorAll<HTMLElement>("[data-mdx-node-type='source_fallback']"),
        );
        expect(
            fallbackBlocks.some(
                (block) =>
                    block.querySelector("section[data-kind='unsupported']") !== null,
            ),
        ).toBe(true);
        expect(
            host.querySelector("textarea[aria-label='Markdown source fallback']"),
        ).toBeNull();
        },
        10000,
    );

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

async function waitFor(assertion: () => void) {
    let lastError: unknown;

    for (let index = 0; index < 20; index += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
        }

        await act(async () => {
            await Promise.resolve();
        });
    }

    throw lastError;
}
