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
        expect(document.blocks[0]?.pmTo).toBe(9);
        expect(document.blocks[1]?.pmFrom).toBe(11);
        expect(document.blocks[1]?.pmTo).toBe(31);
    });

    it("tracks duplicate block text with stable ordered source ranges", () => {
        const markdown = "Repeat\n\nRepeat\n";
        const document = normalizeLayoutDocument(markdown, {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks).toHaveLength(2);
        expect(document.blocks[0]).toMatchObject({
            pmFrom: 0,
            pmTo: 6,
        });
        expect(document.blocks[1]).toMatchObject({
            pmFrom: 8,
            pmTo: 14,
        });
    });

    it("preserves inline math and surrounding text offsets", () => {
        const document = normalizeLayoutDocument("Before $x^2$ after\n", {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks[0]?.inlines).toEqual([
            {
                text: "Before ",
                kind: "text",
                from: 0,
                to: 7,
                style: { bold: false, italic: false, code: false },
            },
            {
                text: "x^2",
                kind: "math_inline",
                from: 8,
                to: 11,
                style: { bold: false, italic: false, code: false },
            },
            {
                text: " after",
                kind: "text",
                from: 12,
                to: 18,
                style: { bold: false, italic: false, code: false },
            },
        ]);
    });

    it("normalizes mermaid fences into mermaid blocks without fence markers", () => {
        const markdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
        const document = normalizeLayoutDocument(markdown, {
            width: 800,
            height: 600,
            devicePixelRatio: 1,
        });

        expect(document.blocks).toHaveLength(1);
        expect(document.blocks[0]).toMatchObject({
            kind: "mermaid",
            pmFrom: markdown.indexOf("graph TD"),
            pmTo: markdown.indexOf("graph TD") + "graph TD\n  A --> B".length,
        });
        expect(document.blocks[0]?.inlines).toEqual([
            {
                text: "graph TD\n  A --> B",
                kind: "text",
                from: 0,
                to: "graph TD\n  A --> B".length,
                style: { bold: false, italic: false, code: false },
            },
        ]);
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
        expect(document.blocks[0]).toMatchObject({
            kind: "fallback",
            pmFrom: 0,
        });
        expect(document.blocks[0]?.inlines[0]?.text).toBe(
            '<div data-x="1">\n  <span>HTML</span>\n</div>',
        );
        expect(document.blocks[1]).toMatchObject({
            kind: "fallback",
        });
        expect(document.blocks[1]?.inlines[0]?.text).toBe(
            '<section data-kind="unsupported">\n  <p>Keep fallback</p>\n</section>',
        );
    });
});
