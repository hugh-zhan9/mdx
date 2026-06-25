import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderComplexBlock } from "./index";

describe("renderComplexBlock", () => {
    it("renders math ops through the math adapter", () => {
        const html = renderToStaticMarkup(
            renderComplexBlock({
                blockId: "math-1",
                kind: "math",
                rect: { x: 0, y: 0, width: 100, height: 20 },
                data: { type: "text", content: "x^2" },
            }),
        );

        expect(html).toContain('data-complex-block-kind="math"');
    });
});
