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
        expect(document.blocks[0]?.pmFrom).toBe(0);
        expect(document.blocks[0]?.pmTo).toBeGreaterThan(
            document.blocks[0]?.pmFrom ?? -1,
        );
        expect(document.blocks[1]?.pmFrom).toBeGreaterThan(
            document.blocks[0]?.pmFrom ?? -1,
        );
        expect(document.styleContext.devicePixelRatio).toBe(1);
    });

    it("tracks duplicate block text with stable ordered ProseMirror ranges", () => {
        const document = normalizeLayoutDocument("Repeat\n\nRepeat\n", {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks).toHaveLength(2);
        expect(document.blocks[0]?.pmFrom).toBeLessThan(
            document.blocks[1]?.pmFrom ?? 0,
        );
        expect(document.blocks[0]?.pmTo).toBeLessThanOrEqual(
            document.blocks[1]?.pmFrom ?? 0,
        );
    });

    it("preserves inline math and surrounding text source positions", () => {
        const document = normalizeLayoutDocument("Before $x^2$ after\n", {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks[0]?.inlines).toMatchObject([
            {
                text: "Before ",
                kind: "text",
                marks: [],
                style: { bold: false, italic: false, code: false },
            },
            {
                text: "x^2",
                kind: "math_inline",
                marks: [],
                style: { bold: false, italic: false, code: false },
            },
            {
                text: " after",
                kind: "text",
                marks: [],
                style: { bold: false, italic: false, code: false },
            },
        ]);
        expect(document.blocks[0]?.inlines[0]?.sourceFrom).toBeLessThan(
            document.blocks[0]?.inlines[1]?.sourceFrom ?? 0,
        );
        expect(document.blocks[0]?.inlines[1]?.sourceTo).toBeLessThanOrEqual(
            document.blocks[0]?.inlines[2]?.sourceFrom ?? 0,
        );
    });

    it("normalizes mermaid fences into mermaid blocks without fence markers", () => {
        const document = normalizeLayoutDocument(
            "```mermaid\ngraph TD\n  A --> B\n```\n",
            { width: 800, height: 600, devicePixelRatio: 1 },
        );

        expect(document.blocks).toHaveLength(1);
        expect(document.blocks[0]).toMatchObject({ kind: "mermaid" });
        expect(document.blocks[0]?.inlines[0]).toMatchObject({
            text: "graph TD\n  A --> B\n",
            kind: "text",
            marks: [],
        });
    });

    it("normalizes indented mermaid fences like the parser", () => {
        const document = normalizeLayoutDocument(
            "   ```mermaid title='Flow'\ngraph TD\n```\n",
            { width: 800, height: 600, devicePixelRatio: 1 },
        );

        expect(document.blocks).toHaveLength(1);
        expect(document.blocks[0]).toMatchObject({ kind: "mermaid" });
        expect(document.blocks[0]?.inlines[0]?.text).toBe("graph TD\n");
    });

    it("normalizes unclosed mermaid fences through EOF like the parser", () => {
        const document = normalizeLayoutDocument(
            "```mermaid\ngraph TD\n  A --> B",
            { width: 800, height: 600, devicePixelRatio: 1 },
        );

        expect(document.blocks).toHaveLength(1);
        expect(document.blocks[0]).toMatchObject({ kind: "mermaid" });
        expect(document.blocks[0]?.inlines[0]?.text).toBe(
            "graph TD\n  A --> B",
        );
    });

    it("preserves unsupported block html fallbacks beyond section tags", () => {
        const markdown = [
            '<div data-x="1">',
            "  <span>HTML</span>",
            "</div>",
            "",
            '<section data-kind="unsupported">',
            "  <p>Keep fallback</p>",
            "</section>",
            "",
        ].join("\n");
        const document = normalizeLayoutDocument(markdown, {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks).toHaveLength(2);
        expect(document.blocks[0]).toMatchObject({ kind: "fallback" });
        expect(document.blocks[0]?.inlines[0]?.text.trimEnd()).toBe(
            '<div data-x="1">\n  <span>HTML</span>\n</div>',
        );
        expect(document.blocks[1]).toMatchObject({ kind: "fallback" });
        expect(document.blocks[1]?.inlines[0]?.text.trimEnd()).toBe(
            '<section data-kind="unsupported">\n  <p>Keep fallback</p>\n</section>',
        );
    });
});
