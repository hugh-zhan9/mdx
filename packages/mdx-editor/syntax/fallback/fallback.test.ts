import { describe, expect, it } from "vitest";
import { createMdxEditorKernel } from "../../kernel";
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
});
