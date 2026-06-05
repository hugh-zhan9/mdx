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

    it("maps light app theme to mermaid default theme", async () => {
        render.mockResolvedValue({ svg: "<svg></svg>" });
        const { renderMermaidDiagram } = await import("./mermaid-renderer");

        await renderMermaidDiagram({
            code: "graph TD\n  A --> B",
            id: "chart-light",
            theme: "light",
        });

        expect(initialize).toHaveBeenCalledWith({
            securityLevel: "strict",
            startOnLoad: false,
            theme: "default",
        });
    });

    it("initializes only once for repeated renders with the same app theme", async () => {
        render.mockResolvedValue({ svg: "<svg></svg>" });
        const { renderMermaidDiagram } = await import("./mermaid-renderer");

        await renderMermaidDiagram({
            code: "graph TD\n  A --> B",
            id: "chart-1",
            theme: "dark",
        });
        await renderMermaidDiagram({
            code: "graph TD\n  B --> C",
            id: "chart-2",
            theme: "dark",
        });

        expect(initialize).toHaveBeenCalledTimes(1);
    });

    it("reinitializes when the app theme changes from light to dark", async () => {
        render.mockResolvedValue({ svg: "<svg></svg>" });
        const { renderMermaidDiagram } = await import("./mermaid-renderer");

        await renderMermaidDiagram({
            code: "graph TD\n  A --> B",
            id: "chart-light",
            theme: "light",
        });
        await renderMermaidDiagram({
            code: "graph TD\n  B --> C",
            id: "chart-dark",
            theme: "dark",
        });

        expect(initialize).toHaveBeenNthCalledWith(1, {
            securityLevel: "strict",
            startOnLoad: false,
            theme: "default",
        });
        expect(initialize).toHaveBeenNthCalledWith(2, {
            securityLevel: "strict",
            startOnLoad: false,
            theme: "dark",
        });
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
