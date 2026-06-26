// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutSnapshot } from "./wasm-layout-bridge";
import { HybridEditorHost } from "./hybrid-editor-host";
import {
    DOMD,
    DOMDProvider,
} from "../../../features/editor/components/editor-kernel-adapter";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    selectionOffsetsForVisibleTextMatch,
} from "../../../features/editor/lib/visible-text-search";
import { normalizeLayoutDocument } from "../layout-ir/normalizer";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./mermaid-renderer", () => ({
    renderMermaidDiagram: vi.fn(async () => ({
        ok: true,
        svg: "<svg><text>rendered mermaid</text></svg>",
    })),
}));

describe("legacy view comparison", () => {
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

    it("aligns visible paragraph text between real legacy DOMD and hybrid host", async () => {
        const markdown = "Plain paragraph\n";
        const surface = await renderComparisonSurface(root, markdown);
        const legacyIndex = buildVisibleTextIndex(surface.legacyRoot);
        const hybridIndex = buildVisibleTextIndex(surface.hybridRoot);

        expect(legacyIndex.text).toContain("Plain paragraph");
        expect(hybridIndex.text).toBe(legacyIndex.text);
        expect(
            findVisibleTextMatches(hybridIndex, "Plain paragraph", {
                caseSensitive: true,
            }),
        ).toEqual(
            findVisibleTextMatches(legacyIndex, "Plain paragraph", {
                caseSensitive: true,
            }),
        );
    });

    it("aligns visible mermaid source text between real legacy DOMD and hybrid host", async () => {
        const markdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
        const surface = await renderComparisonSurface(root, markdown);
        const legacyIndex = buildVisibleTextIndex(surface.legacyRoot);
        const hybridIndex = buildVisibleTextIndex(surface.hybridRoot);
        const graphOffset = markdown.indexOf("graph TD");
        const edgeOffset = markdown.indexOf("A --> B");

        expect(graphOffset).toBeGreaterThanOrEqual(0);
        expect(edgeOffset).toBeGreaterThanOrEqual(0);
        expect(legacyIndex.text).toContain("graph TD");
        expect(legacyIndex.text).toContain("A --> B");
        expect(legacyIndex.text).not.toContain("```mermaid");
        expect(hybridIndex.text).toContain("```mermaid");
        expect(
            findVisibleTextMatches(hybridIndex, "graph TD", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(hybridIndex, "A --> B", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(legacyIndex, "graph TD", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(legacyIndex, "A --> B", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);

        const [hybridGraphMatch] = findVisibleTextMatches(hybridIndex, "graph TD", {
            caseSensitive: true,
        });
        const [hybridEdgeMatch] = findVisibleTextMatches(hybridIndex, "A --> B", {
            caseSensitive: true,
        });

        expect(hybridGraphMatch).toBeDefined();
        expect(hybridEdgeMatch).toBeDefined();
        expect(
            selectionOffsetsForVisibleTextMatch(hybridIndex, hybridGraphMatch!),
        ).toEqual({
            anchor: graphOffset,
            head: graphOffset + "graph TD".length,
        });
        expect(
            selectionOffsetsForVisibleTextMatch(hybridIndex, hybridEdgeMatch!),
        ).toEqual({
            anchor: edgeOffset,
            head: edgeOffset + "A --> B".length,
        });
    });
});

async function renderComparisonSurface(
    root: ReturnType<typeof createRoot>,
    markdown: string,
) {
    const host = document.body.lastElementChild;
    expect(host).not.toBeNull();

    await act(async () => {
        root.render(
            <div data-testid="comparison-host">
                <div data-testid="legacy-root">
                    <DOMDProvider initMd={markdown}>
                        <DOMD />
                    </DOMDProvider>
                </div>
                <div data-testid="hybrid-root">
                    <HybridEditorHost snapshot={snapshotFromMarkdown(markdown)} />
                </div>
            </div>,
        );
    });

    await act(async () => {
        await Promise.resolve();
    });

    return {
        legacyRoot: queryRequired(host!, "[data-testid='legacy-root']"),
        hybridRoot: queryRequired(
            host!,
            "[data-testid='hybrid-root'] [data-hybrid-editor-host]",
        ),
    };
}

function queryRequired(container: ParentNode, selector: string) {
    const node = container.querySelector(selector);
    expect(node).not.toBeNull();
    return node as HTMLElement;
}

function snapshotFromMarkdown(markdown: string): LayoutSnapshot {
    const layoutDocument = normalizeLayoutDocument(markdown, {
        width: 800,
        height: 600,
        devicePixelRatio: 1,
    });
    let y = 0;
    const canvasDrawOps: LayoutSnapshot["canvasDrawOps"] = [];
    const mirrorBlocks: LayoutSnapshot["mirrorBlocks"] = [];
    const lines = layoutDocument.blocks.map((block, index) => {
        let left = 0;
        const textRuns = block.inlines.flatMap((inline) => {
            const width = Math.max(
                inline.text.length * (block.style.fontSize * 0.6),
                1,
            );

            if (inline.kind === "math_inline") {
                const mirrorBlockId = `${block.blockId}-math-${inline.from}-${inline.to}`;
                const pmFrom = block.pmFrom + inline.from;
                const pmTo = block.pmFrom + inline.to;
                canvasDrawOps.push({
                    blockId: mirrorBlockId,
                    kind: "math",
                    x: left,
                    y,
                    width,
                    height: block.style.fontSize * block.style.lineHeight,
                    data: {
                        content: inline.text,
                        latex: inline.text,
                    },
                });
                mirrorBlocks.push({
                    blockId: mirrorBlockId,
                    pmFrom,
                    pmTo,
                    semanticText: inline.text,
                    ariaLabel: `math ${inline.text}`,
                });
                left += width;
                return [];
            }

            const run = {
                blockId: block.blockId,
                pmFrom: block.pmFrom + inline.from,
                pmTo: block.pmFrom + inline.to,
                left,
                baseline: y + block.style.fontSize,
                width,
                height: block.style.fontSize * block.style.lineHeight,
                fontFamily: block.style.fontFamily,
                fontSize: block.style.fontSize,
                text: inline.text,
            };
            left += width;
            return [run];
        });

        const line = {
            id: `line-${index}`,
            blockId: block.blockId,
            y,
            baseline: y + block.style.fontSize,
            height: block.style.fontSize * block.style.lineHeight,
            textRuns,
        };
        y += line.height;
        return line;
    });

    return {
        revision: layoutDocument.revision,
        lines,
        canvasDrawOps,
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks,
    };
}
