import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse-markdown";

describe("parseMarkdown", () => {
    it("parses heading, paragraph, wikilink, and normal link into editor nodes", () => {
        const parsed = parseMarkdown("# Title\n\nSee [[Page|Label]] and [site](https://example.com).\n");

        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.doc.type.name).toBe("doc");
        expect(parsed.doc.childCount).toBe(2);
        expect(parsed.doc.child(0).type.name).toBe("heading");
        expect(parsed.doc.child(0).attrs.level).toBe(1);
        expect(parsed.doc.textContent).toContain("Title");
        expect(parsed.doc.textContent).toContain("Label");
        expect(parsed.sourceSlices.length).toBeGreaterThan(0);
    });

    it("preserves frontmatter and mermaid fences as typed nodes", () => {
        const parsed = parseMarkdown("---\ntitle: Test\n---\n\n```mermaid\ngraph TD\n  A --> B\n```\n");

        expect(parsed.doc.child(0).type.name).toBe("frontmatter");
        expect(parsed.doc.child(1).type.name).toBe("code_block");
        expect(parsed.doc.child(1).attrs.language).toBe("mermaid");
    });
});
