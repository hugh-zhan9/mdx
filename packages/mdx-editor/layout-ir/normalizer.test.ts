import { describe, expect, it } from "vitest";
import { normalizeLayoutDocument } from "./normalizer";

describe("normalizeLayoutDocument", () => {
    it("builds paragraph and math blocks with PM ranges", () => {
        const document = normalizeLayoutDocument(
            "# Heading\n\nParagraph $x^2$ text\n",
            { width: 800, height: 600, devicePixelRatio: 1 },
        );

        expect(document.blocks[0]?.kind).toBe("heading");
        expect(document.blocks[1]?.kind).toBe("paragraph");
        expect(
            document.blocks[1]?.inlines.some(
                (run) => run.kind === "math_inline",
            ),
        ).toBe(true);
    });
});
