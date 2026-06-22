// @vitest-environment jsdom

import { DOMSerializer } from "prosemirror-model";
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

    it("preserves legacy DOM markers on rendered link marks", () => {
        const kernel = createMdxEditorKernel({
            syntax: defaultMarkdownSyntax(),
        });
        const article = document.createElement("article");
        const serializer = DOMSerializer.fromSchema(kernel.schema);
        const linkMark = kernel.schema.marks.link.create({
            href: "https://example.com",
        });
        const wikilinkMark = kernel.schema.marks.link.create({
            href: "mdx-wikilink:Page",
        });
        const paragraph = kernel.schema.nodes.paragraph.create(null, [
            kernel.schema.text("link", [linkMark]),
            kernel.schema.text(" "),
            kernel.schema.text("wiki", [wikilinkMark]),
        ]);

        article.append(serializer.serializeNode(paragraph, { document }));

        const links = Array.from(article.querySelectorAll("a"));
        expect(links).toHaveLength(2);
        expect(links[0]?.getAttribute("data-mdx-node-type")).toBe("link");
        expect(links[1]?.getAttribute("data-mdx-node-type")).toBe("wikilink");
    });
});
