import { describe, expect, it } from "vitest";
import { createMdxEditorKernel, type SyntaxPlugin } from "../../kernel";
import { coreMarkdownSyntax } from "../core";
import { fallbackSyntax } from "./index";

describe("fallback syntax", () => {
    it("owns source_fallback schema and serialization", () => {
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax()],
        });
        const node = kernel.schema.nodes.source_fallback.create({
            markdown: "<x>\n",
            reason: "unsupported",
            sourceId: "source-0",
        });
        const doc = kernel.schema.nodes.doc.create(null, [node]);

        expect(kernel.serializeMarkdown(doc)).toBe("<x>\n");
        expect(kernel.createNodeViews().source_fallback).toBeDefined();
    });

    it("dispatches source_fallback serialization through plugin contributions", () => {
        const overridePlugin: SyntaxPlugin = {
            id: "fallback-serializer-override",
            serializers: {
                nodeSerializers: {
                    source_fallback: (node, _context) =>
                        `<!--${String(node.attrs.markdown ?? "").trim()}-->`,
                },
            },
        };
        const kernel = createMdxEditorKernel({
            syntax: [coreMarkdownSyntax(), fallbackSyntax(), overridePlugin],
        });
        const node = kernel.schema.nodes.source_fallback.create({
            markdown: "<x>\n",
            reason: "unsupported",
            sourceId: "source-0",
        });
        const doc = kernel.schema.nodes.doc.create(null, [node]);

        expect(kernel.serializeMarkdown(doc)).toBe("<!--<x>-->");
    });
});
