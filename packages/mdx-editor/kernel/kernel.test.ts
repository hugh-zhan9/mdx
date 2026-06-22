import { describe, expect, it } from "vitest";
import { defaultMarkdownSyntax } from "../syntax/default";
import { createMdxEditorKernel } from "./create-kernel";

describe("createMdxEditorKernel", () => {
    it("creates a schema and preserves basic markdown round-trip", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const parsed = kernel.parseMarkdown("# Title\n\nBody.\n");

        expect(kernel.schema.nodes.heading).toBeDefined();
        expect(parsed.doc.child(0).type.name).toBe("heading");
        expect(kernel.serializeMarkdown(parsed.doc)).toBe("# Title\n\nBody.\n");
    });

    it("creates editor node views and plugins from registry contributions", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });

        expect(kernel.createNodeViews().source_fallback).toBeDefined();
        expect(kernel.createEditorPlugins().length).toBeGreaterThan(0);
    });
});
