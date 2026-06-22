import { describe, expect, it } from "vitest";
import { createSyntaxRegistry } from "./registry";
import { buildSchemaFromRegistry } from "./schema";
import type { SyntaxPlugin } from "./types";

const basePlugin: SyntaxPlugin = {
    id: "base",
    nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        paragraph: {
            group: "block",
            content: "inline*",
            toDOM: () => ["p", 0],
            parseDOM: [{ tag: "p" }],
        },
    },
};

describe("syntax registry", () => {
    it("sorts parser contributions by phase then descending priority", () => {
        const registry = createSyntaxRegistry([
            {
                id: "low",
                blockParsers: [
                    {
                        phase: "block",
                        priority: 10,
                        parse: () => ({ status: "notMatched" }),
                    },
                ],
            },
            {
                id: "high",
                blockParsers: [
                    {
                        phase: "block",
                        priority: 100,
                        parse: () => ({ status: "notMatched" }),
                    },
                ],
            },
        ]);

        expect(registry.blockParsers.map((parser) => parser.pluginId)).toEqual([
            "high",
            "low",
        ]);
    });

    it("throws on duplicate plugin ids", () => {
        expect(() => createSyntaxRegistry([{ id: "x" }, { id: "x" }])).toThrow(
            "Duplicate syntax plugin id: x",
        );
    });

    it("throws on duplicate schema node names", () => {
        expect(() =>
            createSyntaxRegistry([
                { id: "a", nodes: { paragraph: { group: "block" } } },
                { id: "b", nodes: { paragraph: { group: "block" } } },
            ]),
        ).toThrow("Duplicate schema node: paragraph");
    });

    it("throws on invalid parser phase", () => {
        expect(() =>
            createSyntaxRegistry([
                {
                    id: "broken-phase",
                    blockParsers: [
                        {
                            phase: "unknown" as never,
                            priority: 10,
                            parse: () => ({ status: "notMatched" }),
                        },
                    ],
                },
            ]),
        ).toThrow(
            "Invalid parser phase for syntax plugin broken-phase: unknown",
        );
    });

    it("throws on invalid parser priority", () => {
        expect(() =>
            createSyntaxRegistry([
                {
                    id: "broken-priority",
                    inlineParsers: [
                        {
                            phase: "inline",
                            priority: Number.NaN,
                            parse: () => ({ status: "notMatched" }),
                        },
                    ],
                },
            ]),
        ).toThrow(
            "Invalid parser priority for syntax plugin broken-priority: expected a finite number",
        );
    });

    it("builds a ProseMirror schema from plugin node and mark specs", () => {
        const registry = createSyntaxRegistry([basePlugin]);
        const schema = buildSchemaFromRegistry(registry);

        expect(schema.nodes.doc).toBeDefined();
        expect(schema.nodes.paragraph).toBeDefined();
        expect(schema.text("hello").text).toBe("hello");
    });

    it("collects serializer and node view ownership from syntax plugins", () => {
        const owned = (() => null) as NonNullable<
            SyntaxPlugin["nodeViews"]
        >[string];
        const registry = createSyntaxRegistry([
            {
                id: "owner",
                serializers: {
                    nodeSerializers: {
                        owned: () => "owned\n",
                    },
                },
                nodeViews: {
                    owned,
                },
            },
        ]);

        expect(registry.serializers).toEqual([
            expect.objectContaining({
                nodeSerializers: expect.objectContaining({
                    owned: expect.any(Function),
                }),
            }),
        ]);
        expect(registry.nodeViews.owned).toBe(owned);
    });
});
