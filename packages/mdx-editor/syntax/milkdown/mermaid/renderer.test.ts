// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg></svg>" })),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

const { renderMermaidDiagram } = await import("./renderer");

describe("mermaid initialization", () => {
    it("locks Mermaid to strict security and no built-in error graphic", async () => {
        const result = await renderMermaidDiagram({
            code: "graph TD\n  A --> B",
            id: "mdx-mermaid-strict",
        });

        expect(result).toEqual({ ok: true, svg: "<svg></svg>" });
        expect(mermaid.initialize).toHaveBeenCalledTimes(1);
        expect(mermaid.initialize).toHaveBeenCalledWith({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
        });
    });

    it("configures Mermaid once however many diagrams are rendered", async () => {
        await renderMermaidDiagram({ code: "graph TD", id: "mdx-mermaid-2" });
        await renderMermaidDiagram({ code: "graph LR", id: "mdx-mermaid-3" });

        expect(mermaid.initialize).toHaveBeenCalledTimes(1);
        expect(mermaid.render).toHaveBeenCalledTimes(3);
    });

    it("hands the fence source to Mermaid unchanged", async () => {
        await renderMermaidDiagram({
            code: "graph TD\n  A[Start] --> B{Choice}",
            id: "mdx-mermaid-4",
        });

        expect(mermaid.render).toHaveBeenLastCalledWith(
            "mdx-mermaid-4",
            "graph TD\n  A[Start] --> B{Choice}",
        );
    });

    it("reports a Mermaid failure as a result rather than an exception", async () => {
        mermaid.render.mockRejectedValueOnce(new Error("No diagram type"));

        await expect(
            renderMermaidDiagram({ code: "(((", id: "mdx-mermaid-5" }),
        ).resolves.toEqual({ ok: false, error: "No diagram type" });
    });
});
