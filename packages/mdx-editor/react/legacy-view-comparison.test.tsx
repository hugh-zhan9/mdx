// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutSnapshot } from "./wasm-layout-bridge";
import { HybridEditorHost } from "./hybrid-editor-host";
import { texCanvasFixtures } from "../test/tex-canvas-fixtures";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    selectionOffsetsForVisibleTextMatch,
} from "../../../features/editor/lib/visible-text-search";
import { normalizeLayoutDocument } from "../layout-ir/normalizer";
import type { LayoutDocument } from "../layout-ir/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

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

    it.each(texCanvasFixtures)(
        "aligns visible text and markdown offsets for %s",
        async (fixture) => {
            const surface = await renderComparisonSurface(root, fixture.markdown);
            const legacyIndex = buildVisibleTextIndex(surface.legacyRoot);
            const hybridIndex = buildVisibleTextIndex(surface.hybridRoot);

            expect(hybridIndex.text).toBe(legacyIndex.text);

            for (const query of semanticQueriesForFixture(surface.document, fixture.id)) {
                const legacyMatches = findVisibleTextMatches(
                    legacyIndex,
                    query,
                    { caseSensitive: true },
                );
                const hybridMatches = findVisibleTextMatches(
                    hybridIndex,
                    query,
                    { caseSensitive: true },
                );

                expect(hybridMatches).toEqual(legacyMatches);

                for (const [index, match] of hybridMatches.entries()) {
                    expect(
                        selectionOffsetsForVisibleTextMatch(
                            hybridIndex,
                            match,
                        ),
                    ).toEqual(
                        selectionOffsetsForVisibleTextMatch(
                            legacyIndex,
                            legacyMatches[index]!,
                        ),
                    );
                }
            }
        },
    );

    it("keeps mermaid paragraph semantics aligned in the mixed-layout fixture", async () => {
        const fixture = fixtureById("mixed-layout");
        const surface = await renderComparisonSurface(root, fixture.markdown);
        const legacyIndex = buildVisibleTextIndex(surface.legacyRoot);
        const hybridIndex = buildVisibleTextIndex(surface.hybridRoot);

        for (const query of ["graph LR", "Start --> Stop"]) {
            expect(
                findVisibleTextMatches(hybridIndex, query, {
                    caseSensitive: true,
                }),
            ).toEqual(
                findVisibleTextMatches(legacyIndex, query, {
                    caseSensitive: true,
                }),
            );
        }
    });
});

function fixtureById(id: string) {
    const fixture = texCanvasFixtures.find((candidate) => candidate.id === id);
    expect(fixture).toBeDefined();
    return fixture!;
}

function queryRequired(selector: string) {
    const node = hostDocument().querySelector(selector);
    expect(node).not.toBeNull();
    return node as HTMLElement;
}

function hostDocument() {
    return document;
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
                    pmFrom: block.pmFrom + inline.from,
                    pmTo: block.pmFrom + inline.to,
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

    const snapshot: LayoutSnapshot = {
        revision: layoutDocument.revision,
        lines,
        canvasDrawOps,
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks,
    };

    return snapshot;
}

async function renderComparisonSurface(
    root: ReturnType<typeof createRoot>,
    markdown: string,
) {
    const documentModel = normalizeLayoutDocument(markdown, {
        width: 800,
        height: 600,
        devicePixelRatio: 1,
    });

    await act(async () => {
        root.render(
            <div>
                <div data-testid="legacy-root" />
                <div data-testid="hybrid-root">
                    <HybridEditorHost snapshot={snapshotFromMarkdown(markdown)} />
                </div>
            </div>,
        );
    });

    const legacyContainer = queryRequired("[data-testid='legacy-root']");
    legacyContainer.replaceChildren(buildLegacyFixtureRoot(documentModel));

    return {
        document: documentModel,
        legacyRoot: queryRequired(
            "[data-testid='legacy-root'] [data-mdx-editor-root]",
        ),
        hybridRoot: queryRequired(
            "[data-testid='hybrid-root'] [data-hybrid-editor-host]",
        ),
    };
}

function buildLegacyFixtureRoot(layoutDocument: LayoutDocument) {
    const root = document.createElement("div");
    root.setAttribute("data-mdx-editor-root", "");
    root.setAttribute("data-mdx-text", "");

    for (const block of layoutDocument.blocks) {
        const blockElement = document.createElement(
            block.kind === "heading" ? "h1" : "p",
        );
        blockElement.setAttribute("data-layout-block-id", block.blockId);

        for (const inline of block.inlines) {
            const textRun = document.createElement("span");
            textRun.setAttribute(
                "data-layout-pm-from",
                String(block.pmFrom + inline.from),
            );
            textRun.setAttribute(
                "data-layout-pm-to",
                String(block.pmFrom + inline.to),
            );
            textRun.textContent = inline.text;
            blockElement.append(textRun);
        }

        root.append(blockElement);
    }

    return root;
}

function semanticQueriesForFixture(
    layoutDocument: LayoutDocument,
    fixtureId: string,
) {
    const queries = new Set<string>();

    for (const block of layoutDocument.blocks) {
        for (const inline of block.inlines) {
            if (inline.text.trim().length > 0) {
                queries.add(inline.text);
            }
        }
    }

    for (const preferredQuery of fixtureById(fixtureId).expected.lineSnippets) {
        if (preferredQuery.trim().length > 0) {
            queries.add(preferredQuery);
        }
    }

    return Array.from(queries);
}
