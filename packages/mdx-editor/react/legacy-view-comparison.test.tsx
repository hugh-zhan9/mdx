// @vitest-environment jsdom

import { act } from "react";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMDProvider } from "../../../features/editor/components/editor-kernel-adapter";
import { HybridEditorHost } from "./hybrid-editor-host";
import { useMdxEditor } from "./index";
import { snapshotFromMarkdown } from "../../../features/editor/components/editor-pane";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
} from "../../../features/editor/lib/visible-text-search";
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

    it("aligns visible paragraph text between the registered editor root and hybrid host", async () => {
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

    it("aligns visible mermaid source text between the registered editor root and hybrid host", async () => {
        const markdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
        const surface = await renderComparisonSurface(root, markdown);
        const legacyIndex = buildVisibleTextIndex(surface.legacyRoot);
        const hybridIndex = buildVisibleTextIndex(surface.hybridRoot);
        const graphOffset = markdown.indexOf("graph TD");
        const edgeOffset = markdown.indexOf("A --> B");

        expect(graphOffset).toBeGreaterThanOrEqual(0);
        expect(edgeOffset).toBeGreaterThanOrEqual(0);
        expect(
            surface.legacyRoot.querySelector(
                "textarea[aria-label='Mermaid source']",
            ),
        ).not.toBeNull();
        expect(
            surface.legacyRoot.querySelector("[data-mdx-mermaid-preview]"),
        ).not.toBeNull();
        expect(legacyIndex.text).toContain("graph TD");
        expect(legacyIndex.text).toContain("A --> B");
        expect(legacyIndex.text).not.toContain("```mermaid");
        expect(hybridIndex.text).toBe(legacyIndex.text);
        expect(
            findVisibleTextMatches(hybridIndex, "graph TD", {
                caseSensitive: true,
            }),
        ).toEqual(
            findVisibleTextMatches(legacyIndex, "graph TD", {
                caseSensitive: true,
            }),
        );
        expect(
            findVisibleTextMatches(hybridIndex, "A --> B", {
                caseSensitive: true,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(hybridIndex, "A --> B", {
                caseSensitive: true,
            }),
        ).toEqual(
            findVisibleTextMatches(legacyIndex, "A --> B", {
                caseSensitive: true,
            }),
        );

        expect(graphOffset).toBe(11);
        expect(edgeOffset).toBe(22);
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
                        <LegacyEditorRootFixture />
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

function LegacyEditorRootFixture() {
    const { registerRoot } = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        registerRoot(rootRef.current);

        return () => {
            registerRoot(null);
        };
    }, [registerRoot]);

    return <div ref={rootRef} data-mdx-editor-root tabIndex={0} />;
}

function queryRequired(container: ParentNode, selector: string) {
    const node = container.querySelector(selector);
    expect(node).not.toBeNull();
    return node as HTMLElement;
}
