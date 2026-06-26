import { describe, expect, it } from "vitest";

import { TEX_CANVAS_FIXTURES } from "../../../packages/mdx-editor/test/tex-canvas-fixtures";
import { measureTexCanvasLayoutPerformance } from "../../../scripts/measure-tex-canvas-layout.mjs";

describe("tex canvas layout performance smoke", () => {
    it("keeps fixture normalization under the local smoke threshold", async () => {
        const mixedFixture = TEX_CANVAS_FIXTURES.find(
            (fixture) => fixture.id === "mixed-layout",
        );

        expect(mixedFixture).toBeDefined();

        const measurement = await measureTexCanvasLayoutPerformance({
            fixture: mixedFixture!,
            iterations: 200,
        });

        expect(measurement.iterations).toBe(200);
        expect(measurement.blockCount).toBeGreaterThan(0);
        expect(measurement.inlineCount).toBeGreaterThan(0);
        expect(measurement.elapsedMs).toBeLessThanOrEqual(80);
    });
});
