import { describe, expect, it } from "vitest";
import { buildCanvasRangeMap } from "./canvas-range-map";

describe("buildCanvasRangeMap", () => {
    it("indexes mirror blocks by stable range id", () => {
        const map = buildCanvasRangeMap([
            {
                blockId: "math-1",
                pmFrom: 12,
                pmTo: 18,
                semanticText: "x squared",
                ariaLabel: "math x squared",
            },
        ]);

        expect(map.get("math-1")?.pmFrom).toBe(12);
    });
});
