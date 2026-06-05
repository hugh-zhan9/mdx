import { beforeEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const render = vi.fn();

vi.mock("mermaid", () => ({
    default: {
        initialize,
        render,
    },
}));

describe("mermaid renderer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it("initializes mermaid with strict security and matching theme", async () => {
        render.mockResolvedValue({ svg: "<svg></svg>" });
        const { renderMermaidDiagram } = await import("./mermaid-renderer");

        await renderMermaidDiagram({
            code: "graph TD\n  A --> B",
            id: "chart-1",
            theme: "dark",
        });

        expect(initialize).toHaveBeenCalledWith({
            securityLevel: "strict",
            startOnLoad: false,
            theme: "dark",
        });
        expect(render).toHaveBeenCalledWith("chart-1", "graph TD\n  A --> B");
    });

    it("normalizes render failures", async () => {
        render.mockRejectedValue(new Error("Parse error"));
        const { renderMermaidDiagram } = await import("./mermaid-renderer");

        await expect(
            renderMermaidDiagram({
                code: "not mermaid",
                id: "chart-2",
                theme: "light",
            }),
        ).resolves.toEqual({
            ok: false,
            error: "Parse error",
        });
    });
});
